# 插件开发模板（Dataset Toolkit Plugin）

这是一个**独立于主程序**的插件开发项目模板。工具（Tool）以插件形式开发、
构建、打包，最终把产物目录丢进后端的 `app/plugins/` 即可**自动注册并使用**，
无需改动或重新构建主程序。

## 插件结构（构建产物）

一个插件是 `app/plugins/<id>/` 下的一个目录，包含：

| 文件 | 必需 | 说明 |
| --- | --- | --- |
| `manifest.json` | 是 | 元信息：`id / name / description / scopes / ui / entry / backend` |
| `index.js` | 是 | 前端模块，浏览器动态加载，通过 `window.DatasetToolkit` 自注册 |
| `handler.py` | 否 | 后端处理逻辑，前端统一经 `POST /api/tools/{id}/invoke` 调用 |

### manifest 字段

- `id`：全局唯一，例如 `example.hello`。
- `scopes`：适用范围数组，取值 `"video" | "image" | "global"`，决定工具出现在哪些库的「工具集合」。
- `ui`：`"modal"`（弹窗）或 `"page"`（独立整页路由 `/tools/:id`）。
- `entry`：前端入口文件名，默认 `index.js`。
- `backend`：后端处理文件名，默认 `handler.py`（存在才启用后端）。

## 前端契约

前端不打包 React/antd，而是复用宿主通过全局 `window.DatasetToolkit` 暴露的能力：

```js
const { React, antd, icons, api, invokeTool, registerTool } = window.DatasetToolkit;
```

调用后端统一走 `invokeTool(toolId, action, payload)`（对应 `POST /api/tools/{id}/invoke`）。

## 后端契约

`handler.py` 需暴露：

```python
def invoke(action: str, payload: dict, service) -> Any:
    ...
```

`service` 是宿主的 `DatasetService`，插件借此复用数据层（列视频/图片、增删改等），
无需直连数据库。返回值需可 JSON 序列化。

## 开发与打包

```powershell
npm install          # 安装 esbuild
npm run build        # 构建到 dist/（含 index.js + manifest.json + handler.py）
```

把 `dist/` 目录复制到主程序的 `app/plugins/<id>/`，前端点「刷新扩展」或刷新页面即可看到新工具。

> 安全说明：`handler.py` 会以主进程权限执行（与 ComfyUI 自定义节点相同的信任模型），
> 仅安装可信来源的插件。
