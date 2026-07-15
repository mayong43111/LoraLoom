/**
 * 枚举展示名上下文。
 *
 * 应用启动时拉取一次 /api/meta/enums，向全局提供「取值 → 中文名」的映射，
 * 以及生成下拉选项的辅助方法。前端各处仅依赖此上下文渲染标签，
 * 保证与后端枚举定义单点同步。
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { api } from "./client";
import { useAsync } from "./useAsync";
import type { EnumEntry, EnumMetadata } from "./types";

interface LabelsContextValue {
  meta: EnumMetadata;
  /** 返回某枚举下某取值的中文名，缺失时回退为原值。 */
  label: (enumName: string, value: string | null | undefined) => string;
  /** 返回某枚举的全部成员，用于渲染下拉/单选。 */
  entries: (enumName: string) => EnumEntry[];
}

const LabelsContext = createContext<LabelsContextValue | null>(null);

export function LabelsProvider({ children }: { children: ReactNode }) {
  const { data, loading, error } = useAsync(() => api.getEnumMetadata(), []);

  const value = useMemo<LabelsContextValue>(() => {
    const meta = data ?? {};
    const index: Record<string, Record<string, string>> = {};
    for (const [name, entries] of Object.entries(meta)) {
      index[name] = Object.fromEntries(entries.map((e) => [e.value, e.label]));
    }
    return {
      meta,
      label: (enumName, value) =>
        (value != null && index[enumName]?.[value]) || value || "-",
      entries: (enumName) => meta[enumName] ?? [],
    };
  }, [data]);

  if (loading) {
    return <div style={{ padding: 48 }}>加载元数据…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 48, color: "#ff7875" }}>
        无法连接后端服务：{error.message}
      </div>
    );
  }

  return (
    <LabelsContext.Provider value={value}>{children}</LabelsContext.Provider>
  );
}

export function useLabels(): LabelsContextValue {
  const ctx = useContext(LabelsContext);
  if (!ctx) {
    throw new Error("useLabels 必须在 LabelsProvider 内使用");
  }
  return ctx;
}
