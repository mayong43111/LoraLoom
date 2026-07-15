import { Empty, Tag, Typography } from "antd";
import { ToolOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

interface PlaceholderProps {
  title: string;
  phase?: string;
  description?: ReactNode;
}

/** 非 MVP 功能的占位页：展示标题、阶段标记与说明，功能禁用。 */
export function Placeholder({ title, phase, description }: PlaceholderProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 360,
        gap: 16,
      }}
    >
      <ToolOutlined style={{ fontSize: 48, color: "#5b6172" }} />
      <Typography.Title level={3} style={{ margin: 0 }}>
        {title}
        {phase && (
          <Tag color="default" style={{ marginLeft: 12 }}>
            {phase}
          </Tag>
        )}
      </Typography.Title>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Typography.Text type="secondary">
            {description ?? "该功能规划中，暂未开放。"}
          </Typography.Text>
        }
      />
    </div>
  );
}
