/**
 * 工具（Tool）类型定义。
 *
 * 「工具集合」中的每个工具都是一个完全独立的个体：它自带固定的显示
 * 名称、描述文字、图标与适用范围，并通过注册机制加入平台。工具的实现
 * 与视频库本身解耦，未来可由外部动态注入（例如运行时下载后调用
 * `registerTool` 注册）。
 */
import type { ReactNode } from "react";
import type { ImageModel, Video } from "@/api/types";

/** 工具适用范围。决定工具会出现在哪些资源的「工具集合」入口中。 */
export type ToolScope = "video" | "image" | "global";

/** 工具作用形态：single=单资源工具，multi=多资源/分组工具。 */
export type ToolSelection = "single" | "multi";

/**
 * 工具启动时的作用目标。由资源行 / 分组 / 批量选择等入口注入，工具据此
 * 直接作用于指定对象，无需再在面板内手动挑选。
 * - 单资源作为单元素数组传入；
 * - 多工具可混合传入若干资源 id 与分组 id。
 */
export interface ToolTarget {
  scope: "image" | "video";
  /** 作用形态：single（单资源）/ multi（多资源或分组）。 */
  selection: ToolSelection;
  imageIds?: string[];
  videoIds?: string[];
  groupIds?: string[];
}

/**
 * 工具运行时上下文。宿主页面在启动工具时注入，供工具读取当前资源、
 * 完成后回调刷新等。不同 scope 的字段按需填充。
 */
export interface ToolContext {
  /** 当前可作用的视频列表（scope 含 "video" 时提供）。 */
  videos?: Video[];
  /** 当前可作用的图片列表（scope 含 "image" 时提供）。 */
  images?: ImageModel[];
  /** 由资源行 / 分组 / 批量入口启动时携带的明确作用目标。 */
  target?: ToolTarget;
  /** 工具执行产生数据变更后调用，请求宿主刷新。 */
  onDone: () => void;
}

/** 工具被启动后渲染面板（通常是 Modal）时收到的属性。 */
export interface ToolLaunchProps {
  open: boolean;
  onClose: () => void;
  context: ToolContext;
}

/**
 * 工具定义。每个工具单独开发并导出一个该结构，再通过 `registerTool`
 * 注册。渲染与元信息全部内聚在此，宿主无需了解工具内部实现。
 */
export interface ToolDefinition {
  /** 全局唯一 id。 */
  id: string;
  /** 固定显示名称。 */
  name: string;
  /** 固定描述文字。 */
  description: string;
  /** 固定图标。 */
  icon: ReactNode;
  /** 适用范围。 */
  scopes: ToolScope[];
  /**
   * 作用形态：single=单资源工具，multi=多资源/分组工具。可同时支持两者。
   * 未声明时默认同时适用于 single 与 multi（向后兼容）。
   */
  selections?: ToolSelection[];
  /** 是否可用。为 false 时卡片置灰不可点击。默认 true。 */
  enabled?: boolean;
  /** 来源标记，便于区分内置与外部动态注入的工具。默认 "builtin"。 */
  source?: "builtin" | "external";
  /**
   * 前端形态：
   * - "modal"（默认）：在「工具集合」内以弹窗面板启动；
   * - "page"：跳转到独立整页路由 `/tools/:id` 承载。
   */
  ui?: "modal" | "page";
  /** 启动后渲染的交互面板。 */
  launch: (props: ToolLaunchProps) => ReactNode;
}
