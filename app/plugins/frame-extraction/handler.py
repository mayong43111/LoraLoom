"""视频抽帧插件 —— 后端 handler。

统一入口 ``invoke(action, payload, service)``，由宿主
``POST /api/tools/video.frame-extraction/invoke`` 分发。实现见
``FRAME_EXTRACTION_DESIGN.md`` §5：

- ``probe``          读取视频元数据（时长/帧率/分辨率/路径），走数据层，无需解码。
- ``filmstrip``      均匀采样若干缩略图，用于进度条下方的胶片条。
- ``preview_frame``  解码单帧，用于拖动进度条时的实时预览。
- ``extract``        核心抽帧 + 邻近帧择优，产出候选帧暂存到会话（不入库）。
- ``commit``         将用户确认保留的候选帧写入图片库（可指定/新建分组）。
- ``discard``        丢弃会话与临时文件。

解码使用插件自带的 FFmpeg（``bin/`` → imageio-ffmpeg → PATH），质量指标用
numpy + Pillow 计算，均为纯 CPU、无重型依赖。抽取阶段不产生 Image 记录，
仅在会话内暂存候选帧，符合「先粗筛复核、确认后入库」的流程。
"""

from __future__ import annotations

import base64
import io
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any

_PLUGIN_DIR = Path(__file__).resolve().parent
_WORKSPACE = Path.cwd() / "workspace"
_TMP_ROOT = _WORKSPACE / "tmp" / "frames"
_IMAGES_DIR = _WORKSPACE / "images"

# -- 质量阈值（低于/高于即打标）------------------------------------------------
_BLUR_MIN = 100.0      # 拉普拉斯方差；低于视为模糊
_DARK_MAX = 0.20       # 平均明度（0~1）；低于视为过暗
_OVEREXP_MIN = 0.90    # 平均明度；高于视为过曝
_COLOR_MIN = 0.08      # 平均饱和度；低于视为低色彩
_INFO_MIN = 4.0        # 灰度直方图熵；低于视为低信息量

# 单次抽取解码的最大帧数上限，防止超长区间耗尽内存。
_MAX_RANGE_FRAMES = 12000

# 进程内会话暂存：session_id → {video 元信息, frames: {frame_id: {...}}}。
_SESSIONS: dict[str, dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# FFmpeg / 解码
# ---------------------------------------------------------------------------
def _ffmpeg_exe() -> str:
    """解析 ffmpeg 可执行文件：插件 bin/ → imageio-ffmpeg → 系统 PATH。"""
    bin_dir = _PLUGIN_DIR / "bin"
    for name in ("ffmpeg.exe", "ffmpeg"):
        candidate = bin_dir / name
        if candidate.exists():
            return str(candidate)
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001 - 缺失时回退 PATH
        pass
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    raise ValueError("未找到 ffmpeg，可执行 pip install imageio-ffmpeg 安装自带二进制")


def _run_ffmpeg(args: list[str]) -> bytes:
    """执行 ffmpeg 并返回 stdout（图像字节）。"""
    exe = _ffmpeg_exe()
    proc = subprocess.run(
        [exe, *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return proc.stdout


def _grab_frame(path: str, t: float, max_w: int = 480, quality: int = 3) -> bytes:
    """解码指定时间点的单帧，缩放到最大宽度 ``max_w``，返回 JPEG 字节。"""
    return _run_ffmpeg(
        [
            "-nostdin",
            "-loglevel",
            "error",
            "-ss",
            f"{max(t, 0.0):.3f}",
            "-i",
            path,
            "-frames:v",
            "1",
            "-an",
            "-vf",
            f"scale='min({max_w},iw)':-2",
            "-f",
            "image2",
            "-c:v",
            "mjpeg",
            "-q:v",
            str(quality),
            "pipe:1",
        ]
    )


def _grab_full(path: str, t: float) -> bytes:
    """解码指定时间点的单帧，保持原始分辨率，返回高质量 JPEG 字节。"""
    return _run_ffmpeg(
        [
            "-nostdin",
            "-loglevel",
            "error",
            "-ss",
            f"{max(t, 0.0):.3f}",
            "-i",
            path,
            "-frames:v",
            "1",
            "-an",
            "-f",
            "image2",
            "-c:v",
            "mjpeg",
            "-q:v",
            "2",
            "pipe:1",
        ]
    )


def _decode_range(path: str, start: float, duration: float, max_w: int | None = 360) -> list[bytes]:
    """按原生帧率解码 [start, start+duration) 区间的全部帧。

    ``max_w`` 为 None 时保持原分辨率、使用高质量编码（用于最终入库画质）；
    否则缩放到最大宽度（用于快速预览）。
    """
    args = [
        "-nostdin",
        "-loglevel",
        "error",
        "-ss",
        f"{max(start, 0.0):.3f}",
        "-t",
        f"{max(duration, 0.0):.3f}",
        "-i",
        path,
        "-an",
    ]
    if max_w is not None:
        args += ["-vf", f"scale='min({max_w},iw)':-2"]
    args += [
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-q:v",
        "2" if max_w is None else "4",
        "pipe:1",
    ]
    raw = _run_ffmpeg(args)
    return _split_jpegs(raw)


def _split_jpegs(buf: bytes) -> list[bytes]:
    """将 MJPEG 拼接流按 SOI(FFD8)/EOI(FFD9) 标记切分为独立 JPEG。"""
    frames: list[bytes] = []
    soi, eoi = b"\xff\xd8", b"\xff\xd9"
    i = 0
    while True:
        s = buf.find(soi, i)
        if s < 0:
            break
        e = buf.find(eoi, s + 2)
        if e < 0:
            break
        frames.append(buf[s : e + 2])
        i = e + 2
    return frames


def _data_url(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")


def _thumb_data_url(jpeg: bytes, max_w: int = 360) -> str:
    """由原图 JPEG 生成用于 UI 展示的缩略图 data URL（不改变入库原图）。"""
    from PIL import Image as PILImage

    try:
        img = PILImage.open(io.BytesIO(jpeg))
        img.load()
        if img.mode != "RGB":
            img = img.convert("RGB")
        if img.width > max_w:
            h = max(1, round(img.height * max_w / img.width))
            img = img.resize((max_w, h), PILImage.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return _data_url(buf.getvalue())
    except Exception:  # noqa: BLE001 - 缩略失败则回退原图
        return _data_url(jpeg)


# ---------------------------------------------------------------------------
# 质量指标（numpy + Pillow）
# ---------------------------------------------------------------------------
def _metrics(jpeg: bytes) -> dict[str, float]:
    """计算单帧的模糊/明度/饱和度/信息量指标。"""
    import numpy as np
    from PIL import Image as PILImage

    img = PILImage.open(io.BytesIO(jpeg)).convert("RGB")
    arr = np.asarray(img, dtype=np.float64)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    gray = 0.299 * r + 0.587 * g + 0.114 * b

    # 模糊：拉普拉斯响应方差（越大越清晰）。
    padded = np.pad(gray, 1, mode="edge")
    lap = (
        padded[:-2, 1:-1]
        + padded[2:, 1:-1]
        + padded[1:-1, :-2]
        + padded[1:-1, 2:]
        - 4.0 * padded[1:-1, 1:-1]
    )
    blur = float(lap.var())

    mx = arr.max(axis=2)
    mn = arr.min(axis=2)
    brightness = float((mx / 255.0).mean())
    sat = np.divide(mx - mn, mx, out=np.zeros_like(mx), where=mx > 0)
    saturation = float(sat.mean())

    hist, _ = np.histogram(gray, bins=256, range=(0.0, 255.0))
    total = hist.sum()
    if total > 0:
        p = hist[hist > 0] / total
        entropy = float(-(p * np.log2(p)).sum())
    else:
        entropy = 0.0

    return {
        "blur": blur,
        "brightness": brightness,
        "saturation": saturation,
        "entropy": entropy,
    }


def _clamp01(x: float) -> float:
    return 0.0 if x < 0 else (1.0 if x > 1 else x)


def _score(jpeg: bytes) -> tuple[float, list[str], bool]:
    """返回 (质量分 0~1, 质量标记列表, 是否合格)。"""
    m = _metrics(jpeg)
    flags: list[str] = []
    if m["blur"] < _BLUR_MIN:
        flags.append("blurry")
    if m["brightness"] < _DARK_MAX:
        flags.append("dark")
    elif m["brightness"] > _OVEREXP_MIN:
        flags.append("overexposed")
    if m["saturation"] < _COLOR_MIN:
        flags.append("low_color")
    if m["entropy"] < _INFO_MIN:
        flags.append("low_information")

    s_blur = _clamp01(m["blur"] / 300.0)
    s_bright = 1.0 - min(abs(m["brightness"] - 0.5) / 0.5, 1.0)
    s_sat = _clamp01(m["saturation"] / 0.4)
    s_info = _clamp01(m["entropy"] / 6.0)
    score = round(0.45 * s_blur + 0.20 * s_bright + 0.15 * s_sat + 0.20 * s_info, 3)
    return score, flags, len(flags) == 0


# ---------------------------------------------------------------------------
# 动作实现
# ---------------------------------------------------------------------------
def _require_video(service: Any, video_id: str) -> Any:
    if not video_id:
        raise ValueError("缺少 video_id")
    video = service.get_video(video_id)  # ServiceError 由宿主转 HTTP
    if not video.path:
        raise ValueError("视频缺少文件路径，无法解码")
    if not Path(video.path).is_file():
        raise ValueError(f"视频文件不存在: {video.path}")
    return video


def _act_probe(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    video = service.get_video(payload.get("video_id", ""))
    return {
        "video_id": video.id,
        "title": video.title,
        "duration": video.duration,
        "fps": video.fps,
        "width": video.width,
        "height": video.height,
        "path": video.path,
    }


def _act_filmstrip(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    video = _require_video(service, payload.get("video_id", ""))
    count = int(payload.get("count", 12) or 12)
    count = max(2, min(count, 40))
    duration = float(video.duration or 0.0)
    thumbnails: list[dict[str, Any]] = []
    for i in range(count):
        # 均匀取样，避开最后一帧解码失败：落在 [0, duration) 内。
        t = duration * (i / max(count - 1, 1)) if duration > 0 else 0.0
        t = min(t, max(duration - 0.05, 0.0))
        jpeg = _grab_frame(video.path, t, max_w=160, quality=6)
        if jpeg:
            thumbnails.append({"t": round(t, 3), "thumb": _data_url(jpeg)})
    return {"thumbnails": thumbnails}


def _act_preview_frame(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    video = _require_video(service, payload.get("video_id", ""))
    t = float(payload.get("t", 0.0) or 0.0)
    jpeg = _grab_frame(video.path, t, max_w=640, quality=3)
    if not jpeg:
        raise ValueError(f"解码失败：t={t:.3f}s")
    return {"t": round(t, 3), "thumb": _data_url(jpeg)}


def _act_extract(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    video = _require_video(service, payload.get("video_id", ""))
    duration = float(video.duration or 0.0)
    fps = float(video.fps or 0.0) or 30.0
    f = 1.0 / fps

    start = max(float(payload.get("start", 0.0) or 0.0), 0.0)
    end = float(payload.get("end", duration) or duration)
    end = min(end, duration) if duration > 0 else end
    if end <= start:
        raise ValueError("抽取区间无效：结束时间需大于开始时间")
    interval = float(payload.get("interval", 1.0) or 1.0)
    if interval <= 0:
        raise ValueError("抽帧间隔必须大于 0")
    base_tags = [str(t).strip() for t in (payload.get("tags") or []) if str(t).strip()]

    span = end - start
    if span * fps > _MAX_RANGE_FRAMES:
        raise ValueError("所选区间过长，请缩短范围或增大间隔后重试")

    frames_bytes = _decode_range(video.path, start, span, max_w=None)
    n = len(frames_bytes)
    if n == 0:
        raise ValueError("解码失败：未从所选区间获得任何帧")

    def ts(idx: int) -> float:
        return round(start + idx * f, 3)

    metric_cache: dict[int, tuple[float, list[str], bool]] = {}

    def evaluate(idx: int) -> tuple[float, list[str], bool]:
        cached = metric_cache.get(idx)
        if cached is None:
            cached = _score(frames_bytes[idx])
            metric_cache[idx] = cached
        return cached

    # 采样点（帧索引）：t_k = start, start+interval, ... < end。
    sample_indices: list[int] = []
    t = start
    while t < end - 1e-9:
        idx = min(round((t - start) / f), n - 1)
        sample_indices.append(idx)
        t += interval

    used: set[int] = set()
    session_id = f"fx-{uuid.uuid4().hex[:12]}"
    session_tmp_dir = _TMP_ROOT / session_id
    session_tmp_dir.mkdir(parents=True, exist_ok=True)
    frames_out: list[dict[str, Any]] = []

    for k, target_idx in enumerate(sample_indices):
        prev_idx = sample_indices[k - 1] if k > 0 else None
        next_idx = sample_indices[k + 1] if k < len(sample_indices) - 1 else None
        back_bound = (prev_idx + 1) if prev_idx is not None else 0
        fwd_bound = (next_idx - 1) if next_idx is not None else (n - 1)
        back_bound = max(back_bound, 0)
        fwd_bound = min(fwd_bound, n - 1)

        chosen_idx: int | None = None
        chosen_score = 0.0
        chosen_flags: list[str] = []
        status = "skipped_no_good_frame"

        # 交错逐帧搜索：0, +1, -1, +2, -2 … 直到边界；命中即止。
        offset = 0
        max_off = max(fwd_bound - target_idx, target_idx - back_bound)
        while offset <= max_off:
            for cand in ((target_idx + offset,) if offset == 0 else (target_idx + offset, target_idx - offset)):
                if cand < back_bound or cand > fwd_bound or cand in used:
                    continue
                score, flags, ok = evaluate(cand)
                if ok:
                    chosen_idx = cand
                    chosen_score = score
                    chosen_flags = flags
                    status = "extracted" if cand == target_idx else "replaced_by_neighbor"
                    break
            if chosen_idx is not None:
                break
            offset += 1

        if chosen_idx is not None:
            used.add(chosen_idx)
            actual_idx = chosen_idx
        else:
            # 无合格帧：保留目标帧信息用于复核，仍给出其分数。
            actual_idx = target_idx
            chosen_score, chosen_flags, _ = evaluate(target_idx)

        frame_id = f"{session_id}-{k:04d}"
        full_jpeg = frames_bytes[actual_idx]
        # 会话帧写入临时会话目录，避免原图字节常驻内存。
        frame_path = session_tmp_dir / f"{frame_id}.jpg"
        frame_path.write_bytes(full_jpeg)
        frames_out.append(
            {
                "frame_id": frame_id,
                "target_timestamp": ts(target_idx),
                "actual_timestamp": ts(actual_idx),
                "status": status,
                "quality_score": chosen_score,
                "quality_flags": chosen_flags,
                "thumb": _thumb_data_url(full_jpeg),
                "_frame_index": actual_idx,
                "_full_path": str(frame_path),
            }
        )

    accepted = [f for f in frames_out if f["status"] in ("extracted", "replaced_by_neighbor")]
    rejected = [f for f in frames_out if f["status"] not in ("extracted", "replaced_by_neighbor")]

    _SESSIONS[session_id] = {
        "video_id": video.id,
        "video_title": video.title,
        "path": video.path,
        "width": video.width,
        "height": video.height,
        "fps": fps,
        "tags": base_tags,
        "frames": {f["frame_id"]: f for f in frames_out},
    }

    # 下发前端时去掉内部字段。
    def _public(f: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in f.items() if not k.startswith("_")}

    return {
        "session_id": session_id,
        "tags": base_tags,
        "accepted": [_public(f) for f in accepted],
        "rejected": [_public(f) for f in rejected],
    }


def _resolve_target(service: Any, target: dict[str, Any]) -> tuple[str | None, str | None]:
    """解析提交目标，返回 (group_id, group_name)。root → (None, None)。"""
    kind = (target or {}).get("kind", "root")
    if kind == "root":
        return None, None
    if kind == "group":
        group_id = target.get("group_id")
        if not group_id:
            raise ValueError("缺少目标分组 group_id")
        for grp in service.list_image_groups():
            if grp.id == group_id:
                return grp.id, grp.name
        raise ValueError(f"分组不存在: {group_id}")
    if kind == "new_group":
        name = (target.get("name") or "").strip()
        if not name:
            raise ValueError("新建分组名称不能为空")
        grp = service.create_image_group(name)  # 同名幂等
        return grp.id, grp.name
    raise ValueError(f"未知的提交目标类型: {kind}")


def _act_commit(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    from app.services.api import ImageCreate

    session_id = payload.get("session_id", "")
    session = _SESSIONS.get(session_id)
    if session is None:
        raise ValueError("会话不存在或已过期，请重新抽帧")

    accepted_ids = list(payload.get("accepted_ids") or [])
    if not accepted_ids:
        raise ValueError("没有选择要入库的帧")
    extra_tags = [str(t).strip() for t in (payload.get("tags") or []) if str(t).strip()]
    tags = list(dict.fromkeys([*session["tags"], *extra_tags]))
    group_id, group_name = _resolve_target(service, payload.get("target") or {})

    _IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # 抽取阶段已按原分辨率解码并评分，选中帧的原图暂存在会话临时目录中，
    # 此处直接把临时文件移入图片库，无需再次调用 ffmpeg。
    created = 0
    for fid in accepted_ids:
        frame = session["frames"].get(fid)
        if frame is None:
            continue
        actual_ts = frame["actual_timestamp"]
        filename = f"{fid}.jpg"
        out_path = _IMAGES_DIR / filename
        src_path = frame.get("_full_path")
        if src_path and Path(src_path).exists():
            shutil.move(src_path, out_path)
        else:
            # 兼容旧会话/缺失临时文件：回退到按时间点重新解码。
            jpeg = _grab_full(session["path"], actual_ts)
            if not jpeg:
                continue
            out_path.write_bytes(jpeg)
        title = f"{session['video_title']}@{actual_ts:.3f}s"
        service.create_image(
            ImageCreate(
                title=title,
                group_id=group_id,
                tags=list(tags),
                width=int(session["width"] or 0),
                height=int(session["height"] or 0),
                path=f"workspace/images/{filename}",
                quality_score=float(frame["quality_score"]),
                quality_flags=list(frame["quality_flags"]),
                frame_target_timestamp=frame["target_timestamp"],
                frame_actual_timestamp=actual_ts,
            )
        )
        created += 1

    _cleanup_session(session_id)
    return {"created": created, "group_id": group_id, "group_name": group_name}


def _act_discard(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    _cleanup_session(payload.get("session_id", ""))
    return {"ok": True}


def _cleanup_session(session_id: str) -> None:
    _SESSIONS.pop(session_id, None)
    tmp_dir = _TMP_ROOT / session_id
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# 统一入口
# ---------------------------------------------------------------------------
_ACTIONS = {
    "probe": _act_probe,
    "filmstrip": _act_filmstrip,
    "preview_frame": _act_preview_frame,
    "extract": _act_extract,
    "commit": _act_commit,
    "discard": _act_discard,
}


def invoke(action: str, payload: dict[str, Any], service: Any) -> Any:
    """插件统一调用入口。"""
    handler = _ACTIONS.get(action)
    if handler is None:
        raise ValueError(f"未知的动作: {action}")
    return handler(payload, service)
