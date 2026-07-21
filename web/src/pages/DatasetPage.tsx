import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Alert,
  Switch,
  Tooltip,
  Progress,
  message,
} from "antd";
import {
  FolderOutlined,
  HomeOutlined,
  ArrowLeftOutlined,
  RobotOutlined,
  ExportOutlined,
  CloudUploadOutlined,
  ScissorOutlined,
  LeftOutlined,
  RightOutlined,
  RetweetOutlined,
  DownOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import { PageHeader } from "@/components/PageHeader";
import { Thumbnail } from "@/components/Thumbnail";
import { api } from "@/api/client";
import { BatchCropModal, CROP_SIZE_PRESETS } from "@/pages/ImagesPage";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import type {
  AnnotateResult,
  AiToolkitNode,
  Dataset,
  DatasetType,
  ExportBaseModel,
  ExportPreset,
  ImageModel,
  Video,
} from "@/api/types";

const TYPE_LABEL: Record<DatasetType, string> = {
  image: "图片",
  video: "视频",
};

const DEFAULT_BASE_MODEL = "Qwen/Qwen-Image-2512";

const UNGROUPED_NAME = "未分组";

function isImage(item: ImageModel | Video): item is ImageModel {
  return "image_path" in item;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "-";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 人物形象标注可选的描述维度，动态拼进系统提示词。 */
const CHARACTER_ASPECTS: {
  key: string;
  label: string;
  text: string;
  forbiddenText: string;
}[] = [
  {
    key: "age",
    label: "年龄阶段",
    text: "apparent age group, such as child, young adult, middle-aged, or elderly",
    forbiddenText: "age, age group, youth, adulthood, middle age, or elderly appearance",
  },
  {
    key: "gender",
    label: "性别",
    text: "the person's gender",
    forbiddenText: "gender or gendered words (for example man, woman, male, female, boy, girl, lady)",
  },
  {
    key: "face",
    label: "面部特征",
    text: "facial features and face shape",
    forbiddenText: "facial features, face shape, nose, lips, cheeks, jawline, or eyebrows",
  },
  {
    key: "expression",
    label: "表情",
    text: "facial expression and visible emotion",
    forbiddenText: "facial expression, smile, emotion, mood, or visible feeling",
  },
  {
    key: "eyes",
    label: "眼睛/视线",
    text: "eye appearance, eye state, and gaze direction",
    forbiddenText: "eyes, eye color, open or closed eyes, gaze, or looking direction",
  },
  {
    key: "skin",
    label: "肤色/肤质",
    text: "visible skin tone and skin texture",
    forbiddenText: "skin tone, complexion, skin color, or skin texture",
  },
  {
    key: "hair",
    label: "发型",
    text: "hairstyle and hair color",
    forbiddenText: "hair, hairstyle, hair length, or hair color",
  },
  {
    key: "facial_hair",
    label: "面部毛发",
    text: "facial hair such as beard or mustache",
    forbiddenText: "facial hair, beard, mustache, stubble, or sideburns",
  },
  {
    key: "body",
    label: "体型",
    text: "visible body build and proportions",
    forbiddenText: "body build, physique, body shape, height, weight, muscularity, or proportions",
  },
  {
    key: "clothing",
    label: "衣着/鞋袜",
    text: "clothing, outfit, and footwear",
    forbiddenText: "clothing or footwear, including garments, outfit colors or materials, tops, pants, dresses, shoes, socks, and bare feet",
  },
  { key: "pose", label: "姿势/动作", text: "body pose, posture, and overall action", forbiddenText: "pose, posture, action, or body position" },
  {
    key: "hands",
    label: "手部/手势",
    text: "hand position, hand visibility, and gestures",
    forbiddenText: "hands, fingers, hand position, or hand gesture",
  },
  {
    key: "framing",
    label: "景别/裁切",
    text: "shot framing and crop, such as full-body, three-quarter, half-body, or close-up",
    forbiddenText: "shot framing, crop, camera distance, full-body, three-quarter, half-body, close-up, or which body parts are visible",
  },
  {
    key: "camera",
    label: "拍摄视角",
    text: "camera angle and viewpoint, such as eye-level, high-angle, low-angle, front, side, or back view",
    forbiddenText: "camera angle, viewpoint, eye-level, high-angle, low-angle, front view, side view, or back view",
  },
  {
    key: "background",
    label: "背景",
    text: "background and surrounding environment",
    forbiddenText: "background, location, setting, environment, or surrounding objects",
  },
  {
    key: "lighting",
    label: "光线",
    text: "lighting direction, softness, contrast, and visible light conditions",
    forbiddenText: "lighting, illumination, shadows, highlights, backlight, soft light, or hard light",
  },
  {
    key: "style",
    label: "画面风格/媒介",
    text: "visual style and medium, such as photo, illustration, anime, painting, or 3D render",
    forbiddenText: "visual style, medium, photo, illustration, anime, painting, drawing, or 3D render",
  },
  {
    key: "color",
    label: "色彩",
    text: "overall color palette, saturation, and color treatment",
    forbiddenText: "color palette, saturation, monochrome, warm colors, cool colors, or color grading",
  },
  {
    key: "accessories",
    label: "饰品",
    text: "accessories such as jewelry, glasses, hats",
    forbiddenText: "accessories, jewelry, glasses, hats, or earrings",
  },
  {
    key: "quality",
    label: "图像质量",
    text: "visible image quality such as sharpness, blur, noise, compression artifacts, or low resolution",
    forbiddenText: "image quality, sharpness, blur, noise, grain, compression artifacts, or resolution",
  },
];

const ACTION_ASPECTS = [
  {
    key: "equipment",
    label: "器具与连接",
    text: "the visible training apparatus, suspension frame, ropes, pulleys, cuffs, and how they connect to the wrists and ankles",
    forbiddenText: "training equipment, apparatus, frame, ropes, cables, pulleys, straps, cuffs, hooks, or weights",
    excludedKeys: ["equipment"],
  },
  {
    key: "framing",
    label: "景别/人物完整度",
    text: "whether the complete body and the relevant apparatus are visible",
    forbiddenText: "shot framing, crop, camera distance, or whether the complete body is visible",
    excludedKeys: ["framing"],
  },
  {
    key: "camera",
    label: "身体朝向/视角",
    text: "body orientation and camera viewpoint when they help distinguish the action",
    forbiddenText: "camera angle, viewpoint, front view, side view, or back view",
    excludedKeys: ["camera"],
  },
  {
    key: "background",
    label: "场景背景",
    text: "the surrounding location and background",
    forbiddenText: "background, location, environment, room, gym, studio, walls, or floor",
    excludedKeys: ["background"],
  },
  {
    key: "appearance",
    label: "参考人物外观",
    text: "the person's identity-related appearance, including age, gender, face, hair, skin, expression, and body build",
    forbiddenText: "age, gender, face, expression, eyes, skin, hair, body build, or accessories",
    excludedKeys: [
      "age", "gender", "face", "expression", "eyes", "skin", "hair",
      "facial_hair", "body", "accessories",
    ],
  },
  {
    key: "clothing",
    label: "衣着鞋袜",
    text: "clothing and footwear",
    forbiddenText: "clothing, outfit colors, garments, shoes, socks, or bare feet",
    excludedKeys: ["clothing"],
  },
  {
    key: "text_overlay",
    label: "字幕/水印/Logo",
    text: "visible subtitles, captions, watermarks, logos, account names, and other overlaid text",
    forbiddenText: "subtitles, captions, watermarks, logos, account names, text overlays, or visible written text",
    excludedKeys: ["text_overlay"],
  },
  {
    key: "quality",
    label: "模糊/画质问题",
    text: "visible blur, noise, compression artifacts, and other image-quality defects",
    forbiddenText: "blur, sharpness, noise, compression artifacts, pixelation, or resolution",
    excludedKeys: ["quality"],
  },
];

const DEFAULT_ACTION_ASPECTS = [
  "equipment",
  "framing",
  "camera",
  "background",
  "appearance",
  "clothing",
  "text_overlay",
];
const ACTION_TRIGGER_WORD = "Pravilo training";
const ACTION_CONTEXT_TAG_PREFIXES = ["动作类别:", "人物数:", "姿态:", "景别:"];

/** 标注输出语言。 */
type AnnotationLanguage = "en" | "zh";

/** 输出语言对应的提示词指令。 */
const LANGUAGE_INSTRUCTION: Record<AnnotationLanguage, string> = {
  en: "Write the caption in English.",
  zh: "用简体中文输出描述文本（caption）。",
};

interface AnnotationTemplate {
  key: string;
  label: string;
  /** 是否支持触发词（用于人物/风格等训练场景）。 */
  supportsTrigger: boolean;
  /** 是否支持“描述维度”多选（仅人物形象）。 */
  supportsAspects: boolean;
  supportsActionAspects?: boolean;
  /** 生成系统提示词。 */
  build: (aspects: string[], language: AnnotationLanguage) => string;
}

/** 预置的几套标注模板，覆盖人物形象/动作/风格/场景等训练目标。 */
const ANNOTATION_TEMPLATES: AnnotationTemplate[] = [
  {
    key: "character",
    label: "人物形象（角色/形象训练）",
    supportsTrigger: true,
    supportsAspects: true,
    build: (aspects, language) => {
      const chosen = CHARACTER_ASPECTS.filter((a) => aspects.includes(a.key));
      const excluded = CHARACTER_ASPECTS.filter((a) => !aspects.includes(a.key));
      const parts: string[] = [
        "You are an expert dataset captioner for character/identity LoRA training.",
        "Write one concise, comma-separated training caption using ONLY the explicitly allowed categories below.",
        "Do not add a general description of the person and do not mention a visible detail unless its category is allowed.",
      ];
      parts.push(
        chosen.length
          ? `ALLOWED CATEGORIES: ${chosen
              .map((a) => a.text)
              .join(", ")}.`
          : "ALLOWED CATEGORIES: none. Return an empty caption.",
      );
      if (excluded.length) {
        parts.push(
          `FORBIDDEN CATEGORIES: never describe or mention ${excluded
            .map((a) => a.forbiddenText)
            .join(
              ", ",
            )}. Before answering, silently remove every comma-separated phrase that belongs to a forbidden category.`,
        );
      }
      parts.push("Do not invent details that are not visible.");
      parts.push(LANGUAGE_INSTRUCTION[language]);
      parts.push("Output ONLY the caption text, no quotes, no extra words.");
      return parts.join(" ");
    },
  },
  {
    key: "action",
    label: "人物动作（动作训练）",
    supportsTrigger: true,
    supportsAspects: false,
    supportsActionAspects: true,
    build: (aspects, language) => {
      const chosen = ACTION_ASPECTS.filter((aspect) => aspects.includes(aspect.key));
      const excluded = ACTION_ASPECTS.filter((aspect) => !aspects.includes(aspect.key));
      return [
        "You are an expert dataset captioner for action/pose training.",
        "Write one concise, comma-separated training caption.",
        "Always describe the primary person's action, pose, limb positions, body orientation, and suspension or support state. Distinguish a held pose from an action transition when visible.",
        "Use support-state words precisely: say seated, standing, kneeling, or lying only when the corresponding body part visibly rests on a surface; otherwise say suspended or hanging.",
        "Distinguish gripping an object from a wrist or ankle being secured in a cuff or strap. Use gripping or holding only when the bare hand or fingers visibly wrap around an object; when a hand is enclosed by a padded cuff, describe the wrist as secured in the cuff. Never infer a grip, attachment, or connection that is outside the frame or visually unclear.",
        chosen.length
          ? `Also describe ONLY these optional categories: ${chosen.map((aspect) => aspect.text).join(", ")}.`
          : "Do not describe any optional categories.",
        excluded.length
          ? `Never describe or mention ${excluded.map((aspect) => aspect.forbiddenText).join(", ")}.`
          : "",
        aspects.includes("text_overlay")
          ? "If subtitles, watermarks, logos, account names, or overlaid text are visible, describe only their generic type and screen position. Never transcribe, quote, translate, or summarize their actual text. Omit this category when no overlay is visible."
          : "",
        "Existing metadata is reference evidence only. Never copy metadata field names, colon-formatted tags, IDs, source names, or labels such as person count and shot type into the caption; express relevant visible facts as natural language.",
        "Describe only visible facts. Do not infer identity, intent, medical effects, pain, or emotions.",
        "Do not write the concept name or trigger phrase; the application adds it as a fixed prefix.",
        LANGUAGE_INSTRUCTION[language],
        "Output ONLY the caption text, no quotes, no extra words.",
      ].filter(Boolean).join(" ");
    },
  },
  {
    key: "style",
    label: "风格（风格训练）",
    supportsTrigger: true,
    supportsAspects: false,
    build: (_aspects, language) =>
      [
        "You are an expert dataset captioner for visual style training.",
        "Write a single concise, comma-separated caption describing the overall visual style, art medium, color palette, lighting and aesthetic of the image.",
        LANGUAGE_INSTRUCTION[language],
        "Output ONLY the caption text, no quotes, no extra words.",
      ].join(" "),
  },
  {
    key: "scene",
    label: "场景（环境/内容描述）",
    supportsTrigger: false,
    supportsAspects: false,
    build: (_aspects, language) =>
      [
        "You are an expert dataset captioner.",
        "Write a single concise, comma-separated caption describing the scene, environment, setting and notable objects in the image.",
        LANGUAGE_INSTRUCTION[language],
        "Output ONLY the caption text, no quotes, no extra words.",
      ].join(" "),
  },
];

/** 数据集列表页：展示全部数据集，可新建、删除、进入详情。 */
export function DatasetListPage() {
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [baseModels, setBaseModels] = useState<ExportBaseModel[]>([]);
  const [form] = Form.useForm<{
    name: string;
    type: DatasetType;
    base_model: string;
    description: string;
  }>();

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    try {
      setDatasets(await api.listDatasets());
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDatasets();
  }, [loadDatasets]);

  useEffect(() => {
    if (!createOpen || baseModels.length > 0) return;
    void api
      .getExportOptions()
      .then((res) => setBaseModels(res.base_models))
      .catch(() => {
        setBaseModels([
          { value: DEFAULT_BASE_MODEL, label: "Qwen-Image-2512（推荐）" },
        ]);
      });
  }, [createOpen, baseModels.length]);

  const handleCreate = async () => {
    const values = await form.validateFields();
    try {
      const ds = await api.createDataset({
        name: values.name.trim(),
        type: values.type,
        base_model: values.base_model,
        description: values.description ?? "",
      });
      message.success("数据集已创建");
      setCreateOpen(false);
      form.resetFields();
      navigate(`/datasets/${ds.id}`);
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const handleDelete = async (datasetId: string) => {
    try {
      await api.deleteDataset(datasetId);
      message.success("数据集已删除");
      await loadDatasets();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const columns: ColumnsType<Dataset> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (_, ds) => <Typography.Text strong>{ds.name}</Typography.Text>,
    },
    {
      title: "类型",
      key: "type",
      width: 90,
      render: (_, ds) => (
        <Tag color={ds.type === "image" ? "blue" : "purple"}>
          {TYPE_LABEL[ds.type]}
        </Tag>
      ),
    },
    {
      title: "数量",
      key: "count",
      width: 90,
      render: (_, ds) => `${ds.item_count} 项`,
    },
    {
      title: "训练底模",
      key: "base_model",
      width: 180,
      ellipsis: true,
      render: (_, ds) => ds.base_model || DEFAULT_BASE_MODEL,
    },
    {
      title: "描述",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
      render: (v: string) => v || "-",
    },
    {
      title: "创建时间",
      key: "created_at",
      width: 160,
      render: (_, ds) => dayjs(ds.created_at).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: "操作",
      key: "actions",
      width: 80,
      align: "center",
      render: (_, ds) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Popconfirm
            title="确认删除该数据集？"
            onConfirm={() => handleDelete(ds.id)}
          >
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="数据集"
        subtitle="先创建并设定类型，再从图片库或视频库导入内容"
        extra={
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建数据集
          </Button>
        }
      />
      <Table<Dataset>
        rowKey="id"
        loading={loading}
        dataSource={datasets}
        columns={columns}
        size="middle"
        locale={{ emptyText: <Empty description="暂无数据集" /> }}
        pagination={{
          pageSize: 10,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 个数据集`,
        }}
        onRow={(ds) => ({
          onClick: () => navigate(`/datasets/${ds.id}`),
          style: { cursor: "pointer" },
        })}
      />

      <Modal
        title="新建数据集"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ type: "image", base_model: DEFAULT_BASE_MODEL }}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入数据集名称" }]}
          >
            <Input placeholder="例如：人像训练集 v1" />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio.Button value="image">图片</Radio.Button>
              <Radio.Button value="video">视频</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            name="base_model"
            label="训练底模"
            rules={[{ required: true, message: "请选择要训练的底模" }]}
          >
            <Select
              showSearch
              popupMatchSelectWidth={false}
              placeholder="选择这个数据集将用于训练的底模"
              options={baseModels.map((model) => ({
                label: model.label,
                value: model.value,
              }))}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** 数据集详情页：查看/导入/移除某个数据集的素材。 */
export function DatasetDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<(ImageModel | Video)[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ImageModel | Video | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [batchCropOpen, setBatchCropOpen] = useState(false);
  const [batchCaptionOpen, setBatchCaptionOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"export" | "dispatch" | null>(null);

  const loadDataset = useCallback(async () => {
    setLoading(true);
    try {
      setDataset(await api.getDataset(id));
      setNotFound(false);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const res = await api.listDatasetItems(id);
      setItems(res.items);
    } catch (err) {
      message.error((err as Error).message);
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadDataset();
    void loadItems();
  }, [loadDataset, loadItems]);

  const handleDelete = async () => {
    try {
      await api.deleteDataset(id);
      message.success("数据集已删除");
      navigate("/datasets");
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  if (notFound) {
    return (
      <div>
        <PageHeader title="数据集" subtitle="未找到该数据集" />
        <Empty description="数据集不存在或已被删除">
          <Button type="primary" onClick={() => navigate("/datasets")}>
            返回列表
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={
          <Space>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate("/datasets")}
            />
            <span>{dataset?.name ?? "数据集"}</span>
            {dataset && (
              <Tag color={dataset.type === "image" ? "blue" : "purple"}>
                {TYPE_LABEL[dataset.type]}
              </Tag>
            )}
          </Space>
        }
        subtitle={dataset?.description || `共 ${dataset?.item_count ?? 0} 项`}
        extra={
          dataset ? (
            <Space wrap>
              {dataset.type === "image" && (
                <Dropdown
                  disabled={items.length === 0}
                  menu={{
                    items: [
                      {
                        key: "crop",
                        icon: <ScissorOutlined />,
                        label: `压缩并裁剪${
                          selectedRowKeys.length > 0
                            ? `（选中 ${selectedRowKeys.length}）`
                            : "（全部）"
                        }`,
                      },
                      {
                        key: "annotate",
                        icon: <RobotOutlined />,
                        label: `AI 标注${
                          selectedRowKeys.length > 0
                            ? `（选中 ${selectedRowKeys.length}）`
                            : ""
                        }`,
                      },
                      {
                        key: "replace",
                        icon: <RetweetOutlined />,
                        label: "批量替换 Caption",
                      },
                    ],
                    onClick: ({ key }) => {
                      if (key === "crop") setBatchCropOpen(true);
                      else if (key === "annotate") setAnnotateOpen(true);
                      else if (key === "replace") setBatchCaptionOpen(true);
                    },
                  }}
                >
                  <Button icon={<ToolOutlined />}>
                    素材工具 <DownOutlined />
                  </Button>
                </Dropdown>
              )}
              {dataset.type === "image" && (
                <Button
                  icon={<ExportOutlined />}
                  onClick={() => setExportMode("export")}
                  disabled={items.length === 0}
                >
                  导出训练包
                </Button>
              )}
              {dataset.type === "image" && (
                <Button
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  onClick={() => setExportMode("dispatch")}
                  disabled={items.length === 0}
                >
                  发送训练任务
                </Button>
              )}
              <Button type="primary" onClick={() => setImportOpen(true)}>
                导入{TYPE_LABEL[dataset.type]}
              </Button>
              <Popconfirm title="确认删除该数据集？" onConfirm={handleDelete}>
                <Button danger>删除数据集</Button>
              </Popconfirm>
            </Space>
          ) : undefined
        }
      />
      <Card loading={loading}>
        {items.length === 0 ? (
          <Empty description="尚未导入内容" />
        ) : (
          <Table<ImageModel | Video>
            rowKey="id"
            loading={itemsLoading}
            dataSource={items}
            size="middle"
            rowSelection={
              dataset?.type === "image"
                ? {
                    selectedRowKeys,
                    onChange: (keys) =>
                      setSelectedRowKeys(keys.map((k) => String(k))),
                  }
                : undefined
            }
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (t) => `共 ${t} 项`,
            }}
            onRow={(item) => ({
              style: { cursor: "pointer" },
              onClick: (event) => {
                // 点击行选择框时只切换选中，不打开编辑抽屉。
                const target = event.target as HTMLElement;
                if (target.closest(".ant-table-selection-column")) return;
                setEditing(item);
              },
            })}
            columns={[
              {
                title: dataset?.type === "image" ? "预览" : "名称",
                key: "preview",
                width: dataset?.type === "image" ? 90 : undefined,
                render: (_, item) =>
                  isImage(item) ? (
                    <Thumbnail
                      seed={item.thumbnail_hint || item.id}
                      imageId={item.id}
                      preview
                      size={56}
                      ratio={item.width > 0 && item.height > 0 ? item.width / item.height : 1}
                    />
                  ) : (
                    <Typography.Text>{item.title}</Typography.Text>
                  ),
              },
              {
                title: "说明",
                key: "caption",
                render: (_, item) =>
                  item.caption ? (
                    <Typography.Text>{item.caption}</Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">无</Typography.Text>
                  ),
              },
              {
                title: "标签",
                key: "tags",
                width: 260,
                render: (_, item) =>
                  item.tags.length ? (
                    <Space size={4} wrap>
                      {item.tags.map((t) => (
                        <Tag key={t} color="geekblue" style={{ marginInlineEnd: 0 }}>
                          {t}
                        </Tag>
                      ))}
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">无</Typography.Text>
                  ),
              },
            ]}
          />
        )}
      </Card>

      <ItemEditDrawer
        datasetId={id}
        item={editing}
        items={items}
        onNavigate={setEditing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          // 保存后仅刷新数据，不关闭抽屉，保持停留在当前条目。
          const res = await api.listDatasetItems(id);
          setItems(res.items);
          setEditing(
            (cur) => res.items.find((it) => it.id === cur?.id) ?? null,
          );
        }}
        onCropped={async (updatedId) => {
          const res = await api.listDatasetItems(id);
          setItems(res.items);
          setEditing(res.items.find((it) => it.id === updatedId) ?? null);
        }}
        onRemove={async () => {
          if (!editing) return;
          const removedId = editing.id;
          const idx = items.findIndex((it) => it.id === removedId);
          await api.removeDatasetItems(id, [removedId]);
          const res = await api.listDatasetItems(id);
          setItems(res.items);
          await loadDataset();
          // 移除后自动前往下一张（原本紧随其后的条目现位于同一索引）。
          const next =
            res.items[idx] ?? res.items[res.items.length - 1] ?? null;
          setEditing(next);
        }}
      />

      {dataset && (
        <ImportModal
          open={importOpen}
          dataset={dataset}
          existingIds={new Set(items.map((it) => it.id))}
          onClose={() => setImportOpen(false)}
          onDone={async () => {
            setImportOpen(false);
            await Promise.all([loadItems(), loadDataset()]);
          }}
        />
      )}

      {dataset && dataset.type === "image" && (
        <AnnotateModal
          open={annotateOpen}
          datasetId={id}
          items={items as ImageModel[]}
          selectedIds={selectedRowKeys}
          onClose={() => setAnnotateOpen(false)}
          onDone={async () => {
            await loadItems();
          }}
        />
      )}

      {dataset && dataset.type === "image" && (
        <BatchCropModal
          open={batchCropOpen}
          images={(items as ImageModel[]).filter(
            (image) =>
              selectedRowKeys.length === 0 || selectedRowKeys.includes(image.id),
          )}
          onClose={() => setBatchCropOpen(false)}
          onDone={async () => {
            setSelectedRowKeys([]);
            await loadItems();
          }}
        />
      )}

      {dataset && dataset.type === "image" && (
        <ExportModal
          open={exportMode !== null}
          mode={exportMode ?? "export"}
          datasetId={id}
          datasetBaseModel={dataset.base_model || DEFAULT_BASE_MODEL}
          items={items as ImageModel[]}
          selectedIds={selectedRowKeys}
          onClose={() => setExportMode(null)}
        />
      )}

      {dataset && dataset.type === "image" && (
        <BatchCaptionReplaceModal
          open={batchCaptionOpen}
          datasetId={id}
          items={items}
          onClose={() => setBatchCaptionOpen(false)}
          onDone={async () => {
            await loadItems();
          }}
        />
      )}
    </div>
  );
}

/** 编辑数据集内某条目的标签与说明（仅对当前数据集生效，不影响原始素材）。 */
function ItemEditDrawer({
  datasetId,
  item,
  items,
  onNavigate,
  onClose,
  onSaved,
  onCropped,
  onRemove,
}: {
  datasetId: string;
  item: ImageModel | Video | null;
  items: (ImageModel | Video)[];
  onNavigate: (item: ImageModel | Video) => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onCropped: (updatedId: string) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  // 裁剪压缩：仅预览，确认后才实施。
  const [cropping, setCropping] = useState(false);
  const [cropPreset, setCropPreset] = useState("1024x1024");
  const [cropSize, setCropSize] = useState({ width: 1024, height: 1024 });
  const [crop, setCrop] = useState<PercentCrop>();
  const [applyingCrop, setApplyingCrop] = useState(false);

  useEffect(() => {
    if (item) {
      setCaption(item.caption ?? "");
      setTags(item.tags ?? []);
      setCropping(false);
    }
  }, [item]);

  const index = item ? items.findIndex((it) => it.id === item.id) : -1;
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < items.length - 1;
  const goPrev = () => hasPrev && onNavigate(items[index - 1]);
  const goNext = () => hasNext && onNavigate(items[index + 1]);

  // 依据目标尺寸的宽高比，在原图中央给出可容纳的最大裁剪框（百分比）。
  const buildCenteredCrop = (
    imgWidth: number,
    imgHeight: number,
    targetWidth: number,
    targetHeight: number,
  ): PercentCrop => {
    const aspect = targetWidth / targetHeight;
    let cw = imgWidth;
    let ch = imgWidth / aspect;
    if (ch > imgHeight) {
      ch = imgHeight;
      cw = imgHeight * aspect;
    }
    return {
      unit: "%",
      width: (cw / imgWidth) * 100,
      height: (ch / imgHeight) * 100,
      x: ((imgWidth - cw) / 2 / imgWidth) * 100,
      y: ((imgHeight - ch) / 2 / imgHeight) * 100,
    };
  };

  const startCropping = () => {
    if (!item || !isImage(item)) return;
    const preset =
      CROP_SIZE_PRESETS.find((p) => p.value === cropPreset) ??
      CROP_SIZE_PRESETS[2];
    setCropPreset(preset.value);
    setCropSize({ width: preset.width, height: preset.height });
    setCrop(
      buildCenteredCrop(item.width, item.height, preset.width, preset.height),
    );
    setCropping(true);
  };

  const applyCropPreset = (value: string) => {
    const preset = CROP_SIZE_PRESETS.find((p) => p.value === value);
    if (!preset || !item || !isImage(item)) return;
    setCropPreset(value);
    setCropSize({ width: preset.width, height: preset.height });
    setCrop(
      buildCenteredCrop(item.width, item.height, preset.width, preset.height),
    );
  };

  const confirmCrop = async () => {
    if (!item || !isImage(item) || !crop?.width || !crop?.height) return;
    setApplyingCrop(true);
    try {
      const result = await api.cropResizeImage(item.id, {
        x: Math.round((crop.x / 100) * item.width),
        y: Math.round((crop.y / 100) * item.height),
        width: Math.round((crop.width / 100) * item.width),
        height: Math.round((crop.height / 100) * item.height),
        target_width: cropSize.width,
        target_height: cropSize.height,
      });
      message.success(
        `已裁剪压缩为 ${result.image.width}×${result.image.height}`,
      );
      setCropping(false);
      await onCropped(item.id);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setApplyingCrop(false);
    }
  };

  const handleOk = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await api.updateDatasetItem(datasetId, item.id, { caption, tags });
      message.success("已保存（仅对当前数据集生效）");
      await onSaved();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!item) return;
    setRemoving(true);
    try {
      await onRemove();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setRemoving(false);
    }
  };

  const showImage = item !== null && isImage(item);
  const imageUrl =
    item !== null && isImage(item)
      ? `/api/images/${encodeURIComponent(item.id)}/raw?v=${encodeURIComponent(item.sha256)}`
      : "";

  return (
    <Drawer
      title={
        <Space>
          <span>编辑标签与说明</span>
          {index >= 0 && (
            <Typography.Text type="secondary" style={{ fontWeight: "normal" }}>
              {index + 1} / {items.length}
            </Typography.Text>
          )}
        </Space>
      }
      placement="right"
      width="50%"
      open={item !== null}
      onClose={onClose}
      destroyOnClose
      extra={
        cropping ? (
          <Space>
            <Button onClick={() => setCropping(false)}>取消裁剪</Button>
            <Button
              type="primary"
              icon={<ScissorOutlined />}
              loading={applyingCrop}
              disabled={!crop?.width || !crop?.height}
              onClick={() => void confirmCrop()}
            >
              确认裁剪压缩
            </Button>
          </Space>
        ) : (
          <Space>
            <Button icon={<LeftOutlined />} disabled={!hasPrev} onClick={goPrev}>
              上一张
            </Button>
            <Button
              icon={<RightOutlined />}
              disabled={!hasNext}
              onClick={goNext}
            >
              下一张
            </Button>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleOk}>
              保存
            </Button>
          </Space>
        )
      }
      footer={
        cropping ? null : (
          <Popconfirm
            title="确认从当前数据集移除该条目？"
            okText="移除"
            okButtonProps={{ danger: true }}
            onConfirm={handleRemove}
          >
            <Button danger block loading={removing}>
              从数据集移除
            </Button>
          </Popconfirm>
        )
      }
    >
      {cropping && showImage ? (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="先选择目标尺寸（自动按比例给出裁剪框），再拖动/缩放选择保留区域"
            description="仅预览，确认后才会按目标尺寸压缩裁剪并更新当前图片。原物理图片会保留。"
          />
          <Space align="center" wrap>
            <Typography.Text style={{ whiteSpace: "nowrap" }}>
              目标尺寸
            </Typography.Text>
            <Select
              value={cropPreset}
              onChange={applyCropPreset}
              style={{ width: 220 }}
              options={CROP_SIZE_PRESETS.map((p) => ({
                value: p.value,
                label: p.label,
              }))}
            />
            <Typography.Text type="secondary">
              输出 {cropSize.width}×{cropSize.height}
            </Typography.Text>
          </Space>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              maxHeight: "calc(100vh - 320px)",
              overflow: "auto",
              background: "#11141a",
              borderRadius: 8,
            }}
          >
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              aspect={cropSize.width / cropSize.height}
              keepSelection
            >
              <img
                src={imageUrl}
                alt={item.title || item.id}
                style={{ maxWidth: "100%", maxHeight: "calc(100vh - 340px)" }}
              />
            </ReactCrop>
          </div>
        </Space>
      ) : (
        <>
          {showImage ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 12,
                background: "#000",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <Image
                src={imageUrl}
                alt={item.title}
                style={{ maxHeight: 420, objectFit: "contain" }}
              />
            </div>
          ) : item ? (
            <Typography.Title level={5} style={{ marginBottom: 16 }}>
              {item.title}
            </Typography.Title>
          ) : null}
          {showImage && (
            <Button
              block
              icon={<ScissorOutlined />}
              style={{ marginBottom: 16 }}
              onClick={startCropping}
            >
              裁剪压缩
            </Button>
          )}
          <Typography.Paragraph type="secondary">
            默认取自原始素材；此处的修改只对当前数据集生效，不影响素材库中的原图。
          </Typography.Paragraph>
          <Form layout="vertical">
            <Form.Item label="说明（Caption）">
              <Input.TextArea
                rows={6}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="用于训练的描述文本"
                showCount
              />
            </Form.Item>
            <Form.Item label="标签">
              <Select
                mode="tags"
                value={tags}
                onChange={setTags}
                style={{ width: "100%" }}
                placeholder="输入后回车添加多个标签"
                tokenSeparators={[","]}
              />
            </Form.Item>
          </Form>
        </>
      )}
    </Drawer>
  );
}

/** AI 标注：调用配置的 LLM 视觉模型，按模板批量/单独生成图片 Caption。 */
function AnnotateModal({
  open,
  datasetId,
  items,
  selectedIds,
  onClose,
  onDone,
}: {
  open: boolean;
  datasetId: string;
  items: ImageModel[];
  selectedIds: string[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [templateKey, setTemplateKey] = useState<string>(
    ANNOTATION_TEMPLATES[0].key,
  );
  const [aspects, setAspects] = useState<string[]>([
    ...CHARACTER_ASPECTS.map((aspect) => aspect.key),
  ]);
  const [actionAspects, setActionAspects] = useState<string[]>(DEFAULT_ACTION_ASPECTS);
  const [triggerWord, setTriggerWord] = useState("");
  const [prependTrigger, setPrependTrigger] = useState(true);
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [overwrite, setOverwrite] = useState(true);
  const [userText, setUserText] = useState("");
  const [language, setLanguage] = useState<AnnotationLanguage>("en");
  const [includeContext, setIncludeContext] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [results, setResults] = useState<AnnotateResult[] | null>(null);

  const template = useMemo(
    () =>
      ANNOTATION_TEMPLATES.find((t) => t.key === templateKey) ??
      ANNOTATION_TEMPLATES[0],
    [templateKey],
  );

  // 动作概念使用固定自然语言触发短语；其它模板沿用统一设定。
  useEffect(() => {
    if (!open) return;
    setResults(null);
    setProgress({ done: 0, total: 0 });
    setScope(selectedIds.length > 0 ? "selected" : "all");
    if (templateKey === "action") {
      setActionAspects(DEFAULT_ACTION_ASPECTS);
      setTriggerWord(ACTION_TRIGGER_WORD);
      setPrependTrigger(true);
      setLanguage("zh");
      setIncludeContext(true);
      return;
    }
    api
      .getAnnotationConfig()
      .then((cfg) => setTriggerWord(cfg.trigger_word ?? ""))
      .catch(() => undefined);
  }, [open, selectedIds.length, templateKey]);

  const systemPrompt = useMemo(
    () => template.build(template.supportsActionAspects ? actionAspects : aspects, language),
    [template, aspects, actionAspects, language],
  );

  const targetIds = useMemo(
    () =>
      scope === "selected" && selectedIds.length > 0
        ? selectedIds
        : items.map((it) => it.id),
    [scope, selectedIds, items],
  );

  /** 组合发送给模型的用户侧文本：附加提示 + 可选的已有 tag/Caption 上下文。 */
  const buildUserText = useCallback(
    (item: ImageModel | undefined): string => {
      const parts: string[] = [];
      const base = userText.trim();
      if (base) parts.push(base);
      if (includeContext && item) {
        const ctx: string[] = [];
        if (templateKey !== "action" && item.caption?.trim()) {
          ctx.push(`Existing caption: ${item.caption.trim()}`);
        }
        if (item.tags?.length) {
          const tags = templateKey === "action"
            ? item.tags.filter((tag) =>
                ACTION_CONTEXT_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix)),
              )
            : item.tags;
          if (tags.length) ctx.push(`Existing tags: ${tags.join(", ")}`);
        }
        if (ctx.length) {
          parts.push(
            `Use the existing metadata below as reference if helpful. ${ctx.join(
              ". ",
            )}.`,
          );
        }
      }
      return parts.join(" ");
    },
    [userText, includeContext, templateKey],
  );

  const handleRun = async () => {
    if (targetIds.length === 0) {
      message.warning("没有可标注的图片");
      return;
    }
    setRunning(true);
    setResults(null);
    setProgress({ done: 0, total: targetIds.length });
    try {
      // 持久化触发词这一“统一设定”。
      if (template.supportsTrigger) {
        await api
          .saveAnnotationConfig({ trigger_word: triggerWord.trim() })
          .catch(() => undefined);
      }
      // 逐张调用以便展示进度；单张失败不影响后续。
      const all: AnnotateResult[] = [];
      for (const itemId of targetIds) {
        const item = items.find((it) => it.id === itemId);
        const perUserText = buildUserText(item);
        try {
          const res = await api.annotateDatasetItems(datasetId, {
            item_ids: [itemId],
            system_prompt: systemPrompt,
            user_text: perUserText || undefined,
            trigger_word: template.supportsTrigger
              ? triggerWord.trim()
              : undefined,
            prepend_trigger: template.supportsTrigger && prependTrigger,
            overwrite,
            excluded_aspects: template.supportsAspects
              ? CHARACTER_ASPECTS.filter(
                  (aspect) => !aspects.includes(aspect.key),
                ).map((aspect) => aspect.key)
              : template.supportsActionAspects
                ? ACTION_ASPECTS.filter(
                    (aspect) => !actionAspects.includes(aspect.key),
                  ).flatMap((aspect) => aspect.excludedKeys)
              : undefined,
          });
          all.push(...res.results);
        } catch (err) {
          all.push({
            item_id: itemId,
            ok: false,
            error: (err as Error).message,
          });
        }
        setProgress({ done: all.length, total: targetIds.length });
        setResults([...all]);
      }
      const okCount = all.filter((r) => r.ok && !r.skipped).length;
      const failCount = all.filter((r) => !r.ok).length;
      if (failCount === 0) {
        message.success(`标注完成，成功 ${okCount} 张`);
      } else {
        message.warning(`完成：成功 ${okCount} 张，失败 ${failCount} 张`);
      }
      await onDone();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <Modal
      title="AI 标注"
      open={open}
      onCancel={running ? undefined : onClose}
      width={820}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose} disabled={running}>
          关闭
        </Button>,
        <Button
          key="run"
          type="primary"
          loading={running}
          onClick={handleRun}
          disabled={targetIds.length === 0}
        >
          {running ? "标注中…" : `开始标注（${targetIds.length} 张）`}
        </Button>,
      ]}
    >
      <Form layout="vertical">
        <Form.Item label="标注模板" style={{ marginBottom: 12 }}>
          <Select
            value={templateKey}
            onChange={setTemplateKey}
            options={ANNOTATION_TEMPLATES.map((t) => ({
              value: t.key,
              label: t.label,
            }))}
          />
        </Form.Item>

        {template.supportsAspects && (
          <Form.Item
            label={
              <Space size={4}>
                <span>需要描述的维度（{aspects.length}/{CHARACTER_ASPECTS.length}）</span>
                <Button
                  type="link"
                  size="small"
                  onClick={() =>
                    setAspects(CHARACTER_ASPECTS.map((aspect) => aspect.key))
                  }
                >
                  全选
                </Button>
                <Button type="link" size="small" onClick={() => setAspects([])}>
                  清空
                </Button>
              </Space>
            }
            style={{ marginBottom: 12 }}
            tooltip="勾选=描述该维度；取消勾选=在提示词中强制要求绝对不描述、不提及该维度。"
          >
            <Checkbox.Group
              className="annotation-aspect-grid"
              value={aspects}
              onChange={(v) => setAspects(v as string[])}
              options={CHARACTER_ASPECTS.map((a) => ({
                value: a.key,
                label: a.label,
              }))}
            />
            <Typography.Text
              type="secondary"
              style={{ display: "block", fontSize: 12, marginTop: 4 }}
            >
              未勾选的维度将被强制忽略（提示词中明确禁止提及）。
            </Typography.Text>
          </Form.Item>
        )}

        {template.supportsActionAspects && (
          <Form.Item
            label="动作标注参考内容"
            style={{ marginBottom: 12 }}
            tooltip="动作、肢体位置和悬吊状态始终标注；以下开关控制是否额外描述对应内容。关闭项会在模型输出后再次校验。"
          >
            <Checkbox.Group
              className="annotation-aspect-grid"
              value={actionAspects}
              onChange={(values) => setActionAspects(values as string[])}
              options={ACTION_ASPECTS.map((aspect) => ({
                value: aspect.key,
                label: aspect.label,
              }))}
            />
            <Typography.Text
              type="secondary"
              style={{ display: "block", fontSize: 12, marginTop: 4 }}
            >
              正式概念训练默认描述器具、人物、衣着、视角、背景和文字叠加；画质问题应通过删图处理。
            </Typography.Text>
          </Form.Item>
        )}

        {template.supportsTrigger && (
          <Space align="start" size={16} style={{ display: "flex" }}>
            <Form.Item
              label="触发词（统一设定）"
              style={{ flex: 1, marginBottom: 12 }}
              tooltip="用于训练的触发词，会加入到生成的 Caption 前；此设定会被保存并复用。"
            >
              <Input
                value={triggerWord}
                onChange={(e) => setTriggerWord(e.target.value)}
                placeholder="例如：ohwx woman"
              />
            </Form.Item>
            <Form.Item label="加入答案" style={{ marginBottom: 12 }}>
              <Tooltip title="开启后，触发词会被前置到每条生成的 Caption。">
                <Switch checked={prependTrigger} onChange={setPrependTrigger} />
              </Tooltip>
            </Form.Item>
          </Space>
        )}

        <Form.Item label="附加提示（可选）" style={{ marginBottom: 12 }}>
          <Input
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            placeholder="附加给模型的用户侧提示，可留空"
          />
        </Form.Item>

        <Space size={24} style={{ display: "flex", marginBottom: 4 }}>
          <Form.Item label="输出语言" style={{ marginBottom: 8 }}>
            <Radio.Group
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <Radio.Button value="en">英文</Radio.Button>
              <Radio.Button value="zh">中文</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="传入已有标签/说明"
            style={{ marginBottom: 8 }}
            tooltip="开启后，会把当前数据集内该图片已有的说明与标签作为参考一并发送给模型。"
          >
            <Switch checked={includeContext} onChange={setIncludeContext} />
          </Form.Item>
        </Space>

        <Space size={24} style={{ display: "flex", marginBottom: 4 }}>
          <Form.Item label="标注范围" style={{ marginBottom: 8 }}>
            <Radio.Group
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <Radio.Button
                value="selected"
                disabled={selectedIds.length === 0}
              >
                仅选中（{selectedIds.length}）
              </Radio.Button>
              <Radio.Button value="all">全部（{items.length}）</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="覆盖已有说明"
            style={{ marginBottom: 8 }}
            tooltip="关闭后仅为“说明”为空的图片生成，已有说明的将跳过。"
          >
            <Switch checked={overwrite} onChange={setOverwrite} />
          </Form.Item>
        </Space>

        <Divider style={{ margin: "8px 0" }} />

        <Form.Item
          label="系统生成的提示词（发送给模型，可见）"
          style={{ marginBottom: 8 }}
        >
          <Input.TextArea
            value={systemPrompt}
            readOnly
            autoSize={{ minRows: 3, maxRows: 8 }}
            style={{ fontFamily: "monospace", fontSize: 12 }}
          />
        </Form.Item>
      </Form>

      {(running || progress.done > 0) && progress.total > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Progress
            percent={Math.round((progress.done / progress.total) * 100)}
            status={running ? "active" : "normal"}
            format={() => `${progress.done}/${progress.total}`}
          />
        </div>
      )}

      {results && failed.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`有 ${failed.length} 张标注失败`}
          description={
            <div style={{ maxHeight: 120, overflow: "auto" }}>
              {failed.map((r) => (
                <div key={r.item_id}>
                  <Typography.Text type="secondary">
                    {r.item_id}: {r.error}
                  </Typography.Text>
                </div>
              ))}
            </div>
          }
        />
      )}
    </Modal>
  );
}

/** 分辨率分桶预设。 */
const RESOLUTION_OPTIONS = [
  { label: "自动（按图片最高可用，最多 1024）", value: "auto" },
  { label: "512 / 768 / 1024（推荐）", value: "512,768,1024" },
  { label: "768 / 1024", value: "768,1024" },
  { label: "仅 1024", value: "1024" },
];

/** 批量替换当前数据集所有条目 Caption 中匹配到的词。 */
function BatchCaptionReplaceModal({
  open,
  datasetId,
  items,
  onClose,
  onDone,
}: {
  open: boolean;
  datasetId: string;
  items: (ImageModel | Video)[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [find, setFind] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (open) {
      setFind("");
      setReplaceWith("");
    }
  }, [open]);

  const matched = useMemo(() => {
    if (!find) return { count: 0, occurrences: 0 };
    let count = 0;
    let occurrences = 0;
    for (const item of items) {
      const caption = item.caption || "";
      if (caption.includes(find)) {
        count += 1;
        occurrences += caption.split(find).length - 1;
      }
    }
    return { count, occurrences };
  }, [items, find]);

  const submit = async () => {
    if (!find) {
      message.warning("请填写要替换的词");
      return;
    }
    setRunning(true);
    try {
      let changed = 0;
      for (const item of items) {
        const caption = item.caption || "";
        if (!caption.includes(find)) continue; // 只替换匹配到的
        const next = caption.split(find).join(replaceWith);
        if (next === caption) continue;
        await api.updateDatasetItem(datasetId, item.id, { caption: next });
        changed += 1;
      }
      if (changed > 0) message.success(`已更新 ${changed} 条 Caption`);
      else message.info("没有命中的 Caption");
      await onDone();
      onClose();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open={open}
      title="批量替换 Caption"
      onCancel={onClose}
      onOk={submit}
      okText={`替换（命中 ${matched.count} 条）`}
      okButtonProps={{
        loading: running,
        disabled: !find || matched.count === 0,
      }}
      cancelText="取消"
      destroyOnHidden
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          在当前数据集所有条目的 Caption 中，把「要替换的词」替换为「替换用的词」。仅修改命中的条目，其余保持不变；替换用的词留空表示删除该词。
        </Typography.Paragraph>
        <div>
          <Typography.Text strong>要替换的词</Typography.Text>
          <Input
            style={{ marginTop: 6 }}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="被匹配的原词 / 短语"
          />
        </div>
        <div>
          <Typography.Text strong>替换用的词</Typography.Text>
          <Input
            style={{ marginTop: 6 }}
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
            placeholder="替换后的词（留空表示删除）"
          />
        </div>
        <Alert
          type={find && matched.count === 0 ? "warning" : "info"}
          showIcon
          message={
            find
              ? `命中 ${matched.count} 条 Caption，共 ${matched.occurrences} 处将被替换`
              : "填写要替换的词后显示命中数量"
          }
        />
      </Space>
    </Modal>
  );
}

/** 导出为 ai-toolkit 的 LoRA 训练包。 */
function ExportModal({
  open,
  mode,
  datasetId,
  datasetBaseModel,
  items,
  selectedIds,
  onClose,
}: {
  open: boolean;
  mode: "export" | "dispatch";
  datasetId: string;
  datasetBaseModel: string;
  items: ImageModel[];
  selectedIds: string[];
  onClose: () => void;
}) {
  const [baseModels, setBaseModels] = useState<ExportBaseModel[]>([]);
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [baseModel, setBaseModel] = useState(datasetBaseModel || DEFAULT_BASE_MODEL);
  const [preset, setPreset] = useState("character");
  const [scope, setScope] = useState<"selected" | "all">("all");
  const [onlyCaptioned, setOnlyCaptioned] = useState(true);
  const [resolution, setResolution] = useState("auto");
  const [rank, setRank] = useState(32);
  const [trainingSteps, setTrainingSteps] = useState(800);
  const [learningRate, setLearningRate] = useState(0.0001);
  const [triggerWord, setTriggerWord] = useState("");
  const [samplePrompts, setSamplePrompts] = useState("");
  // 显存 / 速度（对应 ai-toolkit 设置，默认沿用底模推荐值）。
  const [gradientCheckpointing, setGradientCheckpointing] = useState(true);
  const [quantize, setQuantize] = useState(true);
  const [quantizeTe, setQuantizeTe] = useState(true);
  const [lowVram, setLowVram] = useState(false);
  const [nodes, setNodes] = useState<AiToolkitNode[]>([]);
  const [nodeId, setNodeId] = useState<string | undefined>();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBaseModel(datasetBaseModel || DEFAULT_BASE_MODEL);
    setScope(selectedIds.length > 0 ? "selected" : "all");
    void api
      .getExportOptions()
      .then((res) => {
        setBaseModels(res.base_models);
        setPresets(res.presets);
      })
      .catch(() => {
        /* 选项拉取失败时用默认值 */
      });
    if (mode === "dispatch") {
      void api
        .listAiToolkitNodes()
        .then((result) => {
          const enabled = result.filter((node) => node.enabled);
          setNodes(enabled);
          setNodeId((current) =>
            enabled.some((node) => node.id === current)
              ? current
              : enabled[0]?.id,
          );
        })
        .catch((err) => message.error(`加载训练节点失败：${err.message}`));
    }
  }, [open, mode, selectedIds.length, datasetBaseModel]);

  const currentPreset = presets.find((p) => p.value === preset);
  const scopeItems =
    scope === "selected"
      ? items.filter((it) => selectedIds.includes(it.id))
      : items;
  const captionedCount = scopeItems.filter(
    (it) => (it.caption || "").trim().length > 0,
  ).length;
  const exportCount = onlyCaptioned ? captionedCount : scopeItems.length;

  const applyPresetDefaults = (presetValue: string, count = exportCount) => {
    const selectedPreset = presets.find((item) => item.value === presetValue);
    if (!selectedPreset) return;
    setPreset(presetValue);
    setRank(selectedPreset.rank);
    setLearningRate(selectedPreset.learning_rate);
    setTrainingSteps(
      Math.max(
        selectedPreset.min_steps,
        Math.min(selectedPreset.max_steps, Math.max(count, 1) * selectedPreset.steps_per_image),
      ),
    );
    setTriggerWord(selectedPreset.trigger_word);
    setSamplePrompts(selectedPreset.sample_prompts.join("\n"));
  };

  useEffect(() => {
    if (!open || !currentPreset) return;
    setTrainingSteps(
      Math.max(
        currentPreset.min_steps,
        Math.min(
          currentPreset.max_steps,
          Math.max(exportCount, 1) * currentPreset.steps_per_image,
        ),
      ),
    );
  }, [open, exportCount, currentPreset]);

  useEffect(() => {
    if (!open || presets.length === 0) return;
    applyPresetDefaults(preset);
    // 仅在选项首次加载时初始化整组推荐值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presets]);

  // 依据所选底模的 ai-toolkit 推荐值初始化显存/速度开关。
  useEffect(() => {
    if (!open) return;
    const model = baseModels.find((m) => m.value === baseModel);
    const defaults = model?.memory_defaults;
    if (defaults) {
      setGradientCheckpointing(defaults.gradient_checkpointing);
      setQuantize(defaults.quantize);
      setQuantizeTe(defaults.quantize_te);
      setLowVram(defaults.low_vram);
    }
  }, [open, baseModel, baseModels]);

  const handleExport = async () => {
    if (exportCount === 0) {
      message.warning("没有可导出的图片（可能都缺少 Caption）");
      return;
    }
    if (mode === "dispatch" && !nodeId) {
      message.warning("请先添加并选择一个已启用的 ai-toolkit 节点");
      return;
    }
    setRunning(true);
    try {
      const payload = {
        base_model: baseModel,
        preset,
        trigger_word: triggerWord,
        rank,
        learning_rate: learningRate,
        steps: trainingSteps,
        sample_prompts: samplePrompts
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
        resolution:
          resolution === "auto"
            ? undefined
            : resolution.split(",").map((r) => Number(r)),
        item_ids: scope === "selected" ? selectedIds : undefined,
        only_captioned: onlyCaptioned,
        gradient_checkpointing: gradientCheckpointing,
        quantize,
        quantize_te: quantizeTe,
        low_vram: lowVram,
      };
      if (mode === "dispatch") {
        const task = await api.dispatchTrainingTask(datasetId, {
          ...payload,
          node_id: nodeId!,
        });
        message.success(`训练任务已提交：${task.id.slice(0, 8)}`);
      } else {
        const { blob, filename } = await api.exportDataset(datasetId, payload);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        message.success(`已导出 ${filename}`);
      }
      onClose();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open={open}
      title={mode === "dispatch" ? "发送训练任务到 ai-toolkit" : "导出训练包（ai-toolkit LoRA）"}
      width={640}
      onCancel={onClose}
      onOk={handleExport}
      okText={`${mode === "dispatch" ? "发送" : "导出"}（${exportCount} 张）`}
      okButtonProps={{
        loading: running,
        disabled: exportCount === 0 || (mode === "dispatch" && !nodeId),
      }}
      cancelText="取消"
    >
      <Tabs
        defaultActiveKey="basic"
        items={[
          {
            key: "basic",
            label: "普通设置",
            children: (
              <Space
                direction="vertical"
                size="middle"
                style={{ width: "100%" }}
              >
                {mode === "dispatch" && (
                  <div>
                    <Typography.Text strong>目标节点</Typography.Text>
                    <Select
                      style={{ width: "100%", marginTop: 6 }}
                      value={nodeId}
                      onChange={setNodeId}
                      placeholder="选择已启用的 ai-toolkit 节点"
                      options={nodes.map((node) => ({
                        value: node.id,
                        label: `${node.name}（${node.base_url}）`,
                      }))}
                      notFoundContent="暂无可用节点，请先到“训练节点”页面添加"
                    />
                  </div>
                )}

                <div>
                  <Typography.Text strong>底模</Typography.Text>
                  <Select
                    style={{ width: "100%", marginTop: 6 }}
                    value={baseModel}
                    onChange={setBaseModel}
                    options={baseModels.map((m) => ({
                      label: m.label,
                      value: m.value,
                    }))}
                    showSearch
                    popupMatchSelectWidth={false}
                  />
                  <Input
                    style={{ marginTop: 6 }}
                    placeholder="或填写自定义模型名，如 krea/Krea-2-Raw"
                    value={baseModel}
                    onChange={(e) => setBaseModel(e.target.value)}
                  />
                </div>

                <div>
                  <Typography.Text strong>训练预设</Typography.Text>
                  <Radio.Group
                    style={{ display: "block", marginTop: 6 }}
                    value={preset}
                    onChange={(e) => applyPresetDefaults(e.target.value)}
                  >
                    <Space direction="vertical">
                      {presets.map((p) => (
                        <Radio key={p.value} value={p.value}>
                          {p.label}
                          <Typography.Text
                            type="secondary"
                            style={{ marginLeft: 8 }}
                          >
                            rank {p.rank}，每图约 {p.steps_per_image} 步
                          </Typography.Text>
                        </Radio>
                      ))}
                    </Space>
                  </Radio.Group>
                </div>

                <div>
                  <Typography.Text strong>模型触发词</Typography.Text>
                  <Input
                    style={{ marginTop: 6 }}
                    value={triggerWord}
                    onChange={(event) => setTriggerWord(event.target.value)}
                    placeholder="会写入训练配置；Caption 应包含该词"
                  />
                </div>

                <div>
                  <Typography.Text strong>
                    测试集（测试提示词，每行一条）
                  </Typography.Text>
                  <Input.TextArea
                    rows={3}
                    style={{ marginTop: 6 }}
                    value={samplePrompts}
                    onChange={(event) => setSamplePrompts(event.target.value)}
                  />
                </div>

                <div>
                  <Typography.Text strong>导出范围</Typography.Text>
                  <Radio.Group
                    style={{ display: "block", marginTop: 6 }}
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  >
                    <Radio value="selected" disabled={selectedIds.length === 0}>
                      仅选中（{selectedIds.length}）
                    </Radio>
                    <Radio value="all">全部（{items.length}）</Radio>
                  </Radio.Group>
                </div>

                <Space>
                  <Switch checked={onlyCaptioned} onChange={setOnlyCaptioned} />
                  <Typography.Text>仅导出已有 Caption 的图片</Typography.Text>
                </Space>
              </Space>
            ),
          },
          {
            key: "advanced",
            label: "高阶设置",
            children: (
              <Space
                direction="vertical"
                size="middle"
                style={{ width: "100%" }}
              >
                <Divider orientation="left" plain style={{ margin: "4px 0" }}>
                  训练参数
                </Divider>

                <Space size="middle" wrap>
                  <div>
                    <Typography.Text strong>训练步数 Training Steps</Typography.Text>
                    <InputNumber
                      min={1}
                      max={1000000}
                      step={100}
                      value={trainingSteps}
                      style={{ width: 190, marginTop: 6, display: "block" }}
                      onChange={(value) => setTrainingSteps(value ?? 800)}
                    />
                  </div>
                  <div>
                    <Typography.Text strong>学习率 Learning Rate</Typography.Text>
                    <InputNumber
                      min="0.000001"
                      max="1"
                      step="0.00001"
                      stringMode
                      value={String(learningRate)}
                      style={{ width: 190, marginTop: 6, display: "block" }}
                      onChange={(value) => setLearningRate(Number(value ?? 0.0001))}
                    />
                  </div>
                  <div>
                    <Typography.Text strong>LoRA 阶数 LoRA Rank</Typography.Text>
                    <InputNumber
                      min={1}
                      max={512}
                      step={8}
                      value={rank}
                      style={{ width: 190, marginTop: 6, display: "block" }}
                      onChange={(value) => setRank(value ?? 16)}
                    />
                  </div>
                </Space>

                <Space size="large" wrap>
                  <div>
                    <Typography.Text strong>分辨率分桶</Typography.Text>
                    <Select
                      style={{ width: 220, marginTop: 6, display: "block" }}
                      value={resolution}
                      onChange={setResolution}
                      options={RESOLUTION_OPTIONS}
                    />
                  </div>
                </Space>

                <Divider orientation="left" plain style={{ margin: "4px 0" }}>
                  显存 / 速度（优化项）
                </Divider>
                <Alert
                  type="info"
                  showIcon
                  message="对应 ai-toolkit 显存设置。显存充足时关闭「梯度检查点 / 量化」可用显存换速度（更快、更精确）；默认沿用底模推荐值。"
                />
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  <Space align="center">
                    <Switch
                      checked={gradientCheckpointing}
                      onChange={setGradientCheckpointing}
                    />
                    <span>
                      <Typography.Text strong>
                        梯度检查点（gradient_checkpointing）
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{ marginLeft: 8 }}
                      >
                        开启省显存 · 关闭更快
                      </Typography.Text>
                    </span>
                  </Space>
                  <Space align="center">
                    <Switch checked={quantize} onChange={setQuantize} />
                    <span>
                      <Typography.Text strong>量化底模（quantize）</Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{ marginLeft: 8 }}
                      >
                        开启省显存 · 关闭更快更精确
                      </Typography.Text>
                    </span>
                  </Space>
                  <Space align="center">
                    <Switch checked={quantizeTe} onChange={setQuantizeTe} />
                    <span>
                      <Typography.Text strong>
                        量化文本编码器（quantize_te）
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{ marginLeft: 8 }}
                      >
                        开启省显存
                      </Typography.Text>
                    </span>
                  </Space>
                  <Space align="center">
                    <Switch checked={lowVram} onChange={setLowVram} />
                    <span>
                      <Typography.Text strong>低显存模式（low_vram）</Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{ marginLeft: 8 }}
                      >
                        开启更省显存 · 但更慢
                      </Typography.Text>
                    </span>
                  </Space>
                </Space>
              </Space>
            ),
          },
        ]}
      />

      <Alert
        type="info"
        showIcon
        style={{ marginTop: 12 }}
        message={`将${mode === "dispatch" ? "发送" : "导出"} ${exportCount} 张图片（含同名 .txt Caption）和 ai-toolkit 训练配置。`}
        description={
          mode === "dispatch"
            ? "调度器将在后台上传数据集、创建远端 Job 并加入节点训练队列；进度可在“训练节点”页面查看。"
            : "产物为 zip：dataset/ 目录（图片 + .txt） + {name}.yaml + README.txt。放入 ai-toolkit 后运行 python run.py {name}.yaml。"
        }
      />
    </Modal>
  );
}

interface ImportModalProps {
  open: boolean;
  dataset: Dataset;
  existingIds: Set<string>;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}

type PickRow =
  | { kind: "folder"; key: string; id: string; name: string; count: number }
  | { kind: "file"; key: string; item: ImageModel | Video };

function ImportModal({
  open,
  dataset,
  existingIds,
  onClose,
  onDone,
}: ImportModalProps) {
  const isImg = dataset.type === "image";
  const [library, setLibrary] = useState<(ImageModel | Video)[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChecked([]);
    setCurrentGroupId(null);
    setKeyword("");
    setLoading(true);
    const itemsP = isImg ? api.listImages() : api.listVideos();
    const groupsP = isImg ? api.listImageGroups() : api.listVideoGroups();
    Promise.all([itemsP, groupsP])
      .then(([items, grps]) => {
        setLibrary(items);
        setGroups(grps.map((g) => ({ id: g.id, name: g.name })));
      })
      .catch((err) => message.error((err as Error).message))
      .finally(() => setLoading(false));
  }, [open, isImg]);

  const isRoot = (it: ImageModel | Video): boolean => {
    if (!it.group_id) return true;
    const g = groups.find((x) => x.id === it.group_id);
    return !g || g.name === UNGROUPED_NAME;
  };

  const fileName = (it: ImageModel | Video): string =>
    isImage(it) ? it.title || it.id : it.title;

  const rows: PickRow[] = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const matchKw = (it: ImageModel | Video) =>
      !kw || fileName(it).toLowerCase().includes(kw);
    if (currentGroupId === null) {
      const folderRows: PickRow[] = groups
        .filter((g) => g.name !== UNGROUPED_NAME)
        .map((g) => ({
          kind: "folder",
          key: `folder:${g.id}`,
          id: g.id,
          name: g.name,
          count: library.filter((v) => v.group_id === g.id).length,
        }));
      const fileRows: PickRow[] = library
        .filter((v) => isRoot(v) && matchKw(v))
        .map((v) => ({ kind: "file", key: v.id, item: v }));
      return [...folderRows, ...fileRows];
    }
    return library
      .filter((v) => v.group_id === currentGroupId && matchKw(v))
      .map((v) => ({ kind: "file", key: v.id, item: v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, groups, currentGroupId, keyword]);

  const currentGroup = groups.find((g) => g.id === currentGroupId) ?? null;

  // 某分组下可选（未导入）素材的 id 列表。
  const selectableInGroup = (groupId: string): string[] =>
    library
      .filter((v) => v.group_id === groupId && !existingIds.has(v.id))
      .map((v) => v.id);

  // 一行对应的可选素材 id：文件夹→整组，文件→自身。
  const collectIds = (row: PickRow): string[] => {
    if (row.kind === "folder") return selectableInGroup(row.id);
    return existingIds.has(row.item.id) ? [] : [row.item.id];
  };

  // 勾选态：文件在 checked 内即选中；文件夹在其全部可选素材都被选中时显示为选中。
  const selectedRowKeys = useMemo(() => {
    const keys: string[] = [];
    for (const row of rows) {
      if (row.kind === "file") {
        if (checked.includes(row.item.id)) keys.push(row.key);
      } else {
        const ids = library
          .filter((v) => v.group_id === row.id && !existingIds.has(v.id))
          .map((v) => v.id);
        if (ids.length > 0 && ids.every((id) => checked.includes(id)))
          keys.push(row.key);
      }
    }
    return keys;
  }, [rows, checked, library, existingIds]);

  const columns: ColumnsType<PickRow> = [
    {
      title: "名称",
      key: "name",
      ellipsis: true,
      render: (_, row) =>
        row.kind === "folder" ? (
          <Space>
            <FolderOutlined style={{ color: "#f0b34e" }} />
            <span style={{ fontWeight: 600 }}>{row.name}</span>
            <span style={{ color: "#8b90a0" }}>{row.count} 项</span>
          </Space>
        ) : isImage(row.item) ? (
          <Space>
            <span
              onClick={(e) => e.stopPropagation()}
              style={{ display: "inline-flex" }}
            >
              <Thumbnail
                seed={row.item.thumbnail_hint || row.item.id}
                imageId={row.item.id}
                preview
                size={36}
              />
            </span>
            <span>{row.item.title || row.item.id}</span>
          </Space>
        ) : (
          <span>{row.item.title}</span>
        ),
    },
    {
      title: isImg ? "分辨率" : "时长",
      key: "meta",
      width: 110,
      render: (_, row) => {
        if (row.kind !== "file") return null;
        return isImage(row.item)
          ? `${row.item.width}×${row.item.height}`
          : formatDuration(row.item.duration);
      },
    },
    {
      title: "标签",
      key: "tags",
      render: (_, row) => {
        if (row.kind !== "file") return null;
        const tags = row.item.tags;
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
      title: "状态",
      key: "status",
      width: 80,
      render: (_, row) =>
        row.kind === "file" && existingIds.has(row.item.id) ? (
          <Tag color="green">已导入</Tag>
        ) : null,
    },
  ];

  const handleOk = async () => {
    if (checked.length === 0) {
      message.info("请先选择要导入的内容");
      return;
    }
    setSaving(true);
    try {
      await api.addDatasetItems(dataset.id, checked);
      message.success(`已导入 ${checked.length} 项`);
      await onDone();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`从${TYPE_LABEL[dataset.type]}库导入`}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText={checked.length ? `导入 ${checked.length} 项` : "导入"}
      cancelText="取消"
      confirmLoading={saving}
      width={820}
      destroyOnClose
    >
      <Space
        wrap
        style={{
          marginBottom: 12,
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <Breadcrumb
          items={[
            {
              title: (
                <a onClick={() => setCurrentGroupId(null)}>
                  <HomeOutlined /> 全部
                </a>
              ),
            },
            ...(currentGroup ? [{ title: <span>{currentGroup.name}</span> }] : []),
          ]}
        />
        <Input.Search
          allowClear
          placeholder="按名称搜索"
          style={{ width: 220 }}
          onSearch={(v) => setKeyword(v || "")}
          onChange={(e) => {
            if (!e.target.value) setKeyword("");
          }}
        />
      </Space>
      <Table<PickRow>
        rowKey="key"
        loading={loading}
        dataSource={rows}
        columns={columns}
        size="middle"
        rowSelection={{
          selectedRowKeys,
          getCheckboxProps: (row) => ({
            disabled:
              row.kind === "folder"
                ? selectableInGroup(row.id).length === 0
                : existingIds.has(row.item.id),
          }),
          onSelect: (record, selected) => {
            const ids = collectIds(record);
            setChecked((prev) =>
              selected
                ? Array.from(new Set([...prev, ...ids]))
                : prev.filter((x) => !ids.includes(x)),
            );
          },
          onSelectAll: (selected, _rows, changeRows) => {
            const ids = changeRows.flatMap(collectIds);
            setChecked((prev) =>
              selected
                ? Array.from(new Set([...prev, ...ids]))
                : prev.filter((x) => !ids.includes(x)),
            );
          },
        }}
        pagination={{
          pageSize: 8,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 项`,
        }}
        onRow={(row) => ({
          onClick: () => {
            if (row.kind === "folder") {
              setCurrentGroupId(row.id);
            } else if (!existingIds.has(row.item.id)) {
              setChecked((prev) =>
                prev.includes(row.item.id)
                  ? prev.filter((x) => x !== row.item.id)
                  : [...prev, row.item.id],
              );
            }
          },
          style: { cursor: "pointer" },
        })}
      />
    </Modal>
  );
}
