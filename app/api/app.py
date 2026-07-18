"""FastAPI 应用与路由。

路由按 UI 页面组织，直接调用 :class:`~app.services.api.DatasetService`，
并通过 :func:`~app.api.serialization.to_jsonable` 输出 JSON。
本层不包含业务逻辑，仅做请求解析、错误映射与序列化。

启动::

    uvicorn app.api.app:app --reload
    # 或
    python -m app.api.app
"""

from __future__ import annotations

import mimetypes
import os
import re
import shutil
import subprocess
import hashlib
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image as PILImage, ImageOps

from app.api.deps import get_service
from app.api.plugins import (
    PLUGINS_DIR,
    PluginError,
    discover_plugins,
    invoke_plugin,
)
from app.api.serialization import enum_metadata, to_jsonable
from app.domain.enums import DatasetType, Orientation, ReviewStatus, Usability
from app.services import export as export_service
from app.services import settings
from app.services.api import (
    DatasetService,
    ImageCreate,
    ImageFilter,
    ServiceError,
    VideoCreate,
    VideoFilter,
)

app = FastAPI(
    title="ImagesDataset API",
    version="0.1.0",
    description="图片数据集管理平台后端（当前为 mock 数据源）。",
)

# 开发期允许 Vite dev server 跨域访问；生产由同源部署或反向代理承接。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:7778",
        "http://127.0.0.1:7778",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_CAPTION_FORBIDDEN_PATTERNS = {
    "gender": re.compile(
        r"\b(?:man|woman|male|female|boy|girl|lady|gentleman)\b|男人|女人|男性|女性|男孩|女孩|女士|先生",
        re.IGNORECASE,
    ),
    "hair": re.compile(
        r"\b(?:hair|hairstyle|haired|bangs|ponytail|braids?)\b|头发|发型|刘海|马尾|辫子",
        re.IGNORECASE,
    ),
    "clothing": re.compile(
        r"\b(?:clothing|clothes|outfit|garment|top|shirt|t-shirt|blouse|jacket|coat|dress|skirt|pants|trousers|shorts|leggings|sportswear|uniform|shoe|shoes|sneakers?|boots?|sandals?|slippers?|socks?|stockings?|footwear|barefoot|bare feet)\b|衣着|衣服|上衣|衬衫|外套|裙子|裤子|短裤|鞋|袜|赤足|赤脚|光脚",
        re.IGNORECASE,
    ),
    "pose": re.compile(
        r"\b(?:pose|posture|standing|sitting|seated|lying|kneeling|squatting|walking|running|jumping|gesture|arms? raised|hands? on hips)\b|姿势|站立|坐着|坐姿|躺着|跪着|下蹲|行走|跑步|跳跃|手势",
        re.IGNORECASE,
    ),
    "framing": re.compile(
        r"\b(?:full[- ]body|three[- ]quarter|half[- ]body|upper[- ]body|close[- ]up|headshot|portrait crop|wide shot|medium shot)\b|全身|四分之三身|半身|上半身|近景|特写|头像|远景|中景",
        re.IGNORECASE,
    ),
    "background": re.compile(
        r"\b(?:background|setting|environment|indoors?|outdoors?|room|gym|studio|wall|floor|curtain|door|window|furniture)\b|背景|环境|室内|室外|房间|健身房|墙|地板|窗帘|门|窗|家具",
        re.IGNORECASE,
    ),
    "accessories": re.compile(
        r"\b(?:accessory|accessories|jewelry|glasses|eyeglasses|spectacles|hat|cap|earrings?|necklace|bracelet|watch)\b|饰品|配饰|首饰|眼镜|帽子|耳环|项链|手链|手表",
        re.IGNORECASE,
    ),
}


def _caption_forbidden_aspects(caption: str, excluded_aspects: list[str]) -> list[str]:
    """返回 Caption 中实际出现的已排除描述类别。"""
    return [
        aspect
        for aspect in excluded_aspects
        if (pattern := _CAPTION_FORBIDDEN_PATTERNS.get(aspect))
        and pattern.search(caption)
    ]


def _parse_enum(enum_type: type, raw: str | None):
    """把查询字符串解析为枚举；非法值返回 400。"""
    if raw is None or raw == "":
        return None
    try:
        return enum_type(raw)
    except ValueError as exc:  # noqa: PERF203 - 边界校验
        raise HTTPException(status_code=400, detail=f"非法取值: {raw}") from exc


def _normalized_path(raw_path: str) -> str:
    return os.path.normcase(str(Path(raw_path).resolve(strict=False)))


def _delete_unreferenced_managed_images(
    candidate_paths: list[str], referenced_paths: set[str]
) -> int:
    """删除托管目录内已无图片记录引用的文件。"""
    managed_root = (Path.cwd() / "workspace" / "images").resolve(strict=False)
    normalized_references = {
        _normalized_path(path) for path in referenced_paths if path
    }
    deleted = 0
    for raw_path in set(candidate_paths):
        if not raw_path:
            continue
        path = Path(raw_path).resolve(strict=False)
        try:
            path.relative_to(managed_root)
        except ValueError:
            continue
        if _normalized_path(raw_path) in normalized_references or not path.is_file():
            continue
        try:
            path.unlink()
            deleted += 1
        except OSError:
            continue
    return deleted


# -- 元信息 -----------------------------------------------------------------
@app.get("/api/meta/enums")
def get_enum_meta() -> dict[str, Any]:
    """返回枚举展示名映射，供前端渲染标签文案。"""
    return enum_metadata()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/meta/source")
def get_data_source(service: DatasetService = Depends(get_service)) -> dict[str, Any]:
    """返回当前数据源信息（SQLite 数据库文件的绝对路径），供前端展示。"""
    path = getattr(service, "db_path", None)
    return {"kind": "sqlite", "path": path}


# -- 设置：LLM 配置 ---------------------------------------------------------
@app.get("/api/settings/llm")
def get_llm_settings() -> dict[str, Any]:
    """返回 LLM 配置（不含明文密钥，仅标记是否已设置）。"""
    return settings.get_llm_config()


@app.put("/api/settings/llm")
def update_llm_settings(payload: dict[str, Any]) -> dict[str, Any]:
    """保存 LLM 配置；api_key 为空时保留原密钥。"""
    try:
        return settings.save_llm_config(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/settings/llm/test")
def test_llm_settings() -> dict[str, Any]:
    """用当前保存的配置发起一次最小请求以验证连通性。"""
    return settings.test_llm_connection()


# -- 设置：标注（统一设定，如触发词） --------------------------------------
@app.get("/api/settings/annotation")
def get_annotation_settings() -> dict[str, Any]:
    """返回标注统一设定（触发词等）。"""
    return settings.get_annotation_config()


@app.put("/api/settings/annotation")
def update_annotation_settings(payload: dict[str, Any]) -> dict[str, Any]:
    """保存标注统一设定。"""
    return settings.save_annotation_config(payload)


# -- Dashboard --------------------------------------------------------------
@app.get("/api/stats")
def get_stats(service: DatasetService = Depends(get_service)) -> Any:
    return to_jsonable(service.get_stats())


# -- 导入 -------------------------------------------------------------------
@app.get("/api/import-batches")
def list_import_batches(service: DatasetService = Depends(get_service)) -> Any:
    return to_jsonable(service.list_import_batches())


# -- 下载 -------------------------------------------------------------------
@app.get("/api/downloads")
def list_downloads(service: DatasetService = Depends(get_service)) -> Any:
    return to_jsonable(service.list_download_tasks())


# -- 图片库 -----------------------------------------------------------------
@app.get("/api/image-groups")
def list_image_groups(service: DatasetService = Depends(get_service)) -> Any:
    return to_jsonable(service.list_image_groups())


@app.post("/api/image-groups", status_code=201)
def create_image_group(
    payload: dict[str, Any], service: DatasetService = Depends(get_service)
) -> Any:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="分组名称不能为空")
    group = service.create_image_group(name, payload.get("description", ""))
    return to_jsonable(group)


@app.patch("/api/image-groups/{group_id}")
def update_image_group(
    group_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    kwargs: dict[str, Any] = {}
    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="分组名称不能为空")
        kwargs["name"] = name
    if "description" in payload:
        kwargs["description"] = payload.get("description") or ""
    try:
        return to_jsonable(service.update_image_group(group_id, **kwargs))
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/image-groups/{group_id}")
def delete_image_group(
    group_id: str,
    delete_images: bool = Query(default=False),
    service: DatasetService = Depends(get_service),
) -> Any:
    members = list(service.list_images(ImageFilter(group_id=group_id)))
    candidate_paths = [image.image_path for image in members]
    try:
        service.delete_image_group(group_id, delete_images=delete_images)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    deleted_files = 0
    if delete_images:
        referenced_paths = {
            image.image_path for image in service.list_images() if image.image_path
        }
        deleted_files = _delete_unreferenced_managed_images(
            candidate_paths, referenced_paths
        )
    return {
        "deleted": group_id,
        "deleted_images": len(members) if delete_images else 0,
        "deleted_files": deleted_files,
    }


@app.get("/api/images")
def list_images(
    service: DatasetService = Depends(get_service),
    person_id: str | None = Query(default=None),
    orientation: str | None = Query(default=None),
    usability: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    quality_flag: str | None = Query(default=None),
    group_id: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
) -> Any:
    image_filter = ImageFilter(
        person_id=person_id or None,
        orientation=_parse_enum(Orientation, orientation),
        usability=_parse_enum(Usability, usability),
        review_status=_parse_enum(ReviewStatus, review_status),
        quality_flag=quality_flag or None,
        group_id=group_id or None,
        tag=tag or None,
        keyword=keyword or None,
    )
    return to_jsonable(service.list_images(image_filter))


@app.post("/api/images", status_code=201)
def create_image(
    payload: dict[str, Any], service: DatasetService = Depends(get_service)
) -> Any:
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="图片名称不能为空")
    create = ImageCreate(
        title=title,
        group_id=payload.get("group_id") or None,
        tags=list(payload.get("tags", [])),
        width=int(payload.get("width", 0) or 0),
        height=int(payload.get("height", 0) or 0),
        path=payload.get("path", ""),
    )
    try:
        return to_jsonable(service.create_image(create))
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/images/{image_id}")
def get_image(
    image_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        return to_jsonable(service.get_image(image_id))
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/images/{image_id}/raw")
def get_image_raw(
    image_id: str, service: DatasetService = Depends(get_service)
) -> Response:
    """返回图片原始字节，供前端 <img> 直接渲染真实图片。"""
    try:
        image = service.get_image(image_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = getattr(image, "image_path", "") or ""
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="图片文件不存在")
    content_type = mimetypes.guess_type(path)[0] or "image/jpeg"
    with open(path, "rb") as fh:
        data = fh.read()
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "no-cache"},
    )


_IMAGE_DIR = Path.cwd() / "workspace" / "images"
_FACE_MODEL = (
    Path(__file__).resolve().parents[1]
    / "plugins"
    / "pose-face-annotation"
    / "models"
    / "face_detection_yunet_2023mar.onnx"
)


def _fit_image_crop(
    center_x: float,
    top: float,
    crop_width: float,
    crop_height: float,
    image_width: int,
    image_height: int,
) -> dict[str, int]:
    width = min(round(crop_width), image_width)
    height = min(round(crop_height), image_height)
    left = round(max(0.0, min(center_x - width / 2, image_width - width)))
    top_int = round(max(0.0, min(top, image_height - height)))
    return {"x": left, "y": top_int, "width": width, "height": height}


@app.get("/api/images/{image_id}/crop-suggestion")
def get_image_crop_suggestion(
    image_id: str,
    mode: str = Query("head", pattern="^(head|closeup)$"),
    service: DatasetService = Depends(get_service),
) -> Any:
    try:
        import cv2
        import numpy as np
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="自动裁剪需要 OpenCV 与 NumPy") from exc
    try:
        image = service.get_image(image_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = Path(image.image_path or "")
    data = np.fromfile(path, dtype=np.uint8) if path.is_file() else np.array([], dtype=np.uint8)
    source = cv2.imdecode(data, cv2.IMREAD_COLOR) if data.size else None
    if source is None:
        raise HTTPException(status_code=400, detail="图片文件无法读取")
    image_height, image_width = source.shape[:2]
    scale = min(1.0, 1280 / max(image_width, image_height))
    detected = source if scale == 1 else cv2.resize(source, (round(image_width * scale), round(image_height * scale)))
    if not _FACE_MODEL.is_file():
        raise HTTPException(status_code=503, detail="缺少人脸检测模型")
    detector = cv2.FaceDetectorYN.create(str(_FACE_MODEL), "", (detected.shape[1], detected.shape[0]), 0.6, 0.3, 5000)
    _, faces = detector.detect(detected)
    if faces is None or len(faces) == 0:
        raise HTTPException(status_code=422, detail="未检测到人脸，请选择其他图片")
    face = max(faces, key=lambda row: float(row[2]) * float(row[3])).copy()
    face[:4] /= scale
    x, y, face_width, face_height = (float(face[index]) for index in range(4))
    center_x = x + face_width / 2
    if mode == "head":
        box = _fit_image_crop(center_x, y - face_height * 0.72, face_height * 2.35, face_height * 2.35, image_width, image_height)
    else:
        crop_height = face_height * 4.6
        box = _fit_image_crop(center_x, y - face_height * 0.78, crop_height * 0.75, crop_height, image_width, image_height)
    return {"image_id": image_id, "source_width": image_width, "source_height": image_height, "mode": mode, "crop": box}


@app.post("/api/images/{image_id}/crop")
def crop_image(
    image_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    try:
        image = service.get_image(image_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    source_path = Path(image.image_path or "")
    previous_path = image.image_path
    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="图片文件不存在")
    try:
        with PILImage.open(source_path) as loaded:
            source = ImageOps.exif_transpose(loaded).convert("RGB")
    except OSError as exc:
        raise HTTPException(status_code=400, detail="图片文件无法读取") from exc
    try:
        left = int(payload["x"])
        top = int(payload["y"])
        width = int(payload["width"])
        height = int(payload["height"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="裁剪范围格式错误") from exc
    if width < 256 or height < 256:
        raise HTTPException(status_code=400, detail="裁剪结果至少需要 256×256 像素")
    if left < 0 or top < 0 or left + width > source.width or top + height > source.height:
        raise HTTPException(status_code=400, detail="裁剪范围超出原图")
    cropped = source.crop((left, top, left + width, top + height))
    _IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    output = _IMAGE_DIR / f"crop-edit-{uuid4().hex[:16]}.jpg"
    cropped.save(output, format="JPEG", quality=95, optimize=True)
    try:
        stored_path = output.relative_to(Path.cwd())
    except ValueError:
        stored_path = output
    relative_path = str(stored_path).replace("\\", "/")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()[:16]
    tags = list(dict.fromkeys([*image.tags, "人工裁剪", f"裁剪来源:{image_id}"]))
    try:
        updated = service.update_image(
            image_id,
            image_path=relative_path,
            width=cropped.width,
            height=cropped.height,
            sha256=digest,
            tags=tags,
        )
    except Exception:
        output.unlink(missing_ok=True)
        raise
    return {"image": to_jsonable(updated), "previous_path": previous_path, "output_path": relative_path}


@app.post("/api/images/{image_id}/upscale")
def upscale_image(
    image_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    try:
        image = service.get_image(image_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    source_path = Path(image.image_path or "")
    previous_path = image.image_path
    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="图片文件不存在")
    try:
        target_short_side = int(payload["target_short_side"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="目标短边格式错误") from exc
    if target_short_side < 512 or target_short_side > 4096:
        raise HTTPException(status_code=400, detail="目标短边需要在 512 到 4096 之间")
    try:
        with PILImage.open(source_path) as loaded:
            source = ImageOps.exif_transpose(loaded).convert("RGB")
    except OSError as exc:
        raise HTTPException(status_code=400, detail="图片文件无法读取") from exc
    source_short_side = min(source.size)
    if target_short_side <= source_short_side:
        raise HTTPException(
            status_code=400,
            detail=f"目标短边必须大于当前短边 {source_short_side}",
        )
    scale = target_short_side / source_short_side
    target_size = (
        round(source.width * scale),
        round(source.height * scale),
    )
    upscaled = source.resize(target_size, PILImage.Resampling.LANCZOS)
    _IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    output = _IMAGE_DIR / f"upscale-{uuid4().hex[:16]}.jpg"
    upscaled.save(output, format="JPEG", quality=95, optimize=True)
    try:
        stored_path = output.relative_to(Path.cwd())
    except ValueError:
        stored_path = output
    relative_path = str(stored_path).replace("\\", "/")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()[:16]
    tags = list(
        dict.fromkeys(
            [
                *image.tags,
                "分辨率提升",
                f"提升来源:{source.width}x{source.height}",
            ]
        )
    )
    try:
        updated = service.update_image(
            image_id,
            image_path=relative_path,
            width=upscaled.width,
            height=upscaled.height,
            sha256=digest,
            tags=tags,
        )
    except Exception:
        output.unlink(missing_ok=True)
        raise
    return {
        "image": to_jsonable(updated),
        "previous_path": previous_path,
        "output_path": relative_path,
    }



@app.patch("/api/images/{image_id}")
def update_image(
    image_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    kwargs: dict[str, Any] = {}
    if "title" in payload:
        title = (payload.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="图片名称不能为空")
        kwargs["title"] = title
    if "tags" in payload:
        kwargs["tags"] = list(payload.get("tags") or [])
    if "caption" in payload:
        kwargs["caption"] = str(payload.get("caption") or "")
    if "group_id" in payload:
        kwargs["group_id"] = payload.get("group_id") or None
    try:
        return to_jsonable(service.update_image(image_id, **kwargs))
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/images/{image_id}/copy", status_code=201)
def copy_image(
    image_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    try:
        return to_jsonable(
            service.copy_image(image_id, group_id=payload.get("group_id") or None)
        )
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/images/{image_id}")
def delete_image(
    image_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        service.delete_image(image_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"deleted": image_id}


# -- 抽帧 -------------------------------------------------------------------
@app.get("/api/frame-jobs")
def list_frame_jobs(service: DatasetService = Depends(get_service)) -> Any:
    return to_jsonable(service.list_frame_jobs())


# -- 视频库 -----------------------------------------------------------------
@app.get("/api/video-groups")
def list_video_groups(service: DatasetService = Depends(get_service)) -> Any:
    return to_jsonable(service.list_video_groups())


@app.post("/api/video-groups", status_code=201)
def create_video_group(
    payload: dict[str, Any], service: DatasetService = Depends(get_service)
) -> Any:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="分组名称不能为空")
    group = service.create_video_group(name, payload.get("description", ""))
    return to_jsonable(group)


@app.patch("/api/video-groups/{group_id}")
def update_video_group(
    group_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    kwargs: dict[str, Any] = {}
    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="分组名称不能为空")
        kwargs["name"] = name
    if "description" in payload:
        kwargs["description"] = payload.get("description") or ""
    try:
        return to_jsonable(service.update_video_group(group_id, **kwargs))
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/video-groups/{group_id}")
def delete_video_group(
    group_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        service.delete_video_group(group_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"deleted": group_id}


@app.get("/api/videos")
def list_videos(
    service: DatasetService = Depends(get_service),
    group_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
) -> Any:
    video_filter = VideoFilter(
        group_id=group_id or None,
        status=status or None,
        source_type=source_type or None,
        tag=tag or None,
        keyword=keyword or None,
    )
    return to_jsonable(service.list_videos(video_filter))


@app.post("/api/videos", status_code=201)
def create_video(
    payload: dict[str, Any], service: DatasetService = Depends(get_service)
) -> Any:
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="视频名称不能为空")
    create = VideoCreate(
        title=title,
        group_id=payload.get("group_id") or None,
        tags=list(payload.get("tags", [])),
        duration=float(payload.get("duration", 0) or 0),
        width=int(payload.get("width", 0) or 0),
        height=int(payload.get("height", 0) or 0),
        fps=float(payload.get("fps", 25) or 25),
        size_bytes=int(payload.get("size_bytes", 0) or 0),
        path=payload.get("path", ""),
    )
    try:
        return to_jsonable(service.create_video(create))
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/videos/{video_id}")
def get_video(
    video_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        return to_jsonable(service.get_video(video_id))
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.patch("/api/videos/{video_id}")
def update_video(
    video_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    kwargs: dict[str, Any] = {}
    if "title" in payload:
        title = (payload.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="视频名称不能为空")
        kwargs["title"] = title
    if "tags" in payload:
        kwargs["tags"] = list(payload.get("tags") or [])
    if "caption" in payload:
        kwargs["caption"] = str(payload.get("caption") or "")
    if "group_id" in payload:
        kwargs["group_id"] = payload.get("group_id") or None
    try:
        return to_jsonable(service.update_video(video_id, **kwargs))
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/videos/{video_id}/copy", status_code=201)
def copy_video(
    video_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    try:
        return to_jsonable(
            service.copy_video(video_id, group_id=payload.get("group_id") or None)
        )
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/videos/{video_id}")
def delete_video(
    video_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        service.delete_video(video_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"deleted": video_id}


@app.get("/api/videos/{video_id}/frame-job")
def get_video_frame_job(
    video_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    return to_jsonable(service.get_video_frame_job(video_id))


@app.post("/api/videos/{video_id}/extract-frames")
def extract_frames(
    video_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    interval = float(payload.get("interval", 1.0) or 1.0)
    if interval <= 0:
        raise HTTPException(status_code=400, detail="抽帧间隔必须大于 0")
    try:
        return to_jsonable(service.run_frame_extraction(video_id, interval))
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# 视频流式播放：支持 HTTP Range，供抽帧工具的原生 <video> 定位/拖动。
_STREAM_CHUNK = 1024 * 1024  # 1 MiB


def _parse_range(header: str, file_size: int) -> tuple[int, int] | None:
    """解析 ``Range: bytes=start-end``，返回闭区间 ``(start, end)``；非法返回 None。"""
    if not header or not header.strip().lower().startswith("bytes="):
        return None
    spec = header.split("=", 1)[1].split(",", 1)[0].strip()
    start_s, _, end_s = spec.partition("-")
    try:
        if start_s == "":
            # 后缀形式 bytes=-N：请求最后 N 字节。
            length = int(end_s)
            if length <= 0:
                return None
            start = max(file_size - length, 0)
            end = file_size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else file_size - 1
    except ValueError:
        return None
    if start > end or start >= file_size:
        return None
    return start, min(end, file_size - 1)


@app.get("/api/videos/{video_id}/stream")
def stream_video(
    video_id: str,
    request: Request,
    service: DatasetService = Depends(get_service),
) -> Response:
    try:
        video = service.get_video(video_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = video.path
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="视频文件不存在")
    file_size = os.path.getsize(path)
    content_type = mimetypes.guess_type(path)[0] or "video/mp4"

    rng = _parse_range(request.headers.get("range", ""), file_size)
    if rng is None:
        # 无 Range：整段返回，但仍声明支持 Range。
        def _iter_all() -> Any:
            with open(path, "rb") as fh:
                while chunk := fh.read(_STREAM_CHUNK):
                    yield chunk

        return StreamingResponse(
            _iter_all(),
            media_type=content_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            },
        )

    start, end = rng
    length = end - start + 1

    def _iter_range() -> Any:
        remaining = length
        with open(path, "rb") as fh:
            fh.seek(start)
            while remaining > 0:
                chunk = fh.read(min(_STREAM_CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Content-Length": str(length),
    }
    return StreamingResponse(
        _iter_range(), status_code=206, media_type=content_type, headers=headers
    )


# 视频封面缩略图：首次访问用 ffmpeg 抽一帧生成并缓存，之后直接读缓存文件。
_VIDEO_THUMB_DIR = Path.cwd() / "workspace" / "video_thumbs"


def _resolve_ffmpeg() -> str | None:
    """解析 ffmpeg 可执行文件：imageio-ffmpeg 自带二进制 → 系统 PATH。"""
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001 - 缺失时回退 PATH
        pass
    return shutil.which("ffmpeg")


def _generate_video_thumb(src: str, dest: Path, t: float, max_w: int = 480) -> bool:
    """在时间点 ``t`` 抽一帧写入 ``dest``，成功返回 True。"""
    exe = _resolve_ffmpeg()
    if not exe:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            exe,
            "-nostdin",
            "-loglevel",
            "error",
            "-ss",
            f"{max(t, 0.0):.3f}",
            "-i",
            src,
            "-frames:v",
            "1",
            "-an",
            "-vf",
            f"scale='min({max_w},iw)':-2",
            "-c:v",
            "mjpeg",
            "-q:v",
            "3",
            "-y",
            str(dest),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return proc.returncode == 0 and dest.is_file() and dest.stat().st_size > 0


@app.get("/api/videos/{video_id}/thumbnail")
def get_video_thumbnail(
    video_id: str, service: DatasetService = Depends(get_service)
) -> Response:
    """返回视频封面缩略图；首次生成后缓存，后续直接读取缓存文件。"""
    try:
        video = service.get_video(video_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    cache = _VIDEO_THUMB_DIR / f"{video_id}.jpg"
    if not cache.is_file():
        path = video.path
        if not path or not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="视频文件不存在")
        duration = getattr(video, "duration", 0) or 0
        # 取靠前的代表帧：约 10% 处，最多 1 秒，避免片头黑场也避免超长等待。
        timestamp = min(1.0, duration * 0.1) if duration > 0 else 0.0
        if not _generate_video_thumb(path, cache, timestamp):
            raise HTTPException(status_code=404, detail="封面生成失败")

    data = cache.read_bytes()
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


# -- 工具集合（插件化动态注入 + 统一后端调用） -----------------------------
# 参考 ComfyUI 的自定义扩展目录：每个工具是 app/plugins/ 下的一个子目录，
# 内含 manifest.json（元信息）、前端 index.js（浏览器原生动态 import 自注册）
# 与可选的 handler.py（后端处理逻辑）。前端查询 /api/tools 拿到清单后动态加载
# 前端模块；需要后端处理时统一走 POST /api/tools/{id}/invoke，服务器动态导入
# 对应插件的 handler 并执行。打包好的插件直接丢进 app/plugins/ 即自动注册。
@app.get("/api/tools")
def list_external_tools() -> Any:
    """扫描插件目录，返回可加载的工具清单。"""
    return discover_plugins()


@app.post("/api/tools/{tool_id}/invoke")
def invoke_tool(
    tool_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    """统一工具调用接口：分发到插件 handler 的 invoke(action, payload, service)。"""
    action = payload.get("action", "")
    body = payload.get("payload", {})
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="payload 必须是对象")
    try:
        result = invoke_plugin(tool_id, action, body, service)
    except PluginError as exc:
        # 插件不存在 → 404；其余（执行/加载错误）→ 400。
        detail = str(exc)
        status = 404 if detail.startswith("插件不存在") else 400
        raise HTTPException(status_code=status, detail=detail) from exc
    return to_jsonable(result)


# 静态服务插件前端资源。挂载在 /api 之下以复用前端 Vite 的 /api 代理。
PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/api/tool-assets",
    StaticFiles(directory=PLUGINS_DIR),
    name="tool-assets",
)


# -- 人物 -------------------------------------------------------------------
@app.get("/api/people")
def list_people(service: DatasetService = Depends(get_service)) -> Any:
    return to_jsonable(service.list_people())


# -- 复核 -------------------------------------------------------------------
@app.get("/api/review-queue")
def list_review_queue(
    service: DatasetService = Depends(get_service),
    only_unreviewed: bool = Query(default=True),
) -> Any:
    return to_jsonable(service.list_review_queue(only_unreviewed=only_unreviewed))


@app.patch("/api/images/{image_id}/annotation")
def update_annotation(
    image_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    orientation = _parse_enum(Orientation, payload.get("orientation"))
    usability = _parse_enum(Usability, payload.get("usability"))
    try:
        image = service.update_annotation(
            image_id, orientation=orientation, usability=usability
        )
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return to_jsonable(image)


# -- 组包 -------------------------------------------------------------------
@app.get("/api/selections")
def list_selections(service: DatasetService = Depends(get_service)) -> Any:
    return to_jsonable(service.list_selections())


@app.get("/api/selections/{selection_id}")
def get_selection(
    selection_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        return to_jsonable(service.get_selection(selection_id))
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# -- 数据集 -----------------------------------------------------------------
@app.get("/api/datasets")
def list_datasets(service: DatasetService = Depends(get_service)) -> Any:
    return to_jsonable(service.list_datasets())


@app.post("/api/datasets", status_code=201)
def create_dataset(
    payload: dict[str, Any], service: DatasetService = Depends(get_service)
) -> Any:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="数据集名称不能为空")
    try:
        ds_type = DatasetType(payload.get("type"))
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"非法的数据集类型: {payload.get('type')}"
        ) from exc
    ds = service.create_dataset(name, ds_type, payload.get("description", ""))
    return to_jsonable(ds)


@app.get("/api/datasets/{dataset_id}")
def get_dataset(
    dataset_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        return to_jsonable(service.get_dataset(dataset_id))
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.patch("/api/datasets/{dataset_id}")
def update_dataset(
    dataset_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    kwargs: dict[str, Any] = {}
    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="数据集名称不能为空")
        kwargs["name"] = name
    if "description" in payload:
        kwargs["description"] = payload.get("description") or ""
    try:
        return to_jsonable(service.update_dataset(dataset_id, **kwargs))
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(
    dataset_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        service.delete_dataset(dataset_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"deleted": dataset_id}


@app.get("/api/datasets/{dataset_id}/items")
def list_dataset_items(
    dataset_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        ds = service.get_dataset(dataset_id)
        if ds.type == DatasetType.IMAGE:
            items = service.list_dataset_images(dataset_id)
        else:
            items = service.list_dataset_videos(dataset_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"type": ds.type.value, "items": to_jsonable(items)}


@app.post("/api/datasets/{dataset_id}/items")
def add_dataset_items(
    dataset_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    item_ids = payload.get("item_ids") or []
    if not isinstance(item_ids, list):
        raise HTTPException(status_code=400, detail="item_ids 必须为数组")
    try:
        return to_jsonable(service.add_dataset_items(dataset_id, item_ids))
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/datasets/{dataset_id}/items/remove")
def remove_dataset_items(
    dataset_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    item_ids = payload.get("item_ids") or []
    if not isinstance(item_ids, list):
        raise HTTPException(status_code=400, detail="item_ids 必须为数组")
    try:
        return to_jsonable(service.remove_dataset_items(dataset_id, item_ids))
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/datasets/{dataset_id}/items/{item_id}")
def update_dataset_item(
    dataset_id: str,
    item_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Any:
    kwargs: dict[str, Any] = {}
    if "caption" in payload:
        kwargs["caption"] = payload.get("caption") or ""
    if "tags" in payload:
        tags = payload.get("tags") or []
        if not isinstance(tags, list):
            raise HTTPException(status_code=400, detail="tags 必须为数组")
        kwargs["tags"] = [str(t) for t in tags]
    try:
        item = service.update_dataset_item(dataset_id, item_id, **kwargs)
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return to_jsonable(item)


@app.post("/api/datasets/{dataset_id}/annotate")
def annotate_dataset_items(
    dataset_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> dict[str, Any]:
    """使用已配置的 LLM 视觉模型批量/单独为数据集图片生成 Caption。

    请求体::

        {
          "item_ids": ["img-..."],       # 需要标注的条目
          "system_prompt": "...",         # 前端拼装、对用户可见的系统提示词
          "user_text": "...",             # 可选，用户侧提示
          "trigger_word": "...",          # 可选，触发词
          "prepend_trigger": true,         # 是否把触发词加入生成答案
          "overwrite": true,               # 是否覆盖已有 Caption（false 时仅填补空的）
          "excluded_aspects": ["clothing"] # 可选，答案中禁止出现的描述类别
        }

    仅覆盖当前数据集内的 Caption（copy-on-write），不影响素材库原图。
    逐条返回结果，单条失败不影响其它条目。
    """
    item_ids = payload.get("item_ids") or []
    if not isinstance(item_ids, list) or not item_ids:
        raise HTTPException(status_code=400, detail="item_ids 必须为非空数组")
    system_prompt = str(payload.get("system_prompt") or "").strip()
    if not system_prompt:
        raise HTTPException(status_code=400, detail="system_prompt 不能为空")
    user_text = str(payload.get("user_text") or "").strip()
    trigger_word = str(payload.get("trigger_word") or "").strip()
    prepend_trigger = bool(payload.get("prepend_trigger"))
    overwrite = bool(payload.get("overwrite", True))
    raw_excluded_aspects = payload.get("excluded_aspects") or []
    if not isinstance(raw_excluded_aspects, list) or not all(
        isinstance(aspect, str) for aspect in raw_excluded_aspects
    ):
        raise HTTPException(status_code=400, detail="excluded_aspects 必须为字符串数组")
    excluded_aspects = [
        aspect
        for aspect in dict.fromkeys(raw_excluded_aspects)
        if aspect in _CAPTION_FORBIDDEN_PATTERNS
    ]

    try:
        ds = service.get_dataset(dataset_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if ds.type != DatasetType.IMAGE:
        raise HTTPException(status_code=400, detail="AI 标注目前仅支持图片数据集")

    existing = {it.id: it for it in service.list_dataset_images(dataset_id)}

    results: list[dict[str, Any]] = []
    for item_id in item_ids:
        current = existing.get(item_id)
        if current is None:
            results.append(
                {"item_id": item_id, "ok": False, "error": "条目不在数据集中"}
            )
            continue
        if not overwrite and (current.caption or "").strip():
            results.append(
                {
                    "item_id": item_id,
                    "ok": True,
                    "skipped": True,
                    "caption": current.caption,
                }
            )
            continue
        try:
            image = service.get_image(item_id)
            path = getattr(image, "image_path", "") or ""
            if not path or not os.path.isfile(path):
                raise settings.LLMError("图片文件不存在")
            mime = mimetypes.guess_type(path)[0] or "image/jpeg"
            with open(path, "rb") as fh:
                data = fh.read()
            answer = settings.caption_image(system_prompt, data, mime, user_text)
            violations = _caption_forbidden_aspects(answer, excluded_aspects)
            if violations:
                retry_prompt = (
                    f"{system_prompt} Your previous answer violated these forbidden "
                    f"categories: {', '.join(violations)}. Regenerate the caption and "
                    "remove every phrase from those categories."
                )
                answer = settings.caption_image(retry_prompt, data, mime, user_text)
                violations = _caption_forbidden_aspects(answer, excluded_aspects)
                if violations:
                    raise settings.LLMError(
                        "Caption 仍包含已关闭的描述维度："
                        + ", ".join(violations)
                    )
            caption = answer
            if prepend_trigger and trigger_word:
                caption = f"{trigger_word}, {answer}" if answer else trigger_word
            service.update_dataset_item(dataset_id, item_id, caption=caption)
            results.append({"item_id": item_id, "ok": True, "caption": caption})
        except (settings.LLMError, ServiceError) as exc:
            results.append({"item_id": item_id, "ok": False, "error": str(exc)})
        except Exception as exc:  # noqa: BLE001 - 单条兜底，不中断批量
            results.append({"item_id": item_id, "ok": False, "error": str(exc)})

    return {"results": results}


@app.get("/api/datasets/export/options")
def get_export_options() -> dict[str, Any]:
    """返回导出（ai-toolkit）可选的底模与训练预设。"""
    presets = [
        {
            "value": key,
            "label": cfg["label"],
            "rank": cfg["rank"],
            "steps_per_image": cfg["steps_per_image"],
        }
        for key, cfg in export_service.TRAINING_PRESETS.items()
    ]
    return {"base_models": export_service.BASE_MODELS, "presets": presets}


@app.post("/api/datasets/{dataset_id}/export")
def export_dataset(
    dataset_id: str,
    payload: dict[str, Any],
    service: DatasetService = Depends(get_service),
) -> Response:
    """把图片数据集导出为 ai-toolkit 的 LoRA 训练包（zip）。

    请求体（均可选，缺省走预设）::

        {
          "base_model": "Qwen/Qwen-Image-2512",
          "preset": "character" | "action" | "style" | "general",
          "trigger_word": "...",
          "rank": 32,
          "steps": 2000,            # 指定则优先，否则按张数×每图步数
          "steps_per_image": 100,
          "resolution": [512, 768, 1024],
          "sample_prompts": ["..."],
          "item_ids": ["img-..."],  # 指定则仅导出这些条目，否则全部
          "only_captioned": true     # 仅导出已有 Caption 的图片
        }
    """
    try:
        ds = service.get_dataset(dataset_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if ds.type != DatasetType.IMAGE:
        raise HTTPException(status_code=400, detail="导出目前仅支持图片数据集")

    images = list(service.list_dataset_images(dataset_id))
    item_ids = payload.get("item_ids")
    if isinstance(item_ids, list) and item_ids:
        wanted = {str(i) for i in item_ids}
        images = [im for im in images if im.id in wanted]
    if not images:
        raise HTTPException(status_code=400, detail="没有可导出的图片")

    resolution = payload.get("resolution")
    if resolution is not None:
        if not isinstance(resolution, list) or not all(
            isinstance(r, (int, float)) for r in resolution
        ):
            raise HTTPException(status_code=400, detail="resolution 必须为数字数组")
        resolution = [int(r) for r in resolution]
    sample_prompts = payload.get("sample_prompts")
    if sample_prompts is not None and not isinstance(sample_prompts, list):
        raise HTTPException(status_code=400, detail="sample_prompts 必须为数组")

    opts = export_service.ExportOptions(
        base_model=str(payload.get("base_model") or "Qwen/Qwen-Image-2512").strip(),
        preset=str(payload.get("preset") or "character"),
        trigger_word=str(payload.get("trigger_word") or "").strip(),
        rank=int(payload["rank"]) if payload.get("rank") else None,
        steps=int(payload["steps"]) if payload.get("steps") else None,
        steps_per_image=(
            int(payload["steps_per_image"])
            if payload.get("steps_per_image")
            else None
        ),
        resolution=resolution,
        sample_prompts=(
            [str(p) for p in sample_prompts] if sample_prompts else None
        ),
        only_captioned=bool(payload.get("only_captioned", True)),
    )

    data, filename, count = export_service.build_export_zip(ds.name, images, opts)
    if count == 0:
        raise HTTPException(
            status_code=400,
            detail="没有满足条件的图片可导出（可能都缺少 Caption 或文件缺失）",
        )
    ascii_name = filename.encode("ascii", "ignore").decode("ascii") or "export.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{ascii_name}\"; "
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "X-Export-Count": str(count),
        },
    )


def main() -> None:
    """本地启动入口。"""
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
