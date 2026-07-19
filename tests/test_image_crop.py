from __future__ import annotations

from io import BytesIO
from pathlib import Path

from fastapi import HTTPException
from PIL import Image as PILImage

from app.api import app as app_module
from app.services.api import ImageCreate
from app.services.mock_service import MockDatasetService


def _service_with_image(tmp_path: Path) -> tuple[MockDatasetService, str, Path]:
    source = tmp_path / "source.jpg"
    PILImage.new("RGB", (1000, 1600), (30, 80, 120)).save(source, "JPEG")
    service = MockDatasetService()
    image = service.create_image(
        ImageCreate(
            title="crop source",
            path=str(source),
            width=1000,
            height=1600,
        )
    )
    return service, image.id, source


def test_crop_image_creates_file_and_updates_current_reference(tmp_path: Path, monkeypatch) -> None:
    output_dir = tmp_path / "workspace" / "images"
    monkeypatch.setattr(app_module, "_IMAGE_DIR", output_dir)
    service, image_id, source = _service_with_image(tmp_path)
    payload = app_module.crop_image(
        image_id,
        {"x": 100, "y": 200, "width": 600, "height": 600},
        service,
    )

    updated = service.get_image(image_id)
    output = Path(updated.image_path)
    assert source.is_file()
    assert output.is_file()
    assert output != source
    assert (updated.width, updated.height) == (600, 600)
    assert payload["previous_path"] == str(source)
    with PILImage.open(output) as cropped:
        assert cropped.size == (600, 600)


def test_crop_image_rejects_out_of_bounds_box(tmp_path: Path, monkeypatch) -> None:
    output_dir = tmp_path / "workspace" / "images"
    monkeypatch.setattr(app_module, "_IMAGE_DIR", output_dir)
    service, image_id, source = _service_with_image(tmp_path)

    try:
        app_module.crop_image(
            image_id,
            {"x": 800, "y": 1200, "width": 600, "height": 600},
            service,
        )
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("越界裁剪应失败")
    assert service.get_image(image_id).image_path == str(source)
    assert not output_dir.exists()


def test_batch_crop_images_produces_uniform_dimensions(tmp_path: Path, monkeypatch) -> None:
    output_dir = tmp_path / "workspace" / "images"
    monkeypatch.setattr(app_module, "_IMAGE_DIR", output_dir)
    service = MockDatasetService()
    image_ids: list[str] = []
    for index, size in enumerate(((1200, 800), (700, 1400))):
        source = tmp_path / f"source-{index}.jpg"
        PILImage.new("RGB", size, (30 + index, 80, 120)).save(source, "JPEG")
        image = service.create_image(
            ImageCreate(title=source.name, path=str(source), width=size[0], height=size[1])
        )
        image_ids.append(image.id)

    payload = app_module.batch_crop_images(
        {"image_ids": image_ids, "target_width": 640, "target_height": 640},
        service,
    )

    assert len(payload["completed"]) == 2
    assert payload["failed"] == []
    for image_id in image_ids:
        updated = service.get_image(image_id)
        assert (updated.width, updated.height) == (640, 640)
        assert "批量压缩裁剪" in updated.tags
        with PILImage.open(updated.image_path) as cropped:
            assert cropped.size == (640, 640)


def test_compress_then_center_crop_rejects_upscaling() -> None:
    source = PILImage.new("RGB", (512, 768), "white")

    try:
        app_module._compress_then_center_crop(source, 768, 1024)
    except ValueError as exc:
        assert str(exc) == "原图分辨率低于目标尺寸，无法仅压缩裁剪"
    else:
        raise AssertionError("压缩裁剪不应放大低分辨率图片")


def test_batch_crop_preview_returns_exact_jpeg_without_updating_image(tmp_path: Path) -> None:
    service, image_id, source = _service_with_image(tmp_path)

    response = app_module.preview_batch_crop_image(
        image_id,
        target_width=600,
        target_height=800,
        service=service,
    )

    assert response.media_type == "image/jpeg"
    assert service.get_image(image_id).image_path == str(source)
    with PILImage.open(BytesIO(response.body)) as preview:
        assert preview.format == "JPEG"
        assert preview.size == (600, 800)


def test_batch_crop_images_reports_invalid_file_without_stopping(tmp_path: Path, monkeypatch) -> None:
    output_dir = tmp_path / "workspace" / "images"
    monkeypatch.setattr(app_module, "_IMAGE_DIR", output_dir)
    service, image_id, _ = _service_with_image(tmp_path)
    missing = service.create_image(
        ImageCreate(title="missing", path=str(tmp_path / "missing.jpg"), width=800, height=800)
    )

    payload = app_module.batch_crop_images(
        {
            "image_ids": [missing.id, image_id],
            "target_width": 512,
            "target_height": 768,
        },
        service,
    )

    assert [item["id"] for item in payload["completed"]] == [image_id]
    assert payload["failed"] == [{"image_id": missing.id, "error": "图片文件不存在"}]


def test_fit_image_crop_stays_inside_source() -> None:
    crop = app_module._fit_image_crop(40, -20, 500, 500, 1000, 1600)

    assert crop == {"x": 0, "y": 0, "width": 500, "height": 500}


def test_upscale_image_creates_file_and_updates_current_reference(tmp_path: Path, monkeypatch) -> None:
    output_dir = tmp_path / "workspace" / "images"
    monkeypatch.setattr(app_module, "_IMAGE_DIR", output_dir)
    service, image_id, source = _service_with_image(tmp_path)

    payload = app_module.upscale_image(
        image_id,
        {"target_short_side": 1200},
        service,
    )

    updated = service.get_image(image_id)
    output = Path(updated.image_path)
    assert source.is_file()
    assert output.is_file()
    assert output != source
    assert (updated.width, updated.height) == (1200, 1920)
    assert payload["previous_path"] == str(source)
    assert "分辨率提升" in updated.tags
    with PILImage.open(output) as upscaled:
        assert upscaled.size == (1200, 1920)


def test_upscale_image_rejects_target_not_above_current_size(tmp_path: Path, monkeypatch) -> None:
    output_dir = tmp_path / "workspace" / "images"
    monkeypatch.setattr(app_module, "_IMAGE_DIR", output_dir)
    service, image_id, source = _service_with_image(tmp_path)

    try:
        app_module.upscale_image(
            image_id,
            {"target_short_side": 1000},
            service,
        )
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("分辨率提升不应接受等于当前短边的目标")
    assert service.get_image(image_id).image_path == str(source)
    assert not output_dir.exists()
