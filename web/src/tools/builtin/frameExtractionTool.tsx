/**
 * 视频抽帧工具。
 *
 * 一个完全独立的工具个体：自带元信息（名称/描述/图标/适用范围）与
 * 交互面板，通过 `registerTool` 注册进「工具集合」。它作用于视频，但
 * 不属于视频库本身的能力。宿主页面无需了解其内部实现。
 */
import { useState } from "react";
import { App, Form, InputNumber, Modal, Select } from "antd";
import { ScissorOutlined } from "@ant-design/icons";
import { api } from "@/api/client";
import type { ToolDefinition, ToolLaunchProps } from "../types";

function FrameExtractionModal({ open, onClose, context }: ToolLaunchProps) {
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
      context.onDone();
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
            options={context.videos.map((v) => ({ value: v.id, label: v.title }))}
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

export const frameExtractionTool: ToolDefinition = {
  id: "video.frame-extraction",
  name: "视频抽帧",
  description: "按间隔抽帧并做邻近帧择优，产出候选图片",
  icon: <ScissorOutlined />,
  scopes: ["video"],
  source: "builtin",
  launch: (props) => <FrameExtractionModal {...props} />,
};
