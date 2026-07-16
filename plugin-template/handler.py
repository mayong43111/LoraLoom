"""示例插件 —— 后端处理逻辑（统一 invoke 契约）。

前端通过 POST /api/tools/example.hello/invoke 调用，
body 形如 {"action": "greet", "payload": {"name": "世界"}}。

契约：invoke(action, payload, service) -> Any，返回可 JSON 序列化的数据。
service 为宿主 DatasetService，可用于读取/写入数据集。
"""

from __future__ import annotations

from typing import Any


def _greet(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    name = (payload.get("name") or "世界").strip() or "世界"
    # 示例：借助宿主 service 读取数据集规模。
    try:
        video_count = len(list(service.list_videos()))
        image_count = len(list(service.list_images()))
    except Exception:  # noqa: BLE001 - 示例容错
        video_count = image_count = 0
    return {
        "message": f"你好，{name}！这是来自后端 handler 的问候。",
        "dataset": {"videos": video_count, "images": image_count},
    }


_ACTIONS = {
    "greet": _greet,
}


def invoke(action: str, payload: dict[str, Any], service: Any) -> Any:
    handler = _ACTIONS.get(action)
    if handler is None:
        raise ValueError(f"不支持的 action: {action}")
    return handler(payload, service)
