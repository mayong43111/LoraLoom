import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import type {
  AiToolkitNode,
  AiToolkitNodeInput,
  TrainingTask,
} from "@/api/types";
import { PageHeader } from "@/components/PageHeader";

const TERMINAL_STATUSES = new Set(["completed", "error", "stopped"]);

function statusColor(status: string): string {
  if (status === "completed") return "success";
  if (status === "error") return "error";
  if (status === "running") return "processing";
  if (status === "queued") return "warning";
  return "default";
}

export function TrainingPage() {
  const [nodes, setNodes] = useState<AiToolkitNode[]>([]);
  const [tasks, setTasks] = useState<TrainingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [nodeModalOpen, setNodeModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<AiToolkitNode | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form] = Form.useForm<AiToolkitNodeInput>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nodeList, taskList] = await Promise.all([
        api.listAiToolkitNodes(),
        api.listTrainingTasks(),
      ]);
      setNodes(nodeList);
      setTasks(taskList);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openNodeModal = (node?: AiToolkitNode) => {
    setEditingNode(node ?? null);
    form.setFieldsValue(
      node
        ? {
            name: node.name,
            base_url: node.base_url,
            gpu_ids: node.gpu_ids,
            enabled: node.enabled,
            auth_token: "",
          }
        : { gpu_ids: "0", enabled: true },
    );
    setNodeModalOpen(true);
  };

  const saveNode = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingNode) {
        await api.updateAiToolkitNode(editingNode.id, values);
      } else {
        await api.createAiToolkitNode(values);
      }
      message.success(editingNode ? "节点已更新" : "节点已添加");
      setNodeModalOpen(false);
      form.resetFields();
      await load();
    } catch (err: unknown) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const testNode = async (node: AiToolkitNode) => {
    setTestingId(node.id);
    try {
      const result = await api.testAiToolkitNode(node.id);
      const gpuNames = result.gpus.map((gpu) => gpu.name).join("、") || "未检测到 GPU";
      message.success(`连接成功：${gpuNames}`);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setTestingId(null);
    }
  };

  const refreshTask = async (task: TrainingTask) => {
    try {
      const updated = await api.refreshTrainingTask(task.id);
      setTasks((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="训练节点"
        subtitle="维护 ai-toolkit 服务节点并跟踪派发任务"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openNodeModal()}>
              添加节点
            </Button>
          </Space>
        }
      />

      <Card title="ai-toolkit 节点" size="small" style={{ marginBottom: 16 }}>
        <Table<AiToolkitNode>
          rowKey="id"
          loading={loading}
          dataSource={nodes}
          pagination={false}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "地址", dataIndex: "base_url" },
            { title: "GPU", dataIndex: "gpu_ids", width: 90 },
            {
              title: "状态",
              width: 110,
              render: (_, node) => (
                <Space size={4}>
                  <Tag color={node.enabled ? "success" : "default"}>
                    {node.enabled ? "启用" : "停用"}
                  </Tag>
                  {node.auth_configured && <Tag>Auth</Tag>}
                </Space>
              ),
            },
            {
              title: "操作",
              width: 230,
              render: (_, node) => (
                <Space>
                  <Button size="small" loading={testingId === node.id} onClick={() => void testNode(node)}>
                    测试
                  </Button>
                  <Button size="small" onClick={() => openNodeModal(node)}>编辑</Button>
                  <Popconfirm
                    title="删除该节点？历史任务仍会保留。"
                    onConfirm={async () => {
                      await api.deleteAiToolkitNode(node.id);
                      await load();
                    }}
                  >
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card title="派发任务" size="small">
        <Table<TrainingTask>
          rowKey="id"
          loading={loading}
          dataSource={tasks}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "数据集", dataIndex: "dataset_name" },
            { title: "节点", dataIndex: "node_name" },
            {
              title: "状态",
              dataIndex: "status",
              width: 120,
              render: (status: string) => <Tag color={statusColor(status)}>{status}</Tag>,
            },
            {
              title: "远端 Job",
              dataIndex: "remote_job_id",
              render: (value?: string) => value || "-",
            },
            {
              title: "创建时间",
              dataIndex: "created_at",
              width: 170,
              render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm"),
            },
            {
              title: "结果",
              render: (_, task) =>
                task.error ? (
                  <Typography.Text type="danger" ellipsis={{ tooltip: task.error }} style={{ maxWidth: 280 }}>
                    {task.error}
                  </Typography.Text>
                ) : (
                  <Button
                    size="small"
                    disabled={!task.remote_job_id || TERMINAL_STATUSES.has(task.status)}
                    onClick={() => void refreshTask(task)}
                  >
                    同步状态
                  </Button>
                ),
            },
          ]}
        />
      </Card>

      <Modal
        open={nodeModalOpen}
        title={editingNode ? "编辑 ai-toolkit 节点" : "添加 ai-toolkit 节点"}
        onCancel={() => setNodeModalOpen(false)}
        onOk={() => void saveNode()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="节点名称" rules={[{ required: true }]}>
            <Input placeholder="例如：Azure A100" />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="Web UI 地址"
            rules={[{ required: true }, { type: "url", message: "请输入完整 HTTP(S) 地址" }]}
          >
            <Input placeholder="http://10.0.0.5:8675" />
          </Form.Item>
          <Form.Item
            name="auth_token"
            label="AI_TOOLKIT_AUTH"
            extra={editingNode?.auth_configured ? "已配置；留空表示保留原 Token。" : "节点未启用认证时可留空。"}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="gpu_ids" label="GPU ID" rules={[{ required: true }]}>
            <Input placeholder="0；多卡按 ai-toolkit 格式填写" />
          </Form.Item>
          <Form.Item name="enabled" label="允许调度" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}