import { Typography } from "antd";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: string;
  extra?: ReactNode;
}

/** 页面顶部标题栏：标题 + 副标题 + 右侧操作区。 */
export function PageHeader({ title, subtitle, extra }: PageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 20,
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flexShrink: 0, minWidth: 0 }}>
        <Typography.Title level={4} style={{ margin: 0, whiteSpace: "nowrap" }}>
          {title}
        </Typography.Title>
        {subtitle && (
          <Typography.Text type="secondary">{subtitle}</Typography.Text>
        )}
      </div>
      {extra && (
        <div
          style={{
            flexGrow: 1,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          {extra}
        </div>
      )}
    </div>
  );
}
