"""服务层。

服务层定义 UI 与数据/算法之间的边界。UI 只依赖 :class:`DatasetService`
抽象接口，不直接触碰存储或算法实现。当前提供 :class:`MockDatasetService`
用模拟数据响应请求，后续可替换为真实实现（SQLite + 算法管线）而不改动 UI。
"""

from app.services.api import DatasetService, ServiceError
from app.services.mock_service import MockDatasetService

__all__ = ["DatasetService", "ServiceError", "MockDatasetService"]
