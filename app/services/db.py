"""SQLite 连接与表结构。

采用「热字段列 + JSON 文档列」的混合模式：
用于过滤/排序的字段以真实列存储并建索引（便于扩展到大数据量），
其余字段整体以 ``doc`` JSON 列存储，降低映射样板代码。
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS images (
    id                 TEXT PRIMARY KEY,
    orientation        TEXT NOT NULL,
    usability          TEXT NOT NULL,
    review_status      TEXT NOT NULL,
    primary_subject_id TEXT,
    quality_score      REAL NOT NULL,
    doc                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_orientation ON images(orientation);
CREATE INDEX IF NOT EXISTS idx_images_usability ON images(usability);
CREATE INDEX IF NOT EXISTS idx_images_review ON images(review_status);
CREATE INDEX IF NOT EXISTS idx_images_subject ON images(primary_subject_id);

CREATE TABLE IF NOT EXISTS videos (
    id          TEXT PRIMARY KEY,
    status      TEXT NOT NULL,
    source_type TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

CREATE TABLE IF NOT EXISTS frame_jobs (
    video_id TEXT PRIMARY KEY,
    doc      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
    id  TEXT PRIMARY KEY,
    doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
    id  TEXT PRIMARY KEY,
    doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS downloads (
    id  TEXT PRIMARY KEY,
    doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS selections (
    id  TEXT PRIMARY KEY,
    doc TEXT NOT NULL
);
"""


def connect(db_path: str | Path) -> sqlite3.Connection:
    """打开 SQLite 连接并启用行工厂与外键。

    ``check_same_thread=False`` 允许连接在多线程间共享（FastAPI 的同步端点
    运行在线程池中）；服务层用一把锁串行化访问以保证线程安全。
    """
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """创建表结构（幂等）。"""
    conn.executescript(SCHEMA)
    conn.commit()


def is_empty(conn: sqlite3.Connection) -> bool:
    """判断数据库是否尚未填充（以 images 表为准）。"""
    row = conn.execute("SELECT COUNT(*) AS n FROM images").fetchone()
    return int(row["n"]) == 0
