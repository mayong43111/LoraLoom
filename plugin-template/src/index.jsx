/**
 * 示例插件 —— 前端（整页形态，ui: "page"）。
 *
 * 复用宿主 window.DatasetToolkit 暴露的能力，通过 invokeTool 调用后端 handler。
 * 使用 JSX 编写，由 esbuild 以 h() 工厂转换（见 build.mjs）。
 */
const toolkit = window.DatasetToolkit;
if (!toolkit) {
  throw new Error("DatasetToolkit 宿主 SDK 未就绪");
}

const { React, antd, icons, invokeTool, registerTool } = toolkit;
const h = React.createElement;
const Fragment = React.Fragment;
const { Card, Input, Button, Space, Alert, Descriptions, Spin } = antd;

function HelloPage(props) {
  const { onClose } = props;
  const [name, setName] = React.useState("世界");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [data, setData] = React.useState(null);

  const greet = () => {
    setLoading(true);
    setError(null);
    invokeTool("example.hello", "greet", { name })
      .then((res) => setData(res))
      .catch((err) => setError(err && err.message ? err.message : "调用失败"))
      .finally(() => setLoading(false));
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button onClick={onClose}>← 返回</Button>
      </Space>
      <Card>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space>
            <Input
              style={{ width: 240 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入名字"
            />
            <Button type="primary" onClick={greet} loading={loading}>
              调用后端
            </Button>
          </Space>
          {error && <Alert type="error" showIcon message={error} />}
          {loading && <Spin />}
          {data && (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="后端返回">{data.message}</Descriptions.Item>
              <Descriptions.Item label="数据集规模">
                视频 {data.dataset.videos} · 图片 {data.dataset.images}
              </Descriptions.Item>
            </Descriptions>
          )}
        </Space>
      </Card>
    </div>
  );
}

registerTool({
  id: "example.hello",
  name: "示例插件",
  description: "演示前端整页 + 后端 handler 的最小插件",
  icon: h(icons.ExperimentOutlined),
  scopes: ["global"],
  source: "external",
  ui: "page",
  launch: (props) => h(HelloPage, props),
});
