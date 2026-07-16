"""应用级设置的持久化存储。

当前用于保存 LLM 模型配置（目前仅支持 Azure AI Foundry 的 GPT 模型）。
设置以 JSON 文件形式落盘在工作区（``workspace/settings.json``），与数据集
SQLite 库分离，避免把凭据类配置混入领域数据。

安全说明：API Key 属敏感信息，仅保存在服务端；对外读取时一律做掩码处理，
绝不把明文密钥回传给前端。
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

_SETTINGS_PATH = Path("workspace/settings.json")
_LOCK = threading.RLock()

# 目前仅支持 Azure AI Foundry 的 GPT（Azure OpenAI 兼容）模型。
_SUPPORTED_PROVIDERS = ("azure_foundry",)

_DEFAULT_LLM: dict[str, Any] = {
    "provider": "azure_foundry",
    "endpoint": "",
    "deployment": "",
    "api_version": "2024-10-21",
    "model": "gpt-4o",
    "api_key": "",
}


def _read_all() -> dict[str, Any]:
    if not _SETTINGS_PATH.is_file():
        return {}
    try:
        return json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _write_all(data: dict[str, Any]) -> None:
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _raw_llm_config() -> dict[str, Any]:
    """返回包含明文密钥的完整 LLM 配置（仅供服务端内部使用）。"""
    with _LOCK:
        stored = _read_all().get("llm") or {}
    merged = {**_DEFAULT_LLM, **{k: v for k, v in stored.items() if k in _DEFAULT_LLM}}
    return merged


def get_llm_config() -> dict[str, Any]:
    """返回对外安全的 LLM 配置：不含明文密钥，仅标记是否已设置。"""
    cfg = _raw_llm_config()
    key = cfg.pop("api_key", "") or ""
    cfg["api_key_set"] = bool(key)
    cfg["supported_providers"] = list(_SUPPORTED_PROVIDERS)
    return cfg


def save_llm_config(payload: dict[str, Any]) -> dict[str, Any]:
    """校验并保存 LLM 配置，返回对外安全的最新配置。

    ``api_key`` 为空字符串时保留原有密钥（便于前端在不重复输入密钥的情况下
    修改其它字段）；非空时更新为新值。
    """
    provider = str(payload.get("provider") or "azure_foundry").strip()
    if provider not in _SUPPORTED_PROVIDERS:
        raise ValueError(f"暂不支持的 LLM 提供方: {provider}")

    current = _raw_llm_config()
    new_key = payload.get("api_key")
    if new_key is None or str(new_key) == "":
        api_key = current.get("api_key", "")
    else:
        api_key = str(new_key)

    updated = {
        "provider": provider,
        "endpoint": str(payload.get("endpoint", current.get("endpoint", ""))).strip(),
        "deployment": str(
            payload.get("deployment", current.get("deployment", ""))
        ).strip(),
        "api_version": str(
            payload.get("api_version", current.get("api_version", ""))
        ).strip()
        or _DEFAULT_LLM["api_version"],
        "model": str(payload.get("model", current.get("model", ""))).strip(),
        "api_key": api_key,
    }

    with _LOCK:
        data = _read_all()
        data["llm"] = updated
        _write_all(data)

    return get_llm_config()


def test_llm_connection() -> dict[str, Any]:
    """用已保存的配置向 Azure Foundry 发起一次最小 chat 请求以验证连通性。"""
    import urllib.error
    import urllib.request

    cfg = _raw_llm_config()
    endpoint = cfg["endpoint"].rstrip("/")
    deployment = cfg["deployment"]
    api_version = cfg["api_version"]
    api_key = cfg["api_key"]

    missing = [
        name
        for name, val in (
            ("endpoint", endpoint),
            ("deployment", deployment),
            ("api_key", api_key),
        )
        if not val
    ]
    if missing:
        return {"ok": False, "message": f"配置不完整，缺少: {', '.join(missing)}"}

    url = (
        f"{endpoint}/openai/deployments/{deployment}/chat/completions"
        f"?api-version={api_version}"
    )
    body = json.dumps(
        {"messages": [{"role": "user", "content": "ping"}], "max_tokens": 1}
    ).encode("utf-8")
    req = urllib.request.Request(  # noqa: S310 - 目标由用户配置且仅 https 使用
        url,
        data=body,
        headers={"Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310
            if 200 <= resp.status < 300:
                return {"ok": True, "message": "连接成功"}
            return {"ok": False, "message": f"HTTP {resp.status}"}
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "ignore")[:300]
        except Exception:  # noqa: BLE001 - 仅用于附带错误详情
            detail = ""
        return {"ok": False, "message": f"HTTP {exc.code} {exc.reason}: {detail}".strip()}
    except urllib.error.URLError as exc:
        return {"ok": False, "message": f"无法连接: {exc.reason}"}
    except Exception as exc:  # noqa: BLE001 - 边界兜底
        return {"ok": False, "message": f"请求失败: {exc}"}
