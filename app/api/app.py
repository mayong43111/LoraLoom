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
import shutil
import subprocess
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.api.deps import get_service
from app.api.plugins import (
    PLUGINS_DIR,
    PluginError,
    discover_plugins,
    invoke_plugin,
)
from app.api.serialization import enum_metadata, to_jsonable
from app.domain.enums import DatasetType, Orientation, ReviewStatus, Usability
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


def _parse_enum(enum_type: type, raw: str | None):
    """把查询字符串解析为枚举；非法值返回 400。"""
    if raw is None or raw == "":
        return None
    try:
        return enum_type(raw)
    except ValueError as exc:  # noqa: PERF203 - 边界校验
        raise HTTPException(status_code=400, detail=f"非法取值: {raw}") from exc


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
    group_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        service.delete_image_group(group_id)
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"deleted": group_id}


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
        headers={"Cache-Control": "public, max-age=3600"},
    )



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
          "overwrite": true                # 是否覆盖已有 Caption（false 时仅填补空的）
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


def main() -> None:
    """本地启动入口。"""
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
