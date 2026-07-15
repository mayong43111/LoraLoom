/**
 * 工具相关 React Hooks。
 *
 * `useTools` 订阅注册表，异步注入新工具时自动重渲染；`useExternalTools`
 * 触发外部工具加载并暴露加载状态与「刷新扩展」能力。
 */
import { useCallback, useEffect, useReducer, useState } from "react";
import { getTools, subscribeTools } from "./registry";
import { loadExternalTools } from "./loader";
import type { ExternalLoadResult } from "./loader";
import type { ToolDefinition, ToolScope } from "./types";

/** 按适用范围订阅工具列表，注册表变化时自动更新。 */
export function useTools(scope?: ToolScope): ToolDefinition[] {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeTools(force), []);
  return getTools(scope);
}

export interface ExternalToolsState {
  loading: boolean;
  result: ExternalLoadResult | null;
  /** 强制重新拉取清单并注入（用于「刷新扩展」）。 */
  reload: () => void;
}

/** 加载外部工具并暴露状态与刷新入口。 */
export function useExternalTools(): ExternalToolsState {
  const [state, setState] = useState<{
    loading: boolean;
    result: ExternalLoadResult | null;
  }>({ loading: true, result: null });

  const reload = useCallback(() => {
    setState({ loading: true, result: null });
    loadExternalTools(true).then((result) =>
      setState({ loading: false, result }),
    );
  }, []);

  useEffect(() => {
    let alive = true;
    loadExternalTools().then((result) => {
      if (alive) setState({ loading: false, result });
    });
    return () => {
      alive = false;
    };
  }, []);

  return { ...state, reload };
}
