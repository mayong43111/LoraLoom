"""服务层。

服务层定义 UI 与数据/算法之间的边界。上层只依赖 :class:`DatasetService`
抽象接口，不直接触碰存储或算法实现。默认实现为 :class:`SqliteDatasetService`
（SQLite 持久化，首次启动用确定性样例数据播种）；:class:`MockDatasetService`
为纯内存实现，用于测试与播种数据源。
"""

from app.services.api import DatasetService, ServiceError
from app.services.mock_service import MockDatasetService
from app.services.sqlite_service import SqliteDatasetService

__all__ = [
    "DatasetService",
    "ServiceError",
    "MockDatasetService",
    "SqliteDatasetService",
]
