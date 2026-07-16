import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  message,
} from "antd";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/api/client";
import type { LlmConfig } from "@/api/types";

const PROVIDER_LABELS: Record<string, string> = {
  azure_foundry: "Azure AI Foundry（GPT）",
};

/** LLM 模型配置卡片：加载 / 保存 / 测试连接，目前仅支持 Azure AI Foundry 的 GPT 模型。 */
function LlmConfigCard() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [providers, setProviders] = useState<string[]>(["azure_foundry"]);

  useEffect(() => {
    let alive = true;
    api
      .getLlmConfig()
      .then((cfg: LlmConfig) => {
        if (!alive) return;
        setApiKeySet(cfg.api_key_set);
        setProviders(cfg.supported_providers?.length ? cfg.supported_providers : ["azure_foundry"]);
        form.setFieldsValue({
          provider: cfg.provider || "azure_foundry",
          endpoint: cfg.endpoint,
          deployment: cfg.deployment,
          api_version: cfg.api_version,
          model: cfg.model,
          api_key: "",
        });
      })
      .catch((err) => message.error(`加载 LLM 配置失败：${err.message ?? err}`))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const cfg = await api.saveLlmConfig(values);
      setApiKeySet(cfg.api_key_set);
      form.setFieldValue("api_key", "");
      message.success("已保存 LLM 配置");
    } catch (err: unknown) {
      if (err && typeof err === "object" && "errorFields" in err) return; // 表单校验错误
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`保存失败：${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      // 先保存当前表单，确保用后端最新配置进行测试。
      const values = await form.validateFields();
      await api.saveLlmConfig(values);
      form.setFieldValue("api_key", "");
      const result = await api.testLlmConnection();
      if (result.ok) message.success(result.message || "连接成功");
      else message.error(result.message || "连接失败");
    } catch (err: unknown) {
      if (err && typeof err === "object" && "errorFields" in err) {
        setTesting(false);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`测试失败：${msg}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      title="LLM 模型"
      size="small"
      style={{ marginBottom: 16 }}
      loading={loading}
    >
      <Form form={form} layout="vertical" disabled={saving || testing}>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item label="提供方" name="provider" rules={[{ required: true }]}>
              <Select
                options={providers.map((p) => ({
                  value: p,
                  label: PROVIDER_LABELS[p] ?? p,
                }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item
              label="Endpoint"
              name="endpoint"
              rules={[{ required: true, message: "请填写 Azure 资源 Endpoint" }]}
              tooltip="形如 https://<资源名>.openai.azure.com 或 Foundry 提供的 Endpoint"
            >
              <Input placeholder="https://your-resource.openai.azure.com" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item
              label="部署名 (Deployment)"
              name="deployment"
              rules={[{ required: true, message: "请填写部署名" }]}
              tooltip="Azure 上 GPT 模型的部署名称"
            >
              <Input placeholder="gpt-4o" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item label="模型" name="model" tooltip="模型标识，用于展示">
              <Input placeholder="gpt-4o" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item label="API 版本" name="api_version">
              <Input placeholder="2024-10-21" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label="API Key"
          name="api_key"
          extra={apiKeySet ? "已保存密钥；留空表示不修改。" : "尚未设置密钥。"}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={apiKeySet ? "••••••（留空保留原密钥）" : "输入 API Key"}
          />
        </Form.Item>
        <Space>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存
          </Button>
          <Button loading={testing} onClick={handleTest}>
            测试连接
          </Button>
        </Space>
      </Form>
    </Card>
  );
}

/** 设置页。LLM 配置已接入后端；其余参数为骨架，接入后端后再开放持久化。 */
export function SettingsPage() {
  return (
    <>
      <PageHeader title="设置" subtitle="模型与流水线参数配置" />
      <LlmConfigCard />
    </>
  );
}
