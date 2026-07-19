from __future__ import annotations

from pathlib import Path
from typing import Any, Sequence

from PIL import Image as PILImage
from fastapi.testclient import TestClient

from app.api.app import app
from app.api.deps import get_training_scheduler
from app.domain.enums import DatasetType
from app.services.api import ImageCreate
from app.services.sqlite_service import SqliteDatasetService
from app.services.training_scheduler import TrainingScheduler, _StoredNode


class FakeAiToolkitClient:
    def __init__(self) -> None:
        self.uploaded: list[tuple[str, list[tuple[str, bytes]]]] = []
        self.job_config: dict[str, Any] | None = None
        self.started: list[str] = []

    def inspect(self, node: _StoredNode) -> dict[str, Any]:
        return {
            "settings": {
                "DATASETS_FOLDER": "/srv/aitk/datasets",
                "TRAINING_FOLDER": "/srv/aitk/output",
            },
            "gpu": {"gpus": [{"index": 0, "name": "Test GPU"}]},
        }

    def create_dataset(self, node: _StoredNode, name: str) -> str:
        return name.lower()

    def upload_files(
        self,
        node: _StoredNode,
        dataset_name: str,
        files: Sequence[tuple[str, bytes]],
    ) -> None:
        self.uploaded.append((dataset_name, list(files)))

    def create_job(
        self, node: _StoredNode, name: str, config: dict[str, Any]
    ) -> str:
        self.job_config = config
        return "remote-job-1"

    def start_job(self, node: _StoredNode, job_id: str) -> None:
        self.started.append(job_id)

    def get_job(self, node: _StoredNode, job_id: str) -> dict[str, Any]:
        return {"id": job_id, "status": "running"}


def test_dispatch_uploads_dataset_creates_job_and_syncs_status(tmp_path: Path) -> None:
    db_path = tmp_path / "dataset.sqlite"
    image_path = tmp_path / "subject.jpg"
    PILImage.new("RGB", (1024, 1024), "white").save(image_path)

    datasets = SqliteDatasetService(str(db_path))
    image = datasets.create_image(
        ImageCreate(
            title="subject.jpg",
            path=str(image_path),
            width=1024,
            height=1024,
        )
    )
    dataset = datasets.create_dataset("Subject V1", DatasetType.IMAGE)
    datasets.add_dataset_items(dataset.id, [image.id])
    datasets.update_dataset_item(dataset.id, image.id, caption="zxqv, portrait")

    client = FakeAiToolkitClient()
    scheduler = TrainingScheduler(datasets, db_path, client=client)
    node = scheduler.save_node(
        name="A100-1",
        base_url="http://aitk.example:8675",
        auth_token="secret",
    )
    task = scheduler.create_task(
        dataset.id,
        node.id,
        {
            "base_model": "Qwen/Qwen-Image-2512",
            "preset": "character",
            "trigger_word": "zxqv",
            "only_captioned": True,
        },
    )

    scheduler.dispatch(task.id)

    dispatched = scheduler.get_task(task.id)
    assert dispatched.status == "queued"
    assert dispatched.remote_job_id == "remote-job-1"
    assert client.started == ["remote-job-1"]
    assert len(client.uploaded) == 1
    uploaded_names = {name for name, _ in client.uploaded[0][1]}
    assert uploaded_names == {"img_0001.jpg", "img_0001.txt"}

    assert client.job_config is not None
    process = client.job_config["config"]["process"][0]
    assert process["datasets"][0]["folder_path"].startswith(
        "/srv/aitk/datasets/subject_v1_"
    )
    assert process["training_folder"] == "/srv/aitk/output"
    assert process["sqlite_db_path"] == "./aitk_db.db"

    refreshed = scheduler.refresh_task(task.id)
    assert refreshed.status == "running"


def test_node_public_data_never_exposes_auth_token(tmp_path: Path) -> None:
    datasets = SqliteDatasetService(str(tmp_path / "dataset.sqlite"))
    scheduler = TrainingScheduler(datasets, datasets.db_path, client=FakeAiToolkitClient())
    node = scheduler.save_node(
        name="secure-node",
        base_url="https://aitk.example",
        auth_token="top-secret",
    )

    assert node.auth_configured is True
    assert "auth_token" not in node.__dataclass_fields__


def test_scheduler_api_lists_nodes_and_dispatches_in_background(tmp_path: Path) -> None:
    db_path = tmp_path / "api.sqlite"
    image_path = tmp_path / "api-subject.jpg"
    PILImage.new("RGB", (512, 512), "white").save(image_path)
    datasets = SqliteDatasetService(str(db_path))
    image = datasets.create_image(
        ImageCreate(title="api-subject.jpg", path=str(image_path), width=512, height=512)
    )
    dataset = datasets.create_dataset("API Subject", DatasetType.IMAGE)
    datasets.add_dataset_items(dataset.id, [image.id])
    datasets.update_dataset_item(dataset.id, image.id, caption="zxqv")

    fake = FakeAiToolkitClient()
    scheduler = TrainingScheduler(datasets, db_path, client=fake)
    node = scheduler.save_node(name="api-node", base_url="http://node:8675")
    app.dependency_overrides[get_training_scheduler] = lambda: scheduler
    try:
        client = TestClient(app)
        nodes_response = client.get("/api/aitoolkit/nodes")
        assert nodes_response.status_code == 200
        assert nodes_response.json()[0]["auth_configured"] is False
        assert "auth_token" not in nodes_response.json()[0]

        response = client.post(
            f"/api/datasets/{dataset.id}/training-tasks",
            json={
                "node_id": node.id,
                "base_model": "Qwen/Qwen-Image-2512",
                "only_captioned": True,
            },
        )
        assert response.status_code == 202
        task_id = response.json()["id"]
        assert scheduler.get_task(task_id).status == "queued"
        assert fake.started == ["remote-job-1"]
    finally:
        app.dependency_overrides.clear()