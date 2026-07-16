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

import { useMemo, useState } from "react";
import {
  App,
  Breadcrumb,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
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
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  HomeOutlined,
  MoreOutlined,
  PictureOutlined,
  SwapOutlined,
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
import type { ImageFilterParams, ImageGroup, ImageModel } from "@/api/types";
import { ToolsModal } from "@/tools";
import type { ToolDefinition } from "@/tools";

const UNGROUPED_NAME = "未分组";
const ROOT_VALUE = "__root__";

// -- 图片详情（仅属性；硬指标只读） -----------------------------------------
function ImageDetail({
  image,
  groupName,
}: {
  image: ImageModel;
  groupName: string;
}) {
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
        <Descriptions.Item label="分辨率">
          {image.width}×{image.height}
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
        initialValues={{ title: image?.title, tags: image?.tags ?? [] }}
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
  onEnterFolder,
  onOpenDetail,
  onEdit,
  onMove,
  onCopy,
  onDelete,
  onEditGroup,
  onDeleteGroup,
}: {
  images: ImageModel[];
  groups: ImageGroup[];
  currentGroupId: string | null;
  onEnterFolder: (groupId: string) => void;
  onOpenDetail: (img: ImageModel) => void;
  onEdit: (img: ImageModel) => void;
  onMove: (img: ImageModel) => void;
  onCopy: (img: ImageModel) => void;
  onDelete: (img: ImageModel) => void;
  onEditGroup: (group: ImageGroup) => void;
  onDeleteGroup: (group: ImageGroup) => void;
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
    { key: "move", icon: <SwapOutlined />, label: "移动到分组" },
    { key: "copy", icon: <CopyOutlined />, label: "复制到分组" },
    { type: "divider" },
    { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
  ];

  const folderActionItems = (): MenuProps["items"] => [
    { key: "edit", icon: <EditOutlined />, label: "编辑分组" },
    { type: "divider" },
    { key: "delete", icon: <DeleteOutlined />, label: "删除分组", danger: true },
  ];

  const onActionClick = (img: ImageModel, key: string) => {
    if (key === "edit") onEdit(img);
    else if (key === "move") onMove(img);
    else if (key === "copy") onCopy(img);
    else if (key === "delete") onDelete(img);
  };

  const onFolderActionClick = (group: ImageGroup, key: string) => {
    if (key === "edit") onEditGroup(group);
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
            <Thumbnail
              seed={row.image.thumbnail_hint || row.image.id}
              size={36}
            />
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
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolDefinition | null>(null);
  const [editing, setEditing] = useState<ImageModel | null>(null);
  const [moving, setMoving] = useState<ImageModel | null>(null);
  const [copying, setCopying] = useState<ImageModel | null>(null);
  const [editingGroup, setEditingGroup] = useState<ImageGroup | null>(null);

  const groupsState = useAsync(() => api.listImageGroups(), []);
  const groups = groupsState.data ?? [];
  const imagesState = useAsync(
    () => api.listImages(filter),
    [filter.tag, filter.keyword],
  );
  const images = imagesState.data ?? [];

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
    modal.confirm({
      title: "删除分组",
      content:
        count > 0
          ? `分组「${group.name}」内有 ${count} 张图片，删除后这些图片将移出分组（回到根目录），分组本身被删除。确定继续吗？`
          : `确定要删除分组「${group.name}」吗？`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api.deleteImageGroup(group.id);
          message.success("分组已删除");
          if (currentGroupId === group.id) setCurrentGroupId(null);
          refreshAll();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "删除失败");
        }
      },
    });
  };

  return (
    <>
      <PageHeader
        title="图片库"
        subtitle="图片资源管理：分组（文件夹）、上传、标签与筛选"
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
        <Select
          allowClear
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

      <AsyncBoundary state={imagesState}>
        {(list) => (
          <ImageLibraryExplorer
            images={list}
            groups={groups}
            currentGroupId={currentGroupId}
            onEnterFolder={setCurrentGroupId}
            onOpenDetail={setSelected}
            onEdit={setEditing}
            onMove={setMoving}
            onCopy={setCopying}
            onDelete={confirmDelete}
            onEditGroup={setEditingGroup}
            onDeleteGroup={confirmDeleteGroup}
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
      <UploadImageModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        groups={groups}
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
