"""姿态、人脸与景别分类的纯逻辑测试。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import numpy as np


def _load_handler() -> Any:
    path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "plugins"
        / "pose-face-annotation"
        / "handler.py"
    )
    spec = importlib.util.spec_from_file_location("test_pose_face_handler", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HANDLER = _load_handler()


def _face(nose_x: float) -> list[float]:
    return [0, 0, 100, 100, 20, 30, 80, 30, nose_x, 55, 30, 75, 70, 75, 0.95]


def _landmarks(*visible_indices: int) -> np.ndarray:
    points = np.zeros((39, 5), dtype=np.float32)
    for index in visible_indices:
        points[index, 3:5] = 0.9
    return points


def test_classify_face_uses_landmark_asymmetry() -> None:
    assert HANDLER._classify_face(_face(50))[1] == "full"
    assert HANDLER._classify_face(_face(66))[1] == "three_quarter"
    assert HANDLER._classify_face(_face(78))[1] == "half"


def test_classify_shot_from_visible_body_joints() -> None:
    assert HANDLER._classify_shot(_landmarks(11, 12))[0] == "closeup"
    assert HANDLER._classify_shot(_landmarks(11, 12, 23, 24))[0] == "half"
    assert HANDLER._classify_shot(_landmarks(11, 12, 23, 24, 25, 26, 27, 28))[0] == "full"
    assert HANDLER._classify_shot(_landmarks())[0] == "unknown"