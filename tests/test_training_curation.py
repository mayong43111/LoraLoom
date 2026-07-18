from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

from app.services.api import ImageCreate
from app.services.mock_service import MockDatasetService


def _load_handler() -> Any:
    path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "plugins"
        / "training-curation"
        / "handler.py"
    )
    spec = importlib.util.spec_from_file_location("test_training_curation_handler", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HANDLER = _load_handler()


def test_identity_recommendation_rejects_no_face_and_balances_sources() -> None:
    service = MockDatasetService()
    group = service.create_image_group("候选", "")
    for index in range(4):
        service.create_image(
            ImageCreate(
                title=f"source-a@{index}.000s",
                group_id=group.id,
                tags=["人脸:全脸", "人脸数:1", "姿态:正对", "景别:全身"],
                width=2160,
                height=3840,
                quality_score=0.9 - index * 0.01,
            )
        )
    source_b = service.create_image(
        ImageCreate(
            title="source-b@1.000s",
            group_id=group.id,
            tags=["人脸:3-4脸", "人脸数:1", "姿态:侧面", "景别:半身"],
            width=2160,
            height=3840,
            quality_score=0.88,
        )
    )
    rejected = service.create_image(
        ImageCreate(
            title="source-c@1.000s",
            group_id=group.id,
            tags=["人脸:无脸", "人脸数:1"],
            width=2160,
            height=3840,
            quality_score=0.99,
        )
    )
    low_quality = service.create_image(
        ImageCreate(
            title="source-d@1.000s",
            group_id=group.id,
            tags=["人脸:全脸", "人脸数:1"],
            width=2160,
            height=3840,
            quality_score=0.6,
        )
    )

    result = HANDLER._act_analyze(
        {"group_id": group.id, "template": "identity"}, service
    )
    selected = [item for item in result["items"] if item["recommended"]]

    assert len(selected) == 5
    assert {item["source"] for item in selected} == {"source-a", "source-b"}
    assert next(item for item in result["items"] if item["id"] == rejected.id)["eligible"] is False
    assert next(item for item in result["items"] if item["id"] == low_quality.id)["eligible"] is False
    assert any(item["id"] == source_b.id for item in selected)
    assert next(item for item in result["breakdown"] if item["id"] == "front_full")["recommended"] == 4
    assert next(item for item in result["breakdown"] if item["id"] == "side")["recommended"] == 1


def test_crop_box_stays_inside_image() -> None:
    face = [900, 500, 240, 300]
    box = HANDLER._crop_box(face, "head", 2160, 3840)
    left, top, right, bottom = box

    assert 0 <= left < right <= 2160
    assert 0 <= top < bottom <= 3840
    assert right - left == bottom - top


def test_detection_replaces_explicit_unknown_tags() -> None:
    tags = HANDLER._tags_from_detection(
        ["姿态:未知", "景别:未知", "人脸:未知", "人物数:1"],
        {
            "orientation_label": "正对",
            "shot_label": "全身",
            "face_label": "全脸",
            "person_count": 1,
        },
    )

    assert "姿态:未知" not in tags
    assert "景别:未知" not in tags
    assert "人脸:未知" not in tags
    assert {"姿态:正对", "景别:全身", "人脸:全脸"}.issubset(tags)
