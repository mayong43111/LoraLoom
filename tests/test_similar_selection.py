"""相似图片精选插件测试。"""

from __future__ import annotations

import importlib.util
import os
import tempfile
from pathlib import Path
from typing import Any

import numpy as np

from app.services.api import ImageCreate
from app.services.sqlite_service import SqliteDatasetService


def _load_handler() -> Any:
    path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "plugins"
        / "similar-selection"
        / "handler.py"
    )
    spec = importlib.util.spec_from_file_location("test_similar_selection_handler", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HANDLER = _load_handler()


def _record(bits: list[bool], quality: float) -> dict[str, Any]:
    return {
        "phash": np.array(bits * 8, dtype=np.bool_),
        "histogram": np.array([1.0, 0.0], dtype=np.float32),
        "thumbnail": np.zeros((2, 2), dtype=np.float32),
        "quality": quality,
    }


def test_cluster_recommends_highest_quality_near_duplicate() -> None:
    records = [
        _record([True] * 8, 0.4),
        _record([True] * 8, 0.9),
        _record([False] * 8, 0.8),
    ]
    clusters = HANDLER._cluster(records, 0.88)
    assert len(clusters) == 2
    duplicate = next(cluster for cluster in clusters if len(cluster["members"]) == 2)
    assert duplicate["representative"] == 1


def test_commit_copies_to_existing_group_idempotently() -> None:
    db_path = os.path.join(tempfile.mkdtemp(), "dataset.sqlite")
    service = SqliteDatasetService(db_path)
    source_group = service.create_image_group("来源")
    target_group = service.create_image_group("精选")
    source = service.create_image(
        ImageCreate(title="候选图", group_id=source_group.id, path="candidate.jpg")
    )
    payload = {
        "selected": [{"cluster_id": "similar-0001", "image_id": source.id}],
        "target": {"kind": "group", "group_id": target_group.id},
    }

    first = HANDLER._act_commit(payload, service)
    second = HANDLER._act_commit(payload, service)

    assert first["created"] == 1
    assert second["created"] == 0
    assert second["skipped"] == 1
    assert service.get_image(source.id).group_id == source_group.id