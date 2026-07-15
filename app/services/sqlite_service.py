"""基于 SQLite 的服务实现。

:class:`SqliteDatasetService` 实现 :class:`~app.services.api.DatasetService`，
以 SQLite 作为持久化存储。首次启动时若库为空，则用
:class:`~app.services.mock_data.MockDataset` 生成的确定性样例数据播种，
从而在保留演示数据的同时具备真实的读写与持久化能力。
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Sequence

from app.domain.enums import (
    ImageStatus,
    Orientation,
    QualityFlag,
    ReviewStatus,
    Usability,
    VideoStatus,
)
from app.domain.models import (
    DatasetStats,
    DownloadTask,
    FrameJob,
    Image,
    ImportBatch,
    PersonCluster,
    Selection,
    Video,
)
from app.services import db, mapping
from app.services.api import DatasetService, ImageFilter, ServiceError
from app.services.mock_data import MockDataset


class SqliteDatasetService(DatasetService):
    """使用 SQLite 持久化的服务实现。"""

    def __init__(self, db_path: str = "workspace/dataset.sqlite") -> None:
        self._conn = db.connect(db_path)
        # 连接允许跨线程使用（FastAPI 线程池），用可重入锁串行化访问。
        self._lock = threading.RLock()
        db.init_db(self._conn)
        if db.is_empty(self._conn):
            self._seed(MockDataset())

    # -- 底层访问（加锁） ---------------------------------------------------
    def _fetchall(
        self, sql: str, params: Sequence[object] = ()
    ) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    def _fetchone(
        self, sql: str, params: Sequence[object] = ()
    ) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, params).fetchone()

    def _write(self, sql: str, params: Sequence[object]) -> None:
        with self._lock:
            self._conn.execute(sql, params)
            self._conn.commit()

    # -- 播种 ---------------------------------------------------------------
    def _seed(self, data: MockDataset) -> None:
        conn = self._conn
        conn.executemany(
            "INSERT INTO images "
            "(id, orientation, usability, review_status, primary_subject_id, "
            "quality_score, doc) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    img.id,
                    img.orientation.value,
                    img.usability.value,
                    img.review_status.value,
                    img.primary_subject_id,
                    img.quality_score,
                    mapping.to_json(img),
                )
                for img in data.images
            ],
        )
        conn.executemany(
            "INSERT INTO videos (id, status, source_type, created_at, doc) "
            "VALUES (?, ?, ?, ?, ?)",
            [
                (
                    v.id,
                    v.status.value,
                    v.source_type.value,
                    v.created_at.isoformat(),
                    mapping.to_json(v),
                )
                for v in data.videos
            ],
        )
        conn.executemany(
            "INSERT INTO frame_jobs (video_id, doc) VALUES (?, ?)",
            [(j.video_id, mapping.to_json(j)) for j in data.frame_jobs],
        )
        conn.executemany(
            "INSERT INTO people (id, doc) VALUES (?, ?)",
            [(p.id, mapping.to_json(p)) for p in data.people],
        )
        conn.executemany(
            "INSERT INTO import_batches (id, doc) VALUES (?, ?)",
            [(b.id, mapping.to_json(b)) for b in data.import_batches],
        )
        conn.executemany(
            "INSERT INTO downloads (id, doc) VALUES (?, ?)",
            [(d.id, mapping.to_json(d)) for d in data.downloads],
        )
        conn.executemany(
            "INSERT INTO selections (id, doc) VALUES (?, ?)",
            [(s.id, mapping.to_json(s)) for s in data.selections],
        )
        conn.commit()

    @staticmethod
    def _doc(row: sqlite3.Row) -> dict:
        return json.loads(row["doc"])

    # -- Dashboard ----------------------------------------------------------
    def get_stats(self) -> DatasetStats:
        images = self.list_images()
        people = self.list_people()
        videos = self.list_videos()

        orientation_dist: dict[Orientation, int] = {o: 0 for o in Orientation}
        quality_dist: dict[QualityFlag, int] = {q: 0 for q in QualityFlag}
        for img in images:
            orientation_dist[img.orientation] += 1
            for flag in img.quality_flags:
                quality_dist[flag] += 1

        candidate = sum(1 for i in images if i.usability == Usability.NEEDS_REVIEW)
        return DatasetStats(
            image_total=len(images),
            image_candidate=candidate,
            image_reviewed=sum(
                1 for i in images if i.review_status == ReviewStatus.REVIEWED
            ),
            image_exportable=sum(
                1 for i in images if i.status == ImageStatus.REVIEWED_TRAINABLE
            ),
            image_rejected=sum(1 for i in images if i.usability == Usability.REJECT),
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
                for v in videos
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
        rows = self._fetchall("SELECT doc FROM import_batches")
        return [mapping.import_batch_from_dict(self._doc(r)) for r in rows]

    # -- 下载 ---------------------------------------------------------------
    def list_download_tasks(self) -> Sequence[DownloadTask]:
        rows = self._fetchall("SELECT doc FROM downloads")
        return [mapping.download_from_dict(self._doc(r)) for r in rows]

    # -- 图片库 -------------------------------------------------------------
    def list_images(self, image_filter: ImageFilter | None = None) -> Sequence[Image]:
        clauses: list[str] = []
        params: list[object] = []
        if image_filter is not None:
            if image_filter.person_id is not None:
                clauses.append("primary_subject_id = ?")
                params.append(image_filter.person_id)
            if image_filter.orientation is not None:
                clauses.append("orientation = ?")
                params.append(image_filter.orientation.value)
            if image_filter.usability is not None:
                clauses.append("usability = ?")
                params.append(image_filter.usability.value)
            if image_filter.review_status is not None:
                clauses.append("review_status = ?")
                params.append(image_filter.review_status.value)

        sql = "SELECT doc FROM images"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY id"
        rows = self._fetchall(sql, params)
        images = [mapping.image_from_dict(self._doc(r)) for r in rows]

        # 非索引维度在内存中过滤（数据量小）。
        if image_filter is not None:
            if image_filter.quality_flag is not None:
                images = [
                    i
                    for i in images
                    if any(f.value == image_filter.quality_flag for f in i.quality_flags)
                ]
            if image_filter.keyword:
                kw = image_filter.keyword.lower()
                images = [i for i in images if kw in i.id.lower()]
        return images

    def get_image(self, image_id: str) -> Image:
        row = self._fetchone("SELECT doc FROM images WHERE id = ?", (image_id,))
        if row is None:
            raise ServiceError(f"图片不存在: {image_id}")
        return mapping.image_from_dict(self._doc(row))

    # -- 抽帧 ---------------------------------------------------------------
    def list_frame_jobs(self) -> Sequence[FrameJob]:
        rows = self._fetchall("SELECT doc FROM frame_jobs")
        return [mapping.frame_job_from_dict(self._doc(r)) for r in rows]

    # -- 视频库 -------------------------------------------------------------
    def list_videos(self) -> Sequence[Video]:
        rows = self._fetchall(
            "SELECT doc FROM videos ORDER BY created_at DESC, id"
        )
        return [mapping.video_from_dict(self._doc(r)) for r in rows]

    def get_video(self, video_id: str) -> Video:
        row = self._fetchone("SELECT doc FROM videos WHERE id = ?", (video_id,))
        if row is None:
            raise ServiceError(f"视频不存在: {video_id}")
        return mapping.video_from_dict(self._doc(row))

    def get_video_frame_job(self, video_id: str) -> FrameJob | None:
        row = self._fetchone(
            "SELECT doc FROM frame_jobs WHERE video_id = ?", (video_id,)
        )
        if row is None:
            return None
        return mapping.frame_job_from_dict(self._doc(row))

    # -- 人物 ---------------------------------------------------------------
    def list_people(self) -> Sequence[PersonCluster]:
        rows = self._fetchall("SELECT doc FROM people")
        return [mapping.person_from_dict(self._doc(r)) for r in rows]

    # -- 复核 ---------------------------------------------------------------
    def list_review_queue(self, only_unreviewed: bool = True) -> Sequence[Image]:
        if only_unreviewed:
            rows = self._fetchall(
                "SELECT doc FROM images WHERE review_status != ? ORDER BY id",
                (ReviewStatus.REVIEWED.value,),
            )
        else:
            rows = self._fetchall("SELECT doc FROM images ORDER BY id")
        return [mapping.image_from_dict(self._doc(r)) for r in rows]

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

        self._write(
            "UPDATE images SET orientation = ?, usability = ?, review_status = ?, "
            "doc = ? WHERE id = ?",
            (
                image.orientation.value,
                image.usability.value,
                image.review_status.value,
                mapping.to_json(image),
                image_id,
            ),
        )
        return image

    # -- 组包 ---------------------------------------------------------------
    def list_selections(self) -> Sequence[Selection]:
        rows = self._fetchall("SELECT doc FROM selections")
        return [mapping.selection_from_dict(self._doc(r)) for r in rows]

    def get_selection(self, selection_id: str) -> Selection:
        row = self._fetchone(
            "SELECT doc FROM selections WHERE id = ?", (selection_id,)
        )
        if row is None:
            raise ServiceError(f"组包不存在: {selection_id}")
        return mapping.selection_from_dict(self._doc(row))
