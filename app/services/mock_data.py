"""模拟数据工厂。

生成一批确定性的样例数据，供 :class:`~app.services.mock_service.MockDatasetService`
使用。使用固定随机种子保证每次启动数据一致，便于 UI 调试与截图对比。
"""

from __future__ import annotations

import random

from app.domain.enums import (
    BatchStatus,
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
)
from app.domain.models import (
    DownloadTask,
    FrameJob,
    FrameResult,
    Image,
    ImportBatch,
    PersonCluster,
    QualityMetrics,
    Selection,
    SelectionItem,
    SelectionRule,
)

_SEED = 20260715

_PERSON_NAMES = ["林一", "赵敏", "陈然", "Unknown"]


def _build_people(rng: random.Random) -> list[PersonCluster]:
    people: list[PersonCluster] = []
    for index, name in enumerate(_PERSON_NAMES):
        front = rng.randint(8, 34)
        side = rng.randint(4, 22)
        back = rng.randint(0, 12)
        is_unknown = name == "Unknown"
        people.append(
            PersonCluster(
                id=f"person-{index:03d}",
                display_name=name,
                entity_type=SubjectType.PERSON,
                representative_face_id=f"face-{index:03d}-rep",
                status=PersonStatus.AUTO if is_unknown else PersonStatus.CONFIRMED,
                image_count=front + side + back,
                face_count=front + side + back + rng.randint(0, 6),
                front_count=front,
                side_count=side,
                back_count=back,
                suspected_duplicate_of=(
                    "person-000" if index == 2 and rng.random() > 0.5 else None
                ),
            )
        )
    return people


def _build_images(rng: random.Random, people: list[PersonCluster]) -> list[Image]:
    orientations = list(Orientation)
    images: list[Image] = []
    for i in range(120):
        person = rng.choice(people)
        orientation = rng.choices(orientations, weights=[5, 3, 2, 1], k=1)[0]
        flags: list[QualityFlag] = []
        quality_score = round(rng.uniform(0.35, 0.98), 3)
        if quality_score < 0.5:
            flags.append(rng.choice([QualityFlag.BLURRY, QualityFlag.DARK]))
        if rng.random() < 0.12:
            flags.append(QualityFlag.LOW_COLOR)
        if rng.random() < 0.08:
            flags.append(QualityFlag.DUPLICATE)

        if quality_score >= 0.8 and not flags:
            usability = Usability.TRAINABLE
            review = rng.choice([ReviewStatus.REVIEWED, ReviewStatus.AUTO])
        elif quality_score < 0.45:
            usability = Usability.REJECT
            review = ReviewStatus.AUTO
        else:
            usability = Usability.NEEDS_REVIEW
            review = ReviewStatus.AUTO

        if review == ReviewStatus.REVIEWED and usability == Usability.TRAINABLE:
            status = ImageStatus.REVIEWED_TRAINABLE
        elif usability == Usability.REJECT:
            status = ImageStatus.REVIEWED_REJECTED
        else:
            status = ImageStatus.FACE_PROCESSED

        person_count = 1 if person.display_name != "Unknown" else rng.randint(0, 3)
        images.append(
            Image(
                id=f"img-{i:04d}",
                image_path=f"workspace/images/img-{i:04d}.jpg",
                sha256=f"{rng.getrandbits(64):016x}",
                width=rng.choice([768, 896, 1024, 1280]),
                height=rng.choice([1024, 1152, 1280, 1536]),
                quality_score=quality_score,
                quality_flags=flags,
                quality_metrics=QualityMetrics(
                    blur_score=round(rng.uniform(40, 320), 1),
                    brightness=round(rng.uniform(0.2, 0.9), 3),
                    saturation=round(rng.uniform(0.1, 0.8), 3),
                    entropy=round(rng.uniform(4.0, 7.8), 3),
                    duplicate_group=(
                        f"dup-{rng.randint(0, 9)}"
                        if QualityFlag.DUPLICATE in flags
                        else None
                    ),
                ),
                orientation=orientation,
                face_completeness=rng.choices(
                    list(FaceCompleteness), weights=[6, 3, 1, 1], k=1
                )[0],
                subject_type=SubjectType.PERSON,
                primary_subject_id=(
                    None if person.display_name == "Unknown" else person.id
                ),
                person_count=person_count,
                usability=usability,
                review_status=review,
                status=status,
                asset_id=f"asset-{i % 12:03d}",
                frame_target_timestamp=(float(i % 60) if i % 3 == 0 else None),
                frame_actual_timestamp=(
                    float(i % 60) + rng.choice([0.0, 0.2, 0.4]) if i % 3 == 0 else None
                ),
                thumbnail_hint=f"{i}-{orientation.value}",
            )
        )
    return images


def _build_import_batches(rng: random.Random) -> list[ImportBatch]:
    specs = [
        ("本地视频批次 A", ImportType.LOCAL_VIDEO, BatchStatus.COMPLETED, 4, 96, 4, 0),
        ("URL 列表-人物集锦", ImportType.URL_LIST, BatchStatus.PROCESSING, 20, 12, 6, 2),
        ("本地图片-补充正面", ImportType.LOCAL_IMAGES, BatchStatus.COMPLETED, 30, 30, 0, 0),
        ("浏览器捕获-画廊", ImportType.BROWSER_CAPTURE, BatchStatus.FAILED, 8, 0, 0, 8),
    ]
    batches: list[ImportBatch] = []
    for index, (name, itype, status, inp, img, frame, err) in enumerate(specs):
        batches.append(
            ImportBatch(
                id=f"batch-{index:03d}",
                name=name,
                type=itype,
                status=status,
                input_count=inp,
                image_count=img,
                frame_task_count=frame,
                error_count=err,
            )
        )
    return batches


def _build_downloads(rng: random.Random) -> list[DownloadTask]:
    return [
        DownloadTask(
            id="dl-000",
            title="示例视频-人物访谈.mp4",
            tool=DownloadTool.YT_DLP,
            quality="1080p",
            status=DownloadStatus.COMPLETED,
            progress=1.0,
            speed="-",
            output_path="workspace/downloads/interview.mp4",
        ),
        DownloadTask(
            id="dl-001",
            title="示例合集-列表第 3 项",
            tool=DownloadTool.YT_DLP,
            quality="720p",
            status=DownloadStatus.DOWNLOADING,
            progress=0.42,
            speed="3.1 MB/s",
            output_path="workspace/downloads/clip-03.mp4",
        ),
        DownloadTask(
            id="dl-002",
            title="画廊图片集(需 gallery-dl)",
            tool=DownloadTool.GALLERY_DL,
            quality="仅图片",
            status=DownloadStatus.SKIPPED,
            progress=0.0,
            speed="-",
            output_path="",
            error="第二阶段功能，当前占位",
        ),
        DownloadTask(
            id="dl-003",
            title="直链图片.jpg",
            tool=DownloadTool.HTTP,
            quality="原图",
            status=DownloadStatus.FAILED,
            progress=0.0,
            speed="-",
            output_path="",
            error="HTTP 403，可复制命令调试",
        ),
    ]


def _build_frame_jobs(rng: random.Random) -> list[FrameJob]:
    jobs: list[FrameJob] = []
    for index in range(3):
        duration = rng.choice([42.0, 63.0, 120.0])
        frames: list[FrameResult] = []
        t = 0.0
        while t < min(duration, 20.0):
            roll = rng.random()
            if roll < 0.7:
                status = FrameStatus.EXTRACTED
                actual = t
            elif roll < 0.85:
                status = FrameStatus.REPLACED_BY_NEIGHBOR
                actual = round(t + rng.choice([0.2, 0.4]), 1)
            else:
                status = FrameStatus.SKIPPED_NO_GOOD_FRAME
                actual = None
            frames.append(
                FrameResult(
                    target_timestamp=t,
                    actual_timestamp=actual,
                    status=status,
                    quality_score=(
                        round(rng.uniform(0.5, 0.95), 3) if actual is not None else None
                    ),
                    image_id=None,
                )
            )
            t += 1.0
        jobs.append(
            FrameJob(
                id=f"frame-job-{index:03d}",
                asset_id=f"asset-{index:03d}",
                video_name=f"video-{index:03d}.mp4",
                duration=duration,
                interval=1.0,
                progress=round(rng.uniform(0.3, 1.0), 2),
                frames=frames,
            )
        )
    return jobs


def _build_selections(
    rng: random.Random, people: list[PersonCluster], images: list[Image]
) -> list[Selection]:
    target_person = next(p for p in people if p.display_name != "Unknown")
    rules = [
        SelectionRule(SubjectType.PERSON, target_person.id, Orientation.FRONT, 30),
        SelectionRule(SubjectType.PERSON, target_person.id, Orientation.SIDE, 20),
        SelectionRule(SubjectType.PERSON, target_person.id, Orientation.BACK, 10),
    ]
    items: list[SelectionItem] = []
    for rule in rules:
        candidates = [
            img
            for img in images
            if img.primary_subject_id == rule.subject_id
            and img.orientation == rule.orientation
            and img.usability == Usability.TRAINABLE
        ]
        chosen = candidates[: min(len(candidates), rule.target_count)]
        for order, img in enumerate(chosen):
            items.append(
                SelectionItem(
                    id=f"sel-item-{rule.key}-{order}",
                    selection_id="selection-000",
                    image_id=img.id,
                    rule_key=rule.key,
                    rank_score=round(img.quality_score, 3),
                    locked=False,
                )
            )
    return [
        Selection(
            id="selection-000",
            name=f"{target_person.display_name} 正侧背 30/20/10",
            status=SelectionStatus.DRAFT,
            rules=rules,
            items=items,
        )
    ]


class MockDataset:
    """内存中的模拟数据集，聚合所有实体集合。"""

    def __init__(self) -> None:
        rng = random.Random(_SEED)
        self.people = _build_people(rng)
        self.images = _build_images(rng, self.people)
        self.import_batches = _build_import_batches(rng)
        self.downloads = _build_downloads(rng)
        self.frame_jobs = _build_frame_jobs(rng)
        self.selections = _build_selections(rng, self.people, self.images)
