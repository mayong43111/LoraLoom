"""领域对象与 JSON 字典之间的映射。

SQLite 采用「热字段列 + JSON 文档列」的混合模式：用于过滤/排序的字段
以真实列存储并建索引，其余字段整体以 JSON 存储。本模块负责 JSON 文档
与领域 dataclass 之间的双向转换，并在反序列化时把字符串还原为枚举，
保证领域层始终持有强类型对象。
"""

from __future__ import annotations

import dataclasses
import json
from datetime import datetime
from enum import Enum
from typing import Any

from app.domain import enums, models


# -- 序列化：dataclass -> JSON 文本 -----------------------------------------
def _default(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"无法序列化类型: {type(value)!r}")


def to_json(obj: Any) -> str:
    """将 dataclass 实例序列化为 JSON 文本。"""
    return json.dumps(dataclasses.asdict(obj), ensure_ascii=False, default=_default)


def _dt(value: str | None) -> datetime:
    return datetime.fromisoformat(value) if value else datetime.now()


# -- 反序列化：JSON dict -> dataclass ---------------------------------------
def quality_metrics_from_dict(d: dict[str, Any] | None) -> models.QualityMetrics | None:
    if d is None:
        return None
    return models.QualityMetrics(
        blur_score=d["blur_score"],
        brightness=d["brightness"],
        saturation=d["saturation"],
        entropy=d["entropy"],
        duplicate_group=d.get("duplicate_group"),
    )


def image_from_dict(d: dict[str, Any]) -> models.Image:
    return models.Image(
        id=d["id"],
        image_path=d["image_path"],
        sha256=d["sha256"],
        width=d["width"],
        height=d["height"],
        quality_score=d["quality_score"],
        quality_flags=[enums.QualityFlag(x) for x in d.get("quality_flags", [])],
        quality_metrics=quality_metrics_from_dict(d.get("quality_metrics")),
        orientation=enums.Orientation(d["orientation"]),
        face_completeness=enums.FaceCompleteness(d["face_completeness"]),
        subject_type=enums.SubjectType(d["subject_type"]),
        primary_subject_id=d.get("primary_subject_id"),
        person_count=d["person_count"],
        usability=enums.Usability(d["usability"]),
        review_status=enums.ReviewStatus(d["review_status"]),
        status=enums.ImageStatus(d["status"]),
        asset_id=d.get("asset_id"),
        frame_target_timestamp=d.get("frame_target_timestamp"),
        frame_actual_timestamp=d.get("frame_actual_timestamp"),
        thumbnail_hint=d.get("thumbnail_hint", ""),
    )


def person_from_dict(d: dict[str, Any]) -> models.PersonCluster:
    return models.PersonCluster(
        id=d["id"],
        display_name=d["display_name"],
        entity_type=enums.SubjectType(d["entity_type"]),
        representative_face_id=d.get("representative_face_id"),
        status=enums.PersonStatus(d["status"]),
        image_count=d["image_count"],
        face_count=d["face_count"],
        front_count=d["front_count"],
        side_count=d["side_count"],
        back_count=d["back_count"],
        suspected_duplicate_of=d.get("suspected_duplicate_of"),
    )


def import_batch_from_dict(d: dict[str, Any]) -> models.ImportBatch:
    return models.ImportBatch(
        id=d["id"],
        name=d["name"],
        type=enums.ImportType(d["type"]),
        status=enums.BatchStatus(d["status"]),
        input_count=d["input_count"],
        image_count=d["image_count"],
        frame_task_count=d["frame_task_count"],
        error_count=d["error_count"],
        created_at=_dt(d.get("created_at")),
    )


def download_from_dict(d: dict[str, Any]) -> models.DownloadTask:
    return models.DownloadTask(
        id=d["id"],
        title=d["title"],
        tool=enums.DownloadTool(d["tool"]),
        quality=d["quality"],
        status=enums.DownloadStatus(d["status"]),
        progress=d.get("progress", 0.0),
        speed=d.get("speed", ""),
        output_path=d.get("output_path", ""),
        error=d.get("error", ""),
    )


def video_from_dict(d: dict[str, Any]) -> models.Video:
    return models.Video(
        id=d["id"],
        title=d["title"],
        source_type=enums.VideoSourceType(d["source_type"]),
        path=d["path"],
        duration=d["duration"],
        width=d["width"],
        height=d["height"],
        fps=d["fps"],
        size_bytes=d["size_bytes"],
        status=enums.VideoStatus(d["status"]),
        codec=d.get("codec", "h264"),
        frame_interval=d.get("frame_interval", 1.0),
        extracted_frame_count=d.get("extracted_frame_count", 0),
        source_download_id=d.get("source_download_id"),
        thumbnail_hint=d.get("thumbnail_hint", ""),
        created_at=_dt(d.get("created_at")),
    )


def frame_result_from_dict(d: dict[str, Any]) -> models.FrameResult:
    return models.FrameResult(
        target_timestamp=d["target_timestamp"],
        actual_timestamp=d.get("actual_timestamp"),
        status=enums.FrameStatus(d["status"]),
        quality_score=d.get("quality_score"),
        image_id=d.get("image_id"),
    )


def frame_job_from_dict(d: dict[str, Any]) -> models.FrameJob:
    return models.FrameJob(
        id=d["id"],
        video_id=d["video_id"],
        video_name=d["video_name"],
        duration=d["duration"],
        interval=d["interval"],
        progress=d["progress"],
        frames=[frame_result_from_dict(f) for f in d.get("frames", [])],
    )


def selection_rule_from_dict(d: dict[str, Any]) -> models.SelectionRule:
    return models.SelectionRule(
        subject_type=enums.SubjectType(d["subject_type"]),
        subject_id=d["subject_id"],
        orientation=enums.Orientation(d["orientation"]),
        target_count=d["target_count"],
        min_quality=d.get("min_quality", 0.0),
        require_reviewed=d.get("require_reviewed", True),
        require_trainable=d.get("require_trainable", True),
        exclude_duplicates=d.get("exclude_duplicates", True),
    )


def selection_item_from_dict(d: dict[str, Any]) -> models.SelectionItem:
    return models.SelectionItem(
        id=d["id"],
        selection_id=d["selection_id"],
        image_id=d["image_id"],
        rule_key=d["rule_key"],
        rank_score=d["rank_score"],
        locked=d.get("locked", False),
    )


def selection_from_dict(d: dict[str, Any]) -> models.Selection:
    return models.Selection(
        id=d["id"],
        name=d["name"],
        status=enums.SelectionStatus(d["status"]),
        rules=[selection_rule_from_dict(r) for r in d.get("rules", [])],
        items=[selection_item_from_dict(i) for i in d.get("items", [])],
        created_at=_dt(d.get("created_at")),
        updated_at=_dt(d.get("updated_at")),
    )
