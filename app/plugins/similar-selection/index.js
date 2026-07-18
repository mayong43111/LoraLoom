/** 相似图片精选插件前端。 */
const toolkit = window.DatasetToolkit;
if (!toolkit) throw new Error("DatasetToolkit 宿主 SDK 未就绪");

const { React, antd, icons, api, invokeTool, registerTool, ToolModalShell } = toolkit;
const h = React.createElement;
const {
  Alert,
  Button,
  Checkbox,
  Col,
  Divider,
  Empty,
  Flex,
  Input,
  Progress,
  Radio,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} = antd;
const { Text, Title } = Typography;
const TOOL_ID = "image.similar-selection";

const THRESHOLD_OPTIONS = [
  { label: "严格", value: 0.96 },
  { label: "平衡", value: 0.94 },
  { label: "宽松", value: 0.90 },
];

function SimilarSelectionTool(props) {
  const { open, onClose, context } = props;
  const target = context && context.target;
  const initialGroup = target && target.groupIds && target.groupIds[0];
  const [stage, setStage] = React.useState("setup");
  const [groups, setGroups] = React.useState([]);
  const [caps, setCaps] = React.useState(null);
  const [groupId, setGroupId] = React.useState(initialGroup || null);
  const [threshold, setThreshold] = React.useState(0.94);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [activeId, setActiveId] = React.useState(null);
  const [selected, setSelected] = React.useState({});
  const [included, setIncluded] = React.useState({});
  const [listMode, setListMode] = React.useState("duplicates");
  const [targetKind, setTargetKind] = React.useState("new_group");
  const [targetName, setTargetName] = React.useState("");
  const [targetGroupId, setTargetGroupId] = React.useState(null);
  const dirtyRef = React.useRef(false);

  React.useEffect(function () {
    if (!open) return undefined;
    let alive = true;
    Promise.all([api.listImageGroups(), invokeTool(TOOL_ID, "capabilities", {})])
      .then(function (values) {
        if (!alive) return;
        setGroups(values[0] || []);
        setCaps(values[1] || { available: false, reason: "能力探测失败" });
      })
      .catch(function (error) {
        if (alive) setCaps({ available: false, reason: error.message });
      });
    return function () { alive = false; };
  }, [open]);

  const clusters = (result && result.clusters) || [];
  const visibleClusters = clusters.filter(function (cluster) {
    return listMode === "all" || cluster.count > 1;
  });
  const activeCluster = clusters.find(function (cluster) { return cluster.id === activeId; }) || visibleClusters[0] || null;
  const selectedCount = clusters.reduce(function (count, cluster) {
    return count + (included[cluster.id] !== false && selected[cluster.id] ? 1 : 0);
  }, 0);

  function finish() {
    if (dirtyRef.current && context && context.onDone) context.onDone();
    onClose();
  }

  async function analyze() {
    if (!groupId) {
      message.warning("请选择图片分组");
      return;
    }
    setBusy(true);
    try {
      const data = await invokeTool(TOOL_ID, "analyze", { group_id: groupId, threshold: threshold });
      const nextSelected = {};
      const nextIncluded = {};
      (data.clusters || []).forEach(function (cluster) {
        nextSelected[cluster.id] = cluster.representative_id;
        nextIncluded[cluster.id] = true;
      });
      const firstDuplicate = (data.clusters || []).find(function (cluster) { return cluster.count > 1; });
      const source = groups.find(function (group) { return group.id === groupId; });
      setResult(data);
      setSelected(nextSelected);
      setIncluded(nextIncluded);
      setActiveId((firstDuplicate || data.clusters[0] || {}).id || null);
      setTargetName((source ? source.name : "图片") + "_相似精选");
      setStage("review");
      if (data.unreadable && data.unreadable.length) {
        message.warning(data.unreadable.length + " 张图片无法读取，已跳过");
      } else {
        message.success("分析完成");
      }
    } catch (error) {
      message.error("分析失败：" + error.message);
    } finally {
      setBusy(false);
    }
  }

  function choose(clusterId, imageId) {
    setSelected(function (previous) {
      return Object.assign({}, previous, { [clusterId]: imageId });
    });
  }

  function toggleCluster(clusterId, checked) {
    setIncluded(function (previous) {
      return Object.assign({}, previous, { [clusterId]: checked });
    });
  }

  async function commit() {
    const items = clusters
      .filter(function (cluster) { return included[cluster.id] !== false && selected[cluster.id]; })
      .map(function (cluster) {
        return { cluster_id: cluster.id, image_id: selected[cluster.id] };
      });
    if (!items.length) {
      message.warning("至少保留一个相似簇");
      return;
    }
    if (targetKind === "new_group" && !targetName.trim()) {
      message.warning("请输入新分组名称");
      return;
    }
    if (targetKind === "group" && !targetGroupId) {
      message.warning("请选择已有分组");
      return;
    }
    const targetPayload = targetKind === "new_group"
      ? { kind: "new_group", name: targetName.trim() }
      : { kind: "group", group_id: targetGroupId };
    setBusy(true);
    try {
      const response = await invokeTool(TOOL_ID, "commit", { selected: items, target: targetPayload });
      dirtyRef.current = response.created > 0 || dirtyRef.current;
      setGroups(await api.listImageGroups());
      message.success(
        "已加入“" + response.group_name + "”：新增 " + response.created + " 张" +
        (response.skipped ? "，跳过重复 " + response.skipped + " 张" : ""),
      );
    } catch (error) {
      message.error("加入分组失败：" + error.message);
    } finally {
      setBusy(false);
    }
  }

  function renderSetup() {
    const options = groups.map(function (group) {
      return { label: group.name + "（" + (group.image_count || 0) + "）", value: group.id };
    });
    return h("div", { style: { maxWidth: 760, margin: "18px auto" } },
      h(Space, { direction: "vertical", size: 18, style: { width: "100%" } },
        h(Title, { level: 4, style: { margin: 0 } }, "选择来源分组"),
        caps == null
          ? h(Alert, { type: "info", showIcon: true, message: "正在检查分析能力" })
          : caps.available
            ? h(Alert, { type: "success", showIcon: true, message: "相似度分析可用", description: caps.engine })
            : h(Alert, { type: "error", showIcon: true, message: "相似度分析不可用", description: caps.reason }),
        h("div", null,
          h(Text, { strong: true }, "图片分组"),
          h(Select, {
            value: groupId,
            onChange: setGroupId,
            options: options,
            showSearch: true,
            optionFilterProp: "label",
            placeholder: "选择一个图片分组",
            style: { width: "100%", marginTop: 7 },
          }),
        ),
        h("div", null,
          h(Text, { strong: true }, "相似度严格度"),
          h(Segmented, {
            block: true,
            value: threshold,
            onChange: setThreshold,
            options: THRESHOLD_OPTIONS,
            style: { marginTop: 7 },
          }),
        ),
        h(Alert, {
          type: "info",
          showIcon: true,
          message: "原图片不会被移动",
          description: "完成后会将每个相似簇选中的代表图复制到目标分组。",
        }),
        h(Flex, { justify: "flex-end", gap: 8 },
          h(Button, { onClick: finish }, "取消"),
          h(Button, {
            type: "primary",
            icon: h(icons.ExperimentOutlined),
            disabled: !caps || !caps.available || !groupId,
            loading: busy,
            onClick: analyze,
          }, "开始分析"),
        ),
      ),
    );
  }

  function renderClusterList() {
    return h("div", { className: "similar-selection-cluster-list", style: { borderRight: "1px solid #f0f0f0", paddingRight: 12, height: "max(300px, calc(100vh - 360px))" } },
      h(Flex, { justify: "space-between", align: "center", style: { marginBottom: 10 } },
        h(Text, { strong: true }, "相似簇"),
        h(Segmented, {
          size: "small",
          value: listMode,
          onChange: setListMode,
          options: [{ label: "相似组", value: "duplicates" }, { label: "全部", value: "all" }],
        }),
      ),
      h("div", { style: { overflowY: "auto", height: "calc(100% - 38px)", paddingRight: 4 } },
        visibleClusters.length
          ? visibleClusters.map(function (cluster) {
              const chosen = cluster.items.find(function (item) { return item.id === selected[cluster.id]; }) || cluster.items[0];
              const active = activeCluster && activeCluster.id === cluster.id;
              return h("button", {
                key: cluster.id,
                type: "button",
                onClick: function () { setActiveId(cluster.id); },
                style: {
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "58px 1fr auto",
                  gap: 9,
                  alignItems: "center",
                  padding: 8,
                  marginBottom: 6,
                  border: active ? "1px solid #1677ff" : "1px solid #e8e8e8",
                  borderRadius: 6,
                  background: active ? "#e6f4ff" : "#fff",
                  textAlign: "left",
                  cursor: "pointer",
                },
              },
                h("img", {
                  src: "/api/images/" + chosen.id + "/raw",
                  alt: chosen.title,
                  loading: "lazy",
                  style: { width: 58, height: 58, objectFit: "cover", borderRadius: 4 },
                }),
                h("span", { style: { minWidth: 0 } },
                  h("span", { style: { display: "block", fontWeight: 600 } }, cluster.id.replace("similar-", "第 ") + " 组"),
                  h("span", { style: { display: "block", color: "#8c8c8c", fontSize: 12 } }, cluster.count + " 张 · 质量 " + Math.round(chosen.quality * 100)),
                ),
                h(Checkbox, {
                  checked: included[cluster.id] !== false,
                  onClick: function (event) { event.stopPropagation(); },
                  onChange: function (event) { toggleCluster(cluster.id, event.target.checked); },
                }),
              );
            })
          : h(Empty, { image: Empty.PRESENTED_IMAGE_SIMPLE, description: "没有相似组" }),
      ),
    );
  }

  function renderCurrentCluster() {
    if (!activeCluster) return h(Empty, { description: "没有可复核的图片" });
    const isIncluded = included[activeCluster.id] !== false;
    return h("div", { className: "similar-selection-current", style: { height: "max(300px, calc(100vh - 360px))", overflowY: "auto", paddingRight: 4 } },
      h(Flex, { justify: "space-between", align: "center", style: { marginBottom: 12 } },
        h("div", null,
          h(Title, { level: 5, style: { margin: 0 } }, activeCluster.id.replace("similar-", "相似簇 ")),
          h(Text, { type: "secondary" }, activeCluster.count + " 张图片，选择其中一张作为代表图"),
        ),
        h(Checkbox, {
          checked: isIncluded,
          style: { flexShrink: 0, whiteSpace: "nowrap" },
          onChange: function (event) { toggleCluster(activeCluster.id, event.target.checked); },
        }, "加入精选结果"),
      ),
      h("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))",
          gap: 12,
          opacity: isIncluded ? 1 : 0.45,
        },
      }, activeCluster.items.map(function (item) {
        const checked = selected[activeCluster.id] === item.id;
        return h("button", {
          key: item.id,
          type: "button",
          disabled: !isIncluded,
          onClick: function () { choose(activeCluster.id, item.id); },
          style: {
            position: "relative",
            padding: 0,
            overflow: "hidden",
            borderRadius: 6,
            border: checked ? "2px solid #1677ff" : "1px solid #d9d9d9",
            background: "#fff",
            cursor: isIncluded ? "pointer" : "default",
            textAlign: "left",
          },
        },
          h("div", { style: { height: 210, background: "#181b22", display: "flex", alignItems: "center", justifyContent: "center" } },
            h("img", {
              src: "/api/images/" + item.id + "/raw",
              alt: item.title,
              loading: "lazy",
              style: { width: "100%", height: "100%", objectFit: "contain" },
            }),
          ),
          checked ? h("span", {
            style: {
              position: "absolute",
              right: 8,
              top: 8,
              width: 24,
              height: 24,
              lineHeight: "24px",
              borderRadius: "50%",
              textAlign: "center",
              color: "#fff",
              background: "#1677ff",
            },
          }, "✓") : null,
          h("div", { style: { padding: "9px 10px" } },
            h(Text, { ellipsis: true, style: { display: "block", fontSize: 12 } }, item.title || item.id),
            h(Flex, { justify: "space-between", style: { marginTop: 6 } },
              h(Tag, { color: checked ? "blue" : undefined, style: { margin: 0 } }, checked ? "已选择" : "相似 " + Math.round(item.similarity * 100) + "%"),
              h(Text, { type: "secondary", style: { fontSize: 12 } }, "质量 " + Math.round(item.quality * 100)),
            ),
            h(Progress, { percent: Math.round(item.quality * 100), size: "small", showInfo: false, style: { marginTop: 5 } }),
          ),
        );
      })),
    );
  }

  function renderTarget() {
    const existingOptions = groups
      .filter(function (group) { return group.id !== groupId; })
      .map(function (group) { return { label: group.name + "（" + (group.image_count || 0) + "）", value: group.id }; });
    return h("div", { style: { borderTop: "1px solid #f0f0f0", paddingTop: 12, marginTop: 12 } },
      h(Flex, { justify: "space-between", align: "flex-end", gap: 16, wrap: true },
        h(Space, { direction: "vertical", size: 7, style: { flex: "1 1 520px" } },
          h(Text, { strong: true }, "目标分组"),
          h(Radio.Group, {
            value: targetKind,
            onChange: function (event) { setTargetKind(event.target.value); },
            options: [{ label: "新建分组", value: "new_group" }, { label: "已有分组", value: "group" }],
          }),
          targetKind === "new_group"
            ? h(Input, { value: targetName, onChange: function (event) { setTargetName(event.target.value); }, placeholder: "新分组名称", style: { maxWidth: 480 } })
            : h(Select, {
                value: targetGroupId,
                onChange: setTargetGroupId,
                options: existingOptions,
                showSearch: true,
                optionFilterProp: "label",
                placeholder: "选择已有分组",
                style: { width: "100%", maxWidth: 480 },
              }),
        ),
        h(Button, {
          type: "primary",
          size: "large",
          icon: h(icons.FolderOutlined),
          loading: busy,
          onClick: commit,
        }, "加入分组（" + selectedCount + " 张）"),
      ),
    );
  }

  function renderReview() {
    return h("div", null,
      h(Row, { className: "similar-selection-stats", gutter: 12, style: { marginBottom: 12 } },
        [
          ["原图", result.total],
          ["可分析", result.analyzed],
          ["精选候选", selectedCount],
          ["移除近重复", result.removed_count],
        ].map(function (entry) {
          return h(Col, { span: 6, key: entry[0] },
            h("div", { style: { padding: "8px 14px", border: "1px solid #f0f0f0", borderRadius: 6 } },
              h(Statistic, { title: entry[0], value: entry[1], valueStyle: { fontSize: 22 } }),
            ),
          );
        }),
      ),
      h(Row, { className: "similar-selection-review", gutter: 14 },
        h(Col, { span: 6 }, renderClusterList()),
        h(Col, { span: 18 }, renderCurrentCluster()),
      ),
      renderTarget(),
    );
  }

  const headerExtra = stage === "review"
    ? h(Space, { size: 8 },
        h(Button, { size: "small", icon: h(icons.ExperimentOutlined), onClick: function () { setStage("setup"); } }, "重新分析"),
        h(Button, { size: "small", type: "primary", onClick: finish }, "完成"),
      )
    : null;

  return h(ToolModalShell, {
    open: open,
    onClose: finish,
    title: "相似图片精选",
    extra: headerExtra,
  },
  h("style", null, "@media (max-width: 700px) { .similar-selection-stats > .ant-col { flex: 0 0 50% !important; max-width: 50% !important; margin-bottom: 8px; } .similar-selection-review > .ant-col { flex: 0 0 100% !important; max-width: 100% !important; } .similar-selection-cluster-list { height: 220px !important; border-right: 0 !important; border-bottom: 1px solid #f0f0f0; margin-bottom: 12px; } .similar-selection-current { height: auto !important; max-height: 420px; } }"),
  h(Spin, { spinning: busy, tip: stage === "setup" ? "正在分析图片" : "正在加入分组" },
    stage === "setup" ? renderSetup() : renderReview(),
  ));
}

registerTool({
  id: TOOL_ID,
  name: "相似图片精选",
  description: "聚类近重复图片并将每组最佳图片加入精选分组",
  icon: h(icons.TagsOutlined),
  scopes: ["image"],
  selections: ["multi", "group"],
  source: "external",
  ui: "modal",
  launch: function (props) { return h(SimilarSelectionTool, props); },
});