from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

from PIL import Image as PILImage

from app.services.mock_service import MockDatasetService


def _load_handler() -> Any:
    path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "plugins"
        / "frame-extraction"
        / "handler.py"
    )
    spec = importlib.util.spec_from_file_location("test_frame_extraction_handler", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_commit_reads_dimensions_from_saved_frame(tmp_path: Path, monkeypatch) -> None:
    handler = _load_handler()
    service = MockDatasetService()
    source = tmp_path / "frame.jpg"
    PILImage.new("RGB", (1024, 1536), "white").save(source)
    session_id = "session-test"
    frame_id = "frame-test"
    handler._IMAGES_DIR = tmp_path / "images"
    handler._SESSIONS[session_id] = {
        "video_id": "video-test",
        "video_title": "test.mp4",
        "path": "missing.mp4",
        "width": 0,
        "height": 0,
        "fps": 30,
        "tags": ["抽帧"],
        "frames": {
            frame_id: {
                "actual_timestamp": 1.0,
                "target_timestamp": 1.0,
                "quality_score": 0.9,
                "quality_flags": [],
                "_full_path": str(source),
            }
        },
    }
    monkeypatch.setattr(handler, "_cleanup_session", lambda _session_id: None)

    handler._act_commit(
        {
            "session_id": session_id,
            "accepted_ids": [frame_id],
            "target": {"kind": "root"},
        },
        service,
    )

    created = service.list_images()[0]
    assert (created.width, created.height) == (1024, 1536)