import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
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
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import { PageHeader } from "@/components/PageHeader";
import { Thumbnail } from "@/components/Thumbnail";
import { api } from "@/api/client";
import type {
  AnnotateResult,
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
const CHARACTER_ASPECTS: { key: string; label: string; text: string }[] = [
  { key: "gender", label: "性别", text: "the person's gender (man or woman)" },
  { key: "hair", label: "发型", text: "hairstyle and hair color" },
  { key: "clothing", label: "衣着", text: "clothing and outfit" },
  { key: "pose", label: "姿势", text: "body pose and posture" },
  { key: "background", label: "背景", text: "background and surrounding environment" },
  {
    key: "accessories",
    label: "饰品",
    text: "accessories such as jewelry, glasses, hats",
  },
];

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
        "Write a single concise, comma-separated caption describing the person in the image, suitable for training.",
      ];
      parts.push(
        chosen.length
          ? `Describe the following aspects when visible: ${chosen
              .map((a) => a.text)
              .join(", ")}.`
          : "Focus only on the subject's core, consistent identity features (face, body type).",
      );
      if (excluded.length) {
        parts.push(
          `STRICTLY FORBIDDEN: absolutely DO NOT describe or mention ${excluded
            .map((a) => a.text)
            .join(
              ", ",
            )}. Never include any word related to these in the caption, even if clearly visible.`,
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
    build: (_aspects, language) =>
      [
        "You are an expert dataset captioner for action/pose training.",
        "Write a single concise, comma-separated caption emphasizing the person's action, pose, gesture and body movement in the image.",
        "Describe what the subject is doing rather than static identity details.",
        LANGUAGE_INSTRUCTION[language],
        "Output ONLY the caption text, no quotes, no extra words.",
      ].join(" "),
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
  const [form] = Form.useForm<{
    name: string;
    type: DatasetType;
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

  const handleCreate = async () => {
    const values = await form.validateFields();
    try {
      const ds = await api.createDataset({
        name: values.name.trim(),
        type: values.type,
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
        <Form form={form} layout="vertical" initialValues={{ type: "image" }}>
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
  const [exportOpen, setExportOpen] = useState(false);

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

  const handleRemoveItem = async (itemId: string) => {
    try {
      await api.removeDatasetItems(id, [itemId]);
      await Promise.all([loadItems(), loadDataset()]);
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
            <Space>
              {dataset.type === "image" && (
                <Button
                  icon={<RobotOutlined />}
                  onClick={() => setAnnotateOpen(true)}
                  disabled={items.length === 0}
                >
                  AI 标注
                  {selectedRowKeys.length > 0
                    ? `（选中 ${selectedRowKeys.length}）`
                    : ""}
                </Button>
              )}
              {dataset.type === "image" && (
                <Button
                  icon={<ExportOutlined />}
                  onClick={() => setExportOpen(true)}
                  disabled={items.length === 0}
                >
                  导出训练包
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
                      ratio={item.width / item.height}
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
              {
                title: "操作",
                key: "actions",
                width: 130,
                align: "center",
                render: (_, item) => (
                  <Space>
                    <Button size="small" onClick={() => setEditing(item)}>
                      编辑
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() => handleRemoveItem(item.id)}
                    >
                      移除
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <ItemEditModal
        datasetId={id}
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await loadItems();
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
        <ExportModal
          open={exportOpen}
          datasetId={id}
          items={items as ImageModel[]}
          selectedIds={selectedRowKeys}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}

/** 编辑数据集内某条目的标签与说明（仅对当前数据集生效，不影响原始素材）。 */
function ItemEditModal({
  datasetId,
  item,
  onClose,
  onSaved,
}: {
  datasetId: string;
  item: ImageModel | Video | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setCaption(item.caption ?? "");
      setTags(item.tags ?? []);
    }
  }, [item]);

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

  return (
    <Modal
      title="编辑标签与说明"
      open={item !== null}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        默认取自原始素材；此处的修改只对当前数据集生效，不影响素材库中的原图。
      </Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label="说明（Caption）">
          <Input.TextArea
            rows={4}
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
    </Modal>
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
    "gender",
    "hair",
    "clothing",
    "pose",
    "background",
    "accessories",
  ]);
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

  // 打开时载入统一设定（触发词）。
  useEffect(() => {
    if (!open) return;
    setResults(null);
    setProgress({ done: 0, total: 0 });
    setScope(selectedIds.length > 0 ? "selected" : "all");
    api
      .getAnnotationConfig()
      .then((cfg) => setTriggerWord(cfg.trigger_word ?? ""))
      .catch(() => undefined);
  }, [open, selectedIds.length]);

  const systemPrompt = useMemo(
    () => template.build(aspects, language),
    [template, aspects, language],
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
        if (item.caption?.trim()) ctx.push(`Existing caption: ${item.caption.trim()}`);
        if (item.tags?.length) ctx.push(`Existing tags: ${item.tags.join(", ")}`);
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
    [userText, includeContext],
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
      width={720}
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
            label="需要描述的维度"
            style={{ marginBottom: 12 }}
            tooltip="勾选=描述该维度；取消勾选=在提示词中强制要求绝对不描述、不提及该维度。"
          >
            <Checkbox.Group
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
  { label: "512 / 768 / 1024（推荐）", value: "512,768,1024" },
  { label: "768 / 1024", value: "768,1024" },
  { label: "仅 1024", value: "1024" },
];

/** 导出为 Qwen-Image / ai-toolkit 的 LoRA 训练包。 */
function ExportModal({
  open,
  datasetId,
  items,
  selectedIds,
  onClose,
}: {
  open: boolean;
  datasetId: string;
  items: ImageModel[];
  selectedIds: string[];
  onClose: () => void;
}) {
  const [baseModels, setBaseModels] = useState<ExportBaseModel[]>([]);
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [baseModel, setBaseModel] = useState("Qwen/Qwen-Image-2512");
  const [preset, setPreset] = useState("character");
  const [scope, setScope] = useState<"selected" | "all">("all");
  const [onlyCaptioned, setOnlyCaptioned] = useState(true);
  const [resolution, setResolution] = useState("512,768,1024");
  const [rank, setRank] = useState<number | undefined>(undefined);
  const [stepsPerImage, setStepsPerImage] = useState<number | undefined>(
    undefined,
  );
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) return;
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
  }, [open, selectedIds.length]);

  const currentPreset = presets.find((p) => p.value === preset);
  const scopeItems =
    scope === "selected"
      ? items.filter((it) => selectedIds.includes(it.id))
      : items;
  const captionedCount = scopeItems.filter(
    (it) => (it.caption || "").trim().length > 0,
  ).length;
  const exportCount = onlyCaptioned ? captionedCount : scopeItems.length;

  const handleExport = async () => {
    if (exportCount === 0) {
      message.warning("没有可导出的图片（可能都缺少 Caption）");
      return;
    }
    setRunning(true);
    try {
      const { blob, filename } = await api.exportDataset(datasetId, {
        base_model: baseModel,
        preset,
        rank,
        steps_per_image: stepsPerImage,
        resolution: resolution.split(",").map((r) => Number(r)),
        item_ids: scope === "selected" ? selectedIds : undefined,
        only_captioned: onlyCaptioned,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success(`已导出 ${filename}`);
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
      title="导出训练包（Qwen-Image / ai-toolkit）"
      width={640}
      onCancel={onClose}
      onOk={handleExport}
      okText={`导出（${exportCount} 张）`}
      okButtonProps={{ loading: running, disabled: exportCount === 0 }}
      cancelText="取消"
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Typography.Text strong>底模</Typography.Text>
          <Select
            style={{ width: "100%", marginTop: 6 }}
            value={baseModel}
            onChange={setBaseModel}
            options={baseModels.map((m) => ({ label: m.label, value: m.value }))}
            showSearch
            popupMatchSelectWidth={false}
          />
          <Input
            style={{ marginTop: 6 }}
            placeholder="或填写自定义模型名，如 Qwen/Qwen-Image"
            value={baseModel}
            onChange={(e) => setBaseModel(e.target.value)}
          />
        </div>

        <div>
          <Typography.Text strong>训练预设</Typography.Text>
          <Radio.Group
            style={{ display: "block", marginTop: 6 }}
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            <Space direction="vertical">
              {presets.map((p) => (
                <Radio key={p.value} value={p.value}>
                  {p.label}
                  <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                    rank {p.rank}，每图约 {p.steps_per_image} 步
                  </Typography.Text>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </div>

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
          <div>
            <Typography.Text strong>rank 覆盖</Typography.Text>
            <Input
              style={{ width: 140, marginTop: 6, display: "block" }}
              type="number"
              placeholder={currentPreset ? String(currentPreset.rank) : "预设"}
              value={rank ?? ""}
              onChange={(e) =>
                setRank(e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
          <div>
            <Typography.Text strong>每图步数覆盖</Typography.Text>
            <Input
              style={{ width: 140, marginTop: 6, display: "block" }}
              type="number"
              placeholder={
                currentPreset ? String(currentPreset.steps_per_image) : "预设"
              }
              value={stepsPerImage ?? ""}
              onChange={(e) =>
                setStepsPerImage(
                  e.target.value ? Number(e.target.value) : undefined,
                )
              }
            />
          </div>
        </Space>

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

        <Alert
          type="info"
          showIcon
          message={`将导出 ${exportCount} 张图片（含同名 .txt Caption）+ ai-toolkit 训练配置。`}
          description="产物为 zip：dataset/ 目录（图片 + .txt） + {name}.yaml + README.txt。放入 ai-toolkit 后运行 python run.py {name}.yaml。"
        />
      </Space>
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
