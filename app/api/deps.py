"""服务依赖注入。

集中管理 :class:`~app.services.api.DatasetService` 实例的创建，作为
service ↔ API 的唯一装配点。切换真实后端时只需修改此处。
"""

from __future__ import annotations

from functools import lru_cache

from app.services.api import DatasetService
from app.services.sqlite_service import SqliteDatasetService


@lru_cache(maxsize=1)
def get_service() -> DatasetService:
    """返回全局唯一的服务实例。

    当前返回 SQLite 实现（首次启动自动播种样例数据）；接入真实算法管线时，
    在此处替换实现即可，路由层与前端均无需改动。
    """
    return SqliteDatasetService()
