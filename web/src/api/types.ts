/**
 * 与后端领域模型对应的 TypeScript 类型。
 *
 * 约定：所有枚举字段以字符串取值传输（如 orientation: "front"），
 * 中文展示名通过 {@link ../api/labels} 从 /api/meta/enums 获取，
 * 因此这里统一用 string 作为枚举字段类型，避免前后端重复维护取值集合。
 */

export interface DatasetStats {
  image_total: number;
  image_candidate: number;
  image_reviewed: number;
  image_exportable: number;
  image_rejected: number;
  person_total: number;
  person_confirmed: number;
  unknown_faces: number;
  suspected_duplicates: number;
  orientation_distribution: Record<string, number>;
  quality_distribution: Record<string, number>;
  pending_frame: number;
  pending_quality: number;
  pending_face: number;
  pending_review: number;
}

export interface ImportBatch {
  id: string;
  name: string;
  type: string;
  status: string;
  input_count: number;
  image_count: number;
  frame_task_count: number;
  error_count: number;
  created_at: string;
}

export interface QualityMetrics {
  blur_score: number;
  brightness: number;
  saturation: number;
  entropy: number;
  duplicate_group: string | null;
}

export interface ImageModel {
  id: string;
  image_path: string;
  sha256: string;
  width: number;
  height: number;
  quality_score: number;
  quality_flags: string[];
  quality_metrics: QualityMetrics | null;
  orientation: string;
  face_completeness: string;
  subject_type: string;
  primary_subject_id: string | null;
  person_count: number;
  usability: string;
  review_status: string;
  status: string;
  asset_id: string | null;
  frame_target_timestamp: number | null;
  frame_actual_timestamp: number | null;
  thumbnail_hint: string;
  title: string;
  group_id: string | null;
  tags: string[];
  created_at: string;
}

export interface PersonCluster {
  id: string;
  display_name: string;
  entity_type: string;
  representative_face_id: string | null;
  status: string;
  image_count: number;
  face_count: number;
  front_count: number;
  side_count: number;
  back_count: number;
  suspected_duplicate_of: string | null;
}

export interface DownloadTask {
  id: string;
  title: string;
  tool: string;
  quality: string;
  status: string;
  progress: number;
  speed: string;
  output_path: string;
  error: string;
}

export interface FrameResult {
  target_timestamp: number;
  actual_timestamp: number | null;
  status: string;
  quality_score: number | null;
  image_id: string | null;
}

export interface FrameJob {
  id: string;
  video_id: string;
  video_name: string;
  duration: number;
  interval: number;
  progress: number;
  frames: FrameResult[];
}

export interface Video {
  id: string;
  title: string;
  source_type: string;
  path: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  size_bytes: number;
  status: string;
  codec: string;
  frame_interval: number;
  extracted_frame_count: number;
  source_download_id: string | null;
  thumbnail_hint: string;
  group_id: string | null;
  tags: string[];
  created_at: string;
}

export interface VideoGroup {
  id: string;
  name: string;
  description: string;
  video_count: number;
  created_at: string;
}

/** 视频库筛选参数（对应后端 VideoFilter）。 */
export interface VideoFilterParams {
  group_id?: string;
  status?: string;
  source_type?: string;
  tag?: string;
  keyword?: string;
}

/** 手动上传/登记视频的输入（对应后端 VideoCreate）。 */
export interface VideoCreatePayload {
  title: string;
  group_id?: string | null;
  tags?: string[];
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  size_bytes?: number;
  path?: string;
}

export interface SelectionRule {
  subject_type: string;
  subject_id: string;
  orientation: string;
  target_count: number;
  min_quality: number;
  require_reviewed: boolean;
  require_trainable: boolean;
  exclude_duplicates: boolean;
  key: string;
}

export interface SelectionItem {
  id: string;
  selection_id: string;
  image_id: string;
  rule_key: string;
  rank_score: number;
  locked: boolean;
}

export interface Selection {
  id: string;
  name: string;
  status: string;
  rules: SelectionRule[];
  items: SelectionItem[];
  created_at: string;
  updated_at: string;
}

/** 图片库筛选参数（对应后端 ImageFilter）。 */
export interface ImageFilterParams {
  person_id?: string;
  orientation?: string;
  usability?: string;
  review_status?: string;
  quality_flag?: string;
  group_id?: string;
  tag?: string;
  keyword?: string;
}

export interface ImageGroup {
  id: string;
  name: string;
  description: string;
  image_count: number;
  created_at: string;
}

/** 手动上传/登记图片的输入（对应后端 ImageCreate）。 */
export interface ImageCreatePayload {
  title: string;
  group_id?: string | null;
  tags?: string[];
  width?: number;
  height?: number;
  path?: string;
}

/** 单个枚举成员的元信息。 */
export interface EnumEntry {
  value: string;
  label: string;
  isMvp?: boolean;
}

export type EnumMetadata = Record<string, EnumEntry[]>;
