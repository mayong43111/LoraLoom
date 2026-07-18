"""训练集策展与高分辨率人物裁切插件。"""

from __future__ import annotations

import math
import importlib.util
import re
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image as PILImage

from app.services.api import ImageCreate, ImageFilter

_PLUGIN_DIR = Path(__file__).resolve().parent
_FACE_MODEL = _PLUGIN_DIR.parent / "pose-face-annotation" / "models" / "face_detection_yunet_2023mar.onnx"
_IMAGES_DIR = Path.cwd() / "workspace" / "images"
_SOURCE_TAG = "策展来源:"

_TEMPLATES = {
    "identity": {
        "name": "人物形象训练",
        "description": "按头部、正面全身、正面半身、侧面和背面配额覆盖人物形象",
        "categories": [
            {"id": "head_closeup", "name": "头部特写", "target": 25},
            {"id": "front_full", "name": "正面全身", "target": 15},
            {"id": "front_half", "name": "正面半身", "target": 12},
            {"id": "side", "name": "侧面", "target": 15},
            {"id": "back", "name": "背面", "target": 8},
        ],
    },
    "action": {
        "name": "动作训练",
        "description": "按正面、侧面和背面动作配额覆盖全身与半身姿态",
        "categories": [
            {"id": "front_full", "name": "正面全身", "target": 35},
            {"id": "side_full", "name": "侧面全身", "target": 25},
            {"id": "back_full", "name": "背面全身", "target": 15},
            {"id": "front_half", "name": "正面半身", "target": 15},
            {"id": "other_action", "name": "其他动作角度", "target": 10},
        ],
    },
}

_FACE_WEIGHTS = {"全脸": 34.0, "3-4脸": 27.0, "半脸": 15.0, "无脸": -80.0}
_SHOT_WEIGHTS_IDENTITY = {"近景": 16.0, "半身": 10.0, "全身": 3.0, "未知": 0.0}
_SHOT_WEIGHTS_ACTION = {"全身": 24.0, "半身": 17.0, "近景": 3.0, "未知": 8.0}

_FACE_DETECTOR: Any | None = None
_POSE_MODULE: Any | None = None
_INFERENCE_CACHE: dict[str, dict[str, Any]] = {}


def _tag_value(tags: list[str], prefix: str, default: str = "未知") -> str:
    for tag in tags:
        if tag.startswith(prefix):
            return tag[len(prefix) :]
    return default


def _source_key(image: Any) -> str:
    asset_id = getattr(image, "asset_id", None)
    if asset_id:
        return str(asset_id)
    return re.sub(r"@[0-9.]+s$", "", image.title or image.id)


def _actual_size(image: Any) -> tuple[int, int]:
    width, height = int(image.width or 0), int(image.height or 0)
    if width > 0 and height > 0:
        return width, height
    path = Path(image.image_path or "")
    try:
        with PILImage.open(path) as loaded:
            return loaded.size
    except (OSError, ValueError):
        return 0, 0


def _score(image: Any, template: str, tags: list[str] | None = None) -> tuple[float, bool, list[str], int, int]:
    tags = tags if tags is not None else list(image.tags or [])
    face = _tag_value(tags, "人脸:")
    shot = _tag_value(tags, "景别:")
    person_count_raw = _tag_value(tags, "人物数:", _tag_value(tags, "人脸数:", "1"))
    try:
        person_count = int(person_count_raw)
    except ValueError:
        person_count = 1
    width, height = _actual_size(image)
    quality = float(image.quality_score or 0.0)
    reasons: list[str] = []
    min_quality = 0.7 if template == "identity" else 0.65
    eligible = person_count == 1 and width >= 768 and height >= 768 and quality >= min_quality

    if person_count != 1:
        reasons.append("不是单人")
    if min(width, height) < 768:
        reasons.append("有效分辨率不足")
    if quality < min_quality:
        reasons.append("低于模板清晰度门槛")

    if template == "identity":
        score = quality * 55 + _FACE_WEIGHTS.get(face, 0) + _SHOT_WEIGHTS_IDENTITY.get(shot, 0)
        if face in ("全脸", "3-4脸"):
            reasons.append(face)
        if shot in ("近景", "半身"):
            reasons.append(shot)
    else:
        score = quality * 62 + _SHOT_WEIGHTS_ACTION.get(shot, 0)
        if shot in ("全身", "半身"):
            reasons.append(shot)
        orientation = _tag_value(tags, "姿态:", "")
        if orientation:
            score += 7
            reasons.append(orientation)
        if face == "无脸":
            score -= 4

    if quality >= 0.85:
        score += 8
        reasons.append("清晰")
    elif quality < 0.7:
        score -= 20
        reasons.append("清晰度偏低")
    if image.quality_flags:
        score -= 6 * len(image.quality_flags)
    return round(score, 3), eligible, reasons, width, height


def _categories_for(tags: list[str], template: str) -> list[str]:
    orientation = _tag_value(tags, "姿态:")
    shot = _tag_value(tags, "景别:")
    face = _tag_value(tags, "人脸:")
    is_front = orientation in ("正对", "正面")
    if template == "identity":
        categories = []
        if orientation == "背面" or (face == "无脸" and shot in ("全身", "半身")):
            categories.append("back")
        if orientation == "侧面" and face != "无脸":
            categories.append("side")
        if shot == "全身" and is_front:
            categories.append("front_full")
        if shot == "半身" and is_front:
            categories.append("front_half")
        if face not in ("无脸", "未知"):
            categories.append("head_closeup")
        return categories
    categories = []
    if shot == "全身" and is_front:
        categories.append("front_full")
    if shot == "全身" and orientation == "侧面":
        categories.append("side_full")
    if shot == "全身" and (orientation == "背面" or face == "无脸"):
        categories.append("back_full")
    if shot == "半身" and is_front:
        categories.append("front_half")
    if shot in ("全身", "半身"):
        categories.append("other_action")
    return categories


def _pick_balanced(entries: list[dict[str, Any]], target: int) -> list[dict[str, Any]]:
    by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        by_source[entry["source"]].append(entry)
    for values in by_source.values():
        values.sort(key=lambda item: (-item["score"], item["id"]))
    source_order = sorted(by_source, key=lambda key: -by_source[key][0]["score"])
    picked: list[dict[str, Any]] = []
    round_index = 0
    while len(picked) < target:
        added = False
        for source in source_order:
            values = by_source[source]
            if round_index < len(values):
                picked.append(values[round_index])
                added = True
                if len(picked) >= target:
                    break
        if not added:
            break
        round_index += 1
    return picked


def _load_pose_module() -> Any:
    global _POSE_MODULE
    if _POSE_MODULE is None:
        path = _PLUGIN_DIR.parent / "pose-face-annotation" / "handler.py"
        spec = importlib.util.spec_from_file_location("training_curation_pose", path)
        if spec is None or spec.loader is None:
            raise ValueError("无法加载姿态景别识别模块")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _POSE_MODULE = module
    return _POSE_MODULE


def _infer_tags(images: list[Any]) -> tuple[dict[str, list[str]], int]:
    missing = []
    inferred: dict[str, list[str]] = {}
    for image in images:
        tags = list(image.tags or [])
        if _tag_value(tags, "景别:") == "未知" or _tag_value(tags, "姿态:") == "未知":
            cached = _INFERENCE_CACHE.get(image.id)
            if cached is not None:
                result = cached
            else:
                missing.append(image)
                continue
            inferred[image.id] = _tags_from_detection(tags, result)
    if not missing:
        return inferred, 0
    module = _load_pose_module()
    cv2 = module._load_cv2()
    detectors = module._load_detectors(cv2)
    for image in missing:
        result = module._detect_one(cv2, detectors, str(image.image_path or ""))
        _INFERENCE_CACHE[image.id] = result
        inferred[image.id] = _tags_from_detection(list(image.tags or []), result)
    return inferred, len(missing)


def _tags_from_detection(tags: list[str], result: dict[str, Any]) -> list[str]:
    effective = list(tags)
    additions = {
        "姿态:": result.get("orientation_label"),
        "景别:": result.get("shot_label"),
        "人脸:": result.get("face_label"),
        "人物数:": result.get("person_count"),
    }
    for prefix, value in additions.items():
        if value is not None and _tag_value(effective, prefix) == "未知":
            effective = [tag for tag in effective if not tag.startswith(prefix)]
            effective.append(f"{prefix}{value}")
    return effective


def _recommend(
    images: list[Any], template: str, inferred_tags: dict[str, list[str]] | None = None
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    entries: list[dict[str, Any]] = []
    by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for image in images:
        tags = (inferred_tags or {}).get(image.id, list(image.tags or []))
        score, eligible, reasons, width, height = _score(image, template, tags)
        categories = _categories_for(tags, template)
        eligible = eligible and bool(categories)
        entry = {
            "id": image.id,
            "title": image.title,
            "score": score,
            "eligible": eligible,
            "recommended": False,
            "reasons": reasons,
            "width": width,
            "height": height,
            "quality": round(float(image.quality_score or 0.0), 3),
            "face": _tag_value(list(image.tags or []), "人脸:"),
            "shot": _tag_value(list(image.tags or []), "景别:"),
            "orientation": _tag_value(tags, "姿态:"),
            "category": categories[0] if categories else None,
            "categories": categories,
            "source": _source_key(image),
        }
        entries.append(entry)
        if eligible:
            for category in categories:
                by_category[category].append(entry)

    definitions = {item["id"]: item for item in _TEMPLATES[template]["categories"]}
    allocation_order = (
        ["back", "front_half", "front_full", "side", "head_closeup"]
        if template == "identity"
        else ["back_full", "front_half", "front_full", "side_full", "other_action"]
    )
    used: set[str] = set()
    allocated: dict[str, list[dict[str, Any]]] = {}
    for category in allocation_order:
        definition = definitions[category]
        candidates = [item for item in by_category[category] if item["id"] not in used]
        picked = _pick_balanced(candidates, definition["target"])
        for entry in picked:
            entry["recommended"] = True
            entry["category"] = category
            used.add(entry["id"])
        allocated[category] = picked
    breakdown = [
        {
            **definition,
            "available": len(by_category[definition["id"]]),
            "recommended": len(allocated[definition["id"]]),
        }
        for definition in _TEMPLATES[template]["categories"]
    ]
    entries.sort(key=lambda item: (not item["recommended"], -item["score"], item["id"]))
    return entries, breakdown


def _act_overview(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    template = str(payload.get("template") or "identity")
    if template not in _TEMPLATES:
        raise ValueError("未知训练模板")
    groups = []
    for group in service.list_image_groups():
        images = list(service.list_images(ImageFilter(group_id=group.id)))
        breakdown = [{**item, "available": None, "recommended": None} for item in _TEMPLATES[template]["categories"]]
        groups.append(
            {
                "id": group.id,
                "name": group.name,
                "count": len(images),
                "eligible": None,
                "recommended": sum(item["target"] for item in breakdown),
                "breakdown": breakdown,
            }
        )
    return {"templates": _TEMPLATES, "template": template, "groups": groups}


def _act_analyze(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    group_id = str(payload.get("group_id") or "")
    template = str(payload.get("template") or "identity")
    if template not in _TEMPLATES:
        raise ValueError("未知训练模板")
    images = list(service.list_images(ImageFilter(group_id=group_id)))
    if not images:
        raise ValueError("分组为空或不存在")
    inferred_tags, analyzed = _infer_tags(images)
    entries, breakdown = _recommend(images, template, inferred_tags)
    return {
        "template": template,
        "target": sum(item["target"] for item in breakdown),
        "total": len(entries),
        "eligible": sum(1 for item in entries if item["eligible"]),
        "recommended": sum(1 for item in entries if item["recommended"]),
        "analyzed": analyzed,
        "breakdown": breakdown,
        "items": entries,
    }


def _resolve_group(service: Any, target: dict[str, Any]) -> tuple[str, str]:
    kind = target.get("kind", "new_group")
    if kind == "group":
        group_id = str(target.get("group_id") or "")
        for group in service.list_image_groups():
            if group.id == group_id:
                return group.id, group.name
        raise ValueError("目标分组不存在")
    name = str(target.get("name") or "").strip()
    if not name:
        raise ValueError("新分组名称不能为空")
    group = service.create_image_group(name)
    return group.id, group.name


def _existing_sources(service: Any, group_id: str) -> set[str]:
    return {
        tag[len(_SOURCE_TAG) :]
        for image in service.list_images(ImageFilter(group_id=group_id))
        for tag in image.tags
        if tag.startswith(_SOURCE_TAG)
    }


def _act_commit(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    image_ids = list(dict.fromkeys(str(item) for item in payload.get("image_ids") or []))
    if not image_ids:
        raise ValueError("至少选择一张图片")
    group_id, group_name = _resolve_group(service, payload.get("target") or {})
    existing = _existing_sources(service, group_id)
    created = 0
    skipped = 0
    for image_id in image_ids:
        if image_id in existing:
            skipped += 1
            continue
        source = service.get_image(image_id)
        clone = service.copy_image(image_id, group_id=group_id)
        tags = list(dict.fromkeys([*clone.tags, "训练策展", f"{_SOURCE_TAG}{image_id}"]))
        service.update_image(clone.id, title=source.title, tags=tags)
        existing.add(image_id)
        created += 1
    return {"group_id": group_id, "group_name": group_name, "created": created, "skipped": skipped}


def _load_face_detector(cv2: Any) -> Any:
    global _FACE_DETECTOR
    if _FACE_DETECTOR is None:
        if not _FACE_MODEL.is_file():
            raise ValueError("缺少 YuNet 人脸检测模型")
        _FACE_DETECTOR = cv2.FaceDetectorYN.create(str(_FACE_MODEL), "", (320, 320), 0.6, 0.3, 5000)
    return _FACE_DETECTOR


def _fit_crop(cx: float, top: float, crop_w: float, crop_h: float, width: int, height: int) -> tuple[int, int, int, int]:
    crop_width = min(round(crop_w), width)
    crop_height = min(round(crop_h), height)
    left = round(max(0.0, min(cx - crop_width / 2, width - crop_width)))
    top_int = round(max(0.0, min(top, height - crop_height)))
    return left, top_int, left + crop_width, top_int + crop_height


def _crop_box(face: Any, mode: str, width: int, height: int) -> tuple[int, int, int, int]:
    x, y, face_w, face_h = (float(face[index]) for index in range(4))
    cx = x + face_w / 2
    if mode == "head":
        crop_h = face_h * 2.35
        crop_w = crop_h
        top = y - face_h * 0.72
    else:
        crop_h = face_h * 4.6
        crop_w = crop_h * 0.75
        top = y - face_h * 0.78
    return _fit_crop(cx, top, crop_w, crop_h, width, height)


def _act_crop(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    try:
        import cv2
        import numpy as np
    except Exception as exc:  # noqa: BLE001
        raise ValueError("裁切需要 OpenCV 与 NumPy") from exc
    image_ids = list(dict.fromkeys(str(item) for item in payload.get("image_ids") or []))
    mode = str(payload.get("mode") or "head")
    if mode not in ("head", "closeup"):
        raise ValueError("未知裁切模式")
    group_id, group_name = _resolve_group(service, payload.get("target") or {})
    _IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    created: list[str] = []
    skipped: list[dict[str, str]] = []
    detector = _load_face_detector(cv2)
    for image_id in image_ids:
        source = service.get_image(image_id)
        path = Path(source.image_path or "")
        data = np.fromfile(path, dtype=np.uint8) if path.is_file() else np.array([], dtype=np.uint8)
        image = cv2.imdecode(data, cv2.IMREAD_COLOR) if data.size else None
        if image is None:
            skipped.append({"id": image_id, "reason": "图片无法读取"})
            continue
        height, width = image.shape[:2]
        detect_scale = min(1.0, 1280 / max(width, height))
        detect_image = image if detect_scale == 1 else cv2.resize(image, (round(width * detect_scale), round(height * detect_scale)))
        detector.setInputSize((detect_image.shape[1], detect_image.shape[0]))
        _, faces_result = detector.detect(detect_image)
        if faces_result is None or len(faces_result) == 0:
            skipped.append({"id": image_id, "reason": "未检测到人脸"})
            continue
        face = max(faces_result, key=lambda row: float(row[2]) * float(row[3])).copy()
        face[:4] /= detect_scale
        left, top, right, bottom = _crop_box(face, mode, width, height)
        crop = image[top:bottom, left:right]
        crop_h, crop_w = crop.shape[:2]
        if min(crop_w, crop_h) < 640:
            skipped.append({"id": image_id, "reason": f"人脸区域像素不足（{crop_w}×{crop_h}）"})
            continue
        filename = f"crop-{uuid.uuid4().hex[:16]}.jpg"
        output = _IMAGES_DIR / filename
        ok, encoded = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
        if not ok:
            skipped.append({"id": image_id, "reason": "裁切编码失败"})
            continue
        encoded.tofile(output)
        label = "全头" if mode == "head" else "近景"
        created_image = service.create_image(
            ImageCreate(
                title=f"{source.title} [{label}裁切]",
                group_id=group_id,
                tags=list(dict.fromkeys([*source.tags, "训练裁切", f"裁切:{label}", f"{_SOURCE_TAG}{image_id}"])),
                width=crop_w,
                height=crop_h,
                path=str(output.relative_to(Path.cwd())).replace("\\", "/"),
                quality_score=float(source.quality_score or 0.0),
            )
        )
        created.append(created_image.id)
    return {"group_id": group_id, "group_name": group_name, "created": len(created), "created_ids": created, "skipped": skipped}


_ACTIONS = {
    "overview": _act_overview,
    "analyze": _act_analyze,
    "commit": _act_commit,
    "crop": _act_crop,
}


def invoke(action: str, payload: dict[str, Any], service: Any) -> Any:
    handler = _ACTIONS.get(action)
    if handler is None:
        raise ValueError(f"未知动作: {action}")
    return handler(payload, service)
