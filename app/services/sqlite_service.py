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
from app.services import db, mapping
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
            "quality_score, group_id, created_at, doc) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    img.id,
                    img.orientation.value,
                    img.usability.value,
                    img.review_status.value,
                    img.primary_subject_id,
                    img.quality_score,
                    img.group_id,
                    img.created_at.isoformat(),
                    mapping.to_json(img),
                )
                for img in data.images
            ],
        )
        conn.executemany(
            "INSERT INTO image_groups (id, name, created_at, doc) "
            "VALUES (?, ?, ?, ?)",
            [
                (g.id, g.name, g.created_at.isoformat(), mapping.to_json(g))
                for g in data.image_groups
            ],
        )
        conn.executemany(
            "INSERT INTO videos (id, status, source_type, group_id, created_at, doc) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                (
                    v.id,
                    v.status.value,
                    v.source_type.value,
                    v.group_id,
                    v.created_at.isoformat(),
                    mapping.to_json(v),
                )
                for v in data.videos
            ],
        )
        conn.executemany(
            "INSERT INTO video_groups (id, name, created_at, doc) "
            "VALUES (?, ?, ?, ?)",
            [
                (g.id, g.name, g.created_at.isoformat(), mapping.to_json(g))
                for g in data.video_groups
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
    def list_image_groups(self) -> Sequence[ImageGroup]:
        rows = self._fetchall(
            "SELECT doc FROM image_groups ORDER BY created_at, id"
        )
        return [mapping.image_group_from_dict(self._doc(r)) for r in rows]

    def create_image_group(self, name: str, description: str = "") -> ImageGroup:
        existing = self._fetchone(
            "SELECT doc FROM image_groups WHERE name = ? ORDER BY created_at, id",
            (name,),
        )
        if existing is not None:
            return mapping.image_group_from_dict(self._doc(existing))
        group = ImageGroup(
            id=f"img-group-{uuid4().hex[:12]}",
            name=name,
            description=description,
        )
        self._write(
            "INSERT INTO image_groups (id, name, created_at, doc) "
            "VALUES (?, ?, ?, ?)",
            (
                group.id,
                group.name,
                group.created_at.isoformat(),
                mapping.to_json(group),
            ),
        )
        return group

    def update_image_group(
        self,
        group_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> ImageGroup:
        row = self._fetchone(
            "SELECT doc FROM image_groups WHERE id = ?", (group_id,)
        )
        if row is None:
            raise ServiceError(f"分组不存在: {group_id}")
        group = mapping.image_group_from_dict(self._doc(row))
        if name is not None:
            dup = self._fetchone(
                "SELECT 1 FROM image_groups WHERE name = ? AND id != ?",
                (name, group_id),
            )
            if dup is not None:
                raise ServiceError(f"分组名称已存在: {name}")
            group.name = name
        if description is not None:
            group.description = description
        self._write(
            "UPDATE image_groups SET name = ?, doc = ? WHERE id = ?",
            (group.name, mapping.to_json(group), group_id),
        )
        return group

    def delete_image_group(self, group_id: str) -> None:
        row = self._fetchone(
            "SELECT 1 FROM image_groups WHERE id = ?", (group_id,)
        )
        if row is None:
            raise ServiceError(f"分组不存在: {group_id}")
        images = self.list_images(ImageFilter(group_id=group_id))
        for image in images:
            image.group_id = None
            self._write(
                "UPDATE images SET group_id = NULL, doc = ? WHERE id = ?",
                (mapping.to_json(image), image.id),
            )
        self._write("DELETE FROM image_groups WHERE id = ?", (group_id,))

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
            if image_filter.group_id is not None:
                clauses.append("group_id = ?")
                params.append(image_filter.group_id)

        sql = "SELECT doc FROM images"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY created_at DESC, id"
        rows = self._fetchall(sql, params)
        images = [mapping.image_from_dict(self._doc(r)) for r in rows]

        # 非索引维度在内存中过滤（数据量小、tag 存于 JSON）。
        if image_filter is not None:
            if image_filter.quality_flag is not None:
                images = [
                    i
                    for i in images
                    if any(f.value == image_filter.quality_flag for f in i.quality_flags)
                ]
            if image_filter.tag is not None:
                images = [i for i in images if image_filter.tag in i.tags]
            if image_filter.keyword:
                kw = image_filter.keyword.lower()
                images = [
                    i for i in images if kw in i.id.lower() or kw in i.title.lower()
                ]
        return images

    def get_image(self, image_id: str) -> Image:
        row = self._fetchone("SELECT doc FROM images WHERE id = ?", (image_id,))
        if row is None:
            raise ServiceError(f"图片不存在: {image_id}")
        return mapping.image_from_dict(self._doc(row))

    def create_image(self, payload: ImageCreate) -> Image:
        if payload.group_id is not None:
            grp = self._fetchone(
                "SELECT 1 FROM image_groups WHERE id = ?", (payload.group_id,)
            )
            if grp is None:
                raise ServiceError(f"分组不存在: {payload.group_id}")
        image = Image(
            id=f"img-{uuid4().hex[:12]}",
            image_path=payload.path or f"workspace/images/{payload.title}",
            sha256=f"{uuid4().int & ((1 << 64) - 1):016x}",
            width=payload.width,
            height=payload.height,
            quality_score=0.0,
            orientation=Orientation.UNKNOWN,
            usability=Usability.NEEDS_REVIEW,
            review_status=ReviewStatus.AUTO,
            status=ImageStatus.NEW,
            title=payload.title,
            group_id=payload.group_id,
            tags=list(payload.tags),
            thumbnail_hint=payload.title,
        )
        self._write(
            "INSERT INTO images "
            "(id, orientation, usability, review_status, primary_subject_id, "
            "quality_score, group_id, created_at, doc) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                image.id,
                image.orientation.value,
                image.usability.value,
                image.review_status.value,
                image.primary_subject_id,
                image.quality_score,
                image.group_id,
                image.created_at.isoformat(),
                mapping.to_json(image),
            ),
        )
        if payload.group_id is not None:
            self._bump_image_group_count(payload.group_id, 1)
        return image

    def _bump_image_group_count(self, group_id: str, delta: int) -> None:
        row = self._fetchone(
            "SELECT doc FROM image_groups WHERE id = ?", (group_id,)
        )
        if row is None:
            return
        group = mapping.image_group_from_dict(self._doc(row))
        group.image_count += delta
        self._write(
            "UPDATE image_groups SET doc = ? WHERE id = ?",
            (mapping.to_json(group), group_id),
        )

    def update_image(
        self,
        image_id: str,
        *,
        title: str | None = None,
        tags: list[str] | None = None,
        group_id: object = UNSET,
    ) -> Image:
        image = self.get_image(image_id)
        old_group = image.group_id
        if title is not None:
            image.title = title
        if tags is not None:
            image.tags = list(tags)
        new_group = old_group
        if group_id is not UNSET and group_id != old_group:
            if group_id is not None:
                grp = self._fetchone(
                    "SELECT 1 FROM image_groups WHERE id = ?", (group_id,)
                )
                if grp is None:
                    raise ServiceError(f"分组不存在: {group_id}")
            image.group_id = group_id  # type: ignore[assignment]
            new_group = image.group_id
        self._write(
            "UPDATE images SET group_id = ?, doc = ? WHERE id = ?",
            (image.group_id, mapping.to_json(image), image.id),
        )
        if new_group != old_group:
            if old_group is not None:
                self._bump_image_group_count(old_group, -1)
            if new_group is not None:
                self._bump_image_group_count(new_group, 1)
        return image

    def delete_image(self, image_id: str) -> None:
        image = self.get_image(image_id)
        self._write("DELETE FROM images WHERE id = ?", (image_id,))
        if image.group_id is not None:
            self._bump_image_group_count(image.group_id, -1)

    def copy_image(self, image_id: str, *, group_id: str | None = None) -> Image:
        source = self.get_image(image_id)
        if group_id is not None:
            grp = self._fetchone(
                "SELECT 1 FROM image_groups WHERE id = ?", (group_id,)
            )
            if grp is None:
                raise ServiceError(f"分组不存在: {group_id}")
        clone = replace(
            source,
            id=f"img-{uuid4().hex[:12]}",
            title=f"{source.title} 副本" if source.title else source.title,
            group_id=group_id,
            tags=list(source.tags),
        )
        self._write(
            "INSERT INTO images "
            "(id, orientation, usability, review_status, primary_subject_id, "
            "quality_score, group_id, created_at, doc) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                clone.id,
                clone.orientation.value,
                clone.usability.value,
                clone.review_status.value,
                clone.primary_subject_id,
                clone.quality_score,
                clone.group_id,
                clone.created_at.isoformat(),
                mapping.to_json(clone),
            ),
        )
        if group_id is not None:
            self._bump_image_group_count(group_id, 1)
        return clone

    # -- 抽帧 ---------------------------------------------------------------
    def list_frame_jobs(self) -> Sequence[FrameJob]:
        rows = self._fetchall("SELECT doc FROM frame_jobs")
        return [mapping.frame_job_from_dict(self._doc(r)) for r in rows]

    # -- 视频库 -------------------------------------------------------------
    def list_video_groups(self) -> Sequence[VideoGroup]:
        rows = self._fetchall(
            "SELECT doc FROM video_groups ORDER BY created_at, id"
        )
        return [mapping.video_group_from_dict(self._doc(r)) for r in rows]

    def create_video_group(self, name: str, description: str = "") -> VideoGroup:
        existing = self._fetchone(
            "SELECT doc FROM video_groups WHERE name = ? ORDER BY created_at, id",
            (name,),
        )
        if existing is not None:
            return mapping.video_group_from_dict(self._doc(existing))
        group = VideoGroup(
            id=f"group-{uuid4().hex[:12]}",
            name=name,
            description=description,
        )
        self._write(
            "INSERT INTO video_groups (id, name, created_at, doc) "
            "VALUES (?, ?, ?, ?)",
            (
                group.id,
                group.name,
                group.created_at.isoformat(),
                mapping.to_json(group),
            ),
        )
        return group

    def update_video_group(
        self,
        group_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> VideoGroup:
        row = self._fetchone(
            "SELECT doc FROM video_groups WHERE id = ?", (group_id,)
        )
        if row is None:
            raise ServiceError(f"分组不存在: {group_id}")
        group = mapping.video_group_from_dict(self._doc(row))
        if name is not None:
            dup = self._fetchone(
                "SELECT 1 FROM video_groups WHERE name = ? AND id != ?",
                (name, group_id),
            )
            if dup is not None:
                raise ServiceError(f"分组名称已存在: {name}")
            group.name = name
        if description is not None:
            group.description = description
        self._write(
            "UPDATE video_groups SET name = ?, doc = ? WHERE id = ?",
            (group.name, mapping.to_json(group), group_id),
        )
        return group

    def delete_video_group(self, group_id: str) -> None:
        row = self._fetchone(
            "SELECT 1 FROM video_groups WHERE id = ?", (group_id,)
        )
        if row is None:
            raise ServiceError(f"分组不存在: {group_id}")
        videos = self.list_videos(VideoFilter(group_id=group_id))
        for video in videos:
            video.group_id = None
            self._write(
                "UPDATE videos SET group_id = NULL, doc = ? WHERE id = ?",
                (mapping.to_json(video), video.id),
            )
        self._write("DELETE FROM video_groups WHERE id = ?", (group_id,))

    def list_videos(
        self, video_filter: VideoFilter | None = None
    ) -> Sequence[Video]:
        clauses: list[str] = []
        params: list[object] = []
        if video_filter is not None:
            if video_filter.group_id is not None:
                clauses.append("group_id = ?")
                params.append(video_filter.group_id)
            if video_filter.status is not None:
                clauses.append("status = ?")
                params.append(video_filter.status)
            if video_filter.source_type is not None:
                clauses.append("source_type = ?")
                params.append(video_filter.source_type)

        sql = "SELECT doc FROM videos"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY created_at DESC, id"
        rows = self._fetchall(sql, params)
        videos = [mapping.video_from_dict(self._doc(r)) for r in rows]

        # tag / keyword 在内存中过滤（数据量小、tag 存于 JSON）。
        if video_filter is not None:
            if video_filter.tag is not None:
                videos = [v for v in videos if video_filter.tag in v.tags]
            if video_filter.keyword:
                kw = video_filter.keyword.lower()
                videos = [v for v in videos if kw in v.title.lower()]
        return videos

    def get_video(self, video_id: str) -> Video:
        row = self._fetchone("SELECT doc FROM videos WHERE id = ?", (video_id,))
        if row is None:
            raise ServiceError(f"视频不存在: {video_id}")
        return mapping.video_from_dict(self._doc(row))

    def create_video(self, payload: VideoCreate) -> Video:
        if payload.group_id is not None:
            grp = self._fetchone(
                "SELECT 1 FROM video_groups WHERE id = ?", (payload.group_id,)
            )
            if grp is None:
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
        self._write(
            "INSERT INTO videos (id, status, source_type, group_id, created_at, doc) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                video.id,
                video.status.value,
                video.source_type.value,
                video.group_id,
                video.created_at.isoformat(),
                mapping.to_json(video),
            ),
        )
        if payload.group_id is not None:
            self._bump_group_count(payload.group_id, 1)
        return video

    def _bump_group_count(self, group_id: str, delta: int) -> None:
        row = self._fetchone(
            "SELECT doc FROM video_groups WHERE id = ?", (group_id,)
        )
        if row is None:
            return
        group = mapping.video_group_from_dict(self._doc(row))
        group.video_count = max(0, group.video_count + delta)
        self._write(
            "UPDATE video_groups SET doc = ? WHERE id = ?",
            (mapping.to_json(group), group_id),
        )

    def update_video(
        self,
        video_id: str,
        *,
        title: str | None = None,
        tags: list[str] | None = None,
        group_id: object = UNSET,
    ) -> Video:
        video = self.get_video(video_id)
        old_group = video.group_id
        if title is not None:
            video.title = title
        if tags is not None:
            video.tags = list(tags)
        new_group = old_group
        if group_id is not UNSET and group_id != old_group:
            if group_id is not None:
                grp = self._fetchone(
                    "SELECT 1 FROM video_groups WHERE id = ?", (group_id,)
                )
                if grp is None:
                    raise ServiceError(f"分组不存在: {group_id}")
            video.group_id = group_id  # type: ignore[assignment]
            new_group = video.group_id
        self._write(
            "UPDATE videos SET group_id = ?, doc = ? WHERE id = ?",
            (video.group_id, mapping.to_json(video), video.id),
        )
        if new_group != old_group:
            if old_group is not None:
                self._bump_group_count(old_group, -1)
            if new_group is not None:
                self._bump_group_count(new_group, 1)
        return video

    def delete_video(self, video_id: str) -> None:
        video = self.get_video(video_id)
        self._write("DELETE FROM videos WHERE id = ?", (video_id,))
        if video.group_id is not None:
            self._bump_group_count(video.group_id, -1)

    def copy_video(self, video_id: str, *, group_id: str | None = None) -> Video:
        source = self.get_video(video_id)
        if group_id is not None:
            grp = self._fetchone(
                "SELECT 1 FROM video_groups WHERE id = ?", (group_id,)
            )
            if grp is None:
                raise ServiceError(f"分组不存在: {group_id}")
        clone = replace(
            source,
            id=f"video-{uuid4().hex[:12]}",
            title=f"{source.title} 副本" if source.title else source.title,
            group_id=group_id,
            tags=list(source.tags),
        )
        self._write(
            "INSERT INTO videos (id, status, source_type, group_id, created_at, doc) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                clone.id,
                clone.status.value,
                clone.source_type.value,
                clone.group_id,
                clone.created_at.isoformat(),
                mapping.to_json(clone),
            ),
        )
        if group_id is not None:
            self._bump_group_count(group_id, 1)
        return clone

    def get_video_frame_job(self, video_id: str) -> FrameJob | None:
        row = self._fetchone(
            "SELECT doc FROM frame_jobs WHERE video_id = ?", (video_id,)
        )
        if row is None:
            return None
        return mapping.frame_job_from_dict(self._doc(row))

    def run_frame_extraction(self, video_id: str, interval: float) -> FrameJob:
        video = self.get_video(video_id)
        job = build_frame_job(video, interval)
        video.frame_interval = interval
        video.status = VideoStatus.EXTRACTED
        video.extracted_frame_count = sum(
            1 for f in job.frames if f.status != FrameStatus.SKIPPED_NO_GOOD_FRAME
        )
        self._write(
            "UPDATE videos SET status = ?, doc = ? WHERE id = ?",
            (video.status.value, mapping.to_json(video), video_id),
        )
        with self._lock:
            self._conn.execute(
                "DELETE FROM frame_jobs WHERE video_id = ?", (video_id,)
            )
            self._conn.execute(
                "INSERT INTO frame_jobs (video_id, doc) VALUES (?, ?)",
                (video_id, mapping.to_json(job)),
            )
            self._conn.commit()
        return job

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
