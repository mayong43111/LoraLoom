/**
 * 工具集合入口。
 *
 * 职责：
 * 1. 安装宿主 SDK（`window.DatasetToolkit`），供插件复用宿主依赖；
 * 2. 汇总导出注册中心、加载器与 Hooks。
 *
 * 工具全部以「插件」形式提供，主程序不再内置任何具体工具：插件位于后端
 * `app/plugins/` 目录，运行时由 {@link loadExternalTools} 动态注入（ComfyUI 式
 * 扩展机制）。打包好的插件丢进该目录即自动注册。
 */
import { installHostSDK } from "./host";

// 必须在任何插件加载前安装宿主 SDK。
installHostSDK();

export * from "./types";
export {
  registerTool,
  unregisterTool,
  getTool,
  getTools,
  subscribeTools,
} from "./registry";
export { loadExternalTools } from "./loader";
export type { ExternalToolManifest, ExternalLoadResult } from "./loader";
export { useTools, useExternalTools } from "./hooks";
export type { ExternalToolsState } from "./hooks";
export { installHostSDK, HOST_API_VERSION, invokeTool } from "./host";
export { ToolsModal } from "./ToolsModal";
export { ToolPage } from "./ToolPage";
