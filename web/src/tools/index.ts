/**
 * 工具集合入口。
 *
 * 汇总并注册所有内置工具，导出注册中心 API。新增内置工具时，在此
 * 导入其定义并调用 `registerTool` 即可；外部动态注入的工具则在加载后
 * 自行调用 `registerTool`。
 */
import { registerTool } from "./registry";
import { frameExtractionTool } from "./builtin/frameExtractionTool";

/** 注册全部内置工具。幂等：重复调用不会产生重复项。 */
export function registerBuiltinTools(): void {
  registerTool(frameExtractionTool);
}

// 模块加载即注册内置工具，宿主 import 本模块后即可查询。
registerBuiltinTools();

export * from "./types";
export { registerTool, unregisterTool, getTool, getTools } from "./registry";
