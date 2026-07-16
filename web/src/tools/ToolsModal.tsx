/**
 * 工具集合弹窗（卡片式）。
 *
 * 由工具注册中心驱动，支持外部动态注入（ComfyUI 式扩展机制）。
 * 视频库与图片库共用本组件，仅通过 `scope` 区分展示各自适用的工具。
 */
import { Alert, Button, Card, Col, Empty, Modal, Row, Space, Spin, Tag } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { HOST_API_VERSION } from "./host";
import { useExternalTools, useTools } from "./hooks";
import type { ToolDefinition, ToolScope, ToolSelection } from "./types";

/** 工具是否匹配所需作用形态（未声明 selections 视为同时支持 single/multi）。 */
function matchesSelection(tool: ToolDefinition, selection?: ToolSelection): boolean {
  if (!selection) return true;
  const sels = tool.selections ?? ["single", "multi"];
  return sels.includes(selection);
}

export function ToolsModal({
  open,
  onClose,
  scope,
  selection,
  onSelectTool,
}: {
  open: boolean;
  onClose: () => void;
  scope: ToolScope;
  /**
   * 需要的作用形态：
   * - "single"：仅显示单资源工具（+ 同时支持 multi 的工具）；
   * - "multi"：仅显示多资源/分组工具；
   * - 省略：不按形态过滤（如库页顶部「工具集合」入口）。
   */
  selection?: ToolSelection;
  onSelectTool: (tool: ToolDefinition) => void;
}) {
  const navigate = useNavigate();
  const allTools = useTools(scope);
  const tools = allTools.filter((t) => matchesSelection(t, selection));
  const { loading, result, reload } = useExternalTools();
  const failed = result?.failed.filter((f) => f.id !== "*") ?? [];
  const manifestError = result?.failed.find((f) => f.id === "*");

  // 整页工具跳转到独立路由；弹窗工具沿用宿主的内联启动。
  const handleSelect = (tool: ToolDefinition) => {
    if (tool.ui === "page") {
      onClose();
      navigate(`/tools/${encodeURIComponent(tool.id)}`);
    } else {
      onSelectTool(tool);
    }
  };

  return (
    <Modal
      title={
        <Space>
          工具集合
          <span style={{ fontSize: 12, color: "#8b90a0", fontWeight: 400 }}>
            SDK v{HOST_API_VERSION}
          </span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnClose
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 12, color: "#8b90a0" }}>
          {loading ? "正在加载扩展工具…" : `共 ${tools.length} 个工具`}
        </span>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={reload}
        >
          刷新扩展
        </Button>
      </div>

      {manifestError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="获取扩展工具清单失败"
          description={manifestError.error}
        />
      )}
      {failed.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="部分扩展工具加载失败"
          description={failed.map((f) => `${f.id}: ${f.error}`).join("；")}
        />
      )}

      {tools.length === 0 ? (
        loading ? (
          <div style={{ textAlign: "center", padding: 32 }}>
            <Spin />
          </div>
        ) : (
          <Empty description="暂无可用工具" />
        )
      ) : (
        <Row gutter={[16, 16]}>
          {tools.map((tool) => {
            const disabled = tool.enabled === false;
            return (
              <Col key={tool.id} xs={24} sm={12}>
                <Card
                  hoverable={!disabled}
                  onClick={() => !disabled && handleSelect(tool)}
                  style={{
                    height: "100%",
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                  styles={{ body: { padding: 16 } }}
                >
                  <Space align="start" size={12}>
                    <span style={{ fontSize: 28, color: "#4c8dff" }}>
                      {tool.icon}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {tool.name}
                        {tool.source === "external" && (
                          <Tag color="purple" style={{ marginLeft: 8 }}>
                            扩展
                          </Tag>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "#8b90a0" }}>
                        {tool.description}
                      </div>
                    </div>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </Modal>
  );
}
