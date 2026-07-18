# 图片数据集管理平台

基于设计文档 [DESIGN.md](DESIGN.md) 与 [UI_DESIGN.md](UI_DESIGN.md) 实现的
Web 应用（前后端分离）。

当前阶段：正式页面骨架 + 模拟服务（mock API）。前端通过 REST 访问后端，
后端由服务层抽象接口 `DatasetService` 提供数据，当前实现为 `MockDatasetService`
（确定性样例数据）。后续将其替换为接入 SQLite + 算法管线的真实实现，
前端与路由层均无需改动。

## 技术栈

- 后端：Python 3.10+（已在 3.14 上验证）、FastAPI、uvicorn。
- 前端：React 18 + TypeScript + Vite + Ant Design。

## 架构

```
浏览器 (React/AntD)  ──HTTP/JSON──▶  FastAPI 路由层  ──▶  DatasetService 抽象
                                                          ├─ MockDatasetService（当前）
                                                          └─ 真实后端（后续，SQLite+算法）
```

- 前端仅依赖 `/api` REST 契约与 `/api/meta/enums` 下发的枚举展示名，与后端实现松耦合。
- 枚举以字符串取值传输，中文展示名单点来自后端，避免前后端重复维护。
- 服务 ↔ API 的唯一装配点在 [app/api/deps.py](app/api/deps.py)，切换真实后端只改此处。

## 目录结构

```
app/
  domain/            领域模型与枚举（无 UI / 存储依赖）
    enums.py
    models.py
  services/          服务层：抽象接口 + mock 实现
    api.py             DatasetService 抽象接口 + 筛选条件
    mock_data.py       确定性样例数据工厂
    mock_service.py
  api/               HTTP API 层
    serialization.py   领域对象 → JSON + 枚举元信息
    deps.py            服务依赖注入（唯一装配点）
    app.py             FastAPI 应用与路由
web/                 前端应用
  src/
    api/               REST client、类型、枚举标签、请求 Hook
    components/         共享组件（EnumTag、Thumbnail、Placeholder 等）
    layout/            应用外壳（侧栏 + 顶栏）
    pages/             12 个页面
    nav.ts / colors.ts / theme.ts
tests/
  test_mock_service.py 领域/服务层单元测试
```

## 运行

Azure A100 上的 Qwen-Image LoRA 训练、监控和关机流程见
[A100_TRAINING_RUNBOOK.md](A100_TRAINING_RUNBOOK.md)。

需两个终端：后端 API 与前端 dev server。

后端：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.api.app:app --port 8000
```

前端（另开终端）：

```powershell
cd web
npm install
npm run dev
```

浏览器打开 http://localhost:5173 。前端通过 Vite 代理将 `/api` 转发到后端 8000 端口。

## MVP 范围与占位

MVP 页面：概览、导入、下载、图片库、视频抽帧、质量、人物、复核、组包、
导出（JSONL/CSV）、设置。

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
