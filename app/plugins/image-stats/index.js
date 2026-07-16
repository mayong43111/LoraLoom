/**
 * 图片统计 —— 插件前端（弹窗形态，ui: "modal"）。
 *
 * 作用于图片库：从宿主注入的 context.images 读取当前图片列表，统计数量、
 * 朝向分布与高频标签。纯前端计算，不参与主程序打包。
 */
const toolkit = window.DatasetToolkit;
if (!toolkit) {
  throw new Error("DatasetToolkit 宿主 SDK 未就绪");
}

const { React, antd, icons, registerTool } = toolkit;
const h = React.createElement;
const { Modal, Descriptions, Space, Tag } = antd;

function ImageStatsModal(props) {
  const { open, onClose, context } = props;
  const images = (context && context.images) || [];
  const total = images.length;

  const orientationCount = new Map();
  const tagCount = new Map();
  images.forEach(function (img) {
    orientationCount.set(
      img.orientation,
      (orientationCount.get(img.orientation) || 0) + 1,
    );
    (img.tags || []).forEach(function (t) {
      tagCount.set(t, (tagCount.get(t) || 0) + 1);
    });
  });
  const topTags = Array.from(tagCount.entries())
    .sort(function (a, b) {
      return b[1] - a[1];
    })
    .slice(0, 8);

  return h(
    Modal,
    {
      title: "图片统计",
      open: open,
      onCancel: onClose,
      footer: null,
      destroyOnClose: true,
    },
    h(
      Descriptions,
      { column: 1, size: "small", bordered: true },
      h(Descriptions.Item, { label: "当前图片数", key: "total" }, String(total)),
      h(
        Descriptions.Item,
        { label: "朝向分布", key: "orientation" },
        orientationCount.size
          ? h(
              Space,
              { size: 4, wrap: true },
              Array.from(orientationCount.entries()).map(function (entry) {
                return h(Tag, { key: entry[0] }, entry[0] + ": " + entry[1]);
              }),
            )
          : "无",
      ),
      h(
        Descriptions.Item,
        { label: "高频标签", key: "tags" },
        topTags.length
          ? h(
              Space,
              { size: 4, wrap: true },
              topTags.map(function (entry) {
                return h(
                  Tag,
                  { key: entry[0], color: "geekblue" },
                  entry[0] + "(" + entry[1] + ")",
                );
              }),
            )
          : "无",
      ),
    ),
  );
}

registerTool({
  id: "image.stats",
  name: "图片统计",
  description: "统计当前图片数量、朝向分布与高频标签",
  icon: h(icons.BarChartOutlined),
  scopes: ["image"],
  source: "external",
  ui: "modal",
  launch: function (props) {
    return h(ImageStatsModal, props);
  },
});
