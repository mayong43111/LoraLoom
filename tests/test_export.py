from __future__ import annotations

import yaml

from app.services.export import (
    BASE_MODELS,
    ExportOptions,
    TRAINING_PRESETS,
    build_aitoolkit_config,
    resolve_hyperparams,
)


def _build_process(base_model: str) -> dict:
    opts = ExportOptions(base_model=base_model, trigger_word="zxqv")
    hyperparams = resolve_hyperparams(opts, image_count=20, auto_resolution=[1024])
    config = yaml.safe_load(build_aitoolkit_config("test dataset", opts, hyperparams))
    return config["config"]["process"][0]


def test_krea_2_raw_is_available_as_base_model() -> None:
    assert any(model["value"] == "krea/Krea-2-Raw" for model in BASE_MODELS)


def test_krea_2_raw_uses_krea2_training_profile() -> None:
    process = _build_process("krea/Krea-2-Raw")

    assert process["model"] == {
        "name_or_path": "krea/Krea-2-Raw",
        "arch": "krea2",
        "quantize": True,
        "quantize_te": True,
    }
    assert process["train"]["lr"] == 3e-4
    assert process["train"]["timestep_type"] == "linear"
    assert process["sample"]["guidance_scale"] == 3.5
    assert process["sample"]["sample_steps"] == 52


def test_qwen_export_profile_is_unchanged() -> None:
    process = _build_process("Qwen/Qwen-Image-2512")

    assert process["model"] == {
        "name_or_path": "Qwen/Qwen-Image-2512",
        "arch": "qwen_image",
        "quantize": True,
    }
    assert process["train"]["lr"] == 1e-4
    assert "timestep_type" not in process["train"]
    assert process["sample"]["guidance_scale"] == 4
    assert process["sample"]["sample_steps"] == 25


def test_explicit_learning_rate_overrides_model_profile() -> None:
    opts = ExportOptions(
        base_model="krea/Krea-2-Raw",
        preset="style",
        learning_rate=7e-5,
    )

    hyperparams = resolve_hyperparams(opts, image_count=20, auto_resolution=[1024])

    assert hyperparams["lr"] == 7e-5


def test_training_presets_define_complete_recommendations() -> None:
    for preset in TRAINING_PRESETS.values():
        assert preset["rank"] > 0
        assert preset["steps_per_image"] > 0
        assert preset["lr"] > 0
        assert preset["min_steps"] <= preset["max_steps"]
        assert preset["trigger_word"]
        assert preset["sample_prompts"]