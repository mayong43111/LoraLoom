/**
 * 图片统计工具。
 *
 * 一个作用于图片库的独立工具：读取当前图片列表，汇总数量、朝向分布与
 * 标签分布。用于演示 image 作用域的工具，与图片库本身的能力解耦。
 */
import { Descriptions, Modal, Space, Tag } from "antd";
import { BarChartOutlined } from "@ant-design/icons";
import type { ToolDefinition, ToolLaunchProps } from "../types";

function ImageStatsModal({ open, onClose, context }: ToolLaunchProps) {
  const images = context.images ?? [];
  const total = images.length;

  const orientationCount = new Map<string, number>();
  const tagCount = new Map<string, number>();
  for (const img of images) {
    orientationCount.set(
      img.orientation,
      (orientationCount.get(img.orientation) ?? 0) + 1,
    );
    for (const t of img.tags) {
      tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
  }
  const topTags = Array.from(tagCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <Modal
      title="图片统计"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="当前图片数">{total}</Descriptions.Item>
        <Descriptions.Item label="朝向分布">
          {orientationCount.size ? (
            <Space size={4} wrap>
              {Array.from(orientationCount.entries()).map(([k, v]) => (
                <Tag key={k}>{`${k}: ${v}`}</Tag>
              ))}
            </Space>
          ) : (
            "无"
          )}
        </Descriptions.Item>
        <Descriptions.Item label="高频标签">
          {topTags.length ? (
            <Space size={4} wrap>
              {topTags.map(([t, c]) => (
                <Tag key={t} color="geekblue">{`${t}(${c})`}</Tag>
              ))}
            </Space>
          ) : (
            "无"
          )}
        </Descriptions.Item>
      </Descriptions>
    </Modal>
  );
}

export const imageStatsTool: ToolDefinition = {
  id: "image.stats",
  name: "图片统计",
  description: "统计当前图片数量、朝向分布与高频标签",
  icon: <BarChartOutlined />,
  scopes: ["image"],
  source: "builtin",
  launch: (props) => <ImageStatsModal {...props} />,
};
