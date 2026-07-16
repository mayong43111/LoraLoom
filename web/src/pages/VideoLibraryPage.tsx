/**
 * 视频库页面。
 *
 * 视频库定位为「资源库」：维护视频的基本信息（名称、所属分组、标签）与
 * 不可编辑的硬指标（分辨率、帧率、时长、编码、大小）。页面主体是文件夹式
 * 表格：分组即文件夹，支持上传、筛选，以及对单个视频的编辑基本信息、
 * 移动分组、复制到分组、删除等操作。抽帧等能力归入独立的「工具集合」。
 */

import { useMemo, useState } from "react";
import {
  App,
  Breadcrumb,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Upload,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FolderOutlined,
  HomeOutlined,
  MoreOutlined,
  ReloadOutlined,
  SwapOutlined,
  TagsOutlined,
  ToolOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import dayjs from "dayjs";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { useLabels } from "@/api/labels";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { BatchTagModal } from "@/components/BatchTagModal";
import { EnumTag } from "@/components/EnumTag";
import { VIDEO_SOURCE_COLOR } from "@/colors";
import type { Video, VideoFilterParams, VideoGroup } from "@/api/types";
import { ToolsModal } from "@/tools";
import type { ToolDefinition, ToolSelection, ToolTarget } from "@/tools";
import { MediaBrowser } from "@/components/MediaBrowser";

const ANY = "__any__";
const UNGROUPED_NAME = "未分组";
const ROOT_VALUE = "__root__";

function formatSize(bytes: number): string {
  if (bytes <= 0) return "-";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 视频封面缩略图：首次访问由后端 ffmpeg 生成并缓存，之后复用缓存文件。
 * 加载失败（无真实文件等）时回退为摄像机图标。支持点击全屏预览。
 */
function VideoThumb({ videoId, size = 40, preview = false }: { videoId: string; size?: number; preview?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/videos/${encodeURIComponent(videoId)}/thumbnail`;
  if (failed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          background: "#1b1e26",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <VideoCameraOutlined style={{ color: "#4c8dff" }} />
      </div>
    );
  }
  if (preview) {
    return (
      <Image
        src={src}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        style={{ borderRadius: 6, objectFit: "cover", background: "#1b1e26" }}
        preview={{ mask: "预览" }}
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: 6, objectFit: "cover", background: "#1b1e26", display: "block" }}
    />
  );
}

function EnumSelect({
  enumName,
  placeholder,
  value,
  onChange,
  width = 140,
}: {
  enumName: string;
  placeholder: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  width?: number;
}) {
  const { entries } = useLabels();
  return (
    <Select
      allowClear
      style={{ width }}
      placeholder={placeholder}
      value={value ?? undefined}
      onChange={(v) => onChange(v === ANY ? undefined : v)}
      options={entries(enumName).map((e) => ({ value: e.value, label: e.label }))}
    />
  );
}

// -- 视频详情（仅属性；硬指标只读） -----------------------------------------
function VideoDetail({
  video,
  groupName,
}: {
  video: Video;
  groupName: string;
}) {
  return (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label="封面">
        <VideoThumb videoId={video.id} size={200} preview />
      </Descriptions.Item>
      <Descriptions.Item label="ID">{video.id}</Descriptions.Item>
      <Descriptions.Item label="名称">{video.title}</Descriptions.Item>
      <Descriptions.Item label="所属分组">{groupName}</Descriptions.Item>
      <Descriptions.Item label="来源">
        <EnumTag
          enumName="VideoSourceType"
          value={video.source_type}
          colorMap={VIDEO_SOURCE_COLOR}
        />
      </Descriptions.Item>
      <Descriptions.Item label="创建时间">
        {dayjs(video.created_at).format("YYYY-MM-DD HH:mm")}
      </Descriptions.Item>
      <Descriptions.Item label="时长">
        {formatDuration(video.duration)}
      </Descriptions.Item>
      <Descriptions.Item label="分辨率">
        {video.width}×{video.height}
      </Descriptions.Item>
      <Descriptions.Item label="帧率">{video.fps} fps</Descriptions.Item>
      <Descriptions.Item label="编码">{video.codec}</Descriptions.Item>
      <Descriptions.Item label="大小">
        {formatSize(video.size_bytes)}
      </Descriptions.Item>
      <Descriptions.Item label="Caption">
        {video.caption || "无"}
      </Descriptions.Item>
      <Descriptions.Item label="标签">
        {video.tags.length ? (
          <Space size={4} wrap>
            {video.tags.map((t) => (
              <Tag key={t} color="geekblue">
                {t}
              </Tag>
            ))}
          </Space>
        ) : (
          "无"
        )}
      </Descriptions.Item>
      <Descriptions.Item label="关联下载">
        {video.source_download_id ?? "-"}
      </Descriptions.Item>
    </Descriptions>
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
      await api.createVideoGroup({
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
          <Input placeholder="如：人物访谈" />
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
  group: VideoGroup | null;
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
      await api.updateVideoGroup(group.id, {
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

// -- 上传视频弹窗 -----------------------------------------------------------
function UploadVideoModal({
  open,
  onClose,
  groups,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  groups: VideoGroup[];
  onCreated: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await api.createVideo({
        title: values.title,
        group_id: values.group_id ?? null,
        tags: values.tags ?? [],
        duration: values.duration ?? 0,
        width: values.width ?? 0,
        height: values.height ?? 0,
        fps: values.fps ?? 25,
        size_bytes: values.size_bytes ?? 0,
      });
      message.success("视频已登记到视频库");
      form.resetFields();
      onCreated();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 选择文件时仅在前端读取文件名/大小自动填充，不实际上传文件内容。
  const onPickFile = (file: UploadFile): boolean => {
    const raw = file as unknown as File;
    form.setFieldsValue({
      title: form.getFieldValue("title") || raw.name,
      size_bytes: raw.size ?? 0,
    });
    return false;
  };

  return (
    <Modal
      title="上传视频"
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
            accept="video/*"
          >
            <Button>选择本地视频</Button>
          </Upload>
        </Form.Item>
        <Form.Item
          name="title"
          label="名称"
          rules={[{ required: true, message: "请输入视频名称" }]}
        >
          <Input placeholder="视频名称" />
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
          <Form.Item name="duration" label="时长(秒)">
            <InputNumber min={0} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="width" label="宽">
            <InputNumber min={0} style={{ width: 110 }} />
          </Form.Item>
          <Form.Item name="height" label="高">
            <InputNumber min={0} style={{ width: 110 }} />
          </Form.Item>
          <Form.Item name="fps" label="帧率">
            <InputNumber min={0} style={{ width: 100 }} />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}

// -- 编辑基本信息弹窗（仅名称、标签；分辨率/帧率/时长等硬指标不可编辑） -----
function EditVideoModal({
  video,
  onClose,
  onSaved,
}: {
  video: Video | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!video) return;
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await api.updateVideo(video.id, {
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
      open={video !== null}
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
          title: video?.title,
          tags: video?.tags ?? [],
          caption: video?.caption ?? "",
        }}
      >
        <Form.Item
          name="title"
          label="名称"
          rules={[{ required: true, message: "请输入视频名称" }]}
        >
          <Input placeholder="视频名称" />
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
            placeholder="用于训练的视频描述文本"
            showCount
          />
        </Form.Item>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="分辨率 / 帧率 / 时长（不可编辑）">
            {video
              ? `${video.width}×${video.height} · ${video.fps}fps · ${formatDuration(
                  video.duration,
                )}`
              : "-"}
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
  groups: VideoGroup[];
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

// -- 页面主体：文件夹式浏览（分组=文件夹，未分组视频在根目录） --------------

/** 判断视频是否位于根目录（无分组或归属「未分组」）。 */
function isRootVideo(video: Video, groups: VideoGroup[]): boolean {
  if (!video.group_id) return true;
  const g = groups.find((x) => x.id === video.group_id);
  return !g || g.name === UNGROUPED_NAME;
}

type ExplorerRow =
  | { kind: "folder"; key: string; group: VideoGroup; count: number }
  | { kind: "file"; key: string; video: Video };

function VideoLibraryExplorer({
  videos,
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
  videos: Video[];
  groups: VideoGroup[];
  currentGroupId: string | null;
  selectedRowKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  onEnterFolder: (groupId: string) => void;
  onOpenDetail: (v: Video) => void;
  onEdit: (v: Video) => void;
  onMove: (v: Video) => void;
  onCopy: (v: Video) => void;
  onDelete: (v: Video) => void;
  onTools: (v: Video) => void;
  onEditGroup: (group: VideoGroup) => void;
  onDeleteGroup: (group: VideoGroup) => void;
  onToolsGroup: (group: VideoGroup) => void;
}) {
  const rows: ExplorerRow[] = useMemo(() => {
    if (currentGroupId === null) {
      const folderRows: ExplorerRow[] = groups
        .filter((g) => g.name !== UNGROUPED_NAME)
        .map((g) => ({
          kind: "folder",
          key: `folder:${g.id}`,
          group: g,
          count: videos.filter((v) => v.group_id === g.id).length,
        }));
      const fileRows: ExplorerRow[] = videos
        .filter((v) => isRootVideo(v, groups))
        .map((v) => ({ kind: "file", key: v.id, video: v }));
      return [...folderRows, ...fileRows];
    }
    return videos
      .filter((v) => v.group_id === currentGroupId)
      .map((v) => ({ kind: "file", key: v.id, video: v }));
  }, [videos, groups, currentGroupId]);

  const actionItems = (): MenuProps["items"] => [
    { key: "edit", icon: <EditOutlined />, label: "编辑基本信息" },
    { key: "tools", icon: <ToolOutlined />, label: "工具" },
    { key: "move", icon: <SwapOutlined />, label: "移动到分组" },
    { key: "copy", icon: <CopyOutlined />, label: "复制到分组" },
    { type: "divider" },
    { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
  ];

  const onActionClick = (video: Video, key: string) => {
    if (key === "edit") onEdit(video);
    else if (key === "tools") onTools(video);
    else if (key === "move") onMove(video);
    else if (key === "copy") onCopy(video);
    else if (key === "delete") onDelete(video);
  };

  const folderActionItems = (): MenuProps["items"] => [
    { key: "edit", icon: <EditOutlined />, label: "编辑分组" },
    { key: "tools", icon: <ToolOutlined />, label: "工具" },
    { type: "divider" },
    { key: "delete", icon: <DeleteOutlined />, label: "删除分组", danger: true },
  ];

  const onFolderActionClick = (group: VideoGroup, key: string) => {
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
              <VideoThumb videoId={row.video.id} size={40} preview />
            </span>
            <span>{row.video.title}</span>
          </Space>
        ),
    },
    {
      title: "来源",
      key: "source",
      width: 90,
      render: (_, row) =>
        row.kind === "file" ? (
          <EnumTag
            enumName="VideoSourceType"
            value={row.video.source_type}
            colorMap={VIDEO_SOURCE_COLOR}
          />
        ) : null,
    },
    {
      title: "时长",
      key: "duration",
      width: 80,
      render: (_, row) =>
        row.kind === "file" ? formatDuration(row.video.duration) : null,
    },
    {
      title: "分辨率",
      key: "resolution",
      width: 110,
      render: (_, row) =>
        row.kind === "file" ? `${row.video.width}×${row.video.height}` : null,
    },
    {
      title: "标签",
      key: "tags",
      render: (_, row) => {
        if (row.kind !== "file") return null;
        const tags = row.video.tags;
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
          ? dayjs(row.video.created_at).format("YYYY-MM-DD HH:mm")
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
                onClick: ({ key }) => onActionClick(row.video, key),
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
            : onOpenDetail(row.video),
        style: { cursor: "pointer" },
      })}
    />
  );
}

export function VideoLibraryPage() {
  const { message, modal } = App.useApp();
  const [filter, setFilter] = useState<VideoFilterParams>({});
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Video | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolDefinition | null>(null);
  const [toolsSelection, setToolsSelection] = useState<ToolSelection | undefined>(
    undefined,
  );
  const [toolTarget, setToolTarget] = useState<ToolTarget | null>(null);
  const [editing, setEditing] = useState<Video | null>(null);
  const [moving, setMoving] = useState<Video | null>(null);
  const [copying, setCopying] = useState<Video | null>(null);
  const [editingGroup, setEditingGroup] = useState<VideoGroup | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  const groupsState = useAsync(() => api.listVideoGroups(), []);
  const groups = groupsState.data ?? [];
  const videosState = useAsync(
    () => api.listVideos(filter),
    [filter.source_type, filter.tag, filter.keyword],
  );
  const videos = videosState.data ?? [];

  const patch = (part: Partial<VideoFilterParams>) =>
    setFilter((prev) => ({ ...prev, ...part }));

  const refreshAll = () => {
    groupsState.refetch();
    videosState.refetch();
    setSelectedRowKeys([]);
  };

  const currentGroup = groups.find((g) => g.id === currentGroupId) ?? null;

  // 当前目录内的视频文件（用于「开始浏览」）。
  const currentFiles = useMemo(
    () =>
      currentGroupId === null
        ? videos.filter((v) => isRootVideo(v, groups))
        : videos.filter((v) => v.group_id === currentGroupId),
    [videos, groups, currentGroupId],
  );

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of videos) (v.tags ?? []).forEach((t) => set.add(t));
    if (filter.tag) set.add(filter.tag);
    return Array.from(set).map((t) => ({ value: t, label: t }));
  }, [videos, filter.tag]);

  const confirmDelete = (video: Video) => {
    modal.confirm({
      title: "删除视频",
      content: `确定要删除「${video.title}」吗？此操作不可撤销。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api.deleteVideo(video.id);
          message.success("已删除");
          refreshAll();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "删除失败");
        }
      },
    });
  };

  const confirmDeleteGroup = (group: VideoGroup) => {
    const count = videos.filter((v) => v.group_id === group.id).length;
    modal.confirm({
      title: "删除分组",
      content:
        count > 0
          ? `分组「${group.name}」内有 ${count} 个视频，删除后这些视频将移出分组（回到根目录），分组本身被删除。确定继续吗？`
          : `确定要删除分组「${group.name}」吗？`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api.deleteVideoGroup(group.id);
          message.success("分组已删除");
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
      title: "批量删除视频",
      content: `确定要删除选中的 ${ids.length} 个视频吗？此操作不可撤销。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const results = await Promise.allSettled(
          ids.map((id) => api.deleteVideo(id)),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed) message.warning(`已删除 ${ids.length - failed} 个，${failed} 个失败`);
        else message.success(`已删除 ${ids.length} 个`);
        refreshAll();
      },
    });
  };

  const batchMove = async (groupId: string | null) => {
    const ids = selectedRowKeys.slice();
    if (!ids.length) return;
    const results = await Promise.allSettled(
      ids.map((id) => api.updateVideo(id, { group_id: groupId })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) message.warning(`已移动 ${ids.length - failed} 个，${failed} 个失败`);
    else message.success(`已移动 ${ids.length} 个`);
    refreshAll();
  };

  const batchTags = async (add: string[], remove: string[]) => {
    const items = videos.filter((v) => selectedRowKeys.includes(v.id));
    if (!items.length) return;
    const results = await Promise.allSettled(
      items.map((v) => {
        const set = new Set(v.tags);
        add.forEach((t) => set.add(t));
        remove.forEach((t) => set.delete(t));
        return api.updateVideo(v.id, { tags: Array.from(set) });
      }),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) message.warning(`已更新 ${items.length - failed} 个，${failed} 个失败`);
    else message.success(`已更新 ${items.length} 个标签`);
    refreshAll();
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
        title="视频库"
        subtitle="视频资源管理：分组（文件夹）、上传、标签与筛选"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refreshAll}>
              刷新
            </Button>
            <Button onClick={() => setGroupModalOpen(true)}>新建分组</Button>
            <Button type="primary" onClick={() => setUploadModalOpen(true)}>
              上传视频
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
        <EnumSelect
          enumName="VideoSourceType"
          placeholder="来源"
          value={filter.source_type}
          onChange={(v) => patch({ source_type: v })}
          width={110}
        />
        <Select
          allowClear
          style={{ width: 140 }}
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
            icon={<ToolOutlined />}
            onClick={() =>
              openTools("multi", {
                scope: "video",
                selection: "multi",
                videoIds: selectedRowKeys.slice(),
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

      <AsyncBoundary state={videosState}>
        {(list) => (
          <VideoLibraryExplorer
            videos={list}
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
            onTools={(video) =>
              openTools(undefined, {
                scope: "video",
                selection: "single",
                videoIds: [video.id],
              })
            }
            onEditGroup={setEditingGroup}
            onDeleteGroup={confirmDeleteGroup}
            onToolsGroup={(group) =>
              openTools("multi", {
                scope: "video",
                selection: "multi",
                groupIds: [group.id],
              })
            }
          />
        )}
      </AsyncBoundary>

      <Drawer
        title={selected ? `视频详情 · ${selected.title}` : "视频详情"}
        width={460}
        open={selected !== null}
        onClose={() => setSelected(null)}
        destroyOnClose
      >
        {selected && (
          <VideoDetail
            video={selected}
            groupName={
              groups.find((g) => g.id === selected.group_id)?.name ?? "未分组"
            }
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
      <UploadVideoModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        groups={groups}
        onCreated={refreshAll}
      />
      <EditVideoModal
        video={editing}
        onClose={() => setEditing(null)}
        onSaved={refreshAll}
      />
      <GroupPickerModal
        open={moving !== null}
        title={`移动「${moving?.title ?? ""}」到分组`}
        okText="移动"
        groups={groups}
        onClose={() => setMoving(null)}
        onConfirm={async (groupId) => {
          if (!moving) return;
          try {
            await api.updateVideo(moving.id, { group_id: groupId });
            message.success("已移动");
            refreshAll();
          } catch (err) {
            message.error(err instanceof Error ? err.message : "移动失败");
          }
        }}
      />
      <GroupPickerModal
        open={copying !== null}
        title={`复制「${copying?.title ?? ""}」到分组`}
        okText="复制"
        groups={groups}
        onClose={() => setCopying(null)}
        onConfirm={async (groupId) => {
          if (!copying) return;
          try {
            await api.copyVideo(copying.id, groupId);
            message.success("已复制");
            refreshAll();
          } catch (err) {
            message.error(err instanceof Error ? err.message : "复制失败");
          }
        }}
      />
      <GroupPickerModal
        open={batchMoveOpen}
        title={`移动选中的 ${selectedRowKeys.length} 个视频到分组`}
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
      <MediaBrowser
        open={browserOpen}
        items={currentFiles.map((f) => ({
          id: f.id,
          title: f.title || f.id,
          kind: "video" as const,
        }))}
        startIndex={0}
        groups={groups}
        ungroupedName={UNGROUPED_NAME}
        onClose={() => setBrowserOpen(false)}
        onMove={async (id, groupId) => {
          await api.updateVideo(id, { group_id: groupId });
        }}
        onDelete={(id) => api.deleteVideo(id)}
        onChanged={refreshAll}
      />
      <ToolsModal
        open={toolsModalOpen}
        onClose={() => setToolsModalOpen(false)}
        scope="video"
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
        context: { videos, onDone: refreshAll, target: toolTarget ?? undefined },
      })}
    </>
  );
}
