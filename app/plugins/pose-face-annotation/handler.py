"""姿态、人脸与景别自动标注插件。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

_PLUGIN_DIR = Path(__file__).resolve().parent
_MODEL_DIR = _PLUGIN_DIR / "models"
_MODEL_PATHS = {
    "face": _MODEL_DIR / "face_detection_yunet_2023mar.onnx",
    "person": _MODEL_DIR / "person_detection_mediapipe_2023mar.onnx",
    "pose": _MODEL_DIR / "pose_estimation_mediapipe_2023mar.onnx",
}

_ORIENT_LABEL = {"front": "正对", "side": "侧面", "back": "背面"}
_FACE_LABEL = {"full": "全脸", "three_quarter": "3-4脸", "half": "半脸", "none": "无脸"}
_SHOT_LABEL = {"closeup": "近景", "half": "半身", "full": "全身", "unknown": "未知"}

_MAX_BATCH = 200
_DETECT_MAX_SIDE = 1280
_FACE_SCORE_THRESHOLD = 0.62
_KEYPOINT_THRESHOLD = 0.45

_DETECTORS: tuple[Any, Any, Any] | None = None


def _load_cv2() -> Any:
    try:
        import cv2  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        raise ValueError(
            "自动识别需要 opencv-python-headless，请先在服务端执行 "
            "`pip install opencv-python-headless` 后重启后端"
        ) from exc
    return cv2


def _load_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"无法加载模型推理模块: {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_detectors(cv2: Any) -> tuple[Any, Any, Any]:
    global _DETECTORS
    if _DETECTORS is not None:
        return _DETECTORS

    required = [*_MODEL_PATHS.values(), _MODEL_DIR / "mp_persondet.py", _MODEL_DIR / "mp_pose.py"]
    missing = [path.name for path in required if not path.is_file()]
    if missing:
        raise ValueError("自动识别模型不完整: " + ", ".join(missing))

    person_module = _load_module("pose_face_mp_persondet", _MODEL_DIR / "mp_persondet.py")
    pose_module = _load_module("pose_face_mp_pose", _MODEL_DIR / "mp_pose.py")
    face_detector = cv2.FaceDetectorYN.create(
        str(_MODEL_PATHS["face"]),
        "",
        (320, 320),
        _FACE_SCORE_THRESHOLD,
        0.3,
        5000,
    )
    person_detector = person_module.MPPersonDet(
        str(_MODEL_PATHS["person"]), scoreThreshold=0.55, nmsThreshold=0.3
    )
    pose_detector = pose_module.MPPose(str(_MODEL_PATHS["pose"]), confThreshold=0.5)
    _DETECTORS = face_detector, person_detector, pose_detector
    return _DETECTORS


def _classify_face(face: Any) -> tuple[str, str, float]:
    """根据 YuNet 双眼与鼻尖的水平偏移估计人脸偏转程度。"""
    right_eye_x, left_eye_x, nose_x = float(face[4]), float(face[6]), float(face[8])
    eye_distance = abs(left_eye_x - right_eye_x)
    if eye_distance < 1.0:
        return "side", "half", 0.0
    eye_midpoint = (right_eye_x + left_eye_x) / 2.0
    yaw = abs(nose_x - eye_midpoint) / eye_distance
    if yaw <= 0.14:
        return "front", "full", yaw
    if yaw <= 0.38:
        return "side", "three_quarter", yaw
    return "side", "half", yaw


def _keypoint_score(landmarks: Any, *indices: int) -> float:
    """返回一组关键点中最高的可见且存在概率。"""
    return max(
        (min(float(landmarks[index][3]), float(landmarks[index][4])) for index in indices),
        default=0.0,
    )


def _classify_shot(landmarks: Any) -> tuple[str, float]:
    """按肩、髋、膝、脚踝关键点可见性分类人物景别。"""
    shoulders = _keypoint_score(landmarks, 11, 12)
    hips = _keypoint_score(landmarks, 23, 24)
    knees = _keypoint_score(landmarks, 25, 26)
    ankles = _keypoint_score(landmarks, 27, 28)

    if knees >= _KEYPOINT_THRESHOLD and ankles >= _KEYPOINT_THRESHOLD:
        return "full", min(knees, ankles)
    if hips >= _KEYPOINT_THRESHOLD:
        return "half", hips
    if shoulders >= _KEYPOINT_THRESHOLD:
        return "closeup", shoulders
    return "unknown", max(shoulders, hips, knees, ankles)


def _resize_for_detection(cv2: Any, image: Any) -> Any:
    height, width = image.shape[:2]
    long_side = max(height, width)
    if long_side <= _DETECT_MAX_SIDE:
        return image
    scale = _DETECT_MAX_SIDE / long_side
    return cv2.resize(
        image,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def _detect_one(cv2: Any, detectors: tuple[Any, Any, Any], path: str) -> dict[str, Any]:
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        return {"ok": False, "error": "无法读取图片文件"}
    image = _resize_for_detection(cv2, image)
    height, width = image.shape[:2]
    face_detector, person_detector, pose_detector = detectors

    face_detector.setInputSize((width, height))
    _, faces_result = face_detector.detect(image)
    faces = [] if faces_result is None else list(faces_result)
    persons_result = person_detector.infer(image)
    persons = [] if persons_result is None else list(persons_result)

    orientation: str | None = None
    face_type = "none"
    face_yaw: float | None = None
    if faces:
        primary_face = max(faces, key=lambda row: float(row[2]) * float(row[3]))
        orientation, face_type, face_yaw = _classify_face(primary_face)

    shot = "unknown"
    shot_confidence = 0.0
    pose_confidence = 0.0
    if persons:
        primary_person = max(
            persons,
            key=lambda row: max(0.0, float(row[2]) - float(row[0]))
            * max(0.0, float(row[3]) - float(row[1])),
        )
        try:
            pose_result = pose_detector.infer(image, primary_person)
            if pose_result is not None:
                landmarks = pose_result[1]
                pose_confidence = float(pose_result[5])
                shot, shot_confidence = _classify_shot(landmarks)
        except (cv2.error, ValueError, IndexError):
            pass

    person_count = max(len(persons), len(faces))
    return {
        "ok": True,
        "faces": len(faces),
        "person_count": person_count,
        "orientation": orientation,
        "orientation_label": _ORIENT_LABEL.get(orientation or ""),
        "face": face_type,
        "face_label": _FACE_LABEL.get(face_type),
        "shot": shot,
        "shot_label": _SHOT_LABEL[shot],
        "confidence": {
            "face": round(max((float(row[14]) for row in faces), default=0.0), 4),
            "face_yaw": round(face_yaw, 4) if face_yaw is not None else None,
            "pose": round(pose_confidence, 4),
            "shot": round(shot_confidence, 4),
        },
    }


def _act_capabilities(_payload: dict[str, Any], _service: Any) -> dict[str, Any]:
    try:
        cv2 = _load_cv2()
        _load_detectors(cv2)
    except ValueError as exc:
        return {"available": False, "reason": str(exc)}
    return {"available": True, "engine": "OpenCV YuNet + BlazePose", "version": cv2.__version__}


def _act_detect(payload: dict[str, Any], service: Any) -> dict[str, Any]:
    image_ids = payload.get("image_ids") or []
    if not isinstance(image_ids, list) or not image_ids:
        raise ValueError("image_ids 不能为空")
    if len(image_ids) > _MAX_BATCH:
        raise ValueError(f"单次最多识别 {_MAX_BATCH} 张，请分批进行")

    cv2 = _load_cv2()
    detectors = _load_detectors(cv2)
    results: list[dict[str, Any]] = []
    for image_id in image_ids:
        entry: dict[str, Any] = {"id": image_id}
        try:
            image = service.get_image(image_id)
            path = getattr(image, "image_path", "") or ""
            if not path or not Path(path).is_file():
                entry.update({"ok": False, "error": "图片文件不存在"})
            else:
                entry.update(_detect_one(cv2, detectors, path))
        except Exception as exc:  # noqa: BLE001 - 单张失败不影响整批
            entry.update({"ok": False, "error": str(exc)})
        results.append(entry)

    ok_count = sum(1 for result in results if result.get("ok"))
    return {"results": results, "total": len(results), "ok": ok_count}


_ACTIONS = {"capabilities": _act_capabilities, "detect": _act_detect}


def invoke(action: str, payload: dict[str, Any], service: Any) -> Any:
    handler = _ACTIONS.get(action)
    if handler is None:
        raise ValueError(f"未知的动作: {action}")
    return handler(payload, service)
