/**
 * 宿主 SDK（Host SDK）。
 *
 * 参考 ComfyUI 的自定义节点/扩展机制：外部工具不参与前端构建，而是在
 * 运行时由浏览器以原生 ES 模块加载。为了让这些「不经过打包」的模块能够
 * 复用宿主的 React、antd、图标与 API 客户端（尤其必须共用同一份 React
 * 实例，避免 hooks 崩溃），宿主在启动时把这些能力挂到全局
 * `window.DatasetToolkit` 上。外部工具通过该全局对象拿到依赖并调用
 * `registerTool` 注册自身。
 */
import * as React from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  List,
  Modal,
  Progress,
  Radio,
  Result,
  Row,
  Segmented,
  Select,
  Slider,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
  notification,
} from "antd";
import {
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  FileOutlined,
  FolderOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  ScissorOutlined,
  SettingOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { api } from "@/api/client";
import { registerTool, unregisterTool } from "./registry";

/** 宿主 SDK 版本。外部工具可据此做兼容性判断。 */
export const HOST_API_VERSION = "1.2.0";

/**
 * 统一工具后端调用接口。插件通过它调用自身 handler.py 暴露的处理逻辑：
 * `POST /api/tools/{toolId}/invoke`，body 为 `{ action, payload }`。
 * 返回 handler 的 JSON 结果；失败时抛出带后端 detail 的 Error。
 */
export async function invokeTool<T = unknown>(
  toolId: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`/api/tools/${encodeURIComponent(toolId)}/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body && body.detail) detail = body.detail;
    } catch {
      // 保留默认 detail
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

/**
 * 暴露给外部工具的 antd 组件精选集。为保留 tree-shaking、控制体积，仅提供
 * 常用组件；如需更多能力，外部工具可用 `React.createElement` 自行组合。
 */
const antd = {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  List,
  Modal,
  Progress,
  Radio,
  Result,
  Row,
  Segmented,
  Select,
  Slider,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
  notification,
};

/**
 * 统一的全屏工具弹框外壳（Tool Modal Shell）。
 *
 * 平台层约定：所有工具弹框（`ui: "modal"`）都应套用同一套全屏样式，工具本身
 * 只负责定义壳内容。样式与「视频抽帧」保持一致：占满视口、顶部对齐、无圆角、
 * 内容区自适应滚动。工具通过 `toolkit.ToolModalShell` 复用它，避免各自复制
 * Modal 配置导致风格漂移。
 *
 * props：
 *   - `open` / `onClose`：弹框开合（对接 `ToolLaunchProps`）。
 *   - `title`：标题栏内容（字符串或 ReactNode）。
 *   - `extra`：可选，渲染在标题右侧的操作区（如全局按钮）。
 *   - `children`：壳内容，由各工具自定义。
 */
export interface ToolModalShellProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  extra?: React.ReactNode;
  children?: React.ReactNode;
}

function ToolModalShell(props: ToolModalShellProps): React.ReactElement {
  const header = props.extra
    ? React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            paddingRight: 32,
          },
        },
        React.createElement("span", null, props.title),
        React.createElement("div", { onClick: (e: React.MouseEvent) => e.stopPropagation() }, props.extra),
      )
    : props.title;
  return React.createElement(
    Modal,
    {
      title: header,
      open: props.open,
      onCancel: props.onClose,
      footer: null,
      width: "100vw",
      destroyOnClose: true,
      maskClosable: false,
      keyboard: false,
      style: { top: 0, maxWidth: "100vw", margin: 0, paddingBottom: 0 },
      styles: {
        content: { height: "100vh", display: "flex", flexDirection: "column", borderRadius: 0 },
        body: { flex: 1, overflowY: "auto", overflowX: "hidden", paddingTop: 4 },
      },
    },
    props.children,
  );
}

/**
 * 暴露给外部工具的常用图标集合。为控制打包体积仅提供精选图标；
 * 外部工具亦可用 `React.createElement("svg", ...)` 自绘任意图标。
 */
const icons = {
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  FileOutlined,
  FolderOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  ScissorOutlined,
  SettingOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  VideoCameraOutlined,
};

export interface DatasetToolkitGlobal {
  version: string;
  /** 宿主 React 实例（外部工具必须复用，切勿自带）。 */
  React: typeof React;
  /** antd 组件精选集。 */
  antd: typeof antd;
  /** 精选图标集合。 */
  icons: typeof icons;
  /** REST 客户端。 */
  api: typeof api;
  /** `React.createElement` 快捷方式。 */
  h: typeof React.createElement;
  /** 统一的全屏工具弹框外壳（工具只需提供壳内容）。 */
  ToolModalShell: typeof ToolModalShell;
  /** 统一工具后端调用接口。 */
  invokeTool: typeof invokeTool;
  /** 注册工具。 */
  registerTool: typeof registerTool;
  /** 注销工具。 */
  unregisterTool: typeof unregisterTool;
}

declare global {
  // eslint-disable-next-line no-var
  var DatasetToolkit: DatasetToolkitGlobal | undefined;
}

/** 安装宿主 SDK 到全局。幂等，可安全多次调用。 */
export function installHostSDK(): void {
  if (globalThis.DatasetToolkit) return;
  globalThis.DatasetToolkit = {
    version: HOST_API_VERSION,
    React,
    antd,
    icons,
    api,
    h: React.createElement,
    ToolModalShell,
    invokeTool,
    registerTool,
    unregisterTool,
  };
}
