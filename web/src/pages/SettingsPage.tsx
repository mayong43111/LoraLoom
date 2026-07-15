import {
  Card,
  Col,
  Form,
  InputNumber,
  Row,
  Select,
  Slider,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import { PageHeader } from "@/components/PageHeader";

/** 设置页。当前为只读展示的参数骨架，接入后端后再开放持久化。 */
export function SettingsPage() {
  return (
    <>
      <PageHeader title="设置" subtitle="流水线参数配置（接入后端后开放保存）" />
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card title="下载" size="small" style={{ marginBottom: 16 }}>
            <Form layout="vertical">
              <Form.Item label="默认下载器">
                <Select
                  defaultValue="yt_dlp"
                  options={[
                    { value: "yt_dlp", label: "yt-dlp" },
                    {
                      value: "gallery_dl",
                      label: "gallery-dl（第二阶段）",
                      disabled: true,
                    },
                  ]}
                />
              </Form.Item>
              <Form.Item label="并发数">
                <InputNumber min={1} max={8} defaultValue={2} />
              </Form.Item>
            </Form>
          </Card>

          <Card title="抽帧" size="small">
            <Form layout="vertical">
              <Form.Item label="默认间隔 (秒)">
                <InputNumber min={0.1} max={10} step={0.1} defaultValue={1} />
              </Form.Item>
              <Form.Item label="邻近帧搜索窗口 (秒)">
                <Slider min={0} max={2} step={0.1} defaultValue={0.5} />
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card title="人脸与聚类" size="small" style={{ marginBottom: 16 }}>
            <Form layout="vertical">
              <Form.Item label="人脸检测置信度阈值">
                <Slider min={0} max={1} step={0.05} defaultValue={0.6} />
              </Form.Item>
              <Form.Item label="聚类相似度阈值">
                <Slider min={0} max={1} step={0.05} defaultValue={0.5} />
              </Form.Item>
            </Form>
          </Card>

          <Card title="主体类型" size="small">
            <Form layout="vertical">
              <Form.Item
                label={
                  <span>
                    物品主体
                    <Tag color="default" style={{ marginLeft: 8 }}>
                      第二阶段
                    </Tag>
                  </span>
                }
              >
                <Tooltip title="物品主体识别为后续阶段功能">
                  <Switch disabled />
                </Tooltip>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </>
  );
}
