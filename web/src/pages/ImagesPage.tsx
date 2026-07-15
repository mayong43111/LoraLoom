/**
 * 图片库页面。
 *
 * 与视频库采用一致的设计：分组（文件夹）、手动上传、按属性筛选与查看
 * 详情。页面主体是一张带分页与筛选的表格，点击行查看图片「属性」详情。
 * 更复杂的操作（如统计、批处理）归入独立的「工具集合」，作用于图片但
 * 不属于图片库本身的能力。
 */

import { useMemo, useState } from "react";
import {
  App,
  Breadcrumb,
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
import { FolderOutlined, HomeOutlined, PictureOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import dayjs from "dayjs";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { useLabels } from "@/api/labels";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { EnumTag } from "@/components/EnumTag";
import { Thumbnail } from "@/components/Thumbnail";
import { ORIENTATION_COLOR, REVIEW_COLOR, USABILITY_COLOR } from "@/colors";
import type {
  ImageFilterParams,
  ImageGroup,
  ImageModel,
  PersonCluster,
} from "@/api/types";
import { ToolsModal } from "@/tools";
import type { ToolDefinition } from "@/tools";

const ANY = "__any__";

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

// -- 图片详情（仅属性） -----------------------------------------------------
function ImageDetail({
  image,
  groupName,
  people,
}: {
  image: ImageModel;
  groupName: string;
  people: PersonCluster[];
}) {
  const person = people.find((p) => p.id === image.primary_subject_id);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Thumbnail
        seed={image.thumbnail_hint || image.id}
        size={280}
        ratio={image.width / image.height}
      />
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="ID">{image.id}</Descriptions.Item>
        <Descriptions.Item label="名称">
          {image.title || image.id}
        </Descriptions.Item>
        <Descriptions.Item label="所属分组">{groupName}</Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {dayjs(image.created_at).format("YYYY-MM-DD HH:mm")}
        </Descriptions.Item>
        <Descriptions.Item label="尺寸">
          {image.width}×{image.height}
        </Descriptions.Item>
        <Descriptions.Item label="质量分">
          {image.quality_score.toFixed(3)}
        </Descriptions.Item>
        <Descriptions.Item label="朝向">
          <EnumTag
            enumName="Orientation"
            value={image.orientation}
            colorMap={ORIENTATION_COLOR}
          />
        </Descriptions.Item>
        <Descriptions.Item label="可用性">
          <EnumTag
            enumName="Usability"
            value={image.usability}
            colorMap={USABILITY_COLOR}
          />
        </Descriptions.Item>
        <Descriptions.Item label="复核状态">
          <EnumTag
            enumName="ReviewStatus"
            value={image.review_status}
            colorMap={REVIEW_COLOR}
          />
        </Descriptions.Item>
        <Descriptions.Item label="主体人物">
          {person ? person.display_name : "-"}
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

// -- 页面主体：文件夹式浏览（分组=文件夹，未分组图片在根目录） --------------
const UNGROUPED_NAME = "未分组";

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
  onEnterFolder,
  onOpenDetail,
}: {
  images: ImageModel[];
  groups: ImageGroup[];
  currentGroupId: string | null;
  onEnterFolder: (groupId: string) => void;
  onOpenDetail: (img: ImageModel) => void;
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
            <Thumbnail
              seed={row.image.thumbnail_hint || row.image.id}
              size={36}
            />
            <span>{row.image.title || row.image.id}</span>
          </Space>
        ),
    },
    {
      title: "朝向",
      key: "orientation",
      width: 90,
      render: (_, row) =>
        row.kind === "file" ? (
          <EnumTag
            enumName="Orientation"
            value={row.image.orientation}
            colorMap={ORIENTATION_COLOR}
          />
        ) : null,
    },
    {
      title: "可用性",
      key: "usability",
      width: 100,
      render: (_, row) =>
        row.kind === "file" ? (
          <EnumTag
            enumName="Usability"
            value={row.image.usability}
            colorMap={USABILITY_COLOR}
          />
        ) : null,
    },
    {
      title: "尺寸",
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
            : onOpenDetail(row.image),
        style: { cursor: "pointer" },
      })}
    />
  );
}

export function ImagesPage() {
  const [filter, setFilter] = useState<ImageFilterParams>({});
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ImageModel | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolDefinition | null>(null);

  const groupsState = useAsync(() => api.listImageGroups(), []);
  const groups = groupsState.data ?? [];
  const imagesState = useAsync(
    () => api.listImages(filter),
    [filter.orientation, filter.usability, filter.tag, filter.keyword],
  );
  const images = imagesState.data ?? [];
  const peopleState = useAsync(() => api.listPeople(), []);
  const people = peopleState.data ?? [];

  const patch = (part: Partial<ImageFilterParams>) =>
    setFilter((prev) => ({ ...prev, ...part }));

  const refreshAll = () => {
    groupsState.refetch();
    imagesState.refetch();
  };

  const currentGroup = groups.find((g) => g.id === currentGroupId) ?? null;

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of images) (v.tags ?? []).forEach((t) => set.add(t));
    if (filter.tag) set.add(filter.tag);
    return Array.from(set).map((t) => ({ value: t, label: t }));
  }, [images, filter.tag]);

  return (
    <>
      <PageHeader
        title="图片库"
        subtitle="图片资产管理：分组（文件夹）、上传与筛选"
        extra={
          <Space>
            <Button icon={<PictureOutlined />} onClick={() => setGroupModalOpen(true)}>
              新建分组
            </Button>
            <Button type="primary" onClick={() => setUploadModalOpen(true)}>
              上传图片
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
          enumName="Orientation"
          placeholder="朝向"
          value={filter.orientation}
          onChange={(v) => patch({ orientation: v })}
          width={110}
        />
        <EnumSelect
          enumName="Usability"
          placeholder="可用性"
          value={filter.usability}
          onChange={(v) => patch({ usability: v })}
          width={120}
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

      <AsyncBoundary state={imagesState}>
        {(list) => (
          <ImageLibraryExplorer
            images={list}
            groups={groups}
            currentGroupId={currentGroupId}
            onEnterFolder={setCurrentGroupId}
            onOpenDetail={setSelected}
          />
        )}
      </AsyncBoundary>

      <Drawer
        title={
          selected ? `图片详情 · ${selected.title || selected.id}` : "图片详情"
        }
        width={460}
        open={selected !== null}
        onClose={() => setSelected(null)}
        destroyOnClose
      >
        {selected && (
          <ImageDetail
            image={selected}
            people={people}
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
      <UploadImageModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        groups={groups}
        onCreated={refreshAll}
      />
      <ToolsModal
        open={toolsModalOpen}
        onClose={() => setToolsModalOpen(false)}
        scope="image"
        onSelectTool={(tool) => {
          setToolsModalOpen(false);
          setActiveTool(tool);
        }}
      />
      {activeTool?.launch({
        open: true,
        onClose: () => setActiveTool(null),
        context: { images, onDone: refreshAll },
      })}
    </>
  );
}
