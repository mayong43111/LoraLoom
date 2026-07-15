"""服务依赖注入。

集中管理 :class:`~app.services.api.DatasetService` 实例的创建，作为
service ↔ API 的唯一装配点。切换真实后端时只需修改此处。
"""

from __future__ import annotations

from functools import lru_cache

from app.services.api import DatasetService
from app.services.mock_service import MockDatasetService


@lru_cache(maxsize=1)
def get_service() -> DatasetService:
    """返回全局唯一的服务实例。

    当前返回 mock 实现；接入真实后端时替换为对应实现即可，
    路由层与前端均无需改动。
    """
    return MockDatasetService()
