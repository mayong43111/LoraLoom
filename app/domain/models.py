"""领域数据模型。

使用 ``dataclass`` 描述设计文档中的核心实体。这些对象是纯数据容器，
不包含持久化或 UI 逻辑，便于在服务层与视图层之间传递。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from app.domain.enums import (
    BatchStatus,
    CaptionOrigin,
    DatasetType,
    DownloadStatus,
    DownloadTool,
    FaceCompleteness,
    FrameStatus,
    ImageStatus,
    ImportType,
    Orientation,
    PersonStatus,
    QualityFlag,
    ReviewStatus,
    SelectionStatus,
    SubjectType,
    Usability,
    VideoSourceType,
    VideoStatus,
)


@dataclass(slots=True)
class ImportBatch:
    """导入批次。对应 docs/DESIGN.md 6.1。"""

    id: str
    name: str
    type: ImportType
    status: BatchStatus
    input_count: int = 0
    image_count: int = 0
    frame_task_count: int = 0
    error_count: int = 0
    created_at: datetime = field(default_factory=datetime.now)


@dataclass(slots=True)
class Asset:
    """原始素材（视频或图片）。对应 docs/DESIGN.md 6.2。"""

    id: str
    import_batch_id: str
    type: str  # "video" | "image"
    path: str
    sha256: str
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    fps: float | None = None
    download_tool: DownloadTool = DownloadTool.LOCAL


@dataclass(slots=True)
class QualityMetrics:
    """质量指标明细，用于详情面板展示。"""

    blur_score: float
    brightness: float
    saturation: float
    entropy: float
    duplicate_group: str | None = None


@dataclass(slots=True)
class ImageGroup:
    """图片分组。用于在图片库中对图片进行文件夹式归类管理。"""

    id: str
    name: str
    description: str = ""
    image_count: int = 0
    created_at: datetime = field(default_factory=datetime.now)


@dataclass(slots=True)
class Image:
    """数据集核心对象。对应 docs/DESIGN.md 6.3。"""

    id: str
    image_path: str
    sha256: str
    width: int
    height: int
    quality_score: float
    quality_flags: list[QualityFlag] = field(default_factory=list)
    quality_metrics: QualityMetrics | None = None
    orientation: Orientation = Orientation.UNKNOWN
    face_completeness: FaceCompleteness = FaceCompleteness.UNKNOWN
    subject_type: SubjectType = SubjectType.PERSON
    primary_subject_id: str | None = None
    person_count: int = 0
    usability: Usability = Usability.NEEDS_REVIEW
    review_status: ReviewStatus = ReviewStatus.AUTO
    status: ImageStatus = ImageStatus.NEW
    asset_id: str | None = None
    frame_target_timestamp: float | None = None
    frame_actual_timestamp: float | None = None
    thumbnail_hint: str = ""  # mock 环境下用于生成占位缩略图的种子
    title: str = ""
    caption: str = ""
    group_id: str | None = None
    tags: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)


@dataclass(slots=True)
class Face:
    """人脸检测结果。对应 docs/DESIGN.md 6.4。"""

    id: str
    image_id: str
    bbox: tuple[int, int, int, int]
    confidence: float
    cluster_id: str | None = None
    is_false_positive: bool = False


@dataclass(slots=True)
class PersonCluster:
    """人物聚类。对应 docs/DESIGN.md 6.5。"""

    id: str
    display_name: str
    entity_type: SubjectType = SubjectType.PERSON
    representative_face_id: str | None = None
    status: PersonStatus = PersonStatus.AUTO
    image_count: int = 0
    face_count: int = 0
    front_count: int = 0
    side_count: int = 0
    back_count: int = 0
    suspected_duplicate_of: str | None = None


@dataclass(slots=True)
class Annotation:
    """人工/自动标签。对应 docs/DESIGN.md 6.6。"""

    id: str
    image_id: str
    person_cluster_id: str | None
    orientation: Orientation
    face_completeness: FaceCompleteness
    person_count: int
    usability: Usability
    label_origin: str = "auto"  # "auto" | "user"
    updated_at: datetime = field(default_factory=datetime.now)


@dataclass(slots=True)
class Caption:
    """训练文本。对应 docs/DESIGN.md 6.7。"""

    id: str
    image_id: str
    caption: str = ""
    positive_prompt: str = ""
    negative_prompt: str = ""
    template_id: str | None = None
    caption_origin: CaptionOrigin = CaptionOrigin.AUTO
    updated_at: datetime = field(default_factory=datetime.now)


@dataclass(slots=True)
class SelectionRule:
    """组包配额规则。"""

    subject_type: SubjectType
    subject_id: str
    orientation: Orientation
    target_count: int
    min_quality: float = 0.0
    require_reviewed: bool = True
    require_trainable: bool = True
    exclude_duplicates: bool = True

    @property
    def key(self) -> str:
        return f"{self.subject_id}:{self.orientation.value}"


@dataclass(slots=True)
class SelectionItem:
    """组包中的单张图片。对应 docs/DESIGN.md 6.9。"""

    id: str
    selection_id: str
    image_id: str
    rule_key: str
    rank_score: float
    locked: bool = False


@dataclass(slots=True)
class Selection:
    """组包 Selection。对应 docs/DESIGN.md 6.8。"""

    id: str
    name: str
    status: SelectionStatus = SelectionStatus.DRAFT
    rules: list[SelectionRule] = field(default_factory=list)
    items: list[SelectionItem] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    def matched_count(self, rule: SelectionRule) -> int:
        return sum(1 for item in self.items if item.rule_key == rule.key)

    def gap_count(self, rule: SelectionRule) -> int:
        return max(0, rule.target_count - self.matched_count(rule))


@dataclass(slots=True)
class DownloadTask:
    """下载任务。对应 docs/UI_DESIGN.md 4.4。"""

    id: str
    title: str
    tool: DownloadTool
    quality: str
    status: DownloadStatus
    progress: float = 0.0
    speed: str = ""
    output_path: str = ""
    error: str = ""


@dataclass(slots=True)
class VideoGroup:
    """视频分组。用于在视频库中对视频进行归类管理。"""

    id: str
    name: str
    description: str = ""
    video_count: int = 0
    created_at: datetime = field(default_factory=datetime.now)


@dataclass(slots=True)
class Video:
    """视频库中的视频。素材来源于下载或本地导入，是抽帧的输入。"""

    id: str
    title: str
    source_type: VideoSourceType
    path: str
    duration: float
    width: int
    height: int
    fps: float
    size_bytes: int
    status: VideoStatus = VideoStatus.READY
    codec: str = "h264"
    frame_interval: float = 1.0
    extracted_frame_count: int = 0
    source_download_id: str | None = None
    thumbnail_hint: str = ""
    caption: str = ""
    group_id: str | None = None
    tags: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)


@dataclass(slots=True)
class FrameJob:
    """单个视频的抽帧任务。作为视频库的子工具结果。"""

    id: str
    video_id: str
    video_name: str
    duration: float
    interval: float
    progress: float
    frames: list[FrameResult] = field(default_factory=list)


@dataclass(slots=True)
class FrameResult:
    """单个抽取点的结果。"""

    target_timestamp: float
    actual_timestamp: float | None
    status: FrameStatus
    quality_score: float | None = None
    image_id: str | None = None


@dataclass(slots=True)
class DatasetStats:
    """Dashboard 汇总统计。"""

    image_total: int
    image_candidate: int
    image_reviewed: int
    image_exportable: int
    image_rejected: int
    person_total: int
    person_confirmed: int
    unknown_faces: int
    suspected_duplicates: int
    orientation_distribution: dict[Orientation, int]
    quality_distribution: dict[QualityFlag, int]
    pending_frame: int
    pending_quality: int
    pending_face: int
    pending_review: int


@dataclass(slots=True)
class Dataset:
    """数据集。先创建并设定类型（图片/视频），再从对应素材库导入内容。"""

    id: str
    name: str
    type: DatasetType
    description: str = ""
    base_model: str = "Qwen/Qwen-Image-2512"
    item_count: int = 0
    created_at: datetime = field(default_factory=datetime.now)
