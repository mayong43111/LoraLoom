/**
 * 图片库页面。
 *
 * 图片库定位为「资源库」：只维护文件的基本信息（名称、所属分组、标签）
 * 与不可编辑的硬指标（分辨率）。朝向、角色等语义信息都以标签（Tag）形式
 * 存在——例如由「角色识别工具」识别后回写标签，而不是独立字段。
 *
 * 页面主体是文件夹式表格：分组即文件夹，支持上传、筛选，以及对单张图片的
 * 编辑基本信息、移动分组、复制到分组、删除等操作。更复杂的批处理归入
 * 独立的「工具集合」。
 */

import { useEffect, useMemo, useState } from "react";
import {
  App,
  Alert,
  Breadcrumb,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FolderOutlined,
  FolderAddOutlined,
  HomeOutlined,
  MoreOutlined,
  PictureOutlined,
  PushpinOutlined,
  ReloadOutlined,
  ExpandOutlined,
  SwapOutlined,
  ScissorOutlined,
  TagsOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import dayjs from "dayjs";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { Thumbnail } from "@/components/Thumbnail";
import { BatchTagModal } from "@/components/BatchTagModal";
import type { ImageFilterParams, ImageGroup, ImageModel } from "@/api/types";
import { ToolsModal } from "@/tools";
import type { ToolDefinition, ToolSelection, ToolTarget } from "@/tools";
import { MediaBrowser } from "@/components/MediaBrowser";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

const UNGROUPED_NAME = "未分组";
const ROOT_VALUE = "__root__";

export const CROP_SIZE_PRESETS = [
  { label: "512 × 512 · 1:1 方图", value: "512x512", width: 512, height: 512 },
  { label: "768 × 768 · 1:1 方图", value: "768x768", width: 768, height: 768 },
  { label: "1024 × 1024 · 1:1 方图", value: "1024x1024", width: 1024, height: 1024 },
  { label: "768 × 1024 · 3:4 竖图", value: "768x1024", width: 768, height: 1024 },
  { label: "1024 × 768 · 4:3 横图", value: "1024x768", width: 1024, height: 768 },
  { label: "1024 × 1536 · 2:3 竖图", value: "1024x1536", width: 1024, height: 1536 },
  { label: "1536 × 1024 · 3:2 横图", value: "1536x1024", width: 1536, height: 1024 },
  { label: "1536 × 1536 · 1:1 方图", value: "1536x1536", width: 1536, height: 1536 },
  { label: "2048 × 2048 · 1:1 方图", value: "2048x2048", width: 2048, height: 2048 },
  { label: "1536 × 2048 · 3:4 竖图", value: "1536x2048", width: 1536, height: 2048 },
  { label: "2048 × 1536 · 4:3 横图", value: "2048x1536", width: 2048, height: 1536 },
];

// -- 图片详情（仅属性；硬指标只读） -----------------------------------------
function ImageDetail({
  image,
  groupName,
  onUpdated,
}: {
  image: ImageModel;
  groupName: string;
  onUpdated: (image: ImageModel) => void;
}) {
  const { message, modal } = App.useApp();
  const [cropping, setCropping] = useState(false);
  const [cropMode, setCropMode] = useState<"head" | "closeup">("head");
  const [crop, setCrop] = useState<PercentCrop>();
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const [loadingCrop, setLoadingCrop] = useState(false);
  const [targetShortSide, setTargetShortSide] = useState(1024);
  const [upscaling, setUpscaling] = useState(false);

  const startCrop = async (mode: "head" | "closeup") => {
    setLoadingCrop(true);
    try {
      const suggestion = await api.getImageCropSuggestion(image.id, mode);
      setCropMode(mode);
      setSourceSize({
        width: suggestion.source_width,
        height: suggestion.source_height,
      });
      setCrop({
        unit: "%",
        x: (suggestion.crop.x / suggestion.source_width) * 100,
        y: (suggestion.crop.y / suggestion.source_height) * 100,
        width: (suggestion.crop.width / suggestion.source_width) * 100,
        height: (suggestion.crop.height / suggestion.source_height) * 100,
      });
      setCropping(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "无法生成裁剪框");
    } finally {
      setLoadingCrop(false);
    }
  };

  const confirmCrop = async () => {
    if (!crop || !sourceSize.width || !sourceSize.height) return;
    setLoadingCrop(true);
    try {
      const result = await api.cropImage(image.id, {
        x: Math.round((crop.x / 100) * sourceSize.width),
        y: Math.round((crop.y / 100) * sourceSize.height),
        width: Math.round((crop.width / 100) * sourceSize.width),
        height: Math.round((crop.height / 100) * sourceSize.height),
      });
      onUpdated(result.image);
      setCropping(false);
      message.success(
        `裁剪完成：${result.image.width}×${result.image.height}`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "裁剪失败");
    } finally {
      setLoadingCrop(false);
    }
  };

  const confirmUpscale = () => {
    modal.confirm({
      title: `将图片短边提升到 ${targetShortSide}px？`,
      content:
        "将使用高质量重采样生成新文件并更新当前图片引用。原物理图片会保留，但重采样不能恢复原图中不存在的细节。",
      okText: "确认提升",
      cancelText: "取消",
      onOk: async () => {
        setUpscaling(true);
        try {
          const result = await api.upscaleImage(image.id, targetShortSide);
          onUpdated(result.image);
          message.success(
            `分辨率提升完成：${result.image.width}×${result.image.height}`,
          );
        } catch (error) {
          message.error(
            error instanceof Error ? error.message : "分辨率提升失败",
          );
          throw error;
        } finally {
          setUpscaling(false);
        }
      },
    });
  };

  const imageUrl = `/api/images/${encodeURIComponent(image.id)}/raw?v=${encodeURIComponent(image.sha256)}`;

  if (cropping) {
    return (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message="拖动或缩放裁剪框，确认后会生成新文件并更新当前图片引用"
          description="原物理图片会保留，其他引用不受影响。"
        />
        <Segmented
          block
          value={cropMode}
          options={[
            { label: "头部 1:1", value: "head" },
            { label: "近景 3:4", value: "closeup" },
          ]}
          onChange={(value) => void startCrop(value as "head" | "closeup")}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            maxHeight: "calc(100vh - 290px)",
            overflow: "auto",
            background: "#11141a",
          }}
        >
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            aspect={cropMode === "head" ? 1 : 3 / 4}
            keepSelection
          >
            <img
              src={imageUrl}
              alt={image.title || image.id}
              style={{ maxWidth: "100%", maxHeight: "calc(100vh - 310px)" }}
            />
          </ReactCrop>
        </div>
        <Space style={{ justifyContent: "flex-end", width: "100%" }}>
          <Button onClick={() => setCropping(false)}>取消</Button>
          <Button
            type="primary"
            icon={<ScissorOutlined />}
            loading={loadingCrop}
            disabled={!crop?.width || !crop?.height}
            onClick={() => void confirmCrop()}
          >
            确认裁剪
          </Button>
        </Space>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Image
        src={imageUrl}
        alt={image.title || image.id}
        preview
        width="100%"
        style={{
          maxHeight: "56vh",
          objectFit: "contain",
          borderRadius: 6,
          background: "#1b1e26",
        }}
      />
      <Button
        block
        type="primary"
        icon={<ScissorOutlined />}
        loading={loadingCrop}
        onClick={() => void startCrop("head")}
      >
        开始裁剪
      </Button>
      <Space align="center" style={{ width: "100%" }}>
        <Typography.Text style={{ whiteSpace: "nowrap" }}>
          目标短边
        </Typography.Text>
        <InputNumber
          min={512}
          max={4096}
          step={128}
          value={targetShortSide}
          style={{ flex: 1 }}
          onChange={(value) => setTargetShortSide(value ?? 1024)}
        />
        <Typography.Text type="secondary">px</Typography.Text>
        <Button
          icon={<ExpandOutlined />}
          loading={upscaling}
          onClick={confirmUpscale}
        >
          提升分辨率
        </Button>
      </Space>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="ID">{image.id}</Descriptions.Item>
        <Descriptions.Item label="名称">
          {image.title || image.id}
        </Descriptions.Item>
        <Descriptions.Item label="所属分组">{groupName}</Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {dayjs(image.created_at).format("YYYY-MM-DD HH:mm")}
        </Descriptions.Item>
        <Descriptions.Item label="分辨率">
          {image.width}×{image.height}
        </Descriptions.Item>
        <Descriptions.Item label="Caption">
          {image.caption || "无"}
        </Descriptions.Item>
        <Descriptions.Item label="标签">
          {image.tags.length ? (
            <Space size={4} wrap>
              {image.tags.map((t) => (
                <Tag key={t} color="geekblue">
                  {t}
                </Tag>
              ))}
            </Space>
          ) : (
            "无"
          )}
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
}

export function BatchCropModal({
  open,
  images,
  onClose,
  onDone,
}: {
  open: boolean;
  images: ImageModel[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [preset, setPreset] = useState("1024x1024");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewErrors, setPreviewErrors] = useState<Set<string>>(() => new Set());
  const targetWidth = Form.useWatch("target_width", form) ?? 1024;
  const targetHeight = Form.useWatch("target_height", form) ?? 1024;

  useEffect(() => {
    setPreviewErrors(new Set());
  }, [previewOpen, targetWidth, targetHeight]);

  const applyPreset = (value: string) => {
    setPreset(value);
    const selectedPreset = CROP_SIZE_PRESETS.find((item) => item.value === value);
    if (selectedPreset) {
      form.setFieldsValue({
        target_width: selectedPreset.width,
        target_height: selectedPreset.height,
      });
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const result = await api.batchCropImages(
        images.map((image) => image.id),
        values.target_width,
        values.target_height,
      );
      if (result.failed.length) {
        message.warning(
          `已裁剪 ${result.completed.length} 张，${result.failed.length} 张失败`,
        );
      } else {
        message.success(
          `已将 ${result.completed.length} 张图片统一为 ${result.target_width}×${result.target_height}`,
        );
      }
      onDone();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批量裁剪失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        title={`压缩并裁剪 ${images.length} 张图片`}
        open={open}
        okText="开始处理"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void submit()}
        onCancel={onClose}
        destroyOnHidden
        width={880}
      >
      <Form
        form={form}
        initialValues={{ target_width: 1024, target_height: 1024 }}
        onValuesChange={() => setPreset("")}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto minmax(180px, 1fr) auto auto",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            marginBottom: 12,
            overflowX: "auto",
            background: "rgba(255,255,255,0.04)",
            borderBottom: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <Typography.Text strong>裁剪设置</Typography.Text>
          <Select
            aria-label="常用尺寸（可自定义）"
            value={preset}
            style={{ width: "100%", minWidth: 180 }}
            placeholder="常用尺寸"
            options={CROP_SIZE_PRESETS.map((item) => ({
              label: item.label,
              value: item.value,
            }))}
            onChange={applyPreset}
          />
          <Space size={6}>
            <Typography.Text type="secondary">宽</Typography.Text>
            <Form.Item
              noStyle
              name="target_width"
              rules={[{ required: true, message: "请输入目标宽度" }]}
            >
              <InputNumber min={256} max={4096} step={64} style={{ width: 92 }} />
            </Form.Item>
            <Typography.Text type="secondary">×</Typography.Text>
            <Typography.Text type="secondary">高</Typography.Text>
            <Form.Item
              noStyle
              name="target_height"
              rules={[{ required: true, message: "请输入目标高度" }]}
            >
              <InputNumber min={256} max={4096} step={64} style={{ width: 92 }} />
            </Form.Item>
            <Typography.Text type="secondary">px</Typography.Text>
          </Space>
          <Button
            icon={<EyeOutlined />}
            onClick={() => setPreviewOpen(true)}
          >
            预览
          </Button>
        </div>
      </Form>
      <div
        role="list"
        aria-label="裁剪预览列表"
        style={{
          maxHeight: "min(52vh, 520px)",
          overflowY: "auto",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
        }}
      >
        {images.map((image, index) => (
          <div
            key={image.id}
            role="listitem"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              minHeight: 64,
              padding: "10px 16px",
              borderBottom:
                index < images.length - 1
                  ? "1px solid rgba(255,255,255,0.08)"
                  : undefined,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <Typography.Text ellipsis style={{ display: "block" }}>
                {image.title || image.id}
              </Typography.Text>
              <Typography.Text type="secondary">
                {image.width}×{image.height} → {targetWidth}×{targetHeight}
              </Typography.Text>
            </div>
          </div>
        ))}
      </div>
      </Modal>
      <Modal
        title={`批量处理预览 · ${images.length} 张图片`}
        open={previewOpen}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
        destroyOnHidden
        width={1120}
      >
        <div
          role="list"
          aria-label="原图与处理结果预览列表"
          style={{ maxHeight: "72vh", overflowY: "auto" }}
        >
          {images.map((image, index) => (
            <div
              key={image.id}
              role="listitem"
              style={{
                padding: "0 0 20px",
                marginBottom: 20,
                borderBottom:
                  index < images.length - 1
                    ? "1px solid rgba(255,255,255,0.1)"
                    : undefined,
              }}
            >
              <Typography.Text strong style={{ display: "block", marginBottom: 10 }}>
                {image.title || image.id}
              </Typography.Text>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 16,
                }}
              >
                <div>
                  <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                    原图 · {image.width}×{image.height}
                  </Typography.Text>
                  <div
                    style={{
                      height: "min(38vh, 360px)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      background: "#11141a",
                      borderRadius: 6,
                    }}
                  >
                    <img
                      src={`/api/images/${encodeURIComponent(image.id)}/raw?v=${encodeURIComponent(image.sha256)}`}
                      alt={`原图 ${index + 1}`}
                      loading="lazy"
                      style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  </div>
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                    压缩裁剪后 · {targetWidth}×{targetHeight}
                  </Typography.Text>
                  <div
                    style={{
                      height: "min(38vh, 360px)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      background: "#11141a",
                      borderRadius: 6,
                    }}
                  >
                    {previewErrors.has(image.id) ? (
                      <Typography.Text type="secondary">无法生成当前尺寸的预览</Typography.Text>
                    ) : (
                      <img
                        src={`/api/images/${encodeURIComponent(image.id)}/batch-crop-preview?target_width=${targetWidth}&target_height=${targetHeight}`}
                        alt={`压缩裁剪后预览 ${index + 1}`}
                        loading="lazy"
                        onError={() =>
                          setPreviewErrors((current) => new Set(current).add(image.id))
                        }
                        style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

// -- 新建分组弹窗 -----------------------------------------------------------
function CreateGroupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await api.createImageGroup({
        name: values.name,
        description: values.description ?? "",
      });
      message.success("分组已创建");
      form.resetFields();
      onCreated();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="新建分组"
      open={open}
      onOk={submit}
      confirmLoading={submitting}
      onCancel={onClose}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label="分组名称"
          rules={[{ required: true, message: "请输入分组名称" }]}
        >
          <Input placeholder="如：人物正面" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} placeholder="可选" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// -- 编辑分组弹窗 -----------------------------------------------------------
function EditGroupModal({
  group,
  onClose,
  onSaved,
}: {
  group: ImageGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!group) return;
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await api.updateImageGroup(group.id, {
        name: values.name,
        description: values.description ?? "",
      });
      message.success("分组已更新");
      onSaved();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="编辑分组"
      open={group !== null}
      onOk={submit}
      confirmLoading={submitting}
      onCancel={onClose}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          name: group?.name,
          description: group?.description ?? "",
        }}
      >
        <Form.Item
          name="name"
          label="分组名称"
          rules={[{ required: true, message: "请输入分组名称" }]}
        >
          <Input placeholder="分组名称" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} placeholder="可选" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// -- 上传图片弹窗 -----------------------------------------------------------
function UploadImageModal({
  open,
  onClose,
  groups,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  groups: ImageGroup[];
  onCreated: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await api.createImage({
        title: values.title,
        group_id: values.group_id ?? null,
        tags: values.tags ?? [],
        width: values.width ?? 0,
        height: values.height ?? 0,
      });
      message.success("图片已登记到图片库");
      form.resetFields();
      onCreated();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 选择文件时仅在前端读取文件名自动填充，不实际上传文件内容。
  const onPickFile = (file: UploadFile): boolean => {
    const raw = file as unknown as File;
    form.setFieldsValue({
      title: form.getFieldValue("title") || raw.name,
    });
    return false;
  };

  return (
    <Modal
      title="上传图片"
      open={open}
      onOk={submit}
      confirmLoading={submitting}
      onCancel={onClose}
      destroyOnClose
      width={520}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="选择文件">
          <Upload
            beforeUpload={onPickFile as never}
            maxCount={1}
            accept="image/*"
          >
            <Button>选择本地图片</Button>
          </Upload>
        </Form.Item>
        <Form.Item
          name="title"
          label="名称"
          rules={[{ required: true, message: "请输入图片名称" }]}
        >
          <Input placeholder="图片名称" />
        </Form.Item>
        <Form.Item name="group_id" label="所属分组">
          <Select
            allowClear
            placeholder="选择分组（可留空）"
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Select
            mode="tags"
            placeholder="输入后回车添加多个标签"
            tokenSeparators={[","]}
          />
        </Form.Item>
        <Space size={12} wrap>
          <Form.Item name="width" label="宽">
            <InputNumber min={0} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="height" label="高">
            <InputNumber min={0} style={{ width: 120 }} />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}

// -- 上传整个目录弹窗 -------------------------------------------------------
const DIRECTORY_IMAGE_EXTS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".gif",
  ".tiff",
  ".tif",
];

function isImageFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return DIRECTORY_IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

function UploadDirectoryModal({
  open,
  onClose,
  groups,
  defaultGroupId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  groups: ImageGroup[];
  defaultGroupId: string | null;
  onCreated: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ group_id: defaultGroupId ?? undefined, tags: [] });
      setFileList([]);
    }
  }, [open, defaultGroupId, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const files = fileList
      .map((item) => item.originFileObj as File | undefined)
      .filter((file): file is File => Boolean(file));
    if (files.length === 0) {
      message.warning("请先选择包含图片的目录");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.uploadImages({
        files,
        group_id: values.group_id ?? null,
        tags: values.tags ?? [],
      });
      const okCount = res.created.length;
      const errCount = res.errors.length;
      if (okCount > 0) {
        message.success(
          `成功上传 ${okCount} 张图片${errCount ? `，${errCount} 张失败` : ""}`,
        );
      } else {
        message.error(
          errCount ? `全部 ${errCount} 张上传失败` : "没有可上传的图片",
        );
      }
      if (errCount > 0) {
        const preview = res.errors
          .slice(0, 5)
          .map((e) => `${e.file}：${e.error}`)
          .join("\n");
        Modal.warning({
          title: `${errCount} 个文件未能上传`,
          content: (
            <div style={{ whiteSpace: "pre-wrap" }}>
              {preview}
              {errCount > 5 ? `\n… 其余 ${errCount - 5} 个略` : ""}
            </div>
          ),
        });
      }
      onCreated();
      if (okCount > 0) {
        form.resetFields();
        setFileList([]);
        onClose();
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setSubmitting(false);
    }
  };

  const imageCount = fileList.length;

  return (
    <Modal
      title="上传目录"
      open={open}
      onOk={submit}
      okText={imageCount > 0 ? `上传 ${imageCount} 张` : "上传"}
      confirmLoading={submitting}
      onCancel={onClose}
      destroyOnClose
      width={560}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="选择目录" tooltip="选择本地文件夹，其中的图片将被批量上传">
          <Upload
            directory
            multiple
            accept="image/*"
            beforeUpload={() => false}
            fileList={fileList}
            onChange={({ fileList: next }) =>
              setFileList(next.filter((item) => isImageFileName(item.name)))
            }
            onRemove={(file) =>
              setFileList((prev) => prev.filter((item) => item.uid !== file.uid))
            }
          >
            <Button icon={<FolderAddOutlined />}>选择本地目录</Button>
          </Upload>
        </Form.Item>
        {imageCount > 0 ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={`已识别 ${imageCount} 张图片，将全部上传到所选分组`}
          />
        ) : null}
        <Form.Item name="group_id" label="所属分组">
          <Select
            allowClear
            placeholder="选择分组（可留空）"
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
        </Form.Item>
        <Form.Item name="tags" label="统一标签">
          <Select
            mode="tags"
            placeholder="为本次上传的所有图片添加标签（可留空）"
            tokenSeparators={[","]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// -- 编辑基本信息弹窗（仅名称、标签；分辨率等硬指标不可编辑） ---------------
function EditImageModal({
  image,
  onClose,
  onSaved,
}: {
  image: ImageModel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!image) return;
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await api.updateImage(image.id, {
        title: values.title,
        tags: values.tags ?? [],
        caption: values.caption ?? "",
      });
      message.success("已保存");
      onSaved();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="编辑基本信息"
      open={image !== null}
      onOk={submit}
      confirmLoading={submitting}
      onCancel={onClose}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          title: image?.title,
          tags: image?.tags ?? [],
          caption: image?.caption ?? "",
        }}
      >
        <Form.Item
          name="title"
          label="名称"
          rules={[{ required: true, message: "请输入图片名称" }]}
        >
          <Input placeholder="图片名称" />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Select
            mode="tags"
            placeholder="输入后回车添加多个标签"
            tokenSeparators={[","]}
          />
        </Form.Item>
        <Form.Item name="caption" label="Caption（训练文本）">
          <Input.TextArea
            rows={4}
            placeholder="用于训练的图片描述文本"
            showCount
          />
        </Form.Item>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="分辨率（不可编辑）">
            {image ? `${image.width}×${image.height}` : "-"}
          </Descriptions.Item>
        </Descriptions>
      </Form>
    </Modal>
  );
}

// -- 分组选择弹窗（用于移动 / 复制到） --------------------------------------
function GroupPickerModal({
  open,
  title,
  okText,
  groups,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  okText: string;
  groups: ImageGroup[];
  onClose: () => void;
  onConfirm: (groupId: string | null) => Promise<void>;
}) {
  const [value, setValue] = useState<string>(ROOT_VALUE);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await onConfirm(value === ROOT_VALUE ? null : value);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={title}
      open={open}
      okText={okText}
      onOk={submit}
      confirmLoading={submitting}
      onCancel={onClose}
      destroyOnClose
    >
      <Select
        style={{ width: "100%" }}
        value={value}
        onChange={setValue}
        options={[
          { value: ROOT_VALUE, label: "根目录（未分组）" },
          ...groups
            .filter((g) => g.name !== UNGROUPED_NAME)
            .map((g) => ({ value: g.id, label: g.name })),
        ]}
      />
    </Modal>
  );
}

// -- 页面主体：文件夹式浏览（分组=文件夹，未分组图片在根目录） --------------

/** 判断图片是否位于根目录（无分组或归属「未分组」）。 */
function isRootImage(image: ImageModel, groups: ImageGroup[]): boolean {
  if (!image.group_id) return true;
  const g = groups.find((x) => x.id === image.group_id);
  return !g || g.name === UNGROUPED_NAME;
}

type ExplorerRow =
  | { kind: "folder"; key: string; group: ImageGroup; count: number }
  | { kind: "file"; key: string; image: ImageModel };

function ImageLibraryExplorer({
  images,
  groups,
  currentGroupId,
  selectedRowKeys,
  onSelectionChange,
  onEnterFolder,
  onOpenDetail,
  onEdit,
  onMove,
  onCopy,
  onDelete,
  onTools,
  onEditGroup,
  onDeleteGroup,
  onToolsGroup,
}: {
  images: ImageModel[];
  groups: ImageGroup[];
  currentGroupId: string | null;
  selectedRowKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  onEnterFolder: (groupId: string) => void;
  onOpenDetail: (img: ImageModel) => void;
  onEdit: (img: ImageModel) => void;
  onMove: (img: ImageModel) => void;
  onCopy: (img: ImageModel) => void;
  onDelete: (img: ImageModel) => void;
  onTools: (img: ImageModel) => void;
  onEditGroup: (group: ImageGroup) => void;
  onDeleteGroup: (group: ImageGroup) => void;
  onToolsGroup: (group: ImageGroup) => void;
}) {
  const rows: ExplorerRow[] = useMemo(() => {
    if (currentGroupId === null) {
      const folderRows: ExplorerRow[] = groups
        .filter((g) => g.name !== UNGROUPED_NAME)
        .map((g) => ({
          kind: "folder",
          key: `folder:${g.id}`,
          group: g,
          count: images.filter((v) => v.group_id === g.id).length,
        }));
      const fileRows: ExplorerRow[] = images
        .filter((v) => isRootImage(v, groups))
        .map((v) => ({ kind: "file", key: v.id, image: v }));
      return [...folderRows, ...fileRows];
    }
    return images
      .filter((v) => v.group_id === currentGroupId)
      .map((v) => ({ kind: "file", key: v.id, image: v }));
  }, [images, groups, currentGroupId]);

  const actionItems = (): MenuProps["items"] => [
    { key: "edit", icon: <EditOutlined />, label: "编辑基本信息" },
    { key: "tools", icon: <ToolOutlined />, label: "工具" },
    { key: "move", icon: <SwapOutlined />, label: "移动到分组" },
    { key: "copy", icon: <CopyOutlined />, label: "复制到分组" },
    { type: "divider" },
    { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
  ];

  const folderActionItems = (): MenuProps["items"] => [
    { key: "edit", icon: <EditOutlined />, label: "编辑分组" },
    { key: "tools", icon: <ToolOutlined />, label: "工具" },
    { type: "divider" },
    { key: "delete", icon: <DeleteOutlined />, label: "删除分组", danger: true },
  ];

  const onActionClick = (img: ImageModel, key: string) => {
    if (key === "edit") onEdit(img);
    else if (key === "tools") onTools(img);
    else if (key === "move") onMove(img);
    else if (key === "copy") onCopy(img);
    else if (key === "delete") onDelete(img);
  };

  const onFolderActionClick = (group: ImageGroup, key: string) => {
    if (key === "edit") onEditGroup(group);
    else if (key === "tools") onToolsGroup(group);
    else if (key === "delete") onDeleteGroup(group);
  };

  const columns: ColumnsType<ExplorerRow> = [
    {
      title: "名称",
      key: "name",
      ellipsis: true,
      render: (_, row) =>
        row.kind === "folder" ? (
          <Space>
            <FolderOutlined style={{ color: "#f0b34e" }} />
            <span style={{ fontWeight: 600 }}>{row.group.name}</span>
            <span style={{ color: "#8b90a0" }}>{row.count} 项</span>
          </Space>
        ) : (
          <Space>
            <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
              <Thumbnail
                seed={row.image.thumbnail_hint || row.image.id}
                imageId={row.image.id}
                preview
                size={36}
              />
            </span>
            <span>{row.image.title || row.image.id}</span>
          </Space>
        ),
    },
    {
      title: "分辨率",
      key: "resolution",
      width: 110,
      render: (_, row) =>
        row.kind === "file" ? `${row.image.width}×${row.image.height}` : null,
    },
    {
      title: "标签",
      key: "tags",
      render: (_, row) => {
        if (row.kind !== "file") return null;
        const tags = row.image.tags;
        return tags.length ? (
          <Space size={4} wrap>
            {tags.map((t) => (
              <Tag key={t} color="geekblue" style={{ marginInlineEnd: 0 }}>
                {t}
              </Tag>
            ))}
          </Space>
        ) : (
          "-"
        );
      },
    },
    {
      title: "创建时间",
      key: "created_at",
      width: 150,
      render: (_, row) =>
        row.kind === "file"
          ? dayjs(row.image.created_at).format("YYYY-MM-DD HH:mm")
          : null,
    },
    {
      title: "操作",
      key: "actions",
      width: 60,
      align: "center",
      render: (_, row) =>
        row.kind === "file" ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: actionItems(),
                onClick: ({ key }) => onActionClick(row.image, key),
              }}
            >
              <Button type="text" icon={<MoreOutlined />} />
            </Dropdown>
          </div>
        ) : (
          <div onClick={(e) => e.stopPropagation()}>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: folderActionItems(),
                onClick: ({ key }) => onFolderActionClick(row.group, key),
              }}
            >
              <Button type="text" icon={<MoreOutlined />} />
            </Dropdown>
          </div>
        ),
    },
  ];

  return (
    <Table
      rowKey="key"
      columns={columns}
      dataSource={rows}
      size="middle"
      rowSelection={{
        selectedRowKeys,
        onChange: (keys) => onSelectionChange(keys as string[]),
        getCheckboxProps: (row) => ({ disabled: row.kind !== "file" }),
      }}
      pagination={{
        pageSize: 8,
        showSizeChanger: false,
        showTotal: (t) => `共 ${t} 项`,
      }}
      onRow={(row) => ({
        onClick: () =>
          row.kind === "folder"
            ? onEnterFolder(row.group.id)
            : onOpenDetail(row.image),
        style: { cursor: "pointer" },
      })}
    />
  );
}

export function ImagesPage() {
  const { message, modal } = App.useApp();
  const [filter, setFilter] = useState<ImageFilterParams>({});
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ImageModel | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [dirUploadOpen, setDirUploadOpen] = useState(false);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolDefinition | null>(null);
  const [toolsSelection, setToolsSelection] = useState<ToolSelection | undefined>(
    undefined,
  );
  const [toolTarget, setToolTarget] = useState<ToolTarget | null>(null);
  const [editing, setEditing] = useState<ImageModel | null>(null);
  const [moving, setMoving] = useState<ImageModel | null>(null);
  const [copying, setCopying] = useState<ImageModel | null>(null);
  const [editingGroup, setEditingGroup] = useState<ImageGroup | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [batchCropOpen, setBatchCropOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  const groupsState = useAsync(() => api.listImageGroups(), []);
  const groups = groupsState.data ?? [];
  const imagesState = useAsync(
    () => api.listImages(filter),
    [filter.tag, filter.keyword],
  );
  const generationState = useAsync(() => api.getGenerationConfig(), []);
  const images = imagesState.data ?? [];

  const patch = (part: Partial<ImageFilterParams>) =>
    setFilter((prev) => ({ ...prev, ...part }));

  const refreshAll = () => {
    groupsState.refetch();
    imagesState.refetch();
    setSelectedRowKeys([]);
  };

  const currentGroup = groups.find((g) => g.id === currentGroupId) ?? null;

  // 当前目录内的图片文件（用于「开始浏览」）。
  const currentFiles = useMemo(
    () =>
      currentGroupId === null
        ? images.filter((v) => isRootImage(v, groups))
        : images.filter((v) => v.group_id === currentGroupId),
    [images, groups, currentGroupId],
  );

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of images) (v.tags ?? []).forEach((t) => set.add(t));
    if (filter.tag) set.add(filter.tag);
    return Array.from(set).map((t) => ({ value: t, label: t }));
  }, [images, filter.tag]);

  const confirmDelete = (img: ImageModel) => {
    modal.confirm({
      title: "删除图片",
      content: `确定要删除「${img.title || img.id}」吗？此操作不可撤销。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api.deleteImage(img.id);
          message.success("已删除");
          refreshAll();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "删除失败");
        }
      },
    });
  };

  const confirmDeleteGroup = (group: ImageGroup) => {
    const count = images.filter((v) => v.group_id === group.id).length;
    let deleteImages = false;
    modal.confirm({
      title: "删除分组",
      content:
        count > 0
          ? (
              <Space direction="vertical" size={12}>
                <div>
                  分组「{group.name}」内有 {count}
                  张图片。默认只删除分组，图片将移到根目录。
                </div>
                <Checkbox
                  onChange={(event) => {
                    deleteImages = event.target.checked;
                  }}
                >
                  同时从图片库删除组内图片
                </Checkbox>
                <div style={{ color: "#8c8c8c", fontSize: 12 }}>
                  勾选后会删除图片记录。物理文件仅在 workspace/images
                  中且没有其他图片记录引用时删除；共享文件和外部原图会保留。
                </div>
              </Space>
            )
          : `确定要删除分组「${group.name}」吗？`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          const result = await api.deleteImageGroup(group.id, deleteImages);
          message.success(
            deleteImages
              ? `分组已删除，同时删除 ${result.deleted_images} 张图片记录、${result.deleted_files} 个无引用托管文件`
              : "分组已删除，图片已移到根目录",
          );
          if (currentGroupId === group.id) setCurrentGroupId(null);
          refreshAll();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "删除失败");
        }
      },
    });
  };

  const confirmBatchDelete = () => {
    const ids = selectedRowKeys.slice();
    if (!ids.length) return;
    modal.confirm({
      title: "批量删除图片",
      content: `确定要删除选中的 ${ids.length} 张图片吗？此操作不可撤销。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const results = await Promise.allSettled(
          ids.map((id) => api.deleteImage(id)),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed) message.warning(`已删除 ${ids.length - failed} 张，${failed} 张失败`);
        else message.success(`已删除 ${ids.length} 张`);
        refreshAll();
      },
    });
  };

  const batchMove = async (groupId: string | null) => {
    const ids = selectedRowKeys.slice();
    if (!ids.length) return;
    const results = await Promise.allSettled(
      ids.map((id) => api.updateImage(id, { group_id: groupId })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) message.warning(`已移动 ${ids.length - failed} 张，${failed} 张失败`);
    else message.success(`已移动 ${ids.length} 张`);
    refreshAll();
  };

  const batchTags = async (add: string[], remove: string[]) => {
    const items = images.filter((i) => selectedRowKeys.includes(i.id));
    if (!items.length) return;
    const results = await Promise.allSettled(
      items.map((img) => {
        const set = new Set(img.tags);
        add.forEach((t) => set.add(t));
        remove.forEach((t) => set.delete(t));
        return api.updateImage(img.id, { tags: Array.from(set) });
      }),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) message.warning(`已更新 ${items.length - failed} 张，${failed} 张失败`);
    else message.success(`已更新 ${items.length} 张标签`);
    refreshAll();
  };

  const setGenerationReference = async () => {
    if (selectedRowKeys.length !== 1) return;
    try {
      const config = await api.setGenerationReferenceImage(selectedRowKeys[0]);
      generationState.refetch();
      message.success(`已设为 Z-Image 参考图：${config.reference_image_title}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "设置参考图失败");
    }
  };

  // 打开「工具集合」：selection 决定显示的工具形态，target 决定作用对象。
  const openTools = (
    selection: ToolSelection | undefined,
    target: ToolTarget | null,
  ) => {
    setToolsSelection(selection);
    setToolTarget(target);
    setToolsModalOpen(true);
  };

  return (
    <>
      <PageHeader
        title="图片库"
        subtitle="图片资源管理：分组（文件夹）、上传、标签与筛选"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refreshAll}>
              刷新
            </Button>
            <Button icon={<PictureOutlined />} onClick={() => setGroupModalOpen(true)}>
              新建分组
            </Button>
            <Button type="primary" onClick={() => setUploadModalOpen(true)}>
              上传图片
            </Button>
            <Button
              icon={<FolderAddOutlined />}
              onClick={() => setDirUploadOpen(true)}
            >
              上传目录
            </Button>
            <Button
              icon={<EyeOutlined />}
              disabled={currentFiles.length === 0}
              onClick={() => setBrowserOpen(true)}
            >
              开始浏览
            </Button>
            <Button icon={<ToolOutlined />} onClick={() => openTools(undefined, null)}>
              工具集合
            </Button>
          </Space>
        }
      />

      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          {
            title: (
              <a onClick={() => setCurrentGroupId(null)}>
                <HomeOutlined /> 全部
              </a>
            ),
          },
          ...(currentGroup
            ? [{ title: <span>{currentGroup.name}</span> }]
            : []),
        ]}
      />

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 160 }}
          placeholder="标签"
          value={filter.tag ?? undefined}
          onChange={(v) => patch({ tag: v ?? undefined })}
          options={tagOptions}
        />
        <Input.Search
          allowClear
          placeholder="按名称搜索"
          style={{ width: 200 }}
          onSearch={(v) => patch({ keyword: v || undefined })}
        />
      </Space>

      {selectedRowKeys.length > 0 && (
        <Space
          wrap
          style={{
            marginBottom: 16,
            padding: "8px 12px",
            background: "rgba(64,150,255,0.08)",
            borderRadius: 8,
          }}
        >
          <span>已选 {selectedRowKeys.length} 项</span>
          <Button
            size="small"
            icon={<SwapOutlined />}
            onClick={() => setBatchMoveOpen(true)}
          >
            移动到分组
          </Button>
          <Button
            size="small"
            icon={<TagsOutlined />}
            onClick={() => setBatchTagOpen(true)}
          >
            批量标签
          </Button>
          <Button
            size="small"
            icon={<ScissorOutlined />}
            onClick={() => setBatchCropOpen(true)}
          >
            压缩并裁剪
          </Button>
          {selectedRowKeys.length === 1 && (
            <Button
              size="small"
              icon={<PushpinOutlined />}
              onClick={setGenerationReference}
            >
              设为 Z-Image 参考图
            </Button>
          )}
          <Button
            size="small"
            icon={<ToolOutlined />}
            onClick={() =>
              openTools("multi", {
                scope: "image",
                selection: "multi",
                imageIds: selectedRowKeys.slice(),
              })
            }
          >
            工具
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={confirmBatchDelete}
          >
            批量删除
          </Button>
          <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>
            取消选择
          </Button>
        </Space>
      )}

      <AsyncBoundary state={imagesState}>
        {(list) => (
          <ImageLibraryExplorer
            images={list}
            groups={groups}
            currentGroupId={currentGroupId}
            selectedRowKeys={selectedRowKeys}
            onSelectionChange={setSelectedRowKeys}
            onEnterFolder={(gid) => {
              setSelectedRowKeys([]);
              setCurrentGroupId(gid);
            }}
            onOpenDetail={setSelected}
            onEdit={setEditing}
            onMove={setMoving}
            onCopy={setCopying}
            onDelete={confirmDelete}
            onTools={(img) =>
              openTools(undefined, {
                scope: "image",
                selection: "single",
                imageIds: [img.id],
              })
            }
            onEditGroup={setEditingGroup}
            onDeleteGroup={confirmDeleteGroup}
            onToolsGroup={(group) =>
              openTools("multi", {
                scope: "image",
                selection: "multi",
                groupIds: [group.id],
              })
            }
          />
        )}
      </AsyncBoundary>

      <Drawer
        title={
          selected ? `图片详情 · ${selected.title || selected.id}` : "图片详情"
        }
        width="50vw"
        open={selected !== null}
        onClose={() => setSelected(null)}
        destroyOnClose
      >
        {selected && (
          <ImageDetail
            image={selected}
            groupName={
              groups.find((g) => g.id === selected.group_id)?.name ?? "未分组"
            }
            onUpdated={(updated) => {
              setSelected(updated);
              refreshAll();
            }}
          />
        )}
      </Drawer>

      <CreateGroupModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        onCreated={refreshAll}
      />
      <EditGroupModal
        group={editingGroup}
        onClose={() => setEditingGroup(null)}
        onSaved={refreshAll}
      />
      <UploadImageModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        groups={groups}
        onCreated={refreshAll}
      />
      <UploadDirectoryModal
        open={dirUploadOpen}
        onClose={() => setDirUploadOpen(false)}
        groups={groups}
        defaultGroupId={currentGroupId}
        onCreated={refreshAll}
      />
      <EditImageModal
        image={editing}
        onClose={() => setEditing(null)}
        onSaved={refreshAll}
      />
      <GroupPickerModal
        open={moving !== null}
        title={`移动「${moving?.title || moving?.id || ""}」到分组`}
        okText="移动"
        groups={groups}
        onClose={() => setMoving(null)}
        onConfirm={async (groupId) => {
          if (!moving) return;
          try {
            await api.updateImage(moving.id, { group_id: groupId });
            message.success("已移动");
            refreshAll();
          } catch (err) {
            message.error(err instanceof Error ? err.message : "移动失败");
          }
        }}
      />
      <GroupPickerModal
        open={copying !== null}
        title={`复制「${copying?.title || copying?.id || ""}」到分组`}
        okText="复制"
        groups={groups}
        onClose={() => setCopying(null)}
        onConfirm={async (groupId) => {
          if (!copying) return;
          try {
            await api.copyImage(copying.id, groupId);
            message.success("已复制");
            refreshAll();
          } catch (err) {
            message.error(err instanceof Error ? err.message : "复制失败");
          }
        }}
      />
      <GroupPickerModal
        open={batchMoveOpen}
        title={`移动选中的 ${selectedRowKeys.length} 张图片到分组`}
        okText="移动"
        groups={groups}
        onClose={() => setBatchMoveOpen(false)}
        onConfirm={async (groupId) => {
          await batchMove(groupId);
        }}
      />
      <BatchTagModal
        open={batchTagOpen}
        count={selectedRowKeys.length}
        onClose={() => setBatchTagOpen(false)}
        onApply={batchTags}
      />
      <BatchCropModal
        open={batchCropOpen}
        images={selectedRowKeys
          .map((imageId) => images.find((image) => image.id === imageId))
          .filter((image): image is ImageModel => image !== undefined)}
        onClose={() => setBatchCropOpen(false)}
        onDone={refreshAll}
      />
      <MediaBrowser
        open={browserOpen}
        items={currentFiles.map((f) => ({
          id: f.id,
          title: f.title || f.id,
          kind: "image" as const,
        }))}
        startIndex={0}
        groups={groups}
        ungroupedName={UNGROUPED_NAME}
        onClose={() => setBrowserOpen(false)}
        onMove={async (id, groupId) => {
          await api.updateImage(id, { group_id: groupId });
        }}
        onDelete={(id) => api.deleteImage(id)}
        onChanged={refreshAll}
      />
      <ToolsModal
        open={toolsModalOpen}
        onClose={() => setToolsModalOpen(false)}
        scope="image"
        selection={toolsSelection}
        onSelectTool={(tool) => {
          setToolsModalOpen(false);
          setActiveTool(tool);
        }}
      />
      {activeTool?.launch({
        open: true,
        onClose: () => {
          setActiveTool(null);
          setToolTarget(null);
        },
        context: { images, onDone: refreshAll, target: toolTarget ?? undefined },
      })}
    </>
  );
}
