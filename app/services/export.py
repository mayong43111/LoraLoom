"""数据集导出为 ai-toolkit LoRA 训练包。

当前仅支持图片数据集，导出为 ai-toolkit 的 LoRA 训练素材：一个包含
``dataset/`` 目录（图片 + 同名 ``.txt`` Caption）与一份 ai-toolkit YAML
训练配置的 zip 包。触发词已写入 Caption，配置中的 ``trigger_word`` 仅作
参考记录。图片仅接受 jpg/jpeg/png，其它格式会用 Pillow 转成 png。
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

# ai-toolkit 官方支持的底模；也允许用户填写自定义模型名。
BASE_MODELS: list[dict[str, str]] = [
    {"value": "Qwen/Qwen-Image-2512", "label": "Qwen-Image-2512（推荐）"},
    {"value": "Qwen/Qwen-Image", "label": "Qwen-Image（基础版）"},
    {"value": "krea/Krea-2-Raw", "label": "Krea-2-Raw（LoRA 训练底模）"},
]

_MODEL_PROFILES: dict[str, dict[str, Any]] = {
    "krea/krea-2-raw": {
        "family": "Krea 2",
        "arch": "krea2",
        "lr": 3e-4,
        "quantize_te": True,
        "timestep_type": "linear",
        "sample_steps": 52,
        "guidance_scale": 3.5,
        "filename_family": "krea2",
    },
}


def _model_profile(base_model: str) -> dict[str, Any]:
    return _MODEL_PROFILES.get(
        base_model.strip().lower(),
        {
            "family": "Qwen-Image",
            "arch": "qwen_image",
            "filename_family": "qwen_image",
        },
    )

# 训练预设：人物形象偏过拟合（高 rank、更多步数），风格避免过拟合。
TRAINING_PRESETS: dict[str, dict[str, Any]] = {
    "character": {
        "label": "人物形象（偏过拟合）",
        "rank": 32,
        "steps_per_image": 100,
        "lr": 1e-4,
        "min_steps": 800,
        "max_steps": 4000,
    },
    "action": {
        "label": "动作 / 姿势",
        "rank": 24,
        "steps_per_image": 70,
        "lr": 1e-4,
        "min_steps": 700,
        "max_steps": 3500,
    },
    "style": {
        "label": "风格（避免过拟合）",
        "rank": 16,
        "steps_per_image": 40,
        "lr": 8e-5,
        "min_steps": 600,
        "max_steps": 2500,
    },
    "general": {
        "label": "通用",
        "rank": 16,
        "steps_per_image": 60,
        "lr": 1e-4,
        "min_steps": 600,
        "max_steps": 3000,
    },
}

_ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
_AUTO_RESOLUTION_CANDIDATES = [512, 768, 1024]


@dataclass(slots=True)
class ExportOptions:
    """导出参数。"""

    base_model: str = "Qwen/Qwen-Image-2512"
    preset: str = "character"
    trigger_word: str = ""
    rank: int | None = None
    steps: int | None = None
    steps_per_image: int | None = None
    resolution: list[int] | None = None
    sample_prompts: list[str] | None = None
    only_captioned: bool = True


def _slugify(name: str) -> str:
    """把数据集名转成适合文件名/配置名的 slug。"""
    slug = re.sub(r"[^0-9A-Za-z_-]+", "_", name.strip()).strip("_")
    return slug or "dataset"


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def _infer_auto_resolution(image_sizes: Sequence[tuple[int, int]]) -> list[int]:
    """根据图片尺寸自动选择可接受的最高分辨率（上限 1024）。

    规则：取所有图片最短边的最小值作为上限，再从候选分辨率里选不超过
    上限的最大值。若无法识别尺寸，则回退为默认多分辨率分桶。
    """
    if not image_sizes:
        return [512, 768, 1024]
    min_short_side = min(min(w, h) for w, h in image_sizes)
    allowed = [r for r in _AUTO_RESOLUTION_CANDIDATES if r <= min_short_side]
    if not allowed:
        return [512]
    return [max(allowed)]


def resolve_hyperparams(
    opts: ExportOptions,
    image_count: int,
    auto_resolution: list[int] | None = None,
) -> dict[str, Any]:
    """根据预设与用户覆盖，解析出最终的训练超参数。"""
    preset = TRAINING_PRESETS.get(opts.preset) or TRAINING_PRESETS["general"]
    model_profile = _model_profile(opts.base_model)
    rank = int(opts.rank) if opts.rank else int(preset["rank"])
    lr = float(model_profile.get("lr", preset["lr"]))
    if opts.steps:
        steps = int(opts.steps)
    else:
        per_image = int(opts.steps_per_image or preset["steps_per_image"])
        steps = _clamp(
            max(image_count, 1) * per_image,
            int(preset["min_steps"]),
            int(preset["max_steps"]),
        )
    resolution = opts.resolution or auto_resolution or [512, 768, 1024]
    return {"rank": rank, "lr": lr, "steps": steps, "resolution": resolution}


def _read_image_size(path: str) -> tuple[int, int] | None:
    """尽力读取图片尺寸，失败时返回 None。"""
    try:
        from PIL import Image as PILImage

        with PILImage.open(path) as im:
            width, height = im.size
            return int(width), int(height)
    except Exception:  # noqa: BLE001 - 尺寸识别失败时回退默认分辨率
        return None


def build_aitoolkit_config(
    name: str,
    opts: ExportOptions,
    hp: dict[str, Any],
) -> str:
    """生成 ai-toolkit LoRA 训练 YAML 配置。

    字符串标量统一用 :func:`json.dumps` 输出（JSON 字符串是合法 YAML），
    避免触发词/名称中的特殊字符破坏 YAML 结构。
    """
    slug = _slugify(name)
    model_profile = _model_profile(opts.base_model)
    rank = hp["rank"]
    steps = hp["steps"]
    lr = hp["lr"]
    resolution = ", ".join(str(int(r)) for r in hp["resolution"])
    save_every = max(int(steps // 8), 100)
    prompts = opts.sample_prompts or [
        f"{opts.trigger_word}, a portrait photo".strip(", ").strip()
        or "a portrait photo"
    ]
    prompt_lines = "\n".join(
        f"          - {json.dumps(p, ensure_ascii=False)}" for p in prompts
    )

    def q(value: str) -> str:
        return json.dumps(value, ensure_ascii=False)

    quantize_te_line = (
        "        quantize_te: true\n" if model_profile.get("quantize_te") else ""
    )
    timestep_type_line = (
        f"        timestep_type: {model_profile['timestep_type']}\n"
        if model_profile.get("timestep_type")
        else ""
    )
    sample_steps = int(model_profile.get("sample_steps", 25))
    guidance_scale = model_profile.get("guidance_scale", 4)

    return f"""---
# ai-toolkit 训练配置（{model_profile['family']} LoRA），由 LoraLoom 自动生成。
# 用法：把本目录整个放到 ai-toolkit 下，然后运行：
#   python run.py {slug}.yaml
job: extension
config:
  name: {q(slug)}
  process:
    - type: sd_trainer
      training_folder: output
      device: cuda:0
      trigger_word: {q(opts.trigger_word)}
      network:
        type: lora
        linear: {rank}
        linear_alpha: {rank}
      save:
        dtype: bf16
        save_every: {save_every}
        max_step_saves_to_keep: 4
        push_to_hub: false
      datasets:
        - folder_path: ./dataset
          caption_ext: txt
          caption_dropout_rate: 0.05
          shuffle_tokens: false
          cache_latents_to_disk: true
          resolution: [ {resolution} ]
      train:
        batch_size: 1
        steps: {steps}
        gradient_accumulation_steps: 1
        train_unet: true
        train_text_encoder: false
        gradient_checkpointing: true
        noise_scheduler: flowmatch
{timestep_type_line}        optimizer: adamw8bit
        lr: {lr}
        dtype: bf16
      model:
        name_or_path: {q(opts.base_model)}
        arch: {model_profile['arch']}
        quantize: true
{quantize_te_line}      sample:
        sampler: flowmatch
        sample_every: {save_every}
        width: 1024
        height: 1024
        prompts:
{prompt_lines}
        neg: ""
        seed: 42
        walk_seed: true
        guidance_scale: {guidance_scale}
        sample_steps: {sample_steps}
meta:
  name: {q(slug)}
  version: "1.0"
"""


def _readme(name: str, opts: ExportOptions, hp: dict[str, Any], count: int) -> str:
    slug = _slugify(name)
    preset = TRAINING_PRESETS.get(opts.preset) or TRAINING_PRESETS["general"]
    model_profile = _model_profile(opts.base_model)
    return (
        f"# {name} — {model_profile['family']} LoRA 训练包\n\n"
        f"本包由 LoraLoom 导出，面向 ai-toolkit (https://github.com/ostris/ai-toolkit)。\n\n"
        f"目录结构：\n"
        f"  {slug}.yaml       训练配置（ai-toolkit）\n"
        f"  dataset/          训练素材：图片 + 同名 .txt（Caption，触发词已写入）\n\n"
        f"参数概览：\n"
        f"  底模：{opts.base_model}\n"
        f"  预设：{preset['label']}\n"
        f"  触发词：{opts.trigger_word or '(未设置)'}\n"
        f"  图片数量：{count}\n"
        f"  LoRA rank：{hp['rank']}\n"
        f"  学习率：{hp['lr']}\n"
        f"  训练步数：{hp['steps']}\n"
        f"  分辨率分桶：{hp['resolution']}\n\n"
        f"使用步骤：\n"
        f"  1. 按官方说明安装 ai-toolkit 及依赖。\n"
        f"  2. 把本目录放到 ai-toolkit 根目录下。\n"
        f"  3. 运行：python run.py {slug}.yaml\n"
        f"  4. 训练产物默认输出到 ai-toolkit 的 output/ 目录。\n\n"
        f"注意：\n"
        f"  - Caption 已包含触发词，配置里的 trigger_word 仅作记录，不再使用 [trigger] 占位。\n"
        f"  - 具体字段名可能随 ai-toolkit 版本变化，运行前请对照你本地的示例配置核对。\n"
    )


def _prepare_image(path: str) -> tuple[bytes, str] | None:
    """读取图片；jpg/jpeg/png 原样返回，其它格式转 png。返回 (bytes, ext)。"""
    p = Path(path)
    if not p.is_file():
        return None
    ext = p.suffix.lower()
    if ext in _ALLOWED_IMAGE_EXTS:
        return p.read_bytes(), (".jpg" if ext == ".jpeg" else ext)
    # 其它格式（webp/bmp/tiff 等）转成 png，避免 ai-toolkit 不识别。
    try:
        from PIL import Image as PILImage

        with PILImage.open(p) as im:
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            return buf.getvalue(), ".png"
    except Exception:  # noqa: BLE001 - 单张失败则跳过
        return None


def build_export_zip(
    name: str,
    images: Sequence[Any],
    opts: ExportOptions,
) -> tuple[bytes, str, int]:
    """构建训练包 zip，返回 (zip 字节, 建议文件名, 实际导出图片数)。

    ``images`` 为数据集内的图片对象（需含 ``image_path``/``caption``）。
    """
    slug = _slugify(name)
    selected = list(images)
    if opts.only_captioned:
        selected = [im for im in selected if (getattr(im, "caption", "") or "").strip()]

    prepared: list[tuple[bytes, str, str]] = []  # (bytes, ext, caption)
    image_sizes: list[tuple[int, int]] = []
    for im in selected:
        image_path = getattr(im, "image_path", "") or ""
        result = _prepare_image(image_path)
        if result is None:
            continue
        data, ext = result
        caption = (getattr(im, "caption", "") or "").strip()
        prepared.append((data, ext, caption))
        size = _read_image_size(image_path)
        if size is not None:
            image_sizes.append(size)

    hp = resolve_hyperparams(
        opts,
        len(prepared),
        auto_resolution=_infer_auto_resolution(image_sizes),
    )
    config_yaml = build_aitoolkit_config(name, opts, hp)
    readme = _readme(name, opts, hp, len(prepared))

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{slug}/{slug}.yaml", config_yaml)
        zf.writestr(f"{slug}/README.txt", readme)
        width = max(len(str(len(prepared))), 4)
        for idx, (data, ext, caption) in enumerate(prepared, start=1):
            base = f"img_{idx:0{width}d}"
            zf.writestr(f"{slug}/dataset/{base}{ext}", data)
            zf.writestr(f"{slug}/dataset/{base}.txt", caption)

    family = _model_profile(opts.base_model)["filename_family"]
    return buf.getvalue(), f"{slug}_{family}_lora.zip", len(prepared)
