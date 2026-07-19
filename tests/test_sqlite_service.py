"""SQLite 服务与视频库单元测试。

验证 SQLite 实现满足接口契约：播种、筛选、写入持久化，以及视频库/抽帧关联。
每个测试使用独立的临时数据库文件，互不影响。
"""

from __future__ import annotations

import os
import tempfile

from app.domain.enums import DatasetType, Orientation, ReviewStatus, Usability, VideoStatus
from app.services.api import ImageCreate, ImageFilter, VideoCreate, VideoFilter
from app.services.mock_data import MockDataset
from app.services.sqlite_service import SqliteDatasetService


def _service() -> tuple[SqliteDatasetService, str]:
    path = os.path.join(tempfile.mkdtemp(), "dataset.sqlite")
    return SqliteDatasetService(path, seed_data=MockDataset()), path


def test_new_database_is_empty_by_default() -> None:
    path = os.path.join(tempfile.mkdtemp(), "dataset.sqlite")
    service = SqliteDatasetService(path)

    assert service.list_images() == []
    assert service.list_videos() == []
    assert service.list_people() == []


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


def test_image_groups_seeded_with_counts() -> None:
    service, _ = _service()
    groups = service.list_image_groups()
    assert len(groups) == 4
    total = sum(g.image_count for g in groups)
    assert total == len(service.list_images())


def test_filter_images_by_group_and_tag() -> None:
    service, _ = _service()
    images = service.list_images()
    a_group = next(i.group_id for i in images if i.group_id)
    by_group = service.list_images(ImageFilter(group_id=a_group))
    assert by_group and all(i.group_id == a_group for i in by_group)

    a_tag = next(t for i in images for t in i.tags)
    by_tag = service.list_images(ImageFilter(tag=a_tag))
    assert by_tag and all(a_tag in i.tags for i in by_tag)


def test_create_image_group_and_image_persist() -> None:
    service, path = _service()
    group = service.create_image_group("测试图片分组", "desc")
    image = service.create_image(
        ImageCreate(
            title="手动上传.jpg",
            group_id=group.id,
            tags=["正面", "单人"],
            width=1024,
            height=1024,
        )
    )
    reopened = SqliteDatasetService(path)
    stored = reopened.get_image(image.id)
    assert stored.group_id == group.id
    assert stored.tags == ["正面", "单人"]
    assert stored.title == "手动上传.jpg"
    assert any(g.id == group.id for g in reopened.list_image_groups())


def test_update_image_edits_info_and_moves_group() -> None:
    service, path = _service()
    src = service.create_image_group("A", "")
    dst = service.create_image_group("B", "")
    image = service.create_image(ImageCreate(title="a.jpg", group_id=src.id))

    service.update_image(
        image.id, title="renamed.jpg", tags=["高清"], group_id=dst.id
    )
    reopened = SqliteDatasetService(path)
    stored = reopened.get_image(image.id)
    assert stored.title == "renamed.jpg"
    assert stored.tags == ["高清"]
    assert stored.group_id == dst.id
    counts = {g.id: g.image_count for g in reopened.list_image_groups()}
    assert counts[src.id] == 0
    assert counts[dst.id] == 1


def test_copy_and_delete_image_maintain_counts() -> None:
    service, path = _service()
    group = service.create_image_group("组", "")
    image = service.create_image(
        ImageCreate(title="a.jpg", group_id=group.id, tags=["单人"])
    )
    assert service.list_image_groups()[-1].image_count == 1

    clone = service.copy_image(image.id, group_id=group.id)
    assert clone.id != image.id
    assert clone.tags == ["单人"]
    reopened = SqliteDatasetService(path)
    counts = {g.id: g.image_count for g in reopened.list_image_groups()}
    assert counts[group.id] == 2

    reopened.delete_image(image.id)
    again = SqliteDatasetService(path)
    ids = {i.id for i in again.list_images()}
    assert image.id not in ids
    assert clone.id in ids
    assert {g.id: g.image_count for g in again.list_image_groups()}[group.id] == 1


def test_update_copy_delete_video_maintain_counts() -> None:
    service, path = _service()
    src = service.create_video_group("A", "")
    dst = service.create_video_group("B", "")
    video = service.create_video(
        VideoCreate(title="a.mp4", group_id=src.id, width=1920, height=1080)
    )

    service.update_video(video.id, title="b.mp4", tags=["室内"], group_id=dst.id)
    moved = SqliteDatasetService(path).get_video(video.id)
    assert moved.title == "b.mp4"
    assert moved.tags == ["室内"]
    assert moved.group_id == dst.id

    clone = service.copy_video(video.id, group_id=dst.id)
    assert clone.id != video.id
    counts = {g.id: g.video_count for g in SqliteDatasetService(path).list_video_groups()}
    assert counts[src.id] == 0
    assert counts[dst.id] == 2

    service.delete_video(video.id)
    again = SqliteDatasetService(path)
    ids = {v.id for v in again.list_videos()}
    assert video.id not in ids
    assert clone.id in ids
    assert {g.id: g.video_count for g in again.list_video_groups()}[dst.id] == 1


def test_create_group_is_idempotent_by_name() -> None:
    service, _ = _service()
    a = service.create_video_group("哆酱", "")
    b = service.create_video_group("哆酱", "")
    assert a.id == b.id
    names = [g.name for g in service.list_video_groups()]
    assert names.count("哆酱") == 1

    ia = service.create_image_group("同名", "")
    ib = service.create_image_group("同名", "")
    assert ia.id == ib.id


def test_update_group_renames_and_rejects_duplicate() -> None:
    service, path = _service()
    a = service.create_video_group("A", "")
    service.create_video_group("B", "")

    service.update_video_group(a.id, name="A2", description="desc")
    reopened = SqliteDatasetService(path)
    stored = next(g for g in reopened.list_video_groups() if g.id == a.id)
    assert stored.name == "A2"
    assert stored.description == "desc"

    try:
        service.update_video_group(a.id, name="B")
    except Exception as exc:  # noqa: BLE001 - 验证抛出 ServiceError
        assert "已存在" in str(exc)
    else:
        raise AssertionError("重名应当报错")


def test_delete_group_moves_members_to_root() -> None:
    service, path = _service()
    grp = service.create_video_group("组", "")
    video = service.create_video(
        VideoCreate(title="a.mp4", group_id=grp.id, width=1920, height=1080)
    )

    service.delete_video_group(grp.id)
    again = SqliteDatasetService(path)
    assert all(g.id != grp.id for g in again.list_video_groups())
    assert again.get_video(video.id).group_id is None


def test_delete_image_group_moves_members_to_root() -> None:
    service, path = _service()
    grp = service.create_image_group("组", "")
    image = service.create_image(ImageCreate(title="a.jpg", group_id=grp.id))

    service.delete_image_group(grp.id)
    again = SqliteDatasetService(path)
    assert all(g.id != grp.id for g in again.list_image_groups())
    assert again.get_image(image.id).group_id is None


def test_delete_image_group_can_delete_members_without_deleting_shared_copy() -> None:
    service, path = _service()
    grp = service.create_image_group("原组", "")
    keep = service.create_image_group("精选组", "")
    image = service.create_image(
        ImageCreate(title="a.jpg", group_id=grp.id, path="workspace/images/a.jpg")
    )
    clone = service.copy_image(image.id, group_id=keep.id)
    dataset = service.create_dataset("训练集", DatasetType.IMAGE)
    service.add_dataset_items(dataset.id, [image.id, clone.id])

    service.delete_image_group(grp.id, delete_images=True)

    again = SqliteDatasetService(path)
    assert all(g.id != grp.id for g in again.list_image_groups())
    assert all(item.id != image.id for item in again.list_images())
    assert again.get_image(clone.id).image_path == image.image_path
    assert again.get_image(clone.id).group_id == keep.id
    assert [item.id for item in again.list_dataset_images(dataset.id)] == [clone.id]
    assert again.get_dataset(dataset.id).item_count == 1



