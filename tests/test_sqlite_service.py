"""SQLite 服务与视频库单元测试。

验证 SQLite 实现满足接口契约：播种、筛选、写入持久化，以及视频库/抽帧关联。
每个测试使用独立的临时数据库文件，互不影响。
"""

from __future__ import annotations

import os
import tempfile

from app.domain.enums import Orientation, ReviewStatus, Usability, VideoStatus
from app.services.api import ImageFilter, VideoCreate, VideoFilter
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


def test_video_groups_seeded_with_counts() -> None:
    service, _ = _service()
    groups = service.list_video_groups()
    assert len(groups) == 4
    total = sum(g.video_count for g in groups)
    assert total == len(service.list_videos())


def test_filter_videos_by_group_and_tag() -> None:
    service, _ = _service()
    videos = service.list_videos()
    a_group = videos[0].group_id
    by_group = service.list_videos(VideoFilter(group_id=a_group))
    assert by_group and all(v.group_id == a_group for v in by_group)

    a_tag = next(t for v in videos for t in v.tags)
    by_tag = service.list_videos(VideoFilter(tag=a_tag))
    assert by_tag and all(a_tag in v.tags for v in by_tag)


def test_create_group_and_video_persist() -> None:
    service, path = _service()
    group = service.create_video_group("测试分组", "desc")
    video = service.create_video(
        VideoCreate(
            title="手动上传.mp4",
            group_id=group.id,
            tags=["室内", "单人"],
            duration=30.0,
            width=1920,
            height=1080,
        )
    )
    reopened = SqliteDatasetService(path)
    stored = reopened.get_video(video.id)
    assert stored.group_id == group.id
    assert stored.tags == ["室内", "单人"]
    assert any(g.id == group.id for g in reopened.list_video_groups())


def test_run_frame_extraction_updates_video() -> None:
    service, _ = _service()
    ready = next(v for v in service.list_videos() if v.status == VideoStatus.READY)
    job = service.run_frame_extraction(ready.id, 1.0)
    assert job.frames
    assert job.video_id == ready.id
    assert service.get_video(ready.id).status == VideoStatus.EXTRACTED
    assert service.get_video_frame_job(ready.id) is not None

