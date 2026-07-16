"""批量抽帧脚本：哆酱视频组 → 图片库哆酱分组。

对哆酱视频组内 22 个视频，每秒抽取一帧（ffmpeg fps=1，全部接受），
写入 workspace/images/ 并通过运行中的后端 HTTP 接口登记为图片，
归入图片库「哆酱」分组。

顺序执行，避免与后端并发写 sqlite 造成锁竞争。
"""
from __future__ import annotations

import json
import subprocess
import urllib.request
import uuid
from pathlib import Path

import imageio_ffmpeg

BASE = "http://127.0.0.1:7777"
VIDEO_GROUP_ID = "group-19dbf2d74708"  # 哆酱 视频组
IMAGE_GROUP_NAME = "哆酱"
IMAGES_DIR = Path("workspace/images")


def get(path: str):
    with urllib.request.urlopen(BASE + path) as resp:
        return json.load(resp)


def post(path: str, body: dict):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def main() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    # 1) 确保图片库「哆酱」分组存在
    groups = get("/api/image-groups")
    grp = next((g for g in groups if g.get("name") == IMAGE_GROUP_NAME), None)
    if grp is None:
        grp = post(
            "/api/image-groups",
            {"name": IMAGE_GROUP_NAME, "description": "从哆酱视频组每秒抽帧"},
        )
    image_group_id = grp["id"]
    print(f"图片分组: {IMAGE_GROUP_NAME} -> {image_group_id}")

    # 2) 取出哆酱视频组内的视频，按标题排序
    videos = [v for v in get("/api/videos") if v.get("group_id") == VIDEO_GROUP_ID]

    def sort_key(v: dict):
        title = v.get("title", "")
        stem = title.rsplit(".", 1)[0]
        return (int(stem) if stem.isdigit() else 1 << 30, title)

    videos.sort(key=sort_key)
    print(f"待处理视频: {len(videos)} 个")

    total = 0
    for v in videos:
        src = v.get("path", "")
        if not src or not Path(src).is_file():
            print(f"  [跳过] 文件缺失: {v.get('title')} -> {src}")
            continue

        prefix = f"fx-{uuid.uuid4().hex[:10]}"
        pattern = str(IMAGES_DIR / f"{prefix}-%05d.jpg")
        subprocess.run(
            [ffmpeg, "-y", "-i", src, "-vf", "fps=1", "-q:v", "2", pattern],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        frames = sorted(IMAGES_DIR.glob(f"{prefix}-*.jpg"))
        for i, fp in enumerate(frames):
            post(
                "/api/images",
                {
                    "title": f"{v['title']}@{i}s",
                    "group_id": image_group_id,
                    "tags": list(v.get("tags", [])),
                    "width": int(v.get("width") or 0),
                    "height": int(v.get("height") or 0),
                    "path": f"workspace/images/{fp.name}",
                },
            )
        total += len(frames)
        print(f"  {v['title']}: {len(frames)} 帧")

    print(f"完成，共登记 {total} 张图片 -> 分组 {image_group_id}")


if __name__ == "__main__":
    main()
