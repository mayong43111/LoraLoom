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
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import dayjs from "dayjs";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { useLabels } from "@/api/labels";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { EnumTag } from "@/components/EnumTag";
import { VIDEO_SOURCE_COLOR, VIDEO_STATUS_COLOR } from "@/colors";
import type { Video, VideoFilterParams, VideoGroup } from "@/api/types";

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
      <Descriptions.Item label="状态">
        <EnumTag
          enumName="VideoStatus"
          value={video.status}
          colorMap={VIDEO_STATUS_COLOR}
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

// -- 工具集合弹窗 -----------------------------------------------------------
function ToolsModal({
  open,
  onClose,
  onSelectFrameTool,
}: {
  open: boolean;
  onClose: () => void;
  onSelectFrameTool: () => void;
}) {
  const tools = [
    {
      key: "frame",
      title: "视频抽帧",
      desc: "按间隔抽帧并做邻近帧择优，产出候选图片",
      enabled: true,
      onClick: onSelectFrameTool,
    },
  ];
  return (
    <Modal
      title="工具集合"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        {tools.map((t) => (
          <Button
            key={t.key}
            block
            size="large"
            disabled={!t.enabled}
            style={{ height: "auto", padding: 12, textAlign: "left" }}
            onClick={t.onClick}
          >
            <div style={{ fontWeight: 600 }}>{t.title}</div>
            <div style={{ fontSize: 12, color: "#8b90a0" }}>{t.desc}</div>
          </Button>
        ))}
      </Space>
    </Modal>
  );
}

// -- 抽帧工具弹窗 -----------------------------------------------------------
function FrameToolModal({
  open,
  onClose,
  videos,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  videos: Video[];
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    const values = await form.validateFields();
    setRunning(true);
    setResult(null);
    try {
      const job = await api.extractFrames(values.video_id, values.interval ?? 1.0);
      const extracted = job.frames.filter(
        (f) => f.status !== "skipped_no_good_frame",
      ).length;
      setResult(`完成：共 ${job.frames.length} 个采样点，产出 ${extracted} 帧`);
      message.success("抽帧完成");
      onDone();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "抽帧失败");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      title="视频抽帧工具"
      open={open}
      onOk={run}
      okText="执行抽帧"
      confirmLoading={running}
      onCancel={() => {
        setResult(null);
        onClose();
      }}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="video_id"
          label="选择视频"
          rules={[{ required: true, message: "请选择视频" }]}
        >
          <Select
            showSearch
            placeholder="选择要抽帧的视频"
            optionFilterProp="label"
            options={videos.map((v) => ({ value: v.id, label: v.title }))}
          />
        </Form.Item>
        <Form.Item name="interval" label="抽帧间隔(秒)" initialValue={1.0}>
          <InputNumber min={0.1} step={0.1} style={{ width: 160 }} />
        </Form.Item>
      </Form>
      {result && <div style={{ color: "#52c41a" }}>{result}</div>}
    </Modal>
  );
}

// -- 页面主体表格 -----------------------------------------------------------
function VideoLibraryTable({
  videos,
  groups,
  onOpenDetail,
}: {
  videos: Video[];
  groups: VideoGroup[];
  onOpenDetail: (v: Video) => void;
}) {
  const groupName = (id: string | null) =>
    groups.find((g) => g.id === id)?.name ?? "未分组";

  const columns: ColumnsType<Video> = [
    { title: "名称", dataIndex: "title", key: "title", ellipsis: true },
    {
      title: "分组",
      key: "group",
      width: 120,
      render: (_, row) => groupName(row.group_id),
    },
    {
      title: "来源",
      dataIndex: "source_type",
      key: "source",
      width: 90,
      render: (v: string) => (
        <EnumTag
          enumName="VideoSourceType"
          value={v}
          colorMap={VIDEO_SOURCE_COLOR}
        />
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (v: string) => (
        <EnumTag enumName="VideoStatus" value={v} colorMap={VIDEO_STATUS_COLOR} />
      ),
    },
    {
      title: "时长",
      dataIndex: "duration",
      key: "duration",
      width: 80,
      render: (v: number) => formatDuration(v),
    },
    {
      title: "分辨率",
      key: "resolution",
      width: 110,
      render: (_, row) => `${row.width}×${row.height}`,
    },
    {
      title: "标签",
      dataIndex: "tags",
      key: "tags",
      render: (tags: string[]) =>
        tags.length ? (
          <Space size={4} wrap>
            {tags.map((t) => (
              <Tag key={t} color="geekblue" style={{ marginInlineEnd: 0 }}>
                {t}
              </Tag>
            ))}
          </Space>
        ) : (
          "-"
        ),
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      width: 150,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
  ];

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={videos}
      size="middle"
      pagination={{
        pageSize: 8,
        showSizeChanger: false,
        showTotal: (t) => `共 ${t} 个视频`,
      }}
      onRow={(row) => ({
        onClick: () => onOpenDetail(row),
        style: { cursor: "pointer" },
      })}
    />
  );
}

export function VideoLibraryPage() {
  const [filter, setFilter] = useState<VideoFilterParams>({});
  const [selected, setSelected] = useState<Video | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [frameToolOpen, setFrameToolOpen] = useState(false);

  const groupsState = useAsync(() => api.listVideoGroups(), []);
  const groups = groupsState.data ?? [];
  const videosState = useAsync(
    () => api.listVideos(filter),
    [filter.group_id, filter.status, filter.source_type, filter.tag, filter.keyword],
  );
  const videos = videosState.data ?? [];

  const patch = (part: Partial<VideoFilterParams>) =>
    setFilter((prev) => ({ ...prev, ...part }));

  const refreshAll = () => {
    groupsState.refetch();
    videosState.refetch();
  };

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
        subtitle="视频资产管理：分组、上传与筛选"
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

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          style={{ width: 160 }}
          placeholder="分组"
          value={filter.group_id ?? undefined}
          onChange={(v) => patch({ group_id: v ?? undefined })}
          options={groups.map((g) => ({
            value: g.id,
            label: `${g.name} (${g.video_count})`,
          }))}
        />
        <EnumSelect
          enumName="VideoStatus"
          placeholder="状态"
          value={filter.status}
          onChange={(v) => patch({ status: v })}
        />
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
          <VideoLibraryTable
            videos={list}
            groups={groups}
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
        onSelectFrameTool={() => {
          setToolsModalOpen(false);
          setFrameToolOpen(true);
        }}
      />
      <FrameToolModal
        open={frameToolOpen}
        onClose={() => setFrameToolOpen(false)}
        videos={videos}
        onDone={refreshAll}
      />
    </>
  );
}
