"""基于内存模拟数据的服务实现。

:class:`MockDatasetService` 实现 :class:`~app.services.api.DatasetService`，
用固定的样例数据响应 UI 请求。它模拟真实后端的读取与轻量写入语义
（例如更新标签），但不做任何持久化或算法计算。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from uuid import uuid4

from app.domain.enums import (
    FrameStatus,
    ImageStatus,
    Orientation,
    QualityFlag,
    ReviewStatus,
    Usability,
    VideoSourceType,
    VideoStatus,
)
from app.domain.models import (
    DatasetStats,
    DownloadTask,
    FrameJob,
    Image,
    ImageGroup,
    ImportBatch,
    PersonCluster,
    Selection,
    Video,
    VideoGroup,
)
from app.services.api import (
    DatasetService,
    ImageCreate,
    ImageFilter,
    ServiceError,
    UNSET,
    VideoCreate,
    VideoFilter,
)
from app.services.mock_data import MockDataset, build_frame_job


def _extract_frames(video: Video, interval: float) -> FrameJob:
    """对视频执行一次抽帧，返回抽帧任务结果。"""
    return build_frame_job(video, interval)


class MockDatasetService(DatasetService):
    """使用内存样例数据的服务实现。"""

    def __init__(self, dataset: MockDataset | None = None) -> None:
        self._data = dataset or MockDataset()
        self._image_index = {img.id: img for img in self._data.images}
        self._image_group_index = {g.id: g for g in self._data.image_groups}
        self._video_index = {v.id: v for v in self._data.videos}
        self._group_index = {g.id: g for g in self._data.video_groups}
        self._frame_job_index = {j.video_id: j for j in self._data.frame_jobs}

    # -- Dashboard ----------------------------------------------------------
    def get_stats(self) -> DatasetStats:
        images = self._data.images
        orientation_dist: dict[Orientation, int] = {o: 0 for o in Orientation}
        quality_dist: dict[QualityFlag, int] = {q: 0 for q in QualityFlag}
        for img in images:
            orientation_dist[img.orientation] += 1
            for flag in img.quality_flags:
                quality_dist[flag] += 1

        exportable = sum(
            1 for i in images if i.status == ImageStatus.REVIEWED_TRAINABLE
        )
        reviewed = sum(1 for i in images if i.review_status == ReviewStatus.REVIEWED)
        rejected = sum(1 for i in images if i.usability == Usability.REJECT)
        candidate = sum(1 for i in images if i.usability == Usability.NEEDS_REVIEW)

        people = self._data.people
        return DatasetStats(
            image_total=len(images),
            image_candidate=candidate,
            image_reviewed=reviewed,
            image_exportable=exportable,
            image_rejected=rejected,
            person_total=sum(1 for p in people if p.display_name != "Unknown"),
            person_confirmed=sum(
                1 for p in people if p.status.value == "confirmed"
            ),
            unknown_faces=sum(
                p.face_count for p in people if p.display_name == "Unknown"
            ),
            suspected_duplicates=sum(
                1 for p in people if p.suspected_duplicate_of is not None
            ),
            orientation_distribution=orientation_dist,
            quality_distribution=quality_dist,
            pending_frame=sum(
                1
                for v in self._data.videos
                if v.status in (VideoStatus.READY, VideoStatus.QUEUED)
            ),
            pending_quality=candidate,
            pending_face=sum(1 for i in images if i.person_count == 0),
            pending_review=sum(
                1 for i in images if i.review_status == ReviewStatus.AUTO
            ),
        )

    # -- 导入 ---------------------------------------------------------------
    def list_import_batches(self) -> Sequence[ImportBatch]:
        return list(self._data.import_batches)

    # -- 下载 ---------------------------------------------------------------
    def list_download_tasks(self) -> Sequence[DownloadTask]:
        return list(self._data.downloads)

    # -- 图片库 -------------------------------------------------------------
    def list_image_groups(self) -> Sequence[ImageGroup]:
        return list(self._data.image_groups)

    def create_image_group(self, name: str, description: str = "") -> ImageGroup:
        existing = next(
            (g for g in self._data.image_groups if g.name == name), None
        )
        if existing is not None:
            return existing
        group = ImageGroup(
            id=f"img-group-{uuid4().hex[:12]}",
            name=name,
            description=description,
        )
        self._data.image_groups.append(group)
        self._image_group_index[group.id] = group
        return group

    def update_image_group(
        self,
        group_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> ImageGroup:
        group = self._image_group_index.get(group_id)
        if group is None:
            raise ServiceError(f"分组不存在: {group_id}")
        if name is not None:
            if any(
                g.id != group_id and g.name == name for g in self._data.image_groups
            ):
                raise ServiceError(f"分组名称已存在: {name}")
            group.name = name
        if description is not None:
            group.description = description
        return group

    def delete_image_group(self, group_id: str) -> None:
        group = self._image_group_index.get(group_id)
        if group is None:
            raise ServiceError(f"分组不存在: {group_id}")
        for img in self._data.images:
            if img.group_id == group_id:
                img.group_id = None
        self._data.image_groups = [
            g for g in self._data.image_groups if g.id != group_id
        ]
        del self._image_group_index[group_id]

    def list_images(self, image_filter: ImageFilter | None = None) -> Sequence[Image]:
        images: Sequence[Image] = sorted(
            self._data.images, key=lambda i: i.created_at, reverse=True
        )
        if image_filter is None:
            return list(images)

        result: list[Image] = []
        for img in images:
            if (
                image_filter.person_id is not None
                and img.primary_subject_id != image_filter.person_id
            ):
                continue
            if (
                image_filter.orientation is not None
                and img.orientation != image_filter.orientation
            ):
                continue
            if (
                image_filter.usability is not None
                and img.usability != image_filter.usability
            ):
                continue
            if (
                image_filter.review_status is not None
                and img.review_status != image_filter.review_status
            ):
                continue
            if image_filter.quality_flag is not None and not any(
                flag.value == image_filter.quality_flag for flag in img.quality_flags
            ):
                continue
            if (
                image_filter.group_id is not None
                and img.group_id != image_filter.group_id
            ):
                continue
            if image_filter.tag is not None and image_filter.tag not in img.tags:
                continue
            if (
                image_filter.keyword
                and image_filter.keyword.lower() not in img.id.lower()
                and image_filter.keyword.lower() not in img.title.lower()
            ):
                continue
            result.append(img)
        return result

    def get_image(self, image_id: str) -> Image:
        try:
            return self._image_index[image_id]
        except KeyError as exc:  # pragma: no cover - 防御性
            raise ServiceError(f"图片不存在: {image_id}") from exc

    def create_image(self, payload: ImageCreate) -> Image:
        if (
            payload.group_id is not None
            and payload.group_id not in self._image_group_index
        ):
            raise ServiceError(f"分组不存在: {payload.group_id}")
        flags: list[QualityFlag] = []
        for flag in payload.quality_flags:
            try:
                flags.append(QualityFlag(flag))
            except ValueError:
                continue
        image = Image(
            id=f"img-{uuid4().hex[:12]}",
            image_path=payload.path or f"workspace/images/{payload.title}",
            sha256=f"{uuid4().int & ((1 << 64) - 1):016x}",
            width=payload.width,
            height=payload.height,
            quality_score=payload.quality_score,
            quality_flags=flags,
            orientation=Orientation.UNKNOWN,
            usability=Usability.NEEDS_REVIEW,
            review_status=ReviewStatus.AUTO,
            status=ImageStatus.NEW,
            title=payload.title,
            group_id=payload.group_id,
            tags=list(payload.tags),
            thumbnail_hint=payload.title,
            frame_target_timestamp=payload.frame_target_timestamp,
            frame_actual_timestamp=payload.frame_actual_timestamp,
        )
        self._data.images.append(image)
        self._image_index[image.id] = image
        if payload.group_id is not None:
            self._image_group_index[payload.group_id].image_count += 1
        return image

    def update_image(
        self,
        image_id: str,
        *,
        title: str | None = None,
        tags: list[str] | None = None,
        caption: str | None = None,
        group_id: object = UNSET,
    ) -> Image:
        image = self.get_image(image_id)
        if title is not None:
            image.title = title
        if tags is not None:
            image.tags = list(tags)
        if caption is not None:
            image.caption = caption
        if group_id is not UNSET and group_id != image.group_id:
            if group_id is not None and group_id not in self._image_group_index:
                raise ServiceError(f"分组不存在: {group_id}")
            if image.group_id is not None:
                self._image_group_index[image.group_id].image_count -= 1
            image.group_id = group_id  # type: ignore[assignment]
            if group_id is not None:
                self._image_group_index[group_id].image_count += 1
        return image

    def delete_image(self, image_id: str) -> None:
        image = self.get_image(image_id)
        self._data.images.remove(image)
        del self._image_index[image_id]
        if image.group_id is not None and image.group_id in self._image_group_index:
            self._image_group_index[image.group_id].image_count -= 1

    def copy_image(self, image_id: str, *, group_id: str | None = None) -> Image:
        source = self.get_image(image_id)
        if group_id is not None and group_id not in self._image_group_index:
            raise ServiceError(f"分组不存在: {group_id}")
        clone = replace(
            source,
            id=f"img-{uuid4().hex[:12]}",
            title=f"{source.title} 副本" if source.title else source.title,
            group_id=group_id,
            tags=list(source.tags),
        )
        self._data.images.append(clone)
        self._image_index[clone.id] = clone
        if group_id is not None:
            self._image_group_index[group_id].image_count += 1
        return clone

    # -- 抽帧 ---------------------------------------------------------------
    def list_frame_jobs(self) -> Sequence[FrameJob]:
        return list(self._data.frame_jobs)

    # -- 视频库 -------------------------------------------------------------
    def list_video_groups(self) -> Sequence[VideoGroup]:
        return list(self._data.video_groups)

    def create_video_group(self, name: str, description: str = "") -> VideoGroup:
        existing = next(
            (g for g in self._data.video_groups if g.name == name), None
        )
        if existing is not None:
            return existing
        group = VideoGroup(
            id=f"group-{uuid4().hex[:12]}",
            name=name,
            description=description,
        )
        self._data.video_groups.append(group)
        self._group_index[group.id] = group
        return group

    def update_video_group(
        self,
        group_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> VideoGroup:
        group = self._group_index.get(group_id)
        if group is None:
            raise ServiceError(f"分组不存在: {group_id}")
        if name is not None:
            if any(
                g.id != group_id and g.name == name for g in self._data.video_groups
            ):
                raise ServiceError(f"分组名称已存在: {name}")
            group.name = name
        if description is not None:
            group.description = description
        return group

    def delete_video_group(self, group_id: str) -> None:
        group = self._group_index.get(group_id)
        if group is None:
            raise ServiceError(f"分组不存在: {group_id}")
        for video in self._data.videos:
            if video.group_id == group_id:
                video.group_id = None
        self._data.video_groups = [
            g for g in self._data.video_groups if g.id != group_id
        ]
        del self._group_index[group_id]

    def list_videos(
        self, video_filter: VideoFilter | None = None
    ) -> Sequence[Video]:
        videos = sorted(
            self._data.videos, key=lambda v: v.created_at, reverse=True
        )
        if video_filter is None:
            return videos
        result: list[Video] = []
        for v in videos:
            if video_filter.group_id is not None and v.group_id != video_filter.group_id:
                continue
            if video_filter.status is not None and v.status.value != video_filter.status:
                continue
            if (
                video_filter.source_type is not None
                and v.source_type.value != video_filter.source_type
            ):
                continue
            if video_filter.tag is not None and video_filter.tag not in v.tags:
                continue
            if video_filter.keyword and video_filter.keyword.lower() not in v.title.lower():
                continue
            result.append(v)
        return result

    def get_video(self, video_id: str) -> Video:
        try:
            return self._video_index[video_id]
        except KeyError as exc:  # pragma: no cover - 防御性
            raise ServiceError(f"视频不存在: {video_id}") from exc

    def create_video(self, payload: VideoCreate) -> Video:
        if payload.group_id is not None and payload.group_id not in self._group_index:
            raise ServiceError(f"分组不存在: {payload.group_id}")
        video = Video(
            id=f"video-{uuid4().hex[:12]}",
            title=payload.title,
            source_type=VideoSourceType.LOCAL,
            path=payload.path or f"workspace/videos/{payload.title}",
            duration=payload.duration,
            width=payload.width,
            height=payload.height,
            fps=payload.fps,
            size_bytes=payload.size_bytes,
            status=VideoStatus.READY,
            group_id=payload.group_id,
            tags=list(payload.tags),
        )
        self._data.videos.append(video)
        self._video_index[video.id] = video
        if payload.group_id is not None:
            self._group_index[payload.group_id].video_count += 1
        return video

    def update_video(
        self,
        video_id: str,
        *,
        title: str | None = None,
        tags: list[str] | None = None,
        caption: str | None = None,
        group_id: object = UNSET,
    ) -> Video:
        video = self.get_video(video_id)
        if title is not None:
            video.title = title
        if tags is not None:
            video.tags = list(tags)
        if caption is not None:
            video.caption = caption
        if group_id is not UNSET and group_id != video.group_id:
            if group_id is not None and group_id not in self._group_index:
                raise ServiceError(f"分组不存在: {group_id}")
            if video.group_id is not None and video.group_id in self._group_index:
                self._group_index[video.group_id].video_count = max(
                    0, self._group_index[video.group_id].video_count - 1
                )
            video.group_id = group_id  # type: ignore[assignment]
            if group_id is not None:
                self._group_index[group_id].video_count += 1
        return video

    def delete_video(self, video_id: str) -> None:
        video = self.get_video(video_id)
        self._data.videos.remove(video)
        del self._video_index[video_id]
        if video.group_id is not None and video.group_id in self._group_index:
            self._group_index[video.group_id].video_count = max(
                0, self._group_index[video.group_id].video_count - 1
            )

    def copy_video(self, video_id: str, *, group_id: str | None = None) -> Video:
        source = self.get_video(video_id)
        if group_id is not None and group_id not in self._group_index:
            raise ServiceError(f"分组不存在: {group_id}")
        clone = replace(
            source,
            id=f"video-{uuid4().hex[:12]}",
            title=f"{source.title} 副本" if source.title else source.title,
            group_id=group_id,
            tags=list(source.tags),
        )
        self._data.videos.append(clone)
        self._video_index[clone.id] = clone
        if group_id is not None:
            self._group_index[group_id].video_count += 1
        return clone

    def get_video_frame_job(self, video_id: str) -> FrameJob | None:
        return self._frame_job_index.get(video_id)

    def run_frame_extraction(self, video_id: str, interval: float) -> FrameJob:
        video = self.get_video(video_id)
        job = _extract_frames(video, interval)
        video.frame_interval = interval
        video.status = VideoStatus.EXTRACTED
        video.extracted_frame_count = sum(
            1 for f in job.frames if f.status != FrameStatus.SKIPPED_NO_GOOD_FRAME
        )
        self._frame_job_index[video_id] = job
        existing = next(
            (j for j in self._data.frame_jobs if j.video_id == video_id), None
        )
        if existing is not None:
            self._data.frame_jobs.remove(existing)
        self._data.frame_jobs.append(job)
        return job

    # -- 人物 ---------------------------------------------------------------
    def list_people(self) -> Sequence[PersonCluster]:
        return list(self._data.people)

    # -- 复核 ---------------------------------------------------------------
    def list_review_queue(self, only_unreviewed: bool = True) -> Sequence[Image]:
        images = self._data.images
        if not only_unreviewed:
            return list(images)
        return [i for i in images if i.review_status != ReviewStatus.REVIEWED]

    def update_annotation(
        self,
        image_id: str,
        *,
        orientation: Orientation | None = None,
        usability: Usability | None = None,
    ) -> Image:
        image = self.get_image(image_id)
        if orientation is not None:
            image.orientation = orientation
        if usability is not None:
            image.usability = usability
            if usability == Usability.TRAINABLE:
                image.status = ImageStatus.REVIEWED_TRAINABLE
            elif usability == Usability.REJECT:
                image.status = ImageStatus.REVIEWED_REJECTED
        image.review_status = ReviewStatus.REVIEWED
        return image

    # -- 组包 ---------------------------------------------------------------
    def list_selections(self) -> Sequence[Selection]:
        return list(self._data.selections)

    def get_selection(self, selection_id: str) -> Selection:
        for selection in self._data.selections:
            if selection.id == selection_id:
                return selection
        raise ServiceError(f"组包不存在: {selection_id}")
