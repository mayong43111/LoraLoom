# LoraLoom（织模）

**Curate. Dispatch. Train.**

LoraLoom 是一个面向 LoRA 训练的数据集策展与任务调度平台。它负责整理图片和
Caption、生成 ai-toolkit 训练配置，并把训练集派发到一个或多个 ai-toolkit 节点。
节点负责执行训练，LoraLoom 负责节点维护、任务分发和状态跟踪。

## 技术栈

- 后端：Python 3.10+（已在 3.14 上验证）、FastAPI、SQLite、httpx。
- 前端：React 18 + TypeScript + Vite + Ant Design。
- 训练节点：ostris/ai-toolkit Web UI API。

## 架构

```
浏览器 (React/AntD)
  │ HTTP/JSON
  ▼
LoraLoom FastAPI ──▶ SQLiteDatasetService ──▶ SQLite / 本地素材
  │
  └──▶ TrainingScheduler ──HTTP/Bearer──▶ ai-toolkit 节点（一个或多个）
            ├─ 数据集上传
            ├─ Job 创建与排队
            └─ 训练状态
```

- 前端仅依赖 `/api` REST 契约与 `/api/meta/enums` 下发的枚举展示名，与后端实现松耦合。
- 枚举以字符串取值传输，中文展示名单点来自后端，避免前后端重复维护。
- 数据集与调度任务持久化在 `workspace/dataset.sqlite`。
- ai-toolkit Token 只写入本地数据库，节点查询 API 不返回 Token。
- 服务装配点位于 [app/api/deps.py](app/api/deps.py)。

## 目录结构

```
app/
  domain/            领域模型与枚举（无 UI / 存储依赖）
    enums.py
    models.py
  services/          数据集服务、SQLite 持久化、导出与训练调度
    api.py             DatasetService 抽象接口 + 筛选条件
    sqlite_service.py  SQLite 数据集服务
    export.py          ai-toolkit 训练包与配置生成
    training_scheduler.py  ai-toolkit 节点客户端与任务调度器
  api/               HTTP API 层
    serialization.py   领域对象 → JSON + 枚举元信息
    deps.py            服务依赖注入（唯一装配点）
    app.py             FastAPI 应用与路由
web/                 前端应用
  src/
    api/               REST client、类型、枚举标签、请求 Hook
    components/         共享组件（EnumTag、Thumbnail、Placeholder 等）
    layout/            应用外壳（侧栏 + 顶栏）
    pages/             数据集、训练节点、设置等页面
    nav.ts / colors.ts / theme.ts
docs/                公开设计文档
tests/                服务、导出、插件和调度 API 测试
```

## 文档

- [系统设计](docs/DESIGN.md)
- [UI 设计](docs/UI_DESIGN.md)
- [视频抽帧工具设计](docs/FRAME_EXTRACTION_DESIGN.md)

## 运行

需两个终端：后端 API 与前端 dev server。

后端：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.api.app:app --port 7777
```

前端（另开终端）：

```powershell
cd web
npm install
npm run dev
```

浏览器打开 http://localhost:7778 。前端通过 Vite 代理将 `/api` 转发到后端 7777 端口。

### Windows 桌面应用打包

桌面版使用系统 WebView2 显示 React 界面，并在应用进程内启动仅监听随机回环端口的 FastAPI。应用数据保存在 `%LOCALAPPDATA%\LoraLoom\workspace`，首次启动创建空数据库，不会写入演示数据；关闭窗口后本地服务随之退出。

```powershell
.\scripts\build-desktop.ps1
```

构建产物位于 `dist\LoraLoom\LoraLoom.exe`。可在不打开窗口的情况下验证完整打包产物：

```powershell
$check = Start-Process .\dist\LoraLoom\LoraLoom.exe -ArgumentList "--health-check" -Wait -PassThru
if ($check.ExitCode -ne 0) { throw "Desktop health check failed" }
```

## ai-toolkit 节点调度

1. 在“训练节点”页面添加 ai-toolkit Web UI 地址，例如 `http://10.0.0.5:8675`。
2. 节点启用了 `AI_TOOLKIT_AUTH` 时，填写相同 Token，然后测试连接。
3. 准备好图片数据集与 Caption 后，在数据集详情点击“发送训练任务”。
4. 选择节点、底模、训练预设和图片范围。LoraLoom 会在后台上传数据集、创建
  远端 Job 并加入训练队列。
5. 在“训练节点”页面同步远端任务状态。

节点地址必须能被 LoraLoom 后端直接访问。当前适配 ai-toolkit 官方 Web UI 的
`/api/datasets/*`、`/api/jobs` 与 Job start/status 接口。

## MVP 范围与占位

主要页面：视频库、图片库、数据集、训练节点和设置。

非 MVP、已占位并禁用的内容：

- 内置浏览器采集（第二阶段）——整页占位。
- 导出格式 COCO / YOLO / FiftyOne / CVAT / Label Studio（第二阶段）——选项禁用。
- 物品（object）主体类型（第二阶段）——设置项禁用。
- gallery-dl 图片集合下载（第二阶段）——设置项禁用。

## 设计原则

- 前端只依赖 REST 契约，不感知后端实现，便于从 mock 切换到真实后端。
- 领域模型集中在 `app/domain`，与 API、存储解耦。
- 展示令牌集中在 `web/src/theme.ts` 与 `web/src/colors.ts`，避免样式散落。
- 非 MVP 功能统一通过占位/禁用显式呈现，避免误用。
