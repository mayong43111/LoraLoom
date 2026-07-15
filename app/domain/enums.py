"""领域枚举定义。

枚举取值与设计文档《DESIGN.md》第 6 节数据模型保持一致。
每个枚举提供 ``label`` 属性用于 UI 中文展示，避免在视图层散落硬编码文案。
"""

from __future__ import annotations

from enum import Enum


class LabeledEnum(str, Enum):
    """带中文展示名的字符串枚举基类。

    继承 ``str`` 以便直接序列化为 JSON / CSV，同时通过 ``_labels`` 提供展示名。
    """

    @property
    def label(self) -> str:
        return self._labels().get(self.value, self.value)

    @classmethod
    def _labels(cls) -> dict[str, str]:  # pragma: no cover - 子类覆盖
        return {}


class SubjectType(LabeledEnum):
    """主体类型。当前仅 ``PERSON`` 在 MVP 路径上，``OBJECT`` 为未来扩展。"""

    PERSON = "person"
    OBJECT = "object"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {"person": "人物", "object": "物品"}


class Orientation(LabeledEnum):
    """人物朝向 / 主体视角。"""

    FRONT = "front"
    SIDE = "side"
    BACK = "back"
    UNKNOWN = "unknown"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {"front": "正面", "side": "侧面", "back": "背面", "unknown": "未知"}


class FaceCompleteness(LabeledEnum):
    """脸部完整度。"""

    FULL = "full"
    PARTIAL = "partial"
    NONE = "none"
    UNKNOWN = "unknown"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {"full": "完整", "partial": "部分", "none": "无脸", "unknown": "未知"}


class Usability(LabeledEnum):
    """可用性结论。"""

    TRAINABLE = "trainable"
    REJECT = "reject"
    NEEDS_REVIEW = "needs_review"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {"trainable": "可训练", "reject": "拒绝", "needs_review": "需要复核"}


class ReviewStatus(LabeledEnum):
    """人工复核状态。"""

    AUTO = "auto"
    REVIEWED = "reviewed"
    NEEDS_SECOND_REVIEW = "needs_second_review"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "auto": "自动",
            "reviewed": "已复核",
            "needs_second_review": "需二次复核",
        }


class ImageStatus(LabeledEnum):
    """图片在处理流水线中的状态。"""

    NEW = "new"
    QUALITY_CHECKED = "quality_checked"
    FACE_PROCESSED = "face_processed"
    CLUSTERED = "clustered"
    REVIEWED_TRAINABLE = "reviewed_trainable"
    REVIEWED_REJECTED = "reviewed_rejected"
    EXPORTED = "exported"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "new": "新导入",
            "quality_checked": "已质检",
            "face_processed": "已人脸处理",
            "clustered": "已聚类",
            "reviewed_trainable": "已复核-可训练",
            "reviewed_rejected": "已复核-拒绝",
            "exported": "已导出",
        }


class QualityFlag(LabeledEnum):
    """质量问题标记，可多个同时存在。"""

    BLURRY = "blurry"
    DARK = "dark"
    OVEREXPOSED = "overexposed"
    LOW_COLOR = "low_color"
    LOW_INFORMATION = "low_information"
    LOW_RESOLUTION = "low_resolution"
    DUPLICATE = "duplicate"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "blurry": "模糊",
            "dark": "过暗",
            "overexposed": "过曝",
            "low_color": "低色彩",
            "low_information": "低信息量",
            "low_resolution": "分辨率不足",
            "duplicate": "重复",
        }


class ImportType(LabeledEnum):
    """导入批次类型。"""

    LOCAL_IMAGES = "local_images"
    LOCAL_VIDEO = "local_video"
    LOCAL_DIRECTORY = "local_directory"
    URL = "url"
    URL_LIST = "url_list"
    BROWSER_CAPTURE = "browser_capture"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "local_images": "本地图片",
            "local_video": "本地视频",
            "local_directory": "本地目录",
            "url": "单个 URL",
            "url_list": "URL 列表",
            "browser_capture": "浏览器捕获",
        }


class BatchStatus(LabeledEnum):
    """导入批次状态。"""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    ARCHIVED = "archived"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "pending": "待处理",
            "processing": "处理中",
            "completed": "完成",
            "failed": "失败",
            "archived": "已归档",
        }


class DownloadTool(LabeledEnum):
    """下载器类型。"""

    YT_DLP = "yt_dlp"
    GALLERY_DL = "gallery_dl"
    HTTP = "http"
    LOCAL = "local"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "yt_dlp": "yt-dlp",
            "gallery_dl": "gallery-dl",
            "http": "HTTP",
            "local": "本地",
        }


class DownloadStatus(LabeledEnum):
    """下载任务状态。"""

    QUEUED = "queued"
    PROBING = "probing"
    DOWNLOADING = "downloading"
    POSTPROCESSING = "postprocessing"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "queued": "排队中",
            "probing": "探测中",
            "downloading": "下载中",
            "postprocessing": "后处理",
            "completed": "完成",
            "failed": "失败",
            "skipped": "跳过",
        }


class FrameStatus(LabeledEnum):
    """抽帧结果状态。"""

    PENDING = "pending"
    EXTRACTED = "extracted"
    REPLACED_BY_NEIGHBOR = "replaced_by_neighbor"
    SKIPPED_NO_GOOD_FRAME = "skipped_no_good_frame"
    FAILED = "failed"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "pending": "待抽取",
            "extracted": "已抽取",
            "replaced_by_neighbor": "邻近帧替换",
            "skipped_no_good_frame": "无合格帧跳过",
            "failed": "失败",
        }


class VideoSourceType(LabeledEnum):
    """视频来源。"""

    DOWNLOAD = "download"
    LOCAL = "local"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {"download": "下载", "local": "本地导入"}


class VideoStatus(LabeledEnum):
    """视频在抽帧流水线中的状态。"""

    READY = "ready"
    QUEUED = "queued"
    EXTRACTING = "extracting"
    EXTRACTED = "extracted"
    FAILED = "failed"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "ready": "待抽帧",
            "queued": "排队中",
            "extracting": "抽帧中",
            "extracted": "已抽帧",
            "failed": "失败",
        }


class PersonStatus(LabeledEnum):
    """人物聚类状态。"""

    AUTO = "auto"
    CONFIRMED = "confirmed"
    NEEDS_MERGE_REVIEW = "needs_merge_review"
    IGNORED = "ignored"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "auto": "自动",
            "confirmed": "已确认",
            "needs_merge_review": "待合并复核",
            "ignored": "已忽略",
        }


class SelectionStatus(LabeledEnum):
    """组包 Selection 状态。"""

    DRAFT = "draft"
    LOCKED = "locked"
    EXPORTED = "exported"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {"draft": "草稿", "locked": "已锁定", "exported": "已导出"}


class CaptionOrigin(LabeledEnum):
    """Caption 来源。"""

    AUTO = "auto"
    USER = "user"
    TEMPLATE = "template"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {"auto": "自动生成", "user": "人工编辑", "template": "模板生成"}


class ExportFormat(LabeledEnum):
    """导出格式。

    ``JSONL`` 与 ``CSV`` 属于 MVP；其余格式为后续阶段，UI 中占位并禁用。
    """

    JSONL = "jsonl"
    CSV = "csv"
    COCO = "coco"
    YOLO = "yolo"
    FIFTYONE = "fiftyone"
    CVAT = "cvat"
    LABEL_STUDIO = "label_studio"

    @classmethod
    def _labels(cls) -> dict[str, str]:
        return {
            "jsonl": "JSONL",
            "csv": "CSV",
            "coco": "COCO",
            "yolo": "YOLO",
            "fiftyone": "FiftyOne",
            "cvat": "CVAT",
            "label_studio": "Label Studio",
        }

    @property
    def is_mvp(self) -> bool:
        return self in (ExportFormat.JSONL, ExportFormat.CSV)
