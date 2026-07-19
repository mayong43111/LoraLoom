from __future__ import annotations

import socket
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi.testclient import TestClient

from app.desktop import (
    create_desktop_app,
    data_directory,
    prepare_backend,
    start_private_server,
)


def test_data_directory_honors_override(monkeypatch, tmp_path: Path) -> None:
    target = tmp_path / "LoraLoom data"
    monkeypatch.setenv("LORALOOM_DATA_DIR", str(target))

    assert data_directory() == target.resolve()


def test_prepare_backend_initializes_database_in_current_data_directory(
    monkeypatch,
    tmp_path: Path,
) -> None:
    from app.api.deps import get_service, get_training_scheduler

    get_training_scheduler.cache_clear()
    get_service.cache_clear()
    monkeypatch.chdir(tmp_path)
    try:
        service = prepare_backend()

        assert Path(service.db_path) == (tmp_path / "workspace/dataset.sqlite").resolve()
        assert Path(service.db_path).is_file()
    finally:
        get_training_scheduler.cache_clear()
        get_service.cache_clear()


def test_desktop_frontend_serves_assets_and_spa_routes(tmp_path: Path) -> None:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<title>LoraLoom</title>", encoding="utf-8")
    (tmp_path / "assets" / "app.js").write_text("desktop", encoding="utf-8")
    client = TestClient(create_desktop_app(tmp_path))

    assert client.get("/").text == "<title>LoraLoom</title>"
    assert client.get("/datasets/example").text == "<title>LoraLoom</title>"
    assert client.get("/assets/app.js").text == "desktop"
    assert client.get("/api/not-a-route").status_code == 404


def test_private_server_uses_an_available_ephemeral_port(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<title>LoraLoom</title>", encoding="utf-8")
    occupied_sockets: list[socket.socket] = []
    server = None
    thread = None
    try:
        for _ in range(3):
            occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            occupied.bind(("127.0.0.1", 0))
            occupied.listen(1)
            occupied_sockets.append(occupied)
        occupied_ports = {item.getsockname()[1] for item in occupied_sockets}

        server, thread, url = start_private_server(tmp_path)
        selected_port = urlparse(url).port

        assert selected_port is not None
        assert selected_port not in occupied_ports
        assert selected_port not in {7777, 7778, 8000}
        assert httpx.get(f"{url}/api/health", timeout=5).status_code == 200
    finally:
        if server is not None:
            server.should_exit = True
        if thread is not None:
            thread.join(timeout=10)
        for occupied in occupied_sockets:
            occupied.close()