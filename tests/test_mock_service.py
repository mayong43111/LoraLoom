"""服务层单元测试。

验证 mock 服务返回的数据满足接口契约与基本一致性。这些测试不依赖 Qt，
可在无显示环境下运行。
"""

from __future__ import annotations

from app.domain.enums import Orientation, ReviewStatus, Usability
from app.services.api import ImageFilter
from app.services.mock_service import MockDatasetService


def _service() -> MockDatasetService:
    return MockDatasetService()


def test_stats_are_consistent() -> None:
    service = _service()
    stats = service.get_stats()
    images = service.list_images()
    assert stats.image_total == len(images)
    assert sum(stats.orientation_distribution.values()) == len(images)


def test_list_images_without_filter_returns_all() -> None:
    service = _service()
    assert len(service.list_images()) == len(service.list_images(ImageFilter()))


def test_orientation_filter() -> None:
    service = _service()
    result = service.list_images(ImageFilter(orientation=Orientation.FRONT))
    assert result  # 样例数据保证存在正面图片
    assert all(img.orientation is Orientation.FRONT for img in result)


def test_update_annotation_marks_reviewed() -> None:
    service = _service()
    target = service.list_review_queue()[0]
    updated = service.update_annotation(
        target.id, orientation=Orientation.SIDE, usability=Usability.TRAINABLE
    )
    assert updated.orientation is Orientation.SIDE
    assert updated.usability is Usability.TRAINABLE
    assert updated.review_status is ReviewStatus.REVIEWED


def test_selection_gap_calculation() -> None:
    service = _service()
    selection = service.list_selections()[0]
    for rule in selection.rules:
        matched = selection.matched_count(rule)
        assert selection.gap_count(rule) == max(0, rule.target_count - matched)


def test_get_image_roundtrip() -> None:
    service = _service()
    first = service.list_images()[0]
    assert service.get_image(first.id) is first
