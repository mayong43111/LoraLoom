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
export const HOST_API_VERSION = "1.0.0";

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
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
  notification,
};

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
    registerTool,
    unregisterTool,
  };
}
