"""HTTP API 层。

将 :class:`~app.services.api.DatasetService` 暴露为 REST 接口，供 Web 前端消费。
当前使用 :class:`~app.services.mock_service.MockDatasetService` 作为数据源，
后续切换真实后端时只需替换 :func:`app.api.deps.get_service` 的返回实现。
"""
