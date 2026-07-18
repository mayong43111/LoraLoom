"""相似图片聚类、代表图推荐与精选分组提交。"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np

_MAX_IMAGES = 3000
_MAX_CLUSTER_SIZE = 16
_TEMPORAL_WINDOW_SECONDS = 4.0
_TAG_SELECTED = "相似精选"
_TAG_SOURCE_PREFIX = "精选来源:"
_TAG_CLUSTER_PREFIX = "相似簇:"


def _load_cv2() -> Any:
    try:
        import cv2  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        raise ValueError("相似图片精选需要 opencv-python-headless") from exc
    return cv2


def _tag_value(tags: list[str], prefix: str) -> str | None:
    for tag in tags:
        if tag.startswith(prefix):
            return tag[len(prefix) :]
    return None


def _extract_feature(cv2: Any, image: Any) -> dict[str, Any]:
    height, width = image.shape[:2]
    scale = min(1.0, 640.0 / max(height, width))
    if scale < 1.0:
        image = cv2.resize(
            image,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    phash_input = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA)
    dct = cv2.dct(np.float32(phash_input))[:8, :8]
    phash = (dct > np.median(dct[1:, :])).reshape(-1)

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    histogram = cv2.calcHist([hsv], [0, 1], None, [16, 8], [0, 180, 0, 256]).reshape(-1)
    histogram /= float(np.linalg.norm(histogram) or 1.0)

    thumbnail = cv2.resize(gray, (24, 24), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    sharpness = float(cv2.Laplacian(gray, cv2.CV_32F).var())
    mean = float(gray.mean())
    clipped = float(np.mean((gray <= 8) | (gray >= 247)))
    exposure = max(0.0, 1.0 - abs(mean - 128.0) / 128.0 - clipped)
    sharpness_score = sharpness / (sharpness + 250.0)
    resolution_score = min(1.0, (height * width) / (1024.0 * 1024.0))
    technical_quality = 0.55 * sharpness_score + 0.30 * exposure + 0.15 * resolution_score
    return {
        "phash": phash,
        "histogram": histogram,
        "thumbnail": thumbnail,
        "sharpness": sharpness_score,
        "exposure": exposure,
        "resolution": resolution_score,
        "technical_quality": technical_quality,
    }


def _similarity(left: dict[str, Any], right: dict[str, Any]) -> float:
    hash_score = 1.0 - float(np.count_nonzero(left["phash"] != right["phash"])) / 64.0
    histogram_score = max(0.0, float(np.dot(left["histogram"], right["histogram"])))
    thumbnail_score = 1.0 - float(np.mean(np.abs(left["thumbnail"] - right["thumbnail"])))
    score = 0.45 * hash_score + 0.25 * histogram_score + 0.30 * thumbnail_score

    for prefix in ("姿态:", "景别:", "人脸:"):
        left_value = left.get(prefix)
        right_value = right.get(prefix)
        if left_value and right_value and left_value != right_value:
            score *= 0.94

    left_source = left.get("source_key")
    right_source = right.get("source_key")
    if left_source and right_source and left_source != right_source:
        score *= 0.82
    elif left_source and left_source == right_source:
        left_ts = left.get("timestamp")
        right_ts = right.get("timestamp")
        if left_ts is not None and right_ts is not None:
            distance = abs(left_ts - right_ts)
            if distance > _TEMPORAL_WINDOW_SECONDS:
                score *= 0.86
            else:
                score += 0.02 * math.exp(-distance / 2.0)
    return min(1.0, max(0.0, score))


def _quality_score(image: Any, feature: dict[str, Any]) -> float:
    stored = float(getattr(image, "quality_score", 0.0) or 0.0)
    technical = float(feature["technical_quality"])
    score = 0.35 * stored + 0.65 * technical if stored > 0 else technical
    tags = list(getattr(image, "tags", []) or [])
    face = _tag_value(tags, "人脸:")
    if face == "全脸":
        score += 0.05
    elif face == "3-4脸":
        score += 0.025
    elif face == "无脸":
        score -= 0.025
    return min(1.0, max(0.0, score))


def _cluster(records: list[dict[str, Any]], threshold: float) -> list[dict[str, Any]]:
    remaining = set(range(len(records)))
    clusters: list[dict[str, Any]] = []
    seed_order = sorted(remaining, key=lambda index: records[index]["quality"], reverse=True)

    for seed in seed_order:
        if seed not in remaining:
            continue
        similarities = {
            index: _similarity(records[seed], records[index])
            for index in remaining
        }
        members = sorted(
            (index for index, score in similarities.items() if score >= threshold),
            key=lambda index: similarities[index],
            reverse=True,
        )[:_MAX_CLUSTER_SIZE]
        if seed not in members:
            members.append(seed)

        representative = max(
            members,
            key=lambda candidate: 0.68 * records[candidate]["quality"]
            + 0.32
            * (
                sum(_similarity(records[candidate], records[other]) for other in members)
                / len(members)
            ),
        )
        ranked = sorted(
            members,
            key=lambda index: (
                index != representative,
                -_similarity(records[representative], records[index]),
                -records[index]["quality"],
            ),
        )
        clusters.append({"representative": representative, "members": ranked})
        remaining.difference_update(members)

    clusters.sort(
        key=lambda cluster: (
            -len(cluster["members"]),
            -records[cluster["representative"]]["quality"],
        )
    )
    return clusters


def _act_capabilities(_payload: dict[str, Any], _service: Any) -> dict[str, Any]:
    try:
        cv2 = _load_cv2()
    except ValueError as exc:
        return {"available": False, "reason": str(exc)}
    return {
        "available": True,
        "engine": "OpenCV pHash + HSV + perceptual thumbnail",
        "version": cv2.__version__,
        "max_images": _MAX_IMAGES,
    }


def _act_analyze(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    from app.services.api import ImageFilter

    group_id = str(payload.get("group_id") or "").strip()
    if not group_id:
        raise ValueError("请选择图片分组")
    threshold = float(payload.get("threshold", 0.94))
    if not 0.70 <= threshold <= 0.99:
        raise ValueError("相似度阈值必须在 0.70 到 0.99 之间")

    images = list(service.list_images(ImageFilter(group_id=group_id)))
    if not images:
        raise ValueError("所选分组没有图片")
    if len(images) > _MAX_IMAGES:
        raise ValueError(f"单次最多分析 {_MAX_IMAGES} 张图片")

    cv2 = _load_cv2()
    records: list[dict[str, Any]] = []
    unreadable: list[dict[str, str]] = []
    for image in images:
        path = str(getattr(image, "image_path", "") or "")
        frame = cv2.imread(path, cv2.IMREAD_COLOR) if path else None
        if frame is None:
            unreadable.append({"id": image.id, "title": image.title, "error": "图片无法读取"})
            continue
        feature = _extract_feature(cv2, frame)
        tags = list(getattr(image, "tags", []) or [])
        feature.update(
            {
                "image": image,
                "quality": _quality_score(image, feature),
                "姿态:": _tag_value(tags, "姿态:"),
                "景别:": _tag_value(tags, "景别:"),
                "人脸:": _tag_value(tags, "人脸:"),
                "source_key": getattr(image, "asset_id", None)
                or (image.title.rsplit("@", 1)[0] if "@" in image.title else None),
                "timestamp": getattr(image, "frame_actual_timestamp", None),
            }
        )
        records.append(feature)

    if not records:
        raise ValueError("分组中的图片均无法读取")

    raw_clusters = _cluster(records, threshold)
    clusters: list[dict[str, Any]] = []
    for number, cluster in enumerate(raw_clusters, start=1):
        representative = cluster["representative"]
        representative_record = records[representative]
        cluster_id = f"similar-{number:04d}"
        items = []
        for index in cluster["members"]:
            record = records[index]
            image = record["image"]
            items.append(
                {
                    "id": image.id,
                    "title": image.title,
                    "width": image.width,
                    "height": image.height,
                    "quality": round(record["quality"], 4),
                    "similarity": round(_similarity(representative_record, record), 4),
                    "recommended": index == representative,
                    "metrics": {
                        "sharpness": round(record["sharpness"], 4),
                        "exposure": round(record["exposure"], 4),
                        "resolution": round(record["resolution"], 4),
                    },
                }
            )
        clusters.append(
            {
                "id": cluster_id,
                "representative_id": representative_record["image"].id,
                "count": len(items),
                "items": items,
            }
        )

    duplicate_clusters = sum(1 for cluster in clusters if cluster["count"] > 1)
    return {
        "group_id": group_id,
        "threshold": threshold,
        "total": len(images),
        "analyzed": len(records),
        "unreadable": unreadable,
        "cluster_count": len(clusters),
        "duplicate_cluster_count": duplicate_clusters,
        "recommended_count": len(clusters),
        "removed_count": len(records) - len(clusters),
        "clusters": clusters,
    }


def _resolve_target(service: Any, target: dict[str, Any]) -> tuple[str, str]:
    kind = str((target or {}).get("kind") or "")
    if kind == "group":
        group_id = str(target.get("group_id") or "")
        for group in service.list_image_groups():
            if group.id == group_id:
                return group.id, group.name
        raise ValueError("目标分组不存在")
    if kind == "new_group":
        name = str(target.get("name") or "").strip()
        if not name:
            raise ValueError("新分组名称不能为空")
        group = service.create_image_group(name, "相似图片精选结果")
        return group.id, group.name
    raise ValueError("请选择已有分组或新建分组")


def _act_commit(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    from app.services.api import ImageFilter

    selected = list(payload.get("selected") or [])
    if not selected:
        raise ValueError("没有选择要加入分组的图片")
    group_id, group_name = _resolve_target(service, payload.get("target") or {})

    existing = list(service.list_images(ImageFilter(group_id=group_id)))
    existing_sources = {
        tag[len(_TAG_SOURCE_PREFIX) :]
        for image in existing
        for tag in image.tags
        if tag.startswith(_TAG_SOURCE_PREFIX)
    }
    created_ids: list[str] = []
    skipped_ids: list[str] = []
    for item in selected:
        image_id = str(item.get("image_id") or "")
        cluster_id = str(item.get("cluster_id") or "")
        if not image_id:
            continue
        if image_id in existing_sources:
            skipped_ids.append(image_id)
            continue
        source = service.get_image(image_id)
        clone = service.copy_image(image_id, group_id=group_id)
        tags = list(
            dict.fromkeys(
                [
                    *clone.tags,
                    _TAG_SELECTED,
                    f"{_TAG_SOURCE_PREFIX}{image_id}",
                    f"{_TAG_CLUSTER_PREFIX}{cluster_id}",
                ]
            )
        )
        clone = service.update_image(clone.id, title=source.title, tags=tags)
        created_ids.append(clone.id)
        existing_sources.add(image_id)

    return {
        "group_id": group_id,
        "group_name": group_name,
        "created": len(created_ids),
        "skipped": len(skipped_ids),
        "created_ids": created_ids,
        "skipped_ids": skipped_ids,
    }


_ACTIONS = {
    "capabilities": _act_capabilities,
    "analyze": _act_analyze,
    "commit": _act_commit,
}


def invoke(action: str, payload: dict[str, Any], service: Any) -> Any:
    handler = _ACTIONS.get(action)
    if handler is None:
        raise ValueError(f"未知的动作: {action}")
    return handler(payload, service)