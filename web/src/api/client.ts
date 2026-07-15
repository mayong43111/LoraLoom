/**
 * REST 客户端。
 *
 * 封装 fetch，统一基地址、错误处理与查询参数拼接。所有页面通过此模块
 * 访问后端，切换后端地址只需调整 {@link API_BASE}（默认走 Vite 代理的 /api）。
 */

import type {
  DatasetStats,
  DownloadTask,
  EnumMetadata,
  FrameJob,
  ImageFilterParams,
  ImageModel,
  ImportBatch,
  PersonCluster,
  Selection,
} from "./types";

const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch {
      /* 忽略非 JSON 错误体 */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  getEnumMetadata: () => request<EnumMetadata>("/meta/enums"),
  getStats: () => request<DatasetStats>("/stats"),
  listImportBatches: () => request<ImportBatch[]>("/import-batches"),
  listDownloads: () => request<DownloadTask[]>("/downloads"),
  listImages: (filter: ImageFilterParams = {}) =>
    request<ImageModel[]>(
      `/images${buildQuery(filter as Record<string, string | undefined>)}`,
    ),
  getImage: (imageId: string) => request<ImageModel>(`/images/${imageId}`),
  listFrameJobs: () => request<FrameJob[]>("/frame-jobs"),
  listPeople: () => request<PersonCluster[]>("/people"),
  listReviewQueue: (onlyUnreviewed = true) =>
    request<ImageModel[]>(
      `/review-queue${buildQuery({ only_unreviewed: String(onlyUnreviewed) })}`,
    ),
  updateAnnotation: (
    imageId: string,
    payload: { orientation?: string; usability?: string },
  ) =>
    request<ImageModel>(`/images/${imageId}/annotation`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  listSelections: () => request<Selection[]>("/selections"),
  getSelection: (selectionId: string) =>
    request<Selection>(`/selections/${selectionId}`),
};
