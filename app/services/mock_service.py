"""基于内存模拟数据的服务实现。

:class:`MockDatasetService` 实现 :class:`~app.services.api.DatasetService`，
用固定的样例数据响应 UI 请求。它模拟真实后端的读取与轻量写入语义
（例如更新标签），但不做任何持久化或算法计算。
"""

from __future__ import annotations

from collections.abc import Sequence

from app.domain.enums import (
    ImageStatus,
    Orientation,
    QualityFlag,
    ReviewStatus,
    Usability,
)
from app.domain.models import (
    DatasetStats,
    DownloadTask,
    FrameJob,
    Image,
    ImportBatch,
    PersonCluster,
    Selection,
)
from app.services.api import DatasetService, ImageFilter, ServiceError
from app.services.mock_data import MockDataset


class MockDatasetService(DatasetService):
    """使用内存样例数据的服务实现。"""

    def __init__(self, dataset: MockDataset | None = None) -> None:
        self._data = dataset or MockDataset()
        self._image_index = {img.id: img for img in self._data.images}

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
                len([f for f in job.frames if f.status.value == "pending"])
                for job in self._data.frame_jobs
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
    def list_images(self, image_filter: ImageFilter | None = None) -> Sequence[Image]:
        images: Sequence[Image] = self._data.images
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
                image_filter.keyword
                and image_filter.keyword.lower() not in img.id.lower()
            ):
                continue
            result.append(img)
        return result

    def get_image(self, image_id: str) -> Image:
        try:
            return self._image_index[image_id]
        except KeyError as exc:  # pragma: no cover - 防御性
            raise ServiceError(f"图片不存在: {image_id}") from exc

    # -- 抽帧 ---------------------------------------------------------------
    def list_frame_jobs(self) -> Sequence[FrameJob]:
        return list(self._data.frame_jobs)

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
