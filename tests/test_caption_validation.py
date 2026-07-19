from __future__ import annotations

from app.api.app import _caption_forbidden_aspects


def test_detects_disabled_clothing_and_footwear_descriptions() -> None:
    assert _caption_forbidden_aspects(
        "standing pose, black sports top, leggings, white sneakers",
        ["clothing"],
    ) == ["clothing"]
    assert _caption_forbidden_aspects(
        "站立姿势，黑色上衣，赤脚",
        ["clothing"],
    ) == ["clothing"]


def test_detects_other_disabled_character_aspects() -> None:
    caption = "woman with long hair, wearing glasses, full-body photo in a gym"

    assert _caption_forbidden_aspects(
        caption,
        ["gender", "hair", "accessories", "framing", "background"],
    ) == ["gender", "hair", "accessories", "framing", "background"]


def test_ignores_allowed_or_unrelated_descriptions() -> None:
    assert _caption_forbidden_aspects(
        "standing with hands on hips, holding a resistance band",
        ["clothing", "hair", "background"],
    ) == []


def test_detects_identity_and_appearance_dimensions() -> None:
    caption = (
        "young adult with an oval face, smiling and looking left, "
        "fair skin, athletic build, and a short beard"
    )

    assert _caption_forbidden_aspects(
        caption,
        ["age", "face", "expression", "eyes", "skin", "body", "facial_hair"],
    ) == ["age", "face", "expression", "eyes", "skin", "body", "facial_hair"]


def test_detects_capture_and_rendering_dimensions() -> None:
    caption = (
        "hands raised, low-angle photo, soft lighting, anime style, "
        "warm colors, slightly blurry image"
    )

    assert _caption_forbidden_aspects(
        caption,
        ["hands", "camera", "lighting", "style", "color", "quality"],
    ) == ["hands", "camera", "lighting", "style", "color", "quality"]


def test_detects_standalone_hair_color_and_common_locations() -> None:
    assert _caption_forbidden_aspects(
        "blonde woman standing on a beach",
        ["hair", "background"],
    ) == ["hair", "background"]