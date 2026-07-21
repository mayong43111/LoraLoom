/** 训练集策展插件前端。 */
const toolkit = window.DatasetToolkit;
if (!toolkit) throw new Error("DatasetToolkit 宿主 SDK 未就绪");

const { React, antd, icons, invokeTool, api, registerTool, ToolModalShell } = toolkit;
const h = React.createElement;
const {
  Alert, Button, Checkbox, Col, Empty, Flex, Input, InputNumber, Radio, Row,
  Segmented, Select, Space, Spin, Statistic, Table, Tag, Typography, message,
} = antd;
const { Text, Title } = Typography;
const TOOL_ID = "image.training-curation";
const TEMPLATE_OPTIONS = [
  { label: "人物形象训练", value: "identity" },
  { label: "动作训练", value: "action" },
];

function TrainingCurationTool(props) {
  const { open, onClose, context } = props;
  const initialGroup = context && context.target && context.target.groupIds && context.target.groupIds[0];
  const [template, setTemplate] = React.useState("identity");
  const [overview, setOverview] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [groupId, setGroupId] = React.useState(initialGroup || null);
  const [selected, setSelected] = React.useState({});
  const [assignedCategory, setAssignedCategory] = React.useState({});
  const [categoryDefinitions, setCategoryDefinitions] = React.useState([]);
  const [showMode, setShowMode] = React.useState("recommended");
  const [categoryFilter, setCategoryFilter] = React.useState("all");
  const [targetKind, setTargetKind] = React.useState("new_group");
  const [targetName, setTargetName] = React.useState("");
  const [targetGroupId, setTargetGroupId] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  function loadOverview(nextTemplate) {
    setBusy(true);
    invokeTool(TOOL_ID, "overview", { template: nextTemplate })
      .then(function (data) {
        setOverview(data);
      })
      .catch(function (error) { message.error("加载策展建议失败：" + error.message); })
      .finally(function () { setBusy(false); });
  }

  React.useEffect(function () {
    if (open) loadOverview(template);
  }, [open]);

  function changeTemplate(value) {
    setTemplate(value);
    setResult(null);
    setGroupId(null);
    loadOverview(value);
  }

  function analyze(id, name, preserveTargetName) {
    setBusy(true);
    setGroupId(id);
    invokeTool(TOOL_ID, "analyze", { group_id: id, template: template })
      .then(function (data) {
        const next = {};
        const assigned = {};
        data.items.forEach(function (item) {
          next[item.id] = item.recommended;
          if (item.recommended && item.category) assigned[item.id] = item.category;
        });
        setResult(data);
        setSelected(next);
        setAssignedCategory(assigned);
        setCategoryDefinitions(data.breakdown.map(function (item) {
          return Object.assign({}, item, { custom: false });
        }));
        setCategoryFilter(data.breakdown.length ? data.breakdown[0].id : "all");
        if (!preserveTargetName) {
          setTargetName(name + "_" + (template === "identity" ? "人物形象训练" : "动作训练"));
        }
      })
      .catch(function (error) { message.error("分析失败：" + error.message); })
      .finally(function () { setBusy(false); });
  }

  function toggle(id, checked) {
    setSelected(function (previous) { return Object.assign({}, previous, { [id]: checked }); });
    if (checked && categoryFilter !== "all") {
      setAssignedCategory(function (previous) { return Object.assign({}, previous, { [id]: categoryFilter }); });
    }
  }

  const selectedIds = result
    ? result.items.filter(function (item) { return selected[item.id]; }).map(function (item) { return item.id; })
    : [];

  function categoryLabel(categoryId) {
    const definition = categoryDefinitions.find(function (item) { return item.id === categoryId; });
    return definition ? definition.name : categoryName(categoryId);
  }

  function updateCategory(categoryId, patch) {
    setCategoryDefinitions(function (previous) {
      return previous.map(function (item) {
        return item.id === categoryId ? Object.assign({}, item, patch) : item;
      });
    });
  }

  function addCategory() {
    const customCount = categoryDefinitions.filter(function (item) { return item.custom; }).length;
    const id = "custom_" + Date.now().toString(36) + "_" + customCount;
    setCategoryDefinitions(function (previous) {
      return previous.concat([{ id: id, name: "自定义动作 " + (customCount + 1), target: 10, available: result ? result.eligible : 0, recommended: 0, custom: true }]);
    });
    setCategoryFilter(id);
  }

  function removeCategory(categoryId) {
    setCategoryDefinitions(function (previous) {
      return previous.filter(function (item) { return item.id !== categoryId; });
    });
    setSelected(function (previous) {
      const next = Object.assign({}, previous);
      Object.keys(assignedCategory).forEach(function (imageId) {
        if (assignedCategory[imageId] === categoryId) next[imageId] = false;
      });
      return next;
    });
    setAssignedCategory(function (previous) {
      const next = Object.assign({}, previous);
      Object.keys(next).forEach(function (imageId) {
        if (next[imageId] === categoryId) delete next[imageId];
      });
      return next;
    });
    if (categoryFilter === categoryId) setCategoryFilter("all");
  }

  function targetPayload(suffix) {
    if (targetKind === "group") return { kind: "group", group_id: targetGroupId };
    return { kind: "new_group", name: targetName.trim() + (suffix || "") };
  }

  function validateTarget() {
    if (!selectedIds.length) {
      message.warning("至少选择一张图片");
      return false;
    }
    if (targetKind === "new_group" && !targetName.trim()) {
      message.warning("请输入新分组名称");
      return false;
    }
    if (targetKind === "group" && !targetGroupId) {
      message.warning("请选择已有分组");
      return false;
    }
    return true;
  }

  function commit() {
    if (!validateTarget()) return;
    setBusy(true);
    invokeTool(TOOL_ID, "commit", { image_ids: selectedIds, target: targetPayload("") })
      .then(function (data) {
        setDirty(data.created > 0 || dirty);
        message.success("已加入“" + data.group_name + "”：新增 " + data.created + " 张，跳过 " + data.skipped + " 张");
      })
      .catch(function (error) { message.error("加入分组失败：" + error.message); })
      .finally(function () { setBusy(false); });
  }

  function crop(mode) {
    if (!validateTarget()) return;
    const suffix = targetKind === "new_group" ? (mode === "head" ? "_全头裁切" : "_近景裁切") : "";
    setBusy(true);
    invokeTool(TOOL_ID, "crop", { image_ids: selectedIds, mode: mode, target: targetPayload(suffix) })
      .then(function (data) {
        setDirty(data.created > 0 || dirty);
        message.success("已生成 " + data.created + " 张裁切图" + (data.skipped.length ? "，跳过 " + data.skipped.length + " 张" : ""));
      })
      .catch(function (error) { message.error("裁切失败：" + error.message); })
      .finally(function () { setBusy(false); });
  }

  function finish() {
    if (dirty && context && context.onDone) context.onDone();
    onClose();
  }

  function renderOverview() {
    const meta = overview && overview.templates[template];
    const columns = [
      { title: "分组", dataIndex: "name", ellipsis: true },
      { title: "现有", dataIndex: "count", width: 90 },
      { title: "模板建议配额", dataIndex: "breakdown", render: function (items) { return h(Flex, { gap: 5, wrap: true }, items.map(function (item) { return h(Tag, { key: item.id, color: "blue", style: { margin: 0 } }, item.name + " " + item.target + " 张"); })); } },
      { title: "目标配额", dataIndex: "recommended", width: 100, render: function (value) { return h(Tag, { color: "blue" }, value + " 张"); } },
      { title: "操作", width: 120, render: function (_, row) { return h(Button, { type: "primary", size: "small", onClick: function () { analyze(row.id, row.name); } }, "查看推荐"); } },
    ];
    return h("div", { style: { maxWidth: 1080, margin: "20px auto" } },
      h(Space, { direction: "vertical", size: 16, style: { width: "100%" } },
        h(Title, { level: 4, style: { margin: 0 } }, "选择训练模板"),
        h(Segmented, { block: true, value: template, options: TEMPLATE_OPTIONS, onChange: changeTemplate }),
        meta ? h(Alert, { type: "info", showIcon: true, message: meta.name, description: meta.description }) : null,
        meta ? h(Flex, { gap: 7, wrap: true }, meta.categories.map(function (item) { return h(Tag, { key: item.id, color: "blue", style: { margin: 0, padding: "4px 9px" } }, item.name + " " + item.target + " 张"); })) : null,
        h(Table, { rowKey: "id", columns: columns, dataSource: overview ? overview.groups : [], pagination: false, size: "middle", scroll: { x: 900 } }),
      ),
    );
  }

  function renderItem(item) {
    const checked = !!selected[item.id];
    return h("button", {
      key: item.id,
      type: "button",
      onClick: function () { toggle(item.id, !checked); },
      style: {
        position: "relative", padding: 0, overflow: "hidden", borderRadius: 6,
        border: checked ? "2px solid #1677ff" : "1px solid #d9d9d9",
        background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer", opacity: item.eligible ? 1 : 0.55,
      },
    },
      h("div", { style: { height: 230, background: "#171a20", display: "flex", alignItems: "center", justifyContent: "center" } },
        h("img", { src: "/api/images/" + item.id + "/raw", alt: item.title, loading: "lazy", style: { width: "100%", height: "100%", objectFit: "contain" } }),
      ),
      h("div", { style: { padding: 9 } },
        h(Text, { ellipsis: true, style: { display: "block", fontSize: 12 } }, item.title),
        h(Flex, { gap: 4, wrap: true, style: { marginTop: 6 } },
          h(Tag, { color: checked ? "blue" : undefined, style: { margin: 0 } }, checked ? "已入选" : "未入选"),
          h(Tag, { style: { margin: 0 } }, item.face),
          item.shot !== "未知" ? h(Tag, { style: { margin: 0 } }, item.shot) : null,
          h(Tag, { color: item.quality >= 0.85 ? "green" : "orange", style: { margin: 0 } }, "质量 " + Math.round(item.quality * 100)),
          (assignedCategory[item.id] || item.category) ? h(Tag, { color: "cyan", style: { margin: 0 } }, categoryLabel(assignedCategory[item.id] || item.category)) : null,
        ),
        h(Text, { type: "secondary", style: { display: "block", fontSize: 11, marginTop: 5 } }, item.width + "×" + item.height + " · " + (item.reasons.join("、") || "多样性补充")),
      ),
    );
  }

  function renderTarget() {
    const options = (overview ? overview.groups : []).filter(function (group) { return group.id !== groupId; }).map(function (group) { return { label: group.name + "（" + group.count + "）", value: group.id }; });
    return h("div", { style: { borderTop: "1px solid #f0f0f0", paddingTop: 12, marginTop: 12 } },
      h(Flex, { justify: "space-between", align: "flex-end", gap: 16, wrap: true },
        h(Space, { direction: "vertical", size: 7, style: { flex: "1 1 480px" } },
          h(Text, { strong: true }, "输出分组"),
          h(Radio.Group, { value: targetKind, onChange: function (event) { setTargetKind(event.target.value); }, options: [{ label: "新建分组", value: "new_group" }, { label: "已有分组", value: "group" }] }),
          targetKind === "new_group"
            ? h(Input, { value: targetName, onChange: function (event) { setTargetName(event.target.value); }, placeholder: "新分组名称", style: { maxWidth: 520 } })
            : h(Select, { value: targetGroupId, onChange: setTargetGroupId, options: options, placeholder: "选择已有分组", showSearch: true, optionFilterProp: "label", style: { width: "100%", maxWidth: 520 } }),
        ),
        h(Space, { wrap: true },
          h(Button, { icon: h(icons.FolderOutlined), onClick: commit }, "复制入选原图"),
          template === "identity" ? h(Button, { onClick: function () { crop("head"); } }, "生成全头裁切") : null,
          template === "identity" ? h(Button, { type: "primary", onClick: function () { crop("closeup"); } }, "生成近景裁切") : null,
        ),
      ),
      template === "identity" ? h(Alert, { type: "warning", showIcon: true, style: { marginTop: 10 }, message: "裁切不会覆盖原图", description: "仅在人脸区域至少 640 像素时生成；全头为 1:1，近景为 3:4，输出保留原始像素供 1024 训练缩放。" }) : null,
    );
  }

  function renderReview() {
    const currentGroup = overview && overview.groups.find(function (group) { return group.id === groupId; });
    const activeDefinition = categoryDefinitions.find(function (item) { return item.id === categoryFilter; });
    const inCategory = result.items.filter(function (item) {
      return categoryFilter === "all" || (activeDefinition && activeDefinition.custom && item.eligible) || item.category === categoryFilter || (item.categories || []).indexOf(categoryFilter) >= 0;
    });
    const chosen = result.items.filter(function (item) {
      return selected[item.id] && (categoryFilter === "all" || assignedCategory[item.id] === categoryFilter);
    });
    const candidates = inCategory.filter(function (item) { return item.eligible && !selected[item.id]; });

    function renderPool(title, count, items, emptyText, selectedPool) {
      return h("section", { className: "curation-pool" },
        h(Flex, { justify: "space-between", align: "center", style: { marginBottom: 9 } },
          h(Title, { level: 5, style: { margin: 0 } }, title),
          h(Tag, { color: selectedPool ? "blue" : undefined, style: { margin: 0 } }, count + " 张"),
        ),
        items.length
          ? h("div", { className: "curation-grid" }, items.map(renderItem))
          : h(Empty, { image: Empty.PRESENTED_IMAGE_SIMPLE, description: emptyText }),
      );
    }

    return h("div", { className: "curation-review" },
      h("div", { className: "curation-workbench" },
        h("aside", { className: "curation-requirements" },
          h(Text, { type: "secondary", style: { fontSize: 12 } }, "当前分组"),
          h(Title, { level: 5, style: { margin: "3px 0 12px" } }, currentGroup ? currentGroup.name : "分组要求"),
          h("div", { className: "curation-summary" },
            [["原图", result.total], ["基础可用", result.eligible], ["目标配额", categoryDefinitions.reduce(function (sum, item) { return sum + item.target; }, 0)], ["当前入选", selectedIds.length]].map(function (entry) {
              return h("div", { key: entry[0] }, h(Text, { type: "secondary" }, entry[0]), h(Text, { strong: true }, entry[1]));
            }),
          ),
          h(Text, { strong: true, style: { display: "block", margin: "16px 0 8px" } }, "分组要求"),
          h("div", { className: "curation-category-list" }, categoryDefinitions.map(function (item) {
            const current = result.items.filter(function (image) { return assignedCategory[image.id] === item.id && selected[image.id]; }).length;
            const shortfall = Math.max(0, item.target - current);
            return h("div", { key: item.id, onClick: function () { setCategoryFilter(item.id); }, className: "curation-category" + (categoryFilter === item.id ? " is-active" : "") },
              h(Flex, { justify: "space-between", align: "center" },
                h(Input, {
                  value: item.name,
                  size: "small",
                  "aria-label": "分组名称",
                  onClick: function (event) { event.stopPropagation(); },
                  onChange: function (event) { updateCategory(item.id, { name: event.target.value }); },
                  style: { width: 165, fontWeight: 600 },
                }),
                h(Text, { strong: true, type: shortfall ? "warning" : "success" }, current + "/" + item.target),
              ),
              h(Flex, { justify: "space-between", align: "center", style: { marginTop: 7 } },
                h(Text, { type: "secondary", style: { fontSize: 12 } }, "可用 " + (item.custom ? result.eligible : item.available) + (shortfall ? " · 还差 " + shortfall : " · 已满足")),
                h(Space, { size: 4, onClick: function (event) { event.stopPropagation(); } },
                  h(Text, { type: "secondary", style: { fontSize: 12 } }, "目标"),
                  h(InputNumber, { min: 0, max: result.eligible, size: "small", value: item.target, onChange: function (value) { updateCategory(item.id, { target: typeof value === "number" ? value : 0 }); }, style: { width: 68 } }),
                  item.custom ? h(Button, { size: "small", type: "text", danger: true, icon: h(icons.DeleteOutlined), title: "删除分组", onClick: function () { removeCategory(item.id); } }) : null,
                ),
              ),
            );
          })),
          h(Button, { block: true, icon: h(icons.PlusOutlined), style: { marginTop: 10 }, onClick: addCategory }, "添加分组"),
          h(Button, { block: true, style: { marginTop: 10 }, onClick: function () { setCategoryFilter("all"); }, type: categoryFilter === "all" ? "primary" : "default" }, "查看全部"),
        ),
        h("main", { className: "curation-pools" },
          h(Flex, { justify: "space-between", align: "center", gap: 12, wrap: true, className: "curation-pools-header" },
            h("div", null,
              h(Title, { level: 4, style: { margin: 0 } }, categoryFilter === "all" ? "全部类别" : categoryLabel(categoryFilter)),
              h(Text, { type: "secondary" }, activeDefinition && activeDefinition.custom ? "自定义分组展示全部基础可用图片；点击图片进行人工分配" : "点击图片可在入选与候选之间移动"),
            ),
            h(Tag, { color: "blue", style: { margin: 0 } }, "整组已选 " + selectedIds.length + " 张"),
          ),
          renderPool("已入选", chosen.length, chosen, "此类别尚未入选图片", true),
          renderPool("候选", candidates.length, candidates, "没有更多符合条件的候选", false),
        ),
      ),
      renderTarget(),
    );
  }

  return h(ToolModalShell, {
    open: open,
    onClose: finish,
    title: "训练集策展",
    extra: result ? h(Space, null, h(Button, { onClick: function () { setResult(null); } }, "返回分组"), h(Button, { type: "primary", onClick: finish }, "完成")) : null,
  },
  h("style", null, ".curation-workbench{display:grid;grid-template-columns:320px minmax(0,1fr);gap:18px;align-items:start}.curation-requirements{position:sticky;top:0;border-right:1px solid color-mix(in srgb,currentColor 18%,transparent);padding:4px 16px 4px 2px;max-height:calc(100vh - 190px);overflow:auto}.curation-summary{display:grid;grid-template-columns:1fr 1fr;gap:7px}.curation-summary>div{display:flex;flex-direction:column;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:6px;padding:7px 9px}.curation-category-list{display:flex;flex-direction:column;gap:7px}.curation-category{width:100%;color:inherit;text-align:left;padding:9px 10px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:color-mix(in srgb,currentColor 5%,transparent);cursor:pointer}.curation-category.is-active{border-color:#1677ff;background:rgba(22,119,255,.18)}.curation-pools{min-width:0;max-height:calc(100vh - 185px);overflow:auto;padding-right:4px}.curation-pools-header{position:sticky;top:0;z-index:2;padding:3px 0 10px;backdrop-filter:blur(10px);background:color-mix(in srgb,currentColor 5%,transparent)}.curation-pool{border-top:1px solid color-mix(in srgb,currentColor 18%,transparent);padding-top:12px;margin-bottom:18px}.curation-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}.curation-grid>button>div:first-child{height:360px!important}@media(max-width:800px){.curation-workbench{grid-template-columns:1fr}.curation-requirements{position:static;max-height:none;border-right:0;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent);padding:0 0 12px}.curation-category-list{display:grid;grid-template-columns:1fr}.curation-pools{max-height:none}.curation-grid{grid-template-columns:1fr}.curation-grid>button>div:first-child{height:min(62vh,520px)!important}}"),
  h(Spin, { spinning: busy, tip: result ? "正在处理图片" : "正在分析分组" }, result ? renderReview() : renderOverview()));
}

function categoryName(categoryId) {
  const names = {
    head_closeup: "头部特写", front_full: "正面全身", front_half: "正面半身",
    side: "侧面", back: "背面", side_full: "侧面全身", back_full: "背面全身",
    other_action: "其他动作角度",
  };
  return names[categoryId] || categoryId;
}

registerTool({
  id: TOOL_ID,
  name: "训练集策展",
  description: "按训练模板推荐图片，并生成全头或近景裁切",
  icon: h(icons.ExperimentOutlined),
  scopes: ["image"],
  selections: ["multi", "group"],
  source: "external",
  ui: "modal",
  launch: function (props) { return h(TrainingCurationTool, props); },
});
