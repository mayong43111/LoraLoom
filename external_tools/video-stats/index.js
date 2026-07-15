/**
 * 视频统计 —— 外部动态注入工具示例（ComfyUI 式自定义扩展）。
 *
 * 本文件不参与前端构建，由浏览器以原生 ES 模块动态加载，仅依赖宿主
 * 通过 window.DatasetToolkit 暴露的能力（React / antd / 图标 / API）。
 * 加载即调用 registerTool 自注册，随后出现在「工具集合」卡片中。
 *
 * 要新增一个外部工具：在 external_tools/ 下新建目录，放入 manifest.json
 * 与本样式的 index.js 即可，无需重新构建主程序。
 */
const toolkit = window.DatasetToolkit;
if (!toolkit) {
  throw new Error("DatasetToolkit 宿主 SDK 未就绪");
}

const { React, antd, icons, registerTool } = toolkit;
const h = React.createElement;
const { Modal, Descriptions, Empty } = antd;

function StatsPanel(props) {
  const { open, onClose, context } = props;
  const videos = (context && context.videos) || [];
  const totalSeconds = videos.reduce(function (sum, v) {
    return sum + (v.duration || 0);
  }, 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  const avg = videos.length ? Math.round(totalSeconds / videos.length) : 0;

  return h(
    Modal,
    {
      title: "视频统计（扩展工具）",
      open: open,
      onCancel: onClose,
      footer: null,
      destroyOnClose: true,
    },
    videos.length === 0
      ? h(Empty, { description: "暂无视频" })
      : h(
          Descriptions,
          { column: 1, size: "small", bordered: true },
          h(Descriptions.Item, { label: "视频数量", key: "count" }, String(videos.length)),
          h(
            Descriptions.Item,
            { label: "总时长", key: "dur" },
            minutes + " 分 " + seconds + " 秒",
          ),
          h(Descriptions.Item, { label: "平均时长", key: "avg" }, avg + " 秒"),
        ),
  );
}

registerTool({
  id: "external.video-stats",
  name: "视频统计",
  description: "统计当前视频数量与总时长（外部动态注入示例）",
  icon: h(icons.BarChartOutlined),
  scopes: ["video"],
  source: "external",
  launch: function (props) {
    return h(StatsPanel, props);
  },
});
