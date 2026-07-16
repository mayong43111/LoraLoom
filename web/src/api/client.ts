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
  ImageCreatePayload,
  ImageFilterParams,
  ImageGroup,
  ImageModel,
  ImageUpdatePayload,
  ImportBatch,
  PersonCluster,
  Selection,
  Video,
  VideoCreatePayload,
  VideoFilterParams,
  VideoGroup,
  VideoUpdatePayload,
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
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
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
  listImageGroups: () => request<ImageGroup[]>("/image-groups"),
  createImageGroup: (payload: { name: string; description?: string }) =>
    request<ImageGroup>("/image-groups", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateImageGroup: (
    groupId: string,
    payload: { name?: string; description?: string },
  ) =>
    request<ImageGroup>(`/image-groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteImageGroup: (groupId: string) =>
    request<void>(`/image-groups/${groupId}`, { method: "DELETE" }),
  createImage: (payload: ImageCreatePayload) =>
    request<ImageModel>("/images", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateImage: (imageId: string, payload: ImageUpdatePayload) =>
    request<ImageModel>(`/images/${imageId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  copyImage: (imageId: string, groupId: string | null) =>
    request<ImageModel>(`/images/${imageId}/copy`, {
      method: "POST",
      body: JSON.stringify({ group_id: groupId }),
    }),
  deleteImage: (imageId: string) =>
    request<void>(`/images/${imageId}`, { method: "DELETE" }),
  listFrameJobs: () => request<FrameJob[]>("/frame-jobs"),
  listVideoGroups: () => request<VideoGroup[]>("/video-groups"),
  createVideoGroup: (payload: { name: string; description?: string }) =>
    request<VideoGroup>("/video-groups", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateVideoGroup: (
    groupId: string,
    payload: { name?: string; description?: string },
  ) =>
    request<VideoGroup>(`/video-groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteVideoGroup: (groupId: string) =>
    request<void>(`/video-groups/${groupId}`, { method: "DELETE" }),
  listVideos: (filter: VideoFilterParams = {}) =>
    request<Video[]>(
      `/videos${buildQuery(filter as Record<string, string | undefined>)}`,
    ),
  getVideo: (videoId: string) => request<Video>(`/videos/${videoId}`),
  createVideo: (payload: VideoCreatePayload) =>
    request<Video>("/videos", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateVideo: (videoId: string, payload: VideoUpdatePayload) =>
    request<Video>(`/videos/${videoId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  copyVideo: (videoId: string, groupId: string | null) =>
    request<Video>(`/videos/${videoId}/copy`, {
      method: "POST",
      body: JSON.stringify({ group_id: groupId }),
    }),
  deleteVideo: (videoId: string) =>
    request<void>(`/videos/${videoId}`, { method: "DELETE" }),
  getVideoFrameJob: (videoId: string) =>
    request<FrameJob | null>(`/videos/${videoId}/frame-job`),
  extractFrames: (videoId: string, interval: number) =>
    request<FrameJob>(`/videos/${videoId}/extract-frames`, {
      method: "POST",
      body: JSON.stringify({ interval }),
    }),
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
