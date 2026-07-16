import { Layout, Menu, Tag, Tooltip, Typography } from "antd";
import { useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { NAV_ITEMS } from "@/nav";
import { api } from "@/api/client";

const { Sider, Header, Content } = Layout;

function buildMenuItems(navigate: NavigateFunction) {
  return NAV_ITEMS.map((item) => ({
    key: item.path,
    label: (
      <span
        style={{ display: "flex", alignItems: "center", gap: 8 }}
        onClick={() => navigate(item.path)}
      >
        {item.title}
        {!item.mvp && (
          <Tag color="default" style={{ marginInlineEnd: 0, fontSize: 11 }}>
            {item.phase}
          </Tag>
        )}
      </span>
    ),
  }));
}

/** 应用外壳：左侧导航 + 顶部栏 + 内容区。 */
export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [dataSource, setDataSource] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getDataSource()
      .then((info) => {
        if (alive) setDataSource(info.path);
      })
      .catch(() => {
        if (alive) setDataSource(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const selectedKey =
    NAV_ITEMS.find(
      (item) =>
        item.path === location.pathname ||
        (item.path !== "/" && location.pathname.startsWith(item.path)),
    )?.path ?? "/";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={220} theme="dark">
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            fontWeight: 600,
            fontSize: 15,
            color: "#e6e8ee",
          }}
        >
          图片数据集平台
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={buildMenuItems(navigate)}
          style={{ borderInlineEnd: "none" }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            height: 56,
            borderBottom: "1px solid #2a2e39",
          }}
        >
          <Typography.Text strong>LoRA 训练数据集</Typography.Text>
          {dataSource && (
            <Tooltip title={dataSource}>
              <Typography.Text
                type="secondary"
                style={{ maxWidth: 480 }}
                ellipsis={{ tooltip: false }}
              >
                数据位置：{dataSource}
              </Typography.Text>
            </Tooltip>
          )}
        </Header>
        <Content style={{ padding: 24, overflow: "auto" }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
