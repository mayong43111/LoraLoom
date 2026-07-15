/**
 * 视频库页面。
 *
 * 视频库负责视频资产的管理：分组、手动上传、按属性筛选与查看详情。
 * 页面主体是一张带分页与筛选的表格，点击行查看视频「属性」详情
 * （不含抽帧结果）。抽帧等操作被归入独立的「工具集合」，它们作用于
 * 视频，但不属于视频库本身的能力。
 */

import { useMemo, useState } from "react";
import {
  App,
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Upload,
} from "antd";
import {
  FolderOutlined,
  HomeOutlined,
  ReloadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import dayjs from "dayjs";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { useLabels } from "@/api/labels";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { EnumTag } from "@/components/EnumTag";
import { VIDEO_SOURCE_COLOR } from "@/colors";
import type { Video, VideoFilterParams, VideoGroup } from "@/api/types";
import { HOST_API_VERSION, useExternalTools, useTools } from "@/tools";
import type { ToolDefinition } from "@/tools";

const ANY = "__any__";

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

// -- 视频详情（仅属性，不含抽帧） -------------------------------------------
function VideoDetail({
  video,
  groupName,
}: {
  video: Video;
  groupName: string;
}) {
  return (
    <Descriptions column={1} size="small" bordered>
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

// -- 工具集合弹窗（卡片式，由工具注册中心驱动，支持外部动态注入） ----------
function ToolsModal({
  open,
  onClose,
  onSelectTool,
}: {
  open: boolean;
  onClose: () => void;
  onSelectTool: (tool: ToolDefinition) => void;
}) {
  const tools = useTools("video");
  const { loading, result, reload } = useExternalTools();
  const failed = result?.failed.filter((f) => f.id !== "*") ?? [];
  const manifestError = result?.failed.find((f) => f.id === "*");

  return (
    <Modal
      title={
        <Space>
          工具集合
          <span style={{ fontSize: 12, color: "#8b90a0", fontWeight: 400 }}>
            SDK v{HOST_API_VERSION}
          </span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnClose
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 12, color: "#8b90a0" }}>
          {loading ? "正在加载扩展工具…" : `共 ${tools.length} 个工具`}
        </span>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={reload}
        >
          刷新扩展
        </Button>
      </div>

      {manifestError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="获取扩展工具清单失败"
          description={manifestError.error}
        />
      )}
      {failed.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="部分扩展工具加载失败"
          description={failed.map((f) => `${f.id}: ${f.error}`).join("；")}
        />
      )}

      {tools.length === 0 ? (
        loading ? (
          <div style={{ textAlign: "center", padding: 32 }}>
            <Spin />
          </div>
        ) : (
          <Empty description="暂无可用工具" />
        )
      ) : (
        <Row gutter={[16, 16]}>
          {tools.map((tool) => {
            const disabled = tool.enabled === false;
            return (
              <Col key={tool.id} xs={24} sm={12}>
                <Card
                  hoverable={!disabled}
                  onClick={() => !disabled && onSelectTool(tool)}
                  style={{
                    height: "100%",
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                  styles={{ body: { padding: 16 } }}
                >
                  <Space align="start" size={12}>
                    <span style={{ fontSize: 28, color: "#4c8dff" }}>
                      {tool.icon}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {tool.name}
                        {tool.source === "external" && (
                          <Tag color="purple" style={{ marginLeft: 8 }}>
                            扩展
                          </Tag>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "#8b90a0" }}>
                        {tool.description}
                      </div>
                    </div>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </Modal>
  );
}

// -- 页面主体：文件夹式浏览（分组=文件夹，未分组视频在根目录） --------------
const UNGROUPED_NAME = "未分组";

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
  onEnterFolder,
  onOpenDetail,
}: {
  videos: Video[];
  groups: VideoGroup[];
  currentGroupId: string | null;
  onEnterFolder: (groupId: string) => void;
  onOpenDetail: (v: Video) => void;
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
            <VideoCameraOutlined style={{ color: "#4c8dff" }} />
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
  ];

  return (
    <Table
      rowKey="key"
      columns={columns}
      dataSource={rows}
      size="middle"
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
  const [filter, setFilter] = useState<VideoFilterParams>({});
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Video | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolDefinition | null>(null);

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
  };

  const currentGroup = groups.find((g) => g.id === currentGroupId) ?? null;

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of videos) v.tags.forEach((t) => set.add(t));
    if (filter.tag) set.add(filter.tag);
    return Array.from(set).map((t) => ({ value: t, label: t }));
  }, [videos, filter.tag]);

  return (
    <>
      <PageHeader
        title="视频库"
        subtitle="视频资产管理：分组（文件夹）、上传与筛选"
        extra={
          <Space>
            <Button onClick={() => setGroupModalOpen(true)}>新建分组</Button>
            <Button type="primary" onClick={() => setUploadModalOpen(true)}>
              上传视频
            </Button>
            <Button onClick={() => setToolsModalOpen(true)}>工具集合</Button>
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

      <AsyncBoundary state={videosState}>
        {(list) => (
          <VideoLibraryExplorer
            videos={list}
            groups={groups}
            currentGroupId={currentGroupId}
            onEnterFolder={setCurrentGroupId}
            onOpenDetail={setSelected}
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
      <UploadVideoModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        groups={groups}
        onCreated={refreshAll}
      />
      <ToolsModal
        open={toolsModalOpen}
        onClose={() => setToolsModalOpen(false)}
        onSelectTool={(tool) => {
          setToolsModalOpen(false);
          setActiveTool(tool);
        }}
      />
      {activeTool?.launch({
        open: true,
        onClose: () => setActiveTool(null),
        context: { videos, onDone: refreshAll },
      })}
    </>
  );
}
