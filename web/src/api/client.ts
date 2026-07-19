/**
 * REST 客户端。
 *
 * 封装 fetch，统一基地址、错误处理与查询参数拼接。所有页面通过此模块
 * 访问后端，切换后端地址只需调整 {@link API_BASE}（默认走 Vite 代理的 /api）。
 */

import type {
  AiToolkitNode,
  AiToolkitNodeInput,
  AiToolkitNodeInspection,
  DatasetStats,
  DataSourceInfo,
  Dataset,
  DatasetItems,
  DatasetType,
  DownloadTask,
  EnumMetadata,
  FrameJob,
  AnnotateResponse,
  AnnotatePayload,
  AnnotationConfig,
  ExportOptionsResponse,
  ExportPayload,
  DispatchTrainingPayload,
  ImageCreatePayload,
  ImageFilterParams,
  ImageGroup,
  ImageModel,
  BatchImageCropResult,
  ImageCropResult,
  ImageCropSuggestion,
  ImageUpscaleResult,
  ImageUpdatePayload,
  ImportBatch,
  LlmConfig,
  LlmConfigInput,
  LlmTestResult,
  PersonCluster,
  Selection,
  Video,
  VideoCreatePayload,
  VideoFilterParams,
  VideoGroup,
  VideoUpdatePayload,
  TrainingTask,
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
  getDataSource: () => request<DataSourceInfo>("/meta/source"),
  getStats: () => request<DatasetStats>("/stats"),
  listImportBatches: () => request<ImportBatch[]>("/import-batches"),
  listDownloads: () => request<DownloadTask[]>("/downloads"),
  listImages: (filter: ImageFilterParams = {}) =>
    request<ImageModel[]>(
      `/images${buildQuery(filter as Record<string, string | undefined>)}`,
    ),
  getImage: (imageId: string) => request<ImageModel>(`/images/${imageId}`),
  getImageCropSuggestion: (imageId: string, mode: "head" | "closeup") =>
    request<ImageCropSuggestion>(
      `/images/${imageId}/crop-suggestion?mode=${mode}`,
    ),
  cropImage: (
    imageId: string,
    crop: { x: number; y: number; width: number; height: number },
  ) =>
    request<ImageCropResult>(`/images/${imageId}/crop`, {
      method: "POST",
      body: JSON.stringify(crop),
    }),
  batchCropImages: (
    imageIds: string[],
    targetWidth: number,
    targetHeight: number,
  ) =>
    request<BatchImageCropResult>("/images/batch-crop", {
      method: "POST",
      body: JSON.stringify({
        image_ids: imageIds,
        target_width: targetWidth,
        target_height: targetHeight,
      }),
    }),
  upscaleImage: (imageId: string, targetShortSide: number) =>
    request<ImageUpscaleResult>(`/images/${imageId}/upscale`, {
      method: "POST",
      body: JSON.stringify({ target_short_side: targetShortSide }),
    }),
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
  deleteImageGroup: (groupId: string, deleteImages = false) =>
    request<{ deleted: string; deleted_images: number; deleted_files: number }>(
      `/image-groups/${groupId}?delete_images=${deleteImages}`,
      { method: "DELETE" },
    ),
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
  getLlmConfig: () => request<LlmConfig>("/settings/llm"),
  saveLlmConfig: (payload: LlmConfigInput) =>
    request<LlmConfig>("/settings/llm", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  testLlmConnection: () =>
    request<LlmTestResult>("/settings/llm/test", { method: "POST" }),
  listDatasets: () => request<Dataset[]>("/datasets"),
  createDataset: (payload: {
    name: string;
    type: DatasetType;
    description?: string;
    base_model: string;
  }) =>
    request<Dataset>("/datasets", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getDataset: (datasetId: string) =>
    request<Dataset>(`/datasets/${datasetId}`),
  updateDataset: (
    datasetId: string,
    payload: { name?: string; description?: string },
  ) =>
    request<Dataset>(`/datasets/${datasetId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteDataset: (datasetId: string) =>
    request<{ deleted: string }>(`/datasets/${datasetId}`, {
      method: "DELETE",
    }),
  listDatasetItems: (datasetId: string) =>
    request<DatasetItems>(`/datasets/${datasetId}/items`),
  addDatasetItems: (datasetId: string, itemIds: string[]) =>
    request<Dataset>(`/datasets/${datasetId}/items`, {
      method: "POST",
      body: JSON.stringify({ item_ids: itemIds }),
    }),
  removeDatasetItems: (datasetId: string, itemIds: string[]) =>
    request<Dataset>(`/datasets/${datasetId}/items/remove`, {
      method: "POST",
      body: JSON.stringify({ item_ids: itemIds }),
    }),
  updateDatasetItem: (
    datasetId: string,
    itemId: string,
    payload: { caption?: string; tags?: string[] },
  ) =>
    request<ImageModel | Video>(
      `/datasets/${datasetId}/items/${itemId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    ),
  annotateDatasetItems: (datasetId: string, payload: AnnotatePayload) =>
    request<AnnotateResponse>(`/datasets/${datasetId}/annotate`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getAnnotationConfig: () => request<AnnotationConfig>("/settings/annotation"),
  saveAnnotationConfig: (payload: { trigger_word: string }) =>
    request<AnnotationConfig>("/settings/annotation", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  getExportOptions: () =>
    request<ExportOptionsResponse>("/datasets/export/options"),
  listAiToolkitNodes: () =>
    request<AiToolkitNode[]>("/aitoolkit/nodes"),
  createAiToolkitNode: (payload: AiToolkitNodeInput) =>
    request<AiToolkitNode>("/aitoolkit/nodes", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateAiToolkitNode: (nodeId: string, payload: AiToolkitNodeInput) =>
    request<AiToolkitNode>(`/aitoolkit/nodes/${nodeId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteAiToolkitNode: (nodeId: string) =>
    request<void>(`/aitoolkit/nodes/${nodeId}`, { method: "DELETE" }),
  testAiToolkitNode: (nodeId: string) =>
    request<AiToolkitNodeInspection>(`/aitoolkit/nodes/${nodeId}/test`, {
      method: "POST",
    }),
  listTrainingTasks: () => request<TrainingTask[]>("/training-tasks"),
  dispatchTrainingTask: (datasetId: string, payload: DispatchTrainingPayload) =>
    request<TrainingTask>(`/datasets/${datasetId}/training-tasks`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  refreshTrainingTask: (taskId: string) =>
    request<TrainingTask>(`/training-tasks/${taskId}/refresh`, {
      method: "POST",
    }),
  exportDataset: async (
    datasetId: string,
    payload: ExportPayload,
  ): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${API_BASE}/datasets/${datasetId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
    const filename = match
      ? decodeURIComponent(match[1])
      : `${datasetId}_qwen_image_lora.zip`;
    return { blob: await res.blob(), filename };
  },
};
