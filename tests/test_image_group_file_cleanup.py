from pathlib import Path

from app.api.app import _delete_unreferenced_managed_images


def test_cleanup_deletes_only_unreferenced_managed_files(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    managed = tmp_path / "workspace" / "images"
    managed.mkdir(parents=True)
    removable = managed / "remove.jpg"
    shared = managed / "shared.jpg"
    external = tmp_path / "external.jpg"
    for path in (removable, shared, external):
        path.write_bytes(b"image")

    deleted = _delete_unreferenced_managed_images(
        [str(removable), str(shared), str(external)],
        {str(shared)},
    )

    assert deleted == 1
    assert not removable.exists()
    assert shared.exists()
    assert external.exists()