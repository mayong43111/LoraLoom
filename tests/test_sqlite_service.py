"""SQLite 服务与视频库单元测试。

验证 SQLite 实现满足接口契约：播种、筛选、写入持久化，以及视频库/抽帧关联。
每个测试使用独立的临时数据库文件，互不影响。
"""

from __future__ import annotations

import os
import tempfile

from app.domain.enums import Orientation, ReviewStatus, Usability, VideoStatus
from app.services.api import ImageFilter
from app.services.sqlite_service import SqliteDatasetService


def _service() -> tuple[SqliteDatasetService, str]:
    path = os.path.join(tempfile.mkdtemp(), "dataset.sqlite")
    return SqliteDatasetService(path), path


def test_seed_populates_core_entities() -> None:
    service, _ = _service()
    assert len(service.list_images()) == 120
    assert len(service.list_videos()) == 5
    assert len(service.list_people()) == 4


def test_orientation_filter_uses_indexed_column() -> None:
    service, _ = _service()
    result = service.list_images(ImageFilter(orientation=Orientation.FRONT))
    assert result
    assert all(img.orientation is Orientation.FRONT for img in result)


def test_update_annotation_persists_across_connections() -> None:
    service, path = _service()
    target = service.list_review_queue()[0]
    service.update_annotation(
        target.id, orientation=Orientation.SIDE, usability=Usability.TRAINABLE
    )
    reopened = SqliteDatasetService(path)
    stored = reopened.get_image(target.id)
    assert stored.orientation is Orientation.SIDE
    assert stored.usability is Usability.TRAINABLE
    assert stored.review_status is ReviewStatus.REVIEWED


def test_video_frame_job_linkage() -> None:
    service, _ = _service()
    videos = service.list_videos()
    for video in videos:
        job = service.get_video_frame_job(video.id)
        if video.status in (VideoStatus.EXTRACTED, VideoStatus.EXTRACTING):
            assert job is not None
            assert job.video_id == video.id
        else:
            assert job is None


def test_pending_frame_counts_unextracted_videos() -> None:
    service, _ = _service()
    stats = service.get_stats()
    expected = sum(
        1
        for v in service.list_videos()
        if v.status in (VideoStatus.READY, VideoStatus.QUEUED)
    )
    assert stats.pending_frame == expected
