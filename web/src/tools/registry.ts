/**
 * 工具注册中心。
 *
 * 维护一个进程内的工具注册表。工具通过 `registerTool` 加入，宿主页面
 * 通过 `getTools(scope)` 按适用范围查询。注册表在运行时可增删，因此
 * 支持未来的动态扩展：外部代码在加载（例如动态下载）后调用
 * `registerTool` 即可让新工具出现在「工具集合」中。
 */
import type { ToolDefinition, ToolScope } from "./types";

const registry = new Map<string, ToolDefinition>();

/** 注册一个工具。若 id 已存在则覆盖（便于热更新/重新注入）。 */
export function registerTool(tool: ToolDefinition): void {
  registry.set(tool.id, { source: "builtin", enabled: true, ...tool });
}

/** 注销一个工具。返回是否存在并被移除。 */
export function unregisterTool(id: string): boolean {
  return registry.delete(id);
}

/** 获取单个工具定义。 */
export function getTool(id: string): ToolDefinition | undefined {
  return registry.get(id);
}

/**
 * 列出工具。传入 scope 时仅返回适用范围包含该 scope 的工具；
 * 不传则返回全部。结果按名称稳定排序。
 */
export function getTools(scope?: ToolScope): ToolDefinition[] {
  const all = Array.from(registry.values());
  const filtered = scope ? all.filter((t) => t.scopes.includes(scope)) : all;
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}
