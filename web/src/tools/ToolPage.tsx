/**
 * 工具整页宿主（ui: "page" 的插件承载）。
 *
 * 路由 `/tools/:id` 命中此页：确保外部插件已加载后，从注册表按 id 取出工具，
 * 以整页形式渲染其 `launch()` 面板。插件通过统一接口（invokeTool）与后端交互，
 * 因此整页工具默认不依赖当前库的选择上下文。
 */
import { useNavigate, useParams } from "react-router-dom";
import { Button, Empty, Result, Spin } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { useExternalTools, useTools } from "./hooks";
import { getTool } from "./registry";

export function ToolPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  // 订阅注册表变化 + 触发外部插件加载，确保直接访问 URL 时也能注入。
  useTools();
  const { loading } = useExternalTools();

  const tool = getTool(id);
  const back = () => navigate(-1);

  if (!tool) {
    if (loading) {
      return (
        <div style={{ textAlign: "center", padding: 64 }}>
          <Spin size="large" tip="正在加载插件…" />
        </div>
      );
    }
    return (
      <Result
        status="404"
        title="工具不存在"
        subTitle={`未找到 id 为「${id}」的工具，可能未安装或未启用。`}
        extra={
          <Button type="primary" onClick={() => navigate("/videos")}>
            返回视频库
          </Button>
        }
      />
    );
  }

  if (tool.ui !== "page") {
    return (
      <>
        <PageHeader
          title={tool.name}
          extra={
            <Button icon={<ArrowLeftOutlined />} onClick={back}>
              返回
            </Button>
          }
        />
        <Empty description="该工具为弹窗形态，请从「工具集合」中启动。" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={tool.name}
        subtitle={tool.description}
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={back}>
            返回
          </Button>
        }
      />
      {tool.launch({ open: true, onClose: back, context: { onDone: () => {} } })}
    </>
  );
}
