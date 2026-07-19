"""插件系统测试：发现、统一调用与错误处理。"""

from __future__ import annotations

import os
import tempfile

import pytest

from app.api.plugins import (
    PluginError,
    clear_handler_cache,
    discover_plugins,
    invoke_plugin,
)
from app.services.mock_data import MockDataset
from app.services.sqlite_service import SqliteDatasetService


def _service() -> SqliteDatasetService:
    path = os.path.join(tempfile.mkdtemp(), "dataset.sqlite")
    return SqliteDatasetService(path, seed_data=MockDataset())


def test_discover_includes_bundled_plugins() -> None:
    ids = {p["id"] for p in discover_plugins()}
    assert "video.frame-extraction" in ids
    assert "image.pose-face-annotation" in ids
    assert "image.similar-selection" in ids
    assert "image.training-curation" in ids


def test_frame_extraction_manifest_is_video_scoped() -> None:
    plugin = next(
        p for p in discover_plugins() if p["id"] == "video.frame-extraction"
    )
    assert plugin["scopes"] == ["video"]
    assert "entry" in plugin and "/index.js?v=" in plugin["entry"]
    assert plugin["ui"] == "modal"
    assert plugin["selection"] == ["single"]
    assert plugin["has_backend"] is True


def test_frame_extraction_probe_returns_metadata() -> None:
    clear_handler_cache()
    service = _service()
    video = service.list_videos()[0]
    result = invoke_plugin(
        "video.frame-extraction", "probe", {"video_id": video.id}, service
    )
    assert result["video_id"] == video.id
    assert result["duration"] == video.duration
    assert result["fps"] == video.fps
    assert result["width"] == video.width
    assert result["height"] == video.height


def test_frame_extraction_unknown_action_raises() -> None:
    clear_handler_cache()
    with pytest.raises(PluginError):
        invoke_plugin("video.frame-extraction", "no-such-action", {}, _service())


def test_invoke_unknown_plugin_raises_not_found() -> None:
    with pytest.raises(PluginError) as exc:
        invoke_plugin("does.not-exist", "noop", {}, _service())
    assert str(exc.value).startswith("插件不存在")


def test_invoke_plugin_without_backend_raises() -> None:
    clear_handler_cache()
    # 没有声明后端的插件（_backend_file 为 None）调用时应抛错。
    from app.api.plugins import _load_handler

    with pytest.raises(PluginError):
        _load_handler({"id": "x", "_folder": "x", "_backend_file": None})
