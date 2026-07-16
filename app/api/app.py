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

import json
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.deps import get_service
from app.api.serialization import enum_metadata, to_jsonable
from app.domain.enums import Orientation, ReviewStatus, Usability
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


# -- 工具集合（外部动态注入） -----------------------------------------------
# 参考 ComfyUI 的自定义扩展目录：每个外部工具是 external_tools/ 下的一个子目录，
# 内含 manifest.json（元信息）与已构建的 JS 模块（默认 index.js）。前端查询
# /api/tools 拿到清单后，用原生动态 import 加载模块（经 /api/tool-assets 静态
# 服务），模块通过全局 window.DatasetToolkit 自注册。未来可从远端下载工具包
# 落盘到该目录，前端「刷新扩展」即可注入，无需重构主程序。
EXTERNAL_TOOLS_DIR = Path(__file__).resolve().parents[2] / "external_tools"


@app.get("/api/tools")
def list_external_tools() -> Any:
    """扫描外部工具目录，返回可加载的工具清单。"""
    tools: list[dict[str, Any]] = []
    if not EXTERNAL_TOOLS_DIR.exists():
        return tools
    for folder in sorted(EXTERNAL_TOOLS_DIR.iterdir()):
        manifest = folder / "manifest.json"
        if not folder.is_dir() or not manifest.exists():
            continue
        try:
            meta = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue  # 跳过损坏的工具包
        entry = meta.get("entry", "index.js")
        tools.append(
            {
                "id": meta.get("id", folder.name),
                "name": meta.get("name", folder.name),
                "description": meta.get("description", ""),
                "scopes": meta.get("scopes", ["video"]),
                "entry": f"/api/tool-assets/{folder.name}/{entry}",
            }
        )
    return tools


# 静态服务外部工具资源。挂载在 /api 之下以复用前端 Vite 的 /api 代理。
EXTERNAL_TOOLS_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/api/tool-assets",
    StaticFiles(directory=EXTERNAL_TOOLS_DIR),
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


def main() -> None:
    """本地启动入口。"""
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
