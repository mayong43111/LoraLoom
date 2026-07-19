"""LoraLoom Windows desktop launcher.

The desktop process hosts the FastAPI application on an ephemeral loopback port
and displays it in the system WebView2 runtime. Closing the window stops the
private server; no externally reachable web service is created.
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import time
import traceback
from pathlib import Path


APP_NAME = "LoraLoom"
LOOPBACK_HOST = "127.0.0.1"
EPHEMERAL_PORT = 0


def data_directory() -> Path:
    """Return the writable directory used by the packaged application."""
    override = os.environ.get("LORALOOM_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    else:
        root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return root / APP_NAME


def frontend_directory() -> Path:
    """Locate Vite output in source and PyInstaller builds."""
    bundle_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    return bundle_root / "web" / "dist"


def create_desktop_app(static_dir: Path):
    """Attach production frontend routes after all API routes are registered."""
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    from app.api.app import app

    static_root = static_dir.resolve()
    index_file = static_root / "index.html"
    if not index_file.is_file():
        raise RuntimeError(f"Frontend build not found: {index_file}")

    @app.get("/{resource_path:path}", include_in_schema=False)
    def desktop_frontend(resource_path: str):
        if resource_path == "api" or resource_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")

        requested = (static_root / resource_path).resolve()
        try:
            requested.relative_to(static_root)
        except ValueError:
            raise HTTPException(status_code=404, detail="Resource not found") from None

        if requested.is_file():
            return FileResponse(requested)
        return FileResponse(index_file)

    return app


def prepare_backend():
    """Initialize the singleton data service before concurrent UI requests."""
    from app.api.deps import get_service

    return get_service()


def start_private_server(static_dir: Path):
    """Start Uvicorn on an OS-selected loopback port."""
    import uvicorn

    prepare_backend()
    application = create_desktop_app(static_dir)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind((LOOPBACK_HOST, EPHEMERAL_PORT))
    listener.listen(128)
    port = listener.getsockname()[1]

    config = uvicorn.Config(
        application,
        log_config=None,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(
        target=server.run,
        kwargs={"sockets": [listener]},
        name="loraloom-server",
        daemon=True,
    )
    thread.start()

    deadline = time.monotonic() + 15
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.02)
    if not server.started:
        server.should_exit = True
        listener.close()
        raise RuntimeError("Desktop server did not start")
    return server, thread, f"http://{LOOPBACK_HOST}:{port}"


def run_health_check(static_dir: Path) -> int:
    """Verify the bundled UI and API without opening a window."""
    import httpx

    server, thread, url = start_private_server(static_dir)
    try:
        with httpx.Client(timeout=10) as client:
            root = client.get(url)
            health = client.get(f"{url}/api/health")
            deep_link = client.get(f"{url}/datasets/desktop-check")
        if root.status_code != 200 or "LoraLoom" not in root.text:
            raise RuntimeError("Bundled frontend did not load")
        health.raise_for_status()
        if deep_link.status_code != 200 or "LoraLoom" not in deep_link.text:
            raise RuntimeError("Frontend route fallback failed")
        return 0
    finally:
        server.should_exit = True
        thread.join(timeout=10)


def run_desktop(static_dir: Path) -> int:
    """Open the native desktop window and block until it is closed."""
    import webview

    server, thread, url = start_private_server(static_dir)
    try:
        webview.create_window(
            APP_NAME,
            url,
            width=1440,
            height=920,
            min_size=(1024, 700),
        )
        webview.start(debug=False, private_mode=False)
        return 0
    finally:
        server.should_exit = True
        thread.join(timeout=10)


def main() -> int:
    parser = argparse.ArgumentParser(description="LoraLoom desktop application")
    parser.add_argument(
        "--health-check",
        action="store_true",
        help="verify bundled frontend and API, then exit",
    )
    args = parser.parse_args()

    app_data = data_directory()
    app_data.mkdir(parents=True, exist_ok=True)
    (app_data / "desktop-error.log").unlink(missing_ok=True)
    os.chdir(app_data)
    static_dir = frontend_directory()
    if args.health_check:
        return run_health_check(static_dir)
    return run_desktop(static_dir)


if __name__ == "__main__":
    try:
        exit_code = main()
    except Exception:
        crash_directory = data_directory()
        crash_directory.mkdir(parents=True, exist_ok=True)
        (crash_directory / "desktop-error.log").write_text(
            traceback.format_exc(),
            encoding="utf-8",
        )
        exit_code = 1
    raise SystemExit(exit_code)