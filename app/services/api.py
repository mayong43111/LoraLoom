"""服务层抽象接口。

该接口是 UI 与后端之间的唯一契约。真实实现与 mock 实现都必须遵守它，
以保证 UI 代码在从 mock 切换到正式后端时保持不变。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.domain.enums import Orientation, ReviewStatus, Usability
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
    group_id: str | None = None
    tag: str | None = None
    keyword: str | None = None


@dataclass(slots=True)
class ImageCreate:
    """手动上传/登记图片时的输入。"""

    title: str
    group_id: str | None = None
    tags: list[str] = field(default_factory=list)
    width: int = 0
    height: int = 0
    path: str = ""


@dataclass(slots=True)
class VideoFilter:
    """视频库筛选条件。所有字段可选，``None`` 表示不限制。"""

    group_id: str | None = None
    status: str | None = None
    source_type: str | None = None
    tag: str | None = None
    keyword: str | None = None


@dataclass(slots=True)
class VideoCreate:
    """手动上传/登记视频时的输入。"""

    title: str
    group_id: str | None = None
    tags: list[str] = field(default_factory=list)
    duration: float = 0.0
    width: int = 0
    height: int = 0
    fps: float = 25.0
    size_bytes: int = 0
    path: str = ""



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
    def list_image_groups(self) -> Sequence[ImageGroup]:
        """返回图片分组列表。"""

    @abstractmethod
    def create_image_group(self, name: str, description: str = "") -> ImageGroup:
        """新建图片分组，返回创建后的分组。"""

    @abstractmethod
    def list_images(self, image_filter: ImageFilter | None = None) -> Sequence[Image]:
        """按筛选条件返回图片列表。"""

    @abstractmethod
    def get_image(self, image_id: str) -> Image:
        """返回单张图片详情。"""

    @abstractmethod
    def create_image(self, payload: "ImageCreate") -> Image:
        """手动登记/上传一张本地图片，返回创建后的图片。"""

    # -- 抽帧 ---------------------------------------------------------------
    @abstractmethod
    def list_frame_jobs(self) -> Sequence[FrameJob]:
        """返回抽帧任务列表。"""

    # -- 视频库 -------------------------------------------------------------
    @abstractmethod
    def list_video_groups(self) -> Sequence[VideoGroup]:
        """返回视频分组列表。"""

    @abstractmethod
    def create_video_group(self, name: str, description: str = "") -> VideoGroup:
        """新建视频分组，返回创建后的分组。"""

    @abstractmethod
    def list_videos(
        self, video_filter: "VideoFilter | None" = None
    ) -> Sequence[Video]:
        """按筛选条件返回视频库列表。"""

    @abstractmethod
    def get_video(self, video_id: str) -> Video:
        """返回单个视频详情。"""

    @abstractmethod
    def create_video(self, payload: "VideoCreate") -> Video:
        """手动登记/上传一个本地视频，返回创建后的视频。"""

    @abstractmethod
    def get_video_frame_job(self, video_id: str) -> FrameJob | None:
        """返回某视频的抽帧结果；尚未抽帧时返回 None。"""

    @abstractmethod
    def run_frame_extraction(self, video_id: str, interval: float) -> FrameJob:
        """对指定视频执行抽帧工具，返回生成的抽帧任务结果。"""

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
