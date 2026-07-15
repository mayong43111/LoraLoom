"""领域对象到 JSON 可序列化结构的转换。

前端通过 REST 消费领域模型。为保持前后端松耦合并避免在视图层散落
枚举文案，序列化遵循两条约定：

* 枚举统一序列化为其字符串取值（``enum.value``）。中文展示名由
  ``/api/meta/enums`` 单独下发，前端据此渲染，避免重复维护。
* ``datetime`` 序列化为 ISO 8601 字符串；``tuple`` 序列化为列表。

:func:`to_jsonable` 递归处理 dataclass / 枚举 / 时间 / 容器，
使路由层无需为每个模型编写样板序列化代码。
"""

from __future__ import annotations

import dataclasses
from datetime import date, datetime
from enum import Enum
from typing import Any

from app.domain import enums


def to_jsonable(value: Any) -> Any:
    """将任意领域对象递归转换为 JSON 可序列化结构。"""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, str):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {
            f.name: to_jsonable(getattr(value, f.name))
            for f in dataclasses.fields(value)
        }
    if isinstance(value, dict):
        return {_key_to_str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(v) for v in value]
    return value


def _key_to_str(key: Any) -> str:
    """将字典键（可能是枚举）转换为字符串键。"""
    if isinstance(key, Enum):
        return str(key.value)
    return str(key)


# -- 枚举元信息 -------------------------------------------------------------
# 前端启动时拉取一次，用于把 enum value 映射为中文展示名。

_ENUM_TYPES: tuple[type[enums.LabeledEnum], ...] = (
    enums.SubjectType,
    enums.Orientation,
    enums.FaceCompleteness,
    enums.Usability,
    enums.ReviewStatus,
    enums.ImageStatus,
    enums.QualityFlag,
    enums.ImportType,
    enums.BatchStatus,
    enums.DownloadTool,
    enums.DownloadStatus,
    enums.FrameStatus,
    enums.VideoSourceType,
    enums.VideoStatus,
    enums.PersonStatus,
    enums.SelectionStatus,
    enums.CaptionOrigin,
    enums.ExportFormat,
)


def enum_metadata() -> dict[str, list[dict[str, Any]]]:
    """返回所有枚举的取值、展示名及扩展标记。

    结构::

        {
          "Orientation": [{"value": "front", "label": "正面"}, ...],
          "ExportFormat": [{"value": "jsonl", "label": "JSONL", "isMvp": true}, ...],
        }
    """
    meta: dict[str, list[dict[str, Any]]] = {}
    for enum_type in _ENUM_TYPES:
        items: list[dict[str, Any]] = []
        for member in enum_type:
            entry: dict[str, Any] = {"value": member.value, "label": member.label}
            if enum_type is enums.ExportFormat:
                entry["isMvp"] = member.is_mvp  # type: ignore[attr-defined]
            items.append(entry)
        meta[enum_type.__name__] = items
    return meta
