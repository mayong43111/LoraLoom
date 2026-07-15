"""服务层抽象接口。

该接口是 UI 与后端之间的唯一契约。真实实现与 mock 实现都必须遵守它，
以保证 UI 代码在从 mock 切换到正式后端时保持不变。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass

from app.domain.enums import Orientation, ReviewStatus, Usability
from app.domain.models import (
    DatasetStats,
    DownloadTask,
    FrameJob,
    Image,
    ImportBatch,
    PersonCluster,
    Selection,
)


class ServiceError(Exception):
    """服务层统一异常类型。"""


@dataclass(slots=True)
class ImageFilter:
    """图片库筛选条件。

    所有字段均为可选；``None`` 表示不限制该维度。UI 的筛选栏映射到此对象。
    """

    person_id: str | None = None
    orientation: Orientation | None = None
    usability: Usability | None = None
    review_status: ReviewStatus | None = None
    quality_flag: str | None = None
    keyword: str | None = None


class DatasetService(ABC):
    """数据集服务接口。

    方法按 UI 页面组织，返回领域模型对象。实现方负责数据加载、
    筛选与业务规则，UI 只负责展示与收集用户输入。
    """

    # -- Dashboard ----------------------------------------------------------
    @abstractmethod
    def get_stats(self) -> DatasetStats:
        """返回 Dashboard 汇总统计。"""

    # -- 导入 ---------------------------------------------------------------
    @abstractmethod
    def list_import_batches(self) -> Sequence[ImportBatch]:
        """返回导入批次列表。"""

    # -- 下载 ---------------------------------------------------------------
    @abstractmethod
    def list_download_tasks(self) -> Sequence[DownloadTask]:
        """返回下载任务列表。"""

    # -- 图片库 -------------------------------------------------------------
    @abstractmethod
    def list_images(self, image_filter: ImageFilter | None = None) -> Sequence[Image]:
        """按筛选条件返回图片列表。"""

    @abstractmethod
    def get_image(self, image_id: str) -> Image:
        """返回单张图片详情。"""

    # -- 抽帧 ---------------------------------------------------------------
    @abstractmethod
    def list_frame_jobs(self) -> Sequence[FrameJob]:
        """返回抽帧任务列表。"""

    # -- 人物 ---------------------------------------------------------------
    @abstractmethod
    def list_people(self) -> Sequence[PersonCluster]:
        """返回人物聚类列表。"""

    # -- 复核 ---------------------------------------------------------------
    @abstractmethod
    def list_review_queue(self, only_unreviewed: bool = True) -> Sequence[Image]:
        """返回待复核图片队列。"""

    @abstractmethod
    def update_annotation(
        self,
        image_id: str,
        *,
        orientation: Orientation | None = None,
        usability: Usability | None = None,
    ) -> Image:
        """更新单张图片的人工标签，返回更新后的图片。"""

    # -- 组包 ---------------------------------------------------------------
    @abstractmethod
    def list_selections(self) -> Sequence[Selection]:
        """返回组包 Selection 列表。"""

    @abstractmethod
    def get_selection(self, selection_id: str) -> Selection:
        """返回单个 Selection 详情。"""
