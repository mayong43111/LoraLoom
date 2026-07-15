/**
 * 外部工具加载器。
 *
 * 参考 ComfyUI 的自定义扩展加载：向后端查询已投放的外部工具清单
 * （`GET /api/tools`），再用原生动态 `import()` 逐个加载工具模块。模块在
 * 加载时通过全局 `window.DatasetToolkit.registerTool` 自注册，随后 UI 通过
 * 注册表订阅自动出现新卡片。加载结果带幂等缓存，避免重复注入。
 *
 * 未来扩展路径：后端在 `external_tools/` 目录下放置新的工具包（manifest +
 * 已构建的 JS 模块），或从远端下载后落盘，前端「刷新扩展」即可注入，无需
 * 重新构建主程序。
 */

/** 后端返回的外部工具清单项。 */
export interface ExternalToolManifest {
  id: string;
  name: string;
  description?: string;
  scopes?: string[];
  /** 工具模块的可加载 URL（同源，经 /api 代理）。 */
  entry: string;
}

/** 一次加载的结果汇总。 */
export interface ExternalLoadResult {
  loaded: string[];
  failed: { id: string; error: string }[];
}

const importedEntries = new Set<string>();
let loadPromise: Promise<ExternalLoadResult> | null = null;

async function doLoad(): Promise<ExternalLoadResult> {
  const result: ExternalLoadResult = { loaded: [], failed: [] };

  let manifests: ExternalToolManifest[];
  try {
    const res = await fetch("/api/tools");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifests = (await res.json()) as ExternalToolManifest[];
  } catch (err) {
    result.failed.push({
      id: "*",
      error: err instanceof Error ? err.message : "获取工具清单失败",
    });
    return result;
  }

  for (const manifest of manifests) {
    if (importedEntries.has(manifest.entry)) {
      result.loaded.push(manifest.id);
      continue;
    }
    try {
      // 原生动态 import：由浏览器直接加载外部模块，绕过前端打包。
      await import(/* @vite-ignore */ manifest.entry);
      importedEntries.add(manifest.entry);
      result.loaded.push(manifest.id);
    } catch (err) {
      result.failed.push({
        id: manifest.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

/**
 * 加载全部外部工具。默认带缓存（只加载一次）；传 `force=true` 重新拉取
 * 清单并注入新工具（已加载过的模块按 URL 去重，不重复导入）。
 */
export function loadExternalTools(force = false): Promise<ExternalLoadResult> {
  if (force || !loadPromise) {
    loadPromise = doLoad();
  }
  return loadPromise;
}
