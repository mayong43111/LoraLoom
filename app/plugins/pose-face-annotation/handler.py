"""姿态·人脸标注插件 —— 后端 handler（自动识别）。

统一入口 ``invoke(action, payload, service)``，由宿主
``POST /api/tools/image.pose-face-annotation/invoke`` 分发。

动作：
- ``capabilities``  返回自动识别是否可用（前端据此决定是否显示「自动识别」按钮）。
- ``detect``        对给定图片做轻量人脸检测，产出「姿态 / 人脸 / 人脸数」建议，
                    供用户复核后写入标签。**不落库**，仅返回建议。

自动识别使用 OpenCV 自带的 Haar 级联（``cv2.data.haarcascades``，随
``opencv-python-headless`` 一并安装，无需额外下载模型权重，可离线运行）：
- 正脸级联命中           → 姿态「正对」、人脸「全脸」
- 仅侧脸级联命中         → 姿态「侧面」、人脸「半脸」
- 未命中任何脸           → 人脸「无脸」（姿态留空，交由用户判断正对/背面）
识别结果为**预标注建议**，用户可逐一修正后再写入标签，属轻量启发式而非精确姿态估计。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

# 建议标签的取值 → 中文标签值（前端据此拼装带前缀的标签）。
_ORIENT_LABEL = {"front": "正对", "side": "侧面", "back": "背面"}
_FACE_LABEL = {"full": "全脸", "three_quarter": "3-4脸", "half": "半脸", "none": "无脸"}

# 单次识别处理的最大图片数，避免一次请求耗时过长。
_MAX_BATCH = 200
# 检测前将长边缩放到的上限，兼顾速度与召回。
_DETECT_MAX_SIDE = 1024


def _load_cv2() -> Any:
    """惰性导入 cv2；缺失时抛出面向用户的错误。"""
    try:
        import cv2  # noqa: PLC0415 - 惰性导入，避免未装依赖时拖垮整个宿主
    except Exception as exc:  # noqa: BLE001
        raise ValueError(
            "自动识别需要 opencv-python-headless，请先在服务端执行 "
            "`pip install opencv-python-headless` 后重启后端"
        ) from exc
    return cv2


def _cascade(cv2: Any, name: str) -> Any:
    """加载随 OpenCV 一并安装的 Haar 级联分类器。"""
    path = Path(cv2.data.haarcascades) / name
    clf = cv2.CascadeClassifier(str(path))
    if clf.empty():
        raise ValueError(f"无法加载级联分类器: {name}")
    return clf


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """两个 (x, y, w, h) 矩形的交并比。"""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0


def _dedup(boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    """按 IoU>0.3 合并重叠框，返回去重后的框列表。"""
    kept: list[tuple[int, int, int, int]] = []
    for box in sorted(boxes, key=lambda b: b[2] * b[3], reverse=True):
        if all(_iou(box, k) <= 0.3 for k in kept):
            kept.append(box)
    return kept


def _detect_one(cv2: Any, frontal: Any, profile: Any, path: str) -> dict[str, Any]:
    """对单张图片做人脸检测并给出姿态 / 人脸 / 人脸数建议。"""
    gray = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if gray is None:
        return {"ok": False, "error": "无法读取图片文件"}

    h, w = gray.shape[:2]
    scale = 1.0
    long_side = max(h, w)
    if long_side > _DETECT_MAX_SIDE:
        scale = _DETECT_MAX_SIDE / long_side
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.equalizeHist(gray)
    min_size = (24, 24)

    def _run(clf: Any, img: Any) -> list[tuple[int, int, int, int]]:
        found = clf.detectMultiScale(img, scaleFactor=1.1, minNeighbors=5, minSize=min_size)
        return [(int(x), int(y), int(bw), int(bh)) for (x, y, bw, bh) in found]

    frontal_boxes = _run(frontal, gray)
    # 侧脸级联通常只识别一个朝向，水平翻转再检测以覆盖另一朝向。
    profile_boxes = _run(profile, gray)
    flipped = cv2.flip(gray, 1)
    fw = gray.shape[1]
    for (x, y, bw, bh) in _run(profile, flipped):
        profile_boxes.append((fw - x - bw, y, bw, bh))

    frontal_kept = _dedup(frontal_boxes)
    all_kept = _dedup(frontal_boxes + profile_boxes)
    faces = len(all_kept)

    if frontal_kept:
        orientation, face = "front", "full"
    elif profile_boxes:
        orientation, face = "side", "half"
    else:
        orientation, face = None, "none"

    return {
        "ok": True,
        "faces": faces,
        "person_count": faces,
        "orientation": orientation,
        "orientation_label": _ORIENT_LABEL.get(orientation or "", None),
        "face": face,
        "face_label": _FACE_LABEL.get(face or "", None),
    }


def _act_capabilities(_payload: dict[str, Any], _service: Any) -> dict[str, Any]:
    """探测自动识别是否可用（依赖是否就绪）。"""
    try:
        cv2 = _load_cv2()
        _cascade(cv2, "haarcascade_frontalface_default.xml")
    except ValueError as exc:
        return {"available": False, "reason": str(exc)}
    return {"available": True, "engine": "opencv-haar", "version": cv2.__version__}


def _act_detect(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    """对 ``image_ids`` 逐张识别，返回每张的姿态 / 人脸 / 人脸数建议。"""
    image_ids = payload.get("image_ids") or []
    if not isinstance(image_ids, list) or not image_ids:
        raise ValueError("image_ids 不能为空")
    if len(image_ids) > _MAX_BATCH:
        raise ValueError(f"单次最多识别 {_MAX_BATCH} 张，请分批进行")

    cv2 = _load_cv2()
    frontal = _cascade(cv2, "haarcascade_frontalface_default.xml")
    profile = _cascade(cv2, "haarcascade_profileface.xml")

    results: list[dict[str, Any]] = []
    for image_id in image_ids:
        entry: dict[str, Any] = {"id": image_id}
        try:
            image = service.get_image(image_id)  # ServiceError 由宿主转 HTTP
            path = getattr(image, "image_path", "") or ""
            if not path or not Path(path).is_file():
                entry.update({"ok": False, "error": "图片文件不存在"})
            else:
                entry.update(_detect_one(cv2, frontal, profile, path))
        except Exception as exc:  # noqa: BLE001 - 单张失败不影响整批
            entry.update({"ok": False, "error": str(exc)})
        results.append(entry)

    ok_count = sum(1 for r in results if r.get("ok"))
    return {"results": results, "total": len(results), "ok": ok_count}


_ACTIONS = {
    "capabilities": _act_capabilities,
    "detect": _act_detect,
}


def invoke(action: str, payload: dict[str, Any], service: Any) -> Any:
    """插件统一调用入口。"""
    handler = _ACTIONS.get(action)
    if handler is None:
        raise ValueError(f"未知的动作: {action}")
    return handler(payload, service)
