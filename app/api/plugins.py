"""插件（Plugin）发现、加载与统一调用。

设计目标（对齐 ComfyUI 式自定义扩展）：

- 插件是「打包后可丢进目录即用」的独立单元，主程序不内置任何具体工具。
- 每个插件位于 :data:`PLUGINS_DIR` （``app/plugins/<id>/``）下，包含：

  * ``manifest.json``：元信息（id / name / description / scopes / ui / entry / backend）。
  * ``index.js``：前端模块，运行时由浏览器原生 ``import()`` 加载，
    通过全局 ``window.DatasetToolkit`` 自注册（不参与主程序打包）。
  * ``handler.py``（可选）：后端处理逻辑。前端统一通过
    ``POST /api/tools/{id}/invoke`` 调用，服务器动态导入该模块并执行。

统一调用契约：``handler.py`` 需暴露::

    def invoke(action: str, payload: dict, service) -> Any: ...

``action`` 由前端约定，``payload`` 为任意 JSON，``service`` 为宿主
:class:`~app.services.api.DatasetService`，插件借此复用数据层能力。

安全说明：动态导入会以主进程权限执行插件代码（与 ComfyUI 自定义节点相同的
信任模型）。因此仅应安装可信插件；加载严格限制在 :data:`PLUGINS_DIR` 之内，
``tool_id`` 必须匹配已发现的插件目录，杜绝路径穿越。
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType
from typing import Any

# 插件根目录：位于后端包内，随后端一起部署。
PLUGINS_DIR = Path(__file__).resolve().parents[1] / "plugins"


class PluginError(Exception):
    """插件发现或执行阶段的统一异常。"""


def _read_manifest(folder: Path) -> dict[str, Any] | None:
    """读取并校验单个插件目录的 manifest；损坏或缺失时返回 None。"""
    manifest = folder / "manifest.json"
    if not folder.is_dir() or not manifest.exists():
        return None
    try:
        meta = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(meta, dict):
        return None
    plugin_id = meta.get("id") or folder.name
    entry = meta.get("entry", "index.js")
    backend = meta.get("backend", "handler.py")
    has_backend = bool(backend) and (folder / backend).exists()
    # selection：工具作用形态 single/multi，可为字符串或数组，规范化为列表。
    raw_selection = meta.get("selection", ["single", "multi"])
    if isinstance(raw_selection, str):
        selection = [raw_selection]
    elif isinstance(raw_selection, list):
        selection = [str(s) for s in raw_selection if s in ("single", "multi")]
    else:
        selection = ["single", "multi"]
    if not selection:
        selection = ["single", "multi"]
    return {
        "id": plugin_id,
        "name": meta.get("name", plugin_id),
        "description": meta.get("description", ""),
        "scopes": meta.get("scopes", ["global"]),
        "selection": selection,
        "ui": meta.get("ui", "modal"),
        "entry": f"/api/tool-assets/{folder.name}/{entry}",
        "has_backend": has_backend,
        # 仅供内部使用（不下发前端）。
        "_folder": folder.name,
        "_backend_file": backend if has_backend else None,
    }


def discover_plugins() -> list[dict[str, Any]]:
    """扫描插件目录，返回可下发前端的插件清单（不含内部字段）。"""
    PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
    plugins: list[dict[str, Any]] = []
    for folder in sorted(PLUGINS_DIR.iterdir()):
        meta = _read_manifest(folder)
        if meta is None:
            continue
        plugins.append({k: v for k, v in meta.items() if not k.startswith("_")})
    return plugins


def _find_plugin(tool_id: str) -> dict[str, Any]:
    """按 id 定位已发现的插件，携带内部字段；不存在则抛 PluginError。"""
    PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
    for folder in sorted(PLUGINS_DIR.iterdir()):
        meta = _read_manifest(folder)
        if meta is not None and meta["id"] == tool_id:
            return meta
    raise PluginError(f"插件不存在: {tool_id}")


# 已加载后端模块缓存：key=插件目录名，value=模块对象。
_handler_cache: dict[str, ModuleType] = {}


def _load_handler(meta: dict[str, Any]) -> ModuleType:
    """动态导入插件 handler.py（带缓存）。严格限制在插件目录内。"""
    folder_name = meta["_folder"]
    backend_file = meta["_backend_file"]
    if not backend_file:
        raise PluginError(f"插件未提供后端处理逻辑: {meta['id']}")
    cached = _handler_cache.get(folder_name)
    if cached is not None:
        return cached

    handler_path = (PLUGINS_DIR / folder_name / backend_file).resolve()
    # 防路径穿越：handler 必须落在插件目录内。
    plugin_root = (PLUGINS_DIR / folder_name).resolve()
    if plugin_root not in handler_path.parents and handler_path != plugin_root:
        raise PluginError(f"插件后端路径非法: {meta['id']}")
    if not handler_path.exists():
        raise PluginError(f"插件后端文件缺失: {meta['id']}")

    module_name = f"dataset_plugin_{folder_name.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(module_name, handler_path)
    if spec is None or spec.loader is None:
        raise PluginError(f"无法加载插件后端: {meta['id']}")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as exc:  # noqa: BLE001 - 插件代码异常需转成统一错误
        raise PluginError(f"插件后端加载失败: {meta['id']}: {exc}") from exc
    _handler_cache[folder_name] = module
    return module


def invoke_plugin(
    tool_id: str, action: str, payload: dict[str, Any], service: Any
) -> Any:
    """统一调用入口：定位插件 → 加载 handler → 执行 ``invoke``。

    返回 handler 的返回值（应为可 JSON 序列化的数据）。任何异常都会被
    包装成 :class:`PluginError` 上抛，由路由层映射为 HTTP 错误。
    """
    meta = _find_plugin(tool_id)
    module = _load_handler(meta)
    invoke_fn = getattr(module, "invoke", None)
    if not callable(invoke_fn):
        raise PluginError(f"插件后端未定义 invoke(action, payload, service): {tool_id}")
    try:
        return invoke_fn(action, payload, service)
    except PluginError:
        raise
    except Exception as exc:  # noqa: BLE001 - 统一包装插件运行期异常
        raise PluginError(f"插件执行失败: {tool_id}.{action}: {exc}") from exc


def clear_handler_cache() -> None:
    """清空后端 handler 缓存（用于热更新/测试）。"""
    _handler_cache.clear()
