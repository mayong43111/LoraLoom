"""服务层抽象接口。

该接口是 UI 与后端之间的唯一契约。真实实现与 mock 实现都必须遵守它，
以保证 UI 代码在从 mock 切换到正式后端时保持不变。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from app.domain.enums import DatasetType, Orientation, ReviewStatus, Usability
from app.domain.models import (
    Dataset,
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


class _Unset:
    """哨兵类型：区分「未提供该字段」与「显式设为 None」。"""

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - 仅用于调试展示
        return "UNSET"


# 用于 update_* 方法：group_id=UNSET 表示不改动分组；group_id=None 表示移出分组。
UNSET: Any = _Unset()


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
    # 抽帧插件在提交时携带的质量与时间戳信息（普通上传保持默认）。
    quality_score: float = 0.0
    quality_flags: list[str] = field(default_factory=list)
    frame_target_timestamp: float | None = None
    frame_actual_timestamp: float | None = None


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
        """新建图片分组，返回创建后的分组。

        同名分组已存在时不重复创建，直接返回已有分组（保证只保留一个）。
        """

    @abstractmethod
    def update_image_group(
        self,
        group_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> ImageGroup:
        """编辑图片分组名称/描述；``None`` 表示该字段不改动。"""

    @abstractmethod
    def delete_image_group(self, group_id: str, *, delete_images: bool = False) -> None:
        """删除图片分组；成员图片可一并删除，否则移到根目录。"""

    @abstractmethod
    def list_images(self, image_filter: ImageFilter | None = None) -> Sequence[Image]:
        """按筛选条件返回图片列表。"""

    @abstractmethod
    def get_image(self, image_id: str) -> Image:
        """返回单张图片详情。"""

    @abstractmethod
    def create_image(self, payload: "ImageCreate") -> Image:
        """手动登记/上传一张本地图片，返回创建后的图片。"""

    @abstractmethod
    def update_image(
        self,
        image_id: str,
        *,
        title: str | None = None,
        tags: list[str] | None = None,
        caption: str | None = None,
        group_id: Any = UNSET,
        image_path: str | None = None,
        width: int | None = None,
        height: int | None = None,
        sha256: str | None = None,
    ) -> Image:
        """编辑图片基本信息或移动分组。

        ``title``/``tags`` 为 ``None`` 表示不改动；``group_id`` 为 ``UNSET``
        表示保持分组不变，为 ``None`` 表示移出分组（回到根目录）。
        文件路径、分辨率和哈希仅供导入、裁剪等受控服务端流程更新。
        """

    @abstractmethod
    def delete_image(self, image_id: str) -> None:
        """从图片库删除一张图片。"""

    @abstractmethod
    def copy_image(self, image_id: str, *, group_id: str | None = None) -> Image:
        """复制一张图片到指定分组（``group_id=None`` 表示复制到根目录）。"""

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
        """新建视频分组，返回创建后的分组。

        同名分组已存在时不重复创建，直接返回已有分组（保证只保留一个）。
        """

    @abstractmethod
    def update_video_group(
        self,
        group_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> VideoGroup:
        """编辑视频分组名称/描述；``None`` 表示该字段不改动。"""

    @abstractmethod
    def delete_video_group(self, group_id: str) -> None:
        """删除视频分组，其中的视频会被移出分组（回到根目录）。"""

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
    def update_video(
        self,
        video_id: str,
        *,
        title: str | None = None,
        tags: list[str] | None = None,
        caption: str | None = None,
        group_id: Any = UNSET,
    ) -> Video:
        """编辑视频基本信息或移动分组。

        ``title``/``tags`` 为 ``None`` 表示不改动；``group_id`` 为 ``UNSET``
        表示保持分组不变，为 ``None`` 表示移出分组。分辨率、帧率、时长等硬
        指标不可编辑。
        """

    @abstractmethod
    def delete_video(self, video_id: str) -> None:
        """从视频库删除一个视频。"""

    @abstractmethod
    def copy_video(self, video_id: str, *, group_id: str | None = None) -> Video:
        """复制一个视频到指定分组（``group_id=None`` 表示复制到根目录）。"""

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

    # -- 数据集 -------------------------------------------------------------
    # 以下方法为非抽象默认实现（抛未实现异常），便于旧的 mock 实现无需改动即可
    # 保持有效；SQLite 实现提供完整功能。
    def list_datasets(self) -> Sequence[Dataset]:
        """返回数据集列表。"""
        raise NotImplementedError

    def get_dataset(self, dataset_id: str) -> Dataset:
        """返回单个数据集详情。"""
        raise NotImplementedError

    def create_dataset(
        self,
        name: str,
        type: DatasetType,
        description: str = "",
        base_model: str = "Qwen/Qwen-Image-2512",
    ) -> Dataset:
        """创建数据集并设定类型（图片/视频）。"""
        raise NotImplementedError

    def update_dataset(
        self,
        dataset_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> Dataset:
        """更新数据集名称/描述（类型创建后不可变更）。"""
        raise NotImplementedError

    def delete_dataset(self, dataset_id: str) -> None:
        """删除数据集及其条目关联（不影响素材库中的原始图片/视频）。"""
        raise NotImplementedError

    def list_dataset_images(self, dataset_id: str) -> Sequence[Image]:
        """返回图片类型数据集中的图片。"""
        raise NotImplementedError

    def list_dataset_videos(self, dataset_id: str) -> Sequence[Video]:
        """返回视频类型数据集中的视频。"""
        raise NotImplementedError

    def add_dataset_items(self, dataset_id: str, item_ids: Sequence[str]) -> Dataset:
        """把素材库中的图片/视频加入数据集（按数据集类型校验）。"""
        raise NotImplementedError

    def remove_dataset_items(
        self, dataset_id: str, item_ids: Sequence[str]
    ) -> Dataset:
        """从数据集移除条目（不删除素材库原始内容）。"""
        raise NotImplementedError

    def update_dataset_item(
        self,
        dataset_id: str,
        item_id: str,
        *,
        caption: str | None = None,
        tags: Sequence[str] | None = None,
    ) -> Image | Video:
        """修改数据集内某条目的标签/说明覆盖，仅对当前数据集生效。"""
        raise NotImplementedError

