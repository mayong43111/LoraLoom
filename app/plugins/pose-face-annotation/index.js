/**
 * 姿态·人脸标注 —— 插件前端（全屏弹框，ui: "modal"，作用于图片库）。
 *
 * 平台统一设计：弹框外壳复用宿主 SDK 的 `toolkit.ToolModalShell`（全屏、与
 * 「视频抽帧」一致），本插件只定义壳内容。
 *
 * 流程：
 *   1) 选择输入 —— 不默认全部。可「按分组」选择一个/多个分组，或「指定图片」
 *      从当前列表中多选。从行/批量/分组入口带 `context.target` 进入时直接开始。
 *   2) 逐图标注 —— 人物姿态（正对/侧面/背面）、人脸（全脸/3-4脸/半脸/无脸）、
 *      人脸数量。支持「自动识别」（后端 handler.py 用 OpenCV 自带 Haar 级联做
 *      轻量预标注），识别结果作为建议，用户复核后写入。
 *
 * 标注结果以**标签**写入图片（`api.updateImage(id, {tags})`）：
 *   - `姿态:正对 / 姿态:侧面 / 姿态:背面`
 *   - `人脸:全脸 / 人脸:3-4脸 / 人脸:半脸 / 人脸:无脸`
 *   - `人脸数:N`
 * 重新标注时会先剔除同前缀的旧标签再写入，实现幂等替换；不改动其它标签。
 */
const toolkit = window.DatasetToolkit;
if (!toolkit) {
  throw new Error("DatasetToolkit 宿主 SDK 未就绪");
}

const { React, antd, icons, api, invokeTool, registerTool, ToolModalShell } = toolkit;
const h = React.createElement;
const {
  Alert,
  Button,
  Col,
  Divider,
  Empty,
  Flex,
  InputNumber,
  Modal,
  Progress,
  Radio,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} = antd;
const { Text, Title } = Typography;

const TOOL_ID = "image.pose-face-annotation";

// -- 姿态 / 人脸取值与标签映射 -------------------------------------------------
const ORIENT_OPTS = [
  { label: "正对", value: "front" },
  { label: "侧面", value: "side" },
  { label: "背面", value: "back" },
  { label: "未知", value: "unknown" },
];
const FACE_OPTS = [
  { label: "全脸", value: "full" },
  { label: "3/4脸", value: "three_quarter" },
  { label: "半脸", value: "half" },
  { label: "无脸", value: "none" },
  { label: "未知", value: "unknown" },
];

const P_ORIENT = "姿态:";
const P_FACE = "人脸:";
const P_COUNT = "人脸数:";

const ORIENT_TAG = { front: "正对", side: "侧面", back: "背面" };
const FACE_TAG = { full: "全脸", three_quarter: "3-4脸", half: "半脸", none: "无脸" };
const ORIENT_FROM = { 正对: "front", 侧面: "side", 背面: "back" };
const FACE_FROM = { 全脸: "full", "3-4脸": "three_quarter", 半脸: "half", 无脸: "none" };

/** 从图片已有标签解析出当前标注状态（用于回显/再标注）。 */
function stateFromTags(img) {
  let orientation = "unknown";
  let face = "unknown";
  let person_count = 0;
  (img.tags || []).forEach(function (t) {
    if (t.indexOf(P_ORIENT) === 0) {
      const v = ORIENT_FROM[t.slice(P_ORIENT.length)];
      if (v) orientation = v;
    } else if (t.indexOf(P_FACE) === 0) {
      const v = FACE_FROM[t.slice(P_FACE.length)];
      if (v) face = v;
    } else if (t.indexOf(P_COUNT) === 0) {
      const n = parseInt(t.slice(P_COUNT.length), 10);
      if (!isNaN(n)) person_count = n;
    }
  });
  return { orientation: orientation, face: face, person_count: person_count };
}

/** 由标注状态生成带前缀的标签数组。未知项不产生标签。 */
function tagsFromState(s) {
  const out = [];
  if (ORIENT_TAG[s.orientation]) out.push(P_ORIENT + ORIENT_TAG[s.orientation]);
  if (FACE_TAG[s.face]) out.push(P_FACE + FACE_TAG[s.face]);
  if (typeof s.person_count === "number" && s.person_count >= 0) {
    out.push(P_COUNT + s.person_count);
  }
  return out;
}

/** 合并标签：剔除本工具同前缀的旧标签，追加新标签并去重。 */
function mergeTags(existing, fresh) {
  const kept = (existing || []).filter(function (t) {
    return t.indexOf(P_ORIENT) !== 0 && t.indexOf(P_FACE) !== 0 && t.indexOf(P_COUNT) !== 0;
  });
  const seen = {};
  const out = [];
  kept.concat(fresh).forEach(function (t) {
    if (!seen[t]) {
      seen[t] = true;
      out.push(t);
    }
  });
  return out;
}

function PoseFaceTool(props) {
  const { open, onClose, context } = props;
  const pool = (context && context.images) || [];
  const target = context && context.target;

  const [stage, setStage] = React.useState("input");
  const [groups, setGroups] = React.useState([]);
  const [caps, setCaps] = React.useState(null); // null=探测中; {available,reason}
  const [inputMode, setInputMode] = React.useState("group");
  const [pickedGroups, setPickedGroups] = React.useState([]);
  const [pickedImages, setPickedImages] = React.useState([]);

  const [items, setItems] = React.useState([]);
  const [index, setIndex] = React.useState(0);
  const [annos, setAnnos] = React.useState({});
  const [saved, setSaved] = React.useState({});
  const [busy, setBusy] = React.useState(false);
  const [detecting, setDetecting] = React.useState(false);
  const dirtyRef = React.useRef(false);

  const itemsById = React.useMemo(
    function () {
      const m = {};
      items.forEach(function (im) {
        m[im.id] = im;
      });
      return m;
    },
    [items],
  );

  // 载入分组列表 + 探测自动识别能力。
  React.useEffect(function () {
    let alive = true;
    api
      .listImageGroups()
      .then(function (gs) {
        if (alive) setGroups(gs || []);
      })
      .catch(function () {
        if (alive) setGroups([]);
      });
    invokeTool(TOOL_ID, "capabilities", {})
      .then(function (c) {
        if (alive) setCaps(c || { available: false, reason: "未知" });
      })
      .catch(function (e) {
        if (alive) setCaps({ available: false, reason: e.message });
      });
    return function () {
      alive = false;
    };
  }, []);

  // 带 target 入口：直接开始标注，不经过输入选择。
  React.useEffect(
    function () {
      if (!open) return;
      if (target && target.imageIds && target.imageIds.length) {
        const wanted = new Set(target.imageIds);
        beginAnnotate(pool.filter(function (im) {
          return wanted.has(im.id);
        }));
      } else if (target && target.groupIds && target.groupIds.length) {
        startGroups(target.groupIds);
      }
    },
    // 仅在首次打开时依据 target 决定，无需依赖后续变化。
    // eslint-disable-next-line
    [open],
  );

  const total = items.length;
  const current = total ? items[Math.min(index, total - 1)] : null;
  const anno = current ? annos[current.id] : null;
  const savedCount = Object.keys(saved).length;

  // 方向键切换图片（仅标注阶段）。
  React.useEffect(
    function () {
      if (!open || stage !== "annotate" || !total) return undefined;
      function onKey(e) {
        if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (e.key === "ArrowRight") setIndex(function (i) { return Math.min(total - 1, i + 1); });
        else if (e.key === "ArrowLeft") setIndex(function (i) { return Math.max(0, i - 1); });
      }
      window.addEventListener("keydown", onKey);
      return function () {
        window.removeEventListener("keydown", onKey);
      };
    },
    [open, stage, total],
  );

  function beginAnnotate(imgs) {
    if (!imgs || !imgs.length) {
      message.warning("没有可标注的图片");
      return;
    }
    const m = {};
    imgs.forEach(function (im) {
      m[im.id] = stateFromTags(im);
    });
    setItems(imgs);
    setAnnos(m);
    setSaved({});
    setIndex(0);
    setStage("annotate");
  }

  async function startGroups(groupIds) {
    setBusy(true);
    try {
      const lists = await Promise.all(
        groupIds.map(function (g) {
          return api.listImages({ group_id: g });
        }),
      );
      const imgs = [].concat.apply([], lists);
      beginAnnotate(imgs);
    } catch (e) {
      message.error("加载分组图片失败：" + e.message);
    } finally {
      setBusy(false);
    }
  }

  function startImages() {
    const wanted = new Set(pickedImages);
    beginAnnotate(pool.filter(function (im) {
      return wanted.has(im.id);
    }));
  }

  async function startAll() {
    setBusy(true);
    try {
      const imgs = await api.listImages({});
      beginAnnotate(imgs || []);
    } catch (e) {
      message.error("加载全部图片失败：" + e.message);
    } finally {
      setBusy(false);
    }
  }

  function setField(id, field, value) {
    setAnnos(function (prev) {
      const next = Object.assign({}, prev);
      next[id] = Object.assign({}, prev[id], { [field]: value });
      return next;
    });
  }

  async function saveIds(ids) {
    if (!ids.length) return true;
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        ids.map(function (id) {
          const im = itemsById[id];
          const merged = mergeTags(im ? im.tags : [], tagsFromState(annos[id]));
          return api.updateImage(id, { tags: merged }).then(function (updated) {
            if (im) im.tags = (updated && updated.tags) || merged;
          });
        }),
      );
      const okIds = [];
      let failed = 0;
      results.forEach(function (r, i) {
        if (r.status === "fulfilled") okIds.push(ids[i]);
        else failed += 1;
      });
      if (okIds.length) {
        dirtyRef.current = true;
        setSaved(function (prev) {
          const next = Object.assign({}, prev);
          okIds.forEach(function (id) {
            next[id] = true;
          });
          return next;
        });
      }
      if (failed) message.warning("已保存 " + okIds.length + " 张，" + failed + " 张失败");
      return failed === 0;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveNext() {
    if (!current) return;
    const ok = await saveIds([current.id]);
    if (ok) {
      message.success("已保存");
      if (index < total - 1) setIndex(index + 1);
    }
  }

  // scope="current"：仅对当前图片给出建议，交由用户复核后保存。
  // scope="all"：对全部图片自动识别并**直接保存**（无需逐张确认）。
  async function runDetect(scope) {
    const targets = scope === "current" && current ? [current] : items;
    const ids = targets.map(function (i) {
      return i.id;
    });
    if (!ids.length) return;
    const persist = scope !== "current";
    // 后端单批上限 200，这里分批（150/批）发送，避免大分组一次请求被拒。
    const CHUNK = 150;
    const chunks = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    setDetecting(true);
    let okDetect = 0;
    let okSave = 0;
    let failSave = 0;
    try {
      for (let c = 0; c < chunks.length; c += 1) {
        if (chunks.length > 1) {
          message.info("处理中… 第 " + (c + 1) + " / " + chunks.length + " 批", 0.8);
        }
        const res = await invokeTool(TOOL_ID, "detect", { image_ids: chunks[c] });
        const rmap = {};
        (res.results || []).forEach(function (r) {
          rmap[r.id] = r;
        });
        okDetect += res.ok || 0;
        // 依据识别结果计算每张的新标注状态（脱离 React 异步 state，便于随后落库）。
        const computed = {};
        chunks[c].forEach(function (id) {
          const r = rmap[id];
          if (!r || !r.ok) return;
          const base = annos[id] || { orientation: "unknown", face: "unknown", person_count: 0 };
          computed[id] = {
            orientation: r.orientation || base.orientation,
            face: r.face || base.face,
            person_count: typeof r.person_count === "number" ? r.person_count : base.person_count,
            _suggested: true,
          };
        });
        setAnnos(function (prev) {
          const next = Object.assign({}, prev);
          Object.keys(computed).forEach(function (id) {
            next[id] = Object.assign({}, prev[id], computed[id]);
          });
          return next;
        });
        if (persist) {
          const pids = Object.keys(computed);
          const rlist = await Promise.allSettled(
            pids.map(function (id) {
              const im = itemsById[id];
              const merged = mergeTags(im ? im.tags : [], tagsFromState(computed[id]));
              return api.updateImage(id, { tags: merged }).then(function (updated) {
                if (im) im.tags = (updated && updated.tags) || merged;
              });
            }),
          );
          const okIds = [];
          rlist.forEach(function (rr, i) {
            if (rr.status === "fulfilled") {
              okIds.push(pids[i]);
              okSave += 1;
            } else {
              failSave += 1;
            }
          });
          if (okIds.length) {
            dirtyRef.current = true;
            setSaved(function (prev) {
              const nx = Object.assign({}, prev);
              okIds.forEach(function (id) {
                nx[id] = true;
              });
              return nx;
            });
          }
        }
      }
      if (persist) {
        if (failSave) message.warning("识别完成，已保存 " + okSave + " 张，" + failSave + " 张保存失败");
        else message.success("识别并保存完成：" + okSave + " / " + ids.length + " 张");
      } else {
        message.success("识别完成：" + okDetect + " / " + ids.length + " 张（请复核后保存）");
      }
    } catch (e) {
      message.error("自动识别失败：" + e.message);
    } finally {
      setDetecting(false);
    }
  }

  function finish() {
    if (dirtyRef.current && context && context.onDone) context.onDone();
    onClose();
  }

  // ---- 渲染：输入选择阶段 --------------------------------------------------
  function renderInput() {
    const groupOptions = groups.map(function (g) {
      return { label: g.name + "（" + (g.image_count || 0) + "）", value: g.id };
    });
    const imageOptions = pool.map(function (im) {
      return { label: (im.title || im.id) + "（" + (im.width || "?") + "×" + (im.height || "?") + "）", value: im.id };
    });
    const canStart =
      inputMode === "all" ||
      (inputMode === "group" && pickedGroups.length > 0) ||
      (inputMode === "images" && pickedImages.length > 0);
    const capsAlert =
      caps == null
        ? h(Alert, { type: "info", showIcon: true, message: "正在探测自动识别能力…" })
        : caps.available
          ? h(Alert, {
              type: "success",
              showIcon: true,
              message: "自动识别可用（" + (caps.engine || "opencv") + " " + (caps.version || "") + "）——进入标注后可一键预标注。",
            })
          : h(Alert, {
              type: "warning",
              showIcon: true,
              message: "自动识别不可用，将只能手动标注",
              description: caps.reason,
            });

    return h(
      "div",
      { style: { maxWidth: 760, margin: "0 auto", padding: "8px 4px" } },
      h(Space, { direction: "vertical", size: 16, style: { width: "100%" } },
        h(Title, { level: 4, style: { marginBottom: 0 } }, "选择要标注的输入"),
        h(Text, { type: "secondary" }, "请选择一个/多个分组、从当前列表指定一组图片，或对全部图片进行识别标注。"),
        capsAlert,
        h(Radio.Group, {
          optionType: "button",
          buttonStyle: "solid",
          value: inputMode,
          onChange: function (e) {
            setInputMode(e.target.value);
          },
          options: [
            { label: "按分组", value: "group" },
            { label: "指定图片", value: "images" },
            { label: "全部图片", value: "all" },
          ],
        }),
        inputMode === "all"
          ? h(Alert, {
              type: "info",
              showIcon: true,
              message: "将载入整个图库的全部图片进行标注",
              description: "进入标注后可点「自动识别全部」对所有图片一键预标注（大批量会自动分批处理）。",
            })
          : inputMode === "group"
          ? h("div", null,
              h(Text, { strong: true }, "选择分组"),
              h(Select, {
                mode: "multiple",
                allowClear: true,
                showSearch: true,
                optionFilterProp: "label",
                placeholder: "选择一个或多个分组",
                style: { width: "100%", marginTop: 6 },
                value: pickedGroups,
                onChange: setPickedGroups,
                options: groupOptions,
                maxTagCount: "responsive",
              }),
            )
          : h("div", null,
              h(Flex, { justify: "space-between", align: "center" },
                h(Text, { strong: true }, "指定图片（当前列表共 " + pool.length + " 张）"),
                h(Space, { size: 4 },
                  h(Button, { size: "small", onClick: function () { setPickedImages(pool.map(function (im) { return im.id; })); } }, "全选"),
                  h(Button, { size: "small", onClick: function () { setPickedImages([]); } }, "清空"),
                ),
              ),
              h(Select, {
                mode: "multiple",
                allowClear: true,
                showSearch: true,
                optionFilterProp: "label",
                placeholder: "选择要标注的图片",
                style: { width: "100%", marginTop: 6 },
                value: pickedImages,
                onChange: setPickedImages,
                options: imageOptions,
                maxTagCount: "responsive",
              }),
            ),
        h(Divider, { style: { margin: "4px 0" } }),
        h(Flex, { justify: "flex-end", gap: 8 },
          h(Button, { onClick: finish }, "取消"),
          h(Button, {
            type: "primary",
            loading: busy,
            disabled: !canStart,
            onClick: function () {
              if (inputMode === "all") startAll();
              else if (inputMode === "group") startGroups(pickedGroups);
              else startImages();
            },
          }, "开始标注"),
        ),
      ),
    );
  }

  // ---- 渲染：逐图标注阶段 --------------------------------------------------
  function renderAnnotate() {
    if (!total) {
      return h(Empty, { description: "没有可标注的图片，请重新选择输入", style: { marginTop: 80 } });
    }
    const resultTags = anno ? tagsFromState(anno) : [];
    return h(
      Row,
      { gutter: 16, style: { height: "100%" } },
      // 左：预览
      h(Col, { span: 15 },
        h("div", {
          style: {
            height: "calc(100vh - 150px)",
            minHeight: 320,
            background: "#1b1e26",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          },
        },
          h("img", {
            src: "/api/images/" + current.id + "/raw",
            alt: current.title || current.id,
            style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
          }),
        ),
        h(Flex, { justify: "space-between", align: "center", style: { marginTop: 8 } },
          h(Text, { type: "secondary", ellipsis: true, style: { maxWidth: "70%" } },
            (current.title || current.id) + "（" + (current.width || "?") + "×" + (current.height || "?") + "）"),
          h(Space, { size: 6 },
            anno && anno._suggested && !saved[current.id] ? h(Tag, { color: "blue" }, "已预标注") : null,
            saved[current.id] ? h(Tag, { color: "green" }, "已保存") : h(Tag, null, "未保存"),
          ),
        ),
      ),
      // 右：标注控件
      h(Col, { span: 9 },
        h(Space, { direction: "vertical", size: 16, style: { width: "100%" } },
          h("div", null,
            h(Flex, { justify: "space-between", align: "center" },
              h(Text, { strong: true }, "第 " + (index + 1) + " / " + total + " 张"),
              h(Text, { type: "secondary" }, "已保存 " + savedCount + " / " + total),
            ),
            h(Progress, { percent: total ? Math.round((savedCount / total) * 100) : 0, size: "small", showInfo: false }),
          ),
          h(Tooltip, { title: caps && !caps.available ? caps.reason : "对当前图片运行自动识别" },
            h(Button, {
              icon: h(icons.ThunderboltOutlined),
              loading: detecting,
              disabled: !caps || !caps.available,
              onClick: function () { runDetect("current"); },
              block: true,
            }, "自动识别本图"),
          ),
          h("div", null,
            h(Title, { level: 5, style: { marginBottom: 8 } }, "人物姿态"),
            h(Segmented, { block: true, options: ORIENT_OPTS, value: anno.orientation,
              onChange: function (v) { setField(current.id, "orientation", v); } }),
          ),
          h("div", null,
            h(Title, { level: 5, style: { marginBottom: 8 } }, "人脸完整度 / 角度"),
            h(Segmented, { block: true, options: FACE_OPTS, value: anno.face,
              onChange: function (v) { setField(current.id, "face", v); } }),
          ),
          h("div", null,
            h(Title, { level: 5, style: { marginBottom: 8 } }, "人脸数量"),
            h(InputNumber, { min: 0, max: 999, style: { width: 160 }, value: anno.person_count,
              onChange: function (v) { setField(current.id, "person_count", typeof v === "number" ? v : 0); } }),
          ),
          h("div", null,
            h(Text, { type: "secondary", style: { fontSize: 12 } }, "将写入标签："),
            h("div", { style: { marginTop: 6 } },
              resultTags.length
                ? resultTags.map(function (t) { return h(Tag, { key: t, color: "geekblue" }, t); })
                : h(Text, { type: "secondary" }, "（无——姿态/人脸均为未知）"),
            ),
          ),
          h(Divider, { style: { margin: "4px 0" } }),
          h(Flex, { gap: 8, wrap: true },
            h(Button, { disabled: index <= 0 || busy, onClick: function () { setIndex(Math.max(0, index - 1)); } }, "上一张"),
            h(Button, { disabled: index >= total - 1 || busy, onClick: function () { setIndex(Math.min(total - 1, index + 1)); } }, "下一张"),
            h(Button, { type: "primary", loading: busy, onClick: handleSaveNext }, index < total - 1 ? "保存并下一张" : "保存"),
          ),
          h(Text, { type: "secondary", style: { fontSize: 12 } },
            "← / → 键切换图片；结果以标签写入，重复标注会替换同类标签。"),
        ),
      ),
    );
  }

  // ---- 外壳 ----------------------------------------------------------------
  const headerExtra =
    stage === "annotate"
      ? h(Space, { size: 8 },
          h(Button, {
            size: "small",
            icon: h(icons.ThunderboltOutlined),
            loading: detecting,
            disabled: !caps || !caps.available,
            onClick: function () { runDetect("all"); },
          }, "自动识别并保存全部"),
          h(Button, { size: "small", onClick: function () { setStage("input"); } }, "重新选择输入"),
          h(Button, { size: "small", type: "primary", onClick: finish }, "完成"),
        )
      : null;

  return h(
    ToolModalShell,
    { open: open, onClose: finish, title: "姿态·人脸标注", extra: headerExtra },
    h(Spin, { spinning: busy && stage === "input", tip: "加载图片…" },
      stage === "input" ? renderInput() : renderAnnotate(),
    ),
  );
}

registerTool({
  id: TOOL_ID,
  name: "姿态·人脸标注",
  description: "选择分组或一组图片，逐图标注人物姿态与人脸（支持自动识别），结果写入标签",
  icon: h(icons.TagsOutlined),
  scopes: ["image"],
  selections: ["single", "multi"],
  source: "external",
  ui: "modal",
  launch: function (props) {
    return h(PoseFaceTool, props);
  },
});
