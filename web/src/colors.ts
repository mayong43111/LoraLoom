/**
 * 枚举取值到 Ant Design Tag 颜色的映射。
 *
 * 仅承载展示用的语义色，与后端解耦：新增取值时回退为默认色即可，
 * 不会导致渲染异常。
 */

type ColorMap = Record<string, string>;

export const ORIENTATION_COLOR: ColorMap = {
  front: "green",
  side: "gold",
  back: "volcano",
  unknown: "default",
};

export const USABILITY_COLOR: ColorMap = {
  trainable: "green",
  reject: "red",
  needs_review: "gold",
};

export const REVIEW_COLOR: ColorMap = {
  auto: "default",
  reviewed: "blue",
  needs_second_review: "orange",
};

export const BATCH_COLOR: ColorMap = {
  pending: "default",
  processing: "processing",
  completed: "success",
  failed: "error",
  archived: "default",
};

export const DOWNLOAD_COLOR: ColorMap = {
  queued: "default",
  probing: "processing",
  downloading: "processing",
  postprocessing: "cyan",
  completed: "success",
  failed: "error",
  skipped: "warning",
};

export const FRAME_COLOR: ColorMap = {
  pending: "default",
  extracted: "success",
  replaced_by_neighbor: "cyan",
  skipped_no_good_frame: "warning",
  failed: "error",
};

export const PERSON_COLOR: ColorMap = {
  auto: "default",
  confirmed: "success",
  needs_merge_review: "warning",
  ignored: "default",
};

export const SELECTION_COLOR: ColorMap = {
  draft: "default",
  locked: "blue",
  exported: "success",
};

export function colorOf(map: ColorMap, value: string): string {
  return map[value] ?? "default";
}
