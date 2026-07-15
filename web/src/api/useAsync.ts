/**
 * 轻量数据请求 Hook。
 *
 * 以最小依赖实现常见的「加载 / 成功 / 失败 / 重取」状态机，避免为一个
 * 中等规模应用引入额外的数据请求库。返回值包含数据、错误、加载态与
 * 手动 refetch 方法。
 */

import { useCallback, useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

export function useAsync<T>(
  factory: () => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // factory 由调用方通过 deps 控制身份，这里仅在 deps/nonce 变化时执行。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(factory, deps);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    run()
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [run, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, refetch };
}
