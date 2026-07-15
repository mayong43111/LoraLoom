import { Alert, Spin } from "antd";
import type { ReactNode } from "react";
import type { AsyncState } from "@/api/useAsync";

interface AsyncBoundaryProps<T> {
  state: AsyncState<T>;
  children: (data: T) => ReactNode;
}

/** 统一处理数据请求的加载态与错误态，成功后渲染 children。 */
export function AsyncBoundary<T>({ state, children }: AsyncBoundaryProps<T>) {
  if (state.loading && state.data === undefined) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 64 }}>
        <Spin />
      </div>
    );
  }
  if (state.error) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载失败"
        description={state.error.message}
        style={{ margin: 24 }}
      />
    );
  }
  if (state.data === undefined) {
    return null;
  }
  return <>{children(state.data)}</>;
}
