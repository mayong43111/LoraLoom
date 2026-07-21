"""ai-toolkit 节点注册、训练任务派发与状态同步。"""

from __future__ import annotations

import io
import json
import mimetypes
import ntpath
import posixpath
import re
import sqlite3
import threading
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol, Sequence
from uuid import uuid4

import httpx
import yaml

from app.services import db, export as export_service
from app.services.api import DatasetService


class SchedulerError(Exception):
    """节点或派发操作失败。"""


_TRAINING_PROGRESS_RE = re.compile(r"(?<!\d)(\d+)/(\d+)\s*\[")
_TRAINING_SPEED_RE = re.compile(r"(\d+(?:\.\d+)?(?:ms|s)/it)")


def _progress_from_log(log: str) -> tuple[int, int, str] | None:
    matches = list(_TRAINING_PROGRESS_RE.finditer(log))
    if not matches:
        return None
    max_total = max(int(match.group(2)) for match in matches)
    last = next(
        match for match in reversed(matches) if int(match.group(2)) == max_total
    )
    speeds = _TRAINING_SPEED_RE.findall(log[last.start() :])
    return int(last.group(1)), int(last.group(2)), speeds[-1] if speeds else ""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class AiToolkitNode:
    id: str
    name: str
    base_url: str
    gpu_ids: str
    enabled: bool
    auth_configured: bool
    created_at: str
    updated_at: str


@dataclass(slots=True)
class TrainingTask:
    id: str
    dataset_id: str
    dataset_name: str
    node_id: str
    node_name: str
    remote_job_id: str | None
    remote_dataset_name: str | None
    status: str
    options: dict[str, Any]
    error: str
    step: int
    total_steps: int | None
    info: str
    speed_string: str
    created_at: str
    updated_at: str


@dataclass(slots=True)
class _StoredNode:
    id: str
    name: str
    base_url: str
    auth_token: str
    gpu_ids: str
    enabled: bool
    created_at: str
    updated_at: str

    def public(self) -> AiToolkitNode:
        return AiToolkitNode(
            id=self.id,
            name=self.name,
            base_url=self.base_url,
            gpu_ids=self.gpu_ids,
            enabled=self.enabled,
            auth_configured=bool(self.auth_token),
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


class AiToolkitClientProtocol(Protocol):
    def inspect(self, node: _StoredNode) -> dict[str, Any]: ...

    def create_dataset(self, node: _StoredNode, name: str) -> str: ...

    def upload_files(
        self,
        node: _StoredNode,
        dataset_name: str,
        files: Sequence[tuple[str, bytes]],
    ) -> None: ...

    def create_job(
        self, node: _StoredNode, name: str, config: dict[str, Any]
    ) -> str: ...

    def start_job(self, node: _StoredNode, job_id: str) -> None: ...

    def get_job(self, node: _StoredNode, job_id: str) -> dict[str, Any]: ...

    def stop_job(self, node: _StoredNode, job_id: str) -> None: ...

    def delete_job(self, node: _StoredNode, job_id: str) -> None: ...


class AiToolkitClient:
    """官方 ai-toolkit Web UI API 的同步客户端。"""

    def __init__(self, timeout: float = 60.0) -> None:
        self.timeout = timeout

    @staticmethod
    def _headers(node: _StoredNode) -> dict[str, str]:
        return (
            {"Authorization": f"Bearer {node.auth_token}"}
            if node.auth_token
            else {}
        )

    def _request(
        self, node: _StoredNode, method: str, path: str, **kwargs: Any
    ) -> httpx.Response:
        timeout = kwargs.pop("timeout", self.timeout)
        try:
            response = httpx.request(
                method,
                f"{node.base_url.rstrip('/')}{path}",
                headers={**self._headers(node), **kwargs.pop("headers", {})},
                timeout=timeout,
                **kwargs,
            )
        except httpx.HTTPError as exc:
            raise SchedulerError(f"无法连接节点 {node.name}：{exc}") from exc
        if response.is_error:
            try:
                body = response.json()
                detail = body.get("error") or body.get("detail") or response.text
            except (ValueError, AttributeError):
                detail = response.text
            raise SchedulerError(
                f"节点 {node.name} 返回 HTTP {response.status_code}：{detail}"
            )
        return response

    def inspect(self, node: _StoredNode) -> dict[str, Any]:
        settings = self._request(node, "GET", "/api/settings").json()
        gpu = self._request(node, "GET", "/api/gpu").json()
        return {"settings": settings, "gpu": gpu}

    def create_dataset(self, node: _StoredNode, name: str) -> str:
        data = self._request(
            node, "POST", "/api/datasets/create", json={"name": name}
        ).json()
        return str(data.get("name") or name)

    def upload_files(
        self,
        node: _StoredNode,
        dataset_name: str,
        files: Sequence[tuple[str, bytes]],
    ) -> None:
        batch: list[tuple[str, tuple[str, bytes, str]]] = []
        batch_size = 0
        for filename, content in files:
            mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            batch.append(("files", (filename, content, mime)))
            batch_size += len(content)
            if batch_size >= 32 * 1024 * 1024:
                self._upload_batch(node, dataset_name, batch)
                batch, batch_size = [], 0
        if batch:
            self._upload_batch(node, dataset_name, batch)

    def _upload_batch(
        self,
        node: _StoredNode,
        dataset_name: str,
        files: list[tuple[str, tuple[str, bytes, str]]],
    ) -> None:
        self._request(
            node,
            "POST",
            "/api/datasets/upload",
            data={"datasetName": dataset_name},
            files=files,
            timeout=max(self.timeout, 300.0),
        )

    def create_job(
        self, node: _StoredNode, name: str, config: dict[str, Any]
    ) -> str:
        data = self._request(
            node,
            "POST",
            "/api/jobs",
            json={
                "name": name,
                "gpu_ids": node.gpu_ids,
                "job_config": config,
                "job_ref": f"loraloom:{name}",
                "job_type": "train",
            },
        ).json()
        job_id = data.get("id")
        if not job_id:
            raise SchedulerError(f"节点 {node.name} 创建任务后未返回任务 ID")
        return str(job_id)

    def start_job(self, node: _StoredNode, job_id: str) -> None:
        self._request(node, "GET", f"/api/jobs/{job_id}/start")
        self._request(node, "GET", f"/api/queue/{node.gpu_ids}/start")

    def get_job(self, node: _StoredNode, job_id: str) -> dict[str, Any]:
        job = self._request(
            node, "GET", "/api/jobs", params={"id": job_id}
        ).json()
        if str(job.get("status")) == "running" and not int(job.get("step") or 0):
            log_data = self._request(
                node, "GET", f"/api/jobs/{job_id}/log"
            ).json()
            progress = _progress_from_log(str(log_data.get("log") or ""))
            if progress:
                step, total_steps, speed = progress
                job.update(
                    step=step,
                    total_steps=total_steps,
                    speed_string=speed,
                    info="Training",
                )
        return job

    def stop_job(self, node: _StoredNode, job_id: str) -> None:
        self._request(node, "GET", f"/api/jobs/{job_id}/stop")

    def delete_job(self, node: _StoredNode, job_id: str) -> None:
        self._request(node, "GET", f"/api/jobs/{job_id}/delete")


class TrainingScheduler:
    """持久化节点，并把 LoraLoom 数据集派发到 ai-toolkit。"""

    def __init__(
        self,
        dataset_service: DatasetService,
        db_path: str | Path,
        client: AiToolkitClientProtocol | None = None,
    ) -> None:
        self.dataset_service = dataset_service
        self._conn = db.connect(db_path)
        self._lock = threading.RLock()
        db.init_db(self._conn)
        self.client = client or AiToolkitClient()

    def _write(self, sql: str, params: Sequence[object]) -> None:
        with self._lock:
            self._conn.execute(sql, params)
            self._conn.commit()

    @staticmethod
    def _stored_node(row: sqlite3.Row) -> _StoredNode:
        return _StoredNode(
            id=row["id"],
            name=row["name"],
            base_url=row["base_url"],
            auth_token=row["auth_token"],
            gpu_ids=row["gpu_ids"],
            enabled=bool(row["enabled"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _task(row: sqlite3.Row) -> TrainingTask:
        return TrainingTask(
            id=row["id"],
            dataset_id=row["dataset_id"],
            dataset_name=row["dataset_name"],
            node_id=row["node_id"],
            node_name=row["node_name"],
            remote_job_id=row["remote_job_id"],
            remote_dataset_name=row["remote_dataset_name"],
            status=row["status"],
            options=json.loads(row["options_json"]),
            error=row["error"],
            step=int(row["step"] or 0),
            total_steps=(
                int(row["total_steps"])
                if row["total_steps"] is not None
                else None
            ),
            info=row["info"],
            speed_string=row["speed_string"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def list_nodes(self) -> list[AiToolkitNode]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM aitoolkit_nodes ORDER BY name"
            ).fetchall()
        return [self._stored_node(row).public() for row in rows]

    def get_node(self, node_id: str) -> _StoredNode:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM aitoolkit_nodes WHERE id = ?", (node_id,)
            ).fetchone()
        if row is None:
            raise SchedulerError("ai-toolkit 节点不存在")
        return self._stored_node(row)

    def save_node(
        self,
        *,
        name: str,
        base_url: str,
        auth_token: str = "",
        gpu_ids: str = "0",
        enabled: bool = True,
        node_id: str | None = None,
    ) -> AiToolkitNode:
        name = name.strip()
        base_url = base_url.strip().rstrip("/")
        if not name or not base_url.startswith(("http://", "https://")):
            raise SchedulerError("节点名称不能为空，地址必须以 http:// 或 https:// 开头")
        timestamp = _now()
        try:
            if node_id:
                current = self.get_node(node_id)
                token = auth_token if auth_token else current.auth_token
                self._write(
                    "UPDATE aitoolkit_nodes SET name=?, base_url=?, auth_token=?, "
                    "gpu_ids=?, enabled=?, updated_at=? WHERE id=?",
                    (name, base_url, token, gpu_ids.strip() or "0", int(enabled), timestamp, node_id),
                )
            else:
                node_id = str(uuid4())
                self._write(
                    "INSERT INTO aitoolkit_nodes "
                    "(id,name,base_url,auth_token,gpu_ids,enabled,created_at,updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (node_id, name, base_url, auth_token, gpu_ids.strip() or "0", int(enabled), timestamp, timestamp),
                )
        except sqlite3.IntegrityError as exc:
            raise SchedulerError("节点名称已存在") from exc
        return self.get_node(node_id).public()

    def delete_node(self, node_id: str) -> None:
        self.get_node(node_id)
        self._write("DELETE FROM aitoolkit_nodes WHERE id = ?", (node_id,))

    def inspect_node(self, node_id: str) -> dict[str, Any]:
        node = self.get_node(node_id)
        result = self.client.inspect(node)
        gpu_data = result.get("gpu") or {}
        return {
            "ok": True,
            "node": asdict(node.public()),
            "datasets_folder": (result.get("settings") or {}).get("DATASETS_FOLDER"),
            "training_folder": (result.get("settings") or {}).get("TRAINING_FOLDER"),
            "gpus": gpu_data.get("gpus", []),
        }

    def list_tasks(self) -> list[TrainingTask]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM training_tasks ORDER BY created_at DESC"
            ).fetchall()
        return [self._task(row) for row in rows]

    def get_task(self, task_id: str) -> TrainingTask:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM training_tasks WHERE id = ?", (task_id,)
            ).fetchone()
        if row is None:
            raise SchedulerError("训练任务不存在")
        return self._task(row)

    def create_task(
        self, dataset_id: str, node_id: str, options: dict[str, Any]
    ) -> TrainingTask:
        dataset = self.dataset_service.get_dataset(dataset_id)
        node = self.get_node(node_id)
        if not node.enabled:
            raise SchedulerError("目标节点已停用")
        task_id = str(uuid4())
        timestamp = _now()
        self._write(
            "INSERT INTO training_tasks "
            "(id,dataset_id,dataset_name,node_id,node_name,status,options_json,error,created_at,updated_at) "
            "VALUES (?,?,?,?,?,'pending',?,'',?,?)",
            (task_id, dataset_id, dataset.name, node.id, node.name, json.dumps(options, ensure_ascii=False), timestamp, timestamp),
        )
        return self.get_task(task_id)

    def _update_task(self, task_id: str, **values: Any) -> None:
        if not values:
            return
        values["updated_at"] = _now()
        columns = ", ".join(f"{key} = ?" for key in values)
        self._write(
            f"UPDATE training_tasks SET {columns} WHERE id = ?",
            (*values.values(), task_id),
        )

    @staticmethod
    def _remote_path(root: str, name: str) -> str:
        return (
            ntpath.join(root, name)
            if "\\" in root or (len(root) > 1 and root[1] == ":")
            else posixpath.join(root, name)
        )

    def dispatch(self, task_id: str) -> None:
        task = self.get_task(task_id)
        node = self.get_node(task.node_id)
        self._update_task(task_id, status="uploading", error="")
        try:
            images = list(self.dataset_service.list_dataset_images(task.dataset_id))
            item_ids = task.options.get("item_ids")
            if isinstance(item_ids, list) and item_ids:
                wanted = {str(item_id) for item_id in item_ids}
                images = [image for image in images if image.id in wanted]
            options = self._export_options(task.options)
            package, _, count = export_service.build_export_zip(
                task.dataset_name, images, options
            )
            if count == 0:
                raise SchedulerError("没有满足条件的图片可派发")

            suffix = task.id.split("-")[0]
            remote_name = f"{export_service._slugify(task.dataset_name)}_{suffix}"
            remote_name = self.client.create_dataset(node, remote_name)
            config, files = self._package_contents(package)
            self.client.upload_files(node, remote_name, files)

            inspection = self.client.inspect(node)
            settings = inspection.get("settings") or {}
            process = config["config"]["process"][0]
            process["datasets"][0]["folder_path"] = self._remote_path(
                str(settings.get("DATASETS_FOLDER") or "datasets"), remote_name
            )
            process["training_folder"] = str(
                settings.get("TRAINING_FOLDER") or "output"
            )
            process["sqlite_db_path"] = "./aitk_db.db"
            process["device"] = "cuda"
            process["performance_log_every"] = 10
            job_name = remote_name
            config["config"]["name"] = job_name
            if isinstance(config.get("meta"), dict):
                config["meta"]["name"] = job_name

            self._update_task(
                task_id,
                status="creating_job",
                remote_dataset_name=remote_name,
            )
            job_id = self.client.create_job(node, job_name, config)
            self.client.start_job(node, job_id)
            self._update_task(
                task_id,
                status="queued",
                remote_job_id=job_id,
                remote_dataset_name=remote_name,
            )
        except Exception as exc:  # noqa: BLE001 - 后台任务必须记录失败原因
            self._update_task(task_id, status="error", error=str(exc))

    @staticmethod
    def _export_options(options: dict[str, Any]) -> export_service.ExportOptions:
        resolution = options.get("resolution")
        return export_service.ExportOptions(
            base_model=str(options.get("base_model") or "Qwen/Qwen-Image-2512"),
            preset=str(options.get("preset") or "character"),
            trigger_word=str(options.get("trigger_word") or "").strip(),
            rank=int(options["rank"]) if options.get("rank") else None,
            learning_rate=(
                float(options["learning_rate"])
                if options.get("learning_rate") is not None
                else None
            ),
            steps=int(options["steps"]) if options.get("steps") else None,
            steps_per_image=(
                int(options["steps_per_image"])
                if options.get("steps_per_image")
                else None
            ),
            resolution=[int(value) for value in resolution] if resolution else None,
            sample_prompts=(
                [str(value) for value in options["sample_prompts"]]
                if options.get("sample_prompts")
                else None
            ),
            only_captioned=bool(options.get("only_captioned", True)),
            gradient_checkpointing=bool(
                options.get("gradient_checkpointing", True)
            ),
            quantize=bool(options.get("quantize", True)),
            quantize_te=(
                bool(options["quantize_te"])
                if options.get("quantize_te") is not None
                else None
            ),
            low_vram=bool(options.get("low_vram", False)),
        )

    @staticmethod
    def _package_contents(
        package: bytes,
    ) -> tuple[dict[str, Any], list[tuple[str, bytes]]]:
        with zipfile.ZipFile(io.BytesIO(package)) as archive:
            yaml_names = [name for name in archive.namelist() if name.endswith((".yaml", ".yml"))]
            if len(yaml_names) != 1:
                raise SchedulerError("训练包内未找到唯一配置文件")
            config = yaml.safe_load(archive.read(yaml_names[0]).decode("utf-8"))
            files = []
            for name in archive.namelist():
                marker = "/dataset/"
                if marker in name and not name.endswith("/"):
                    files.append((name.split(marker, 1)[1], archive.read(name)))
        return config, files

    def refresh_task(self, task_id: str) -> TrainingTask:
        task = self.get_task(task_id)
        if not task.remote_job_id:
            return task
        node = self.get_node(task.node_id)
        try:
            remote = self.client.get_job(node, task.remote_job_id)
            status = str(remote.get("status") or task.status)
            self._update_task(
                task_id,
                status=status,
                error="",
                step=int(remote.get("step") or 0),
                total_steps=(
                    int(remote["total_steps"])
                    if remote.get("total_steps") is not None
                    else task.total_steps
                ),
                info=str(remote.get("info") or ""),
                speed_string=str(remote.get("speed_string") or ""),
            )
        except Exception as exc:  # 保留远端状态，仅记录同步错误
            self._update_task(task_id, error=f"状态同步失败：{exc}")
        return self.get_task(task_id)

    def stop_task(self, task_id: str) -> TrainingTask:
        """停止远端训练 Job；本地任务标记为已停止。"""
        task = self.get_task(task_id)
        if task.remote_job_id:
            node = self.get_node(task.node_id)
            self.client.stop_job(node, task.remote_job_id)
        self._update_task(task_id, status="stopped", info="已停止")
        return self.get_task(task_id)

    def delete_task(self, task_id: str) -> None:
        """删除任务：尽力停止并删除远端 Job，再移除本地记录。"""
        task = self.get_task(task_id)
        if task.remote_job_id:
            try:
                node = self.get_node(task.node_id)
            except SchedulerError:
                node = None
            if node is not None:
                # 远端不可达时不阻断本地删除，避免残留无法清理的记录。
                try:
                    self.client.stop_job(node, task.remote_job_id)
                except SchedulerError:
                    pass
                try:
                    self.client.delete_job(node, task.remote_job_id)
                except SchedulerError:
                    pass
        self._write("DELETE FROM training_tasks WHERE id = ?", (task_id,))