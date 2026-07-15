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

from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import get_service
from app.api.serialization import enum_metadata, to_jsonable
from app.domain.enums import Orientation, ReviewStatus, Usability
from app.services.api import DatasetService, ImageFilter, ServiceError

app = FastAPI(
    title="ImagesDataset API",
    version="0.1.0",
    description="图片数据集管理平台后端（当前为 mock 数据源）。",
)

# 开发期允许 Vite dev server 跨域访问；生产由同源部署或反向代理承接。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
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
@app.get("/api/images")
def list_images(
    service: DatasetService = Depends(get_service),
    person_id: str | None = Query(default=None),
    orientation: str | None = Query(default=None),
    usability: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    quality_flag: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
) -> Any:
    image_filter = ImageFilter(
        person_id=person_id or None,
        orientation=_parse_enum(Orientation, orientation),
        usability=_parse_enum(Usability, usability),
        review_status=_parse_enum(ReviewStatus, review_status),
        quality_flag=quality_flag or None,
        keyword=keyword or None,
    )
    return to_jsonable(service.list_images(image_filter))


@app.get("/api/images/{image_id}")
def get_image(
    image_id: str, service: DatasetService = Depends(get_service)
) -> Any:
    try:
        return to_jsonable(service.get_image(image_id))
    except ServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# -- 抽帧 -------------------------------------------------------------------
@app.get("/api/frame-jobs")
def list_frame_jobs(service: DatasetService = Depends(get_service)) -> Any:
    return to_jsonable(service.list_frame_jobs())


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
