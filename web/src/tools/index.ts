/**
 * 工具集合入口。
 *
 * 职责：
 * 1. 安装宿主 SDK（`window.DatasetToolkit`），供外部工具复用宿主依赖；
 * 2. 注册全部内置工具；
 * 3. 汇总导出注册中心、加载器与 Hooks。
 *
 * 工具来源分两类：
 * - 内置（builtin）：随主程序打包，在此静态导入并注册；
 * - 外部（external）：不参与构建，运行时由 {@link loadExternalTools} 动态注入
 *   （见 ComfyUI 式扩展机制）。
 */
import { installHostSDK } from "./host";
import { registerTool } from "./registry";
import { frameExtractionTool } from "./builtin/frameExtractionTool";
import { imageStatsTool } from "./builtin/imageStatsTool";

// 必须在任何外部工具加载前安装宿主 SDK。
installHostSDK();

/** 注册全部内置工具。幂等：重复调用不会产生重复项。 */
export function registerBuiltinTools(): void {
  registerTool(frameExtractionTool);
  registerTool(imageStatsTool);
}

// 模块加载即注册内置工具，宿主 import 本模块后即可查询。
registerBuiltinTools();

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
export { installHostSDK, HOST_API_VERSION } from "./host";
export { ToolsModal } from "./ToolsModal";
