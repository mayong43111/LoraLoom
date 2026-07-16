/**
 * 视频抽帧 —— 插件前端（弹窗形态，ui: "modal"）。
 *
 * 双 Tab 布局（无线性向导）：
 *   「操作」：选择视频 + 预览/胶片条 + 框选区间 + 抽帧参数（间隔/标签/开始抽帧）。
 *   「候选」：候选帧复核（通过/拒绝互相移动）+ 入库设置（目标/确认入库/放弃）。
 * 未选择视频时也展示完整骨架，仅相关操作置灰。
 *
 * 所有解码与质量计算在后端 handler.py 完成，前端统一通过
 * invokeTool("video.frame-extraction", action, payload) 调用；视频原生播放走
 * 宿主的 GET /api/videos/{id}/stream（支持 Range 拖动）。
 */
const toolkit = window.DatasetToolkit;
if (!toolkit) {
  throw new Error("DatasetToolkit 宿主 SDK 未就绪");
}

const { React, antd, icons, api, invokeTool, registerTool } = toolkit;
const h = React.createElement;
const {
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Image,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Segmented,
  Select,
  Slider,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  message,
} = antd;
const { Text } = Typography;

const TOOL_ID = "video.frame-extraction";

function fmt(t) {
  if (t == null || Number.isNaN(t)) return "0.000s";
  return Number(t).toFixed(3) + "s";
}

/** 单个候选帧卡片。 */
function FrameCard(props) {
  const { frame, actionLabel, onAction } = props;
  const flags = frame.quality_flags || [];
  return h(
    Card,
    {
      size: "small",
      styles: { body: { padding: 6 } },
      style: { width: 148 },
      cover: h(
        "div",
        { style: { height: 96, background: "#1b1e26", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" } },
        h(Image, {
          src: frame.thumb,
          alt: fmt(frame.actual_timestamp),
          height: 96,
          style: { objectFit: "contain", maxWidth: "100%" },
          preview: { mask: "预览" },
        }),
      ),
    },
    h(
      Space,
      { direction: "vertical", size: 2, style: { width: "100%" } },
      h(
        Flex,
        { justify: "space-between", align: "center" },
        h(Text, { style: { fontSize: 11 } }, fmt(frame.actual_timestamp)),
        h(Tag, { color: frame.quality_score >= 0.6 ? "green" : "orange", style: { marginInlineEnd: 0 } }, frame.quality_score),
      ),
      frame.status === "replaced_by_neighbor"
        ? h(Tag, { color: "blue", style: { fontSize: 11 } }, "邻近帧")
        : null,
      flags.length
        ? h("div", null, flags.map(function (fl) {
            return h(Tag, { key: fl, color: "red", style: { fontSize: 11, marginBottom: 2 } }, fl);
          }))
        : null,
      h(Button, { size: "small", block: true, onClick: function () { onAction(frame); } }, actionLabel),
    ),
  );
}

/** 将秒格式化为 mm:ss 刻度文字。 */
function clockLabel(t) {
  if (t == null || Number.isNaN(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

/**
 * 抽取区间时间轴（参考视频编辑器）：
 * 顶部刻度栏，中部橙色选中区间 + 白色菱形采样点（转折点），
 * 两侧可拖拽的起/止手柄，蓝色播放头；点击轨道跳转播放头。
 */
function RangeTimeline(props) {
  const duration = props.duration || 0;
  const range = props.range || { start: 0, end: 0 };
  const interval = props.interval || 1;
  const playhead = props.playhead || 0;
  const disabled = props.disabled;
  const trackRef = React.useRef(null);

  const pct = function (t) {
    return duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0;
  };

  const timeAt = function (clientX) {
    const el = trackRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const beginDrag = function (which) {
    return function (e) {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const onMove = function (ev) {
        const t = timeAt(ev.clientX);
        if (which === "start") props.onChange({ start: Math.min(t, range.end - interval), end: range.end });
        else props.onChange({ start: range.start, end: Math.max(t, range.start + interval) });
      };
      const onUp = function () {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };
  };

  const seekAt = function (e) {
    if (disabled) return;
    props.onSeek(timeAt(e.clientX));
  };

  const beginPlayheadDrag = function (e) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const onMove = function (ev) { props.onSeek(timeAt(ev.clientX)); };
    const onUp = function () {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // 采样点（转折点）：区间内按间隔均匀分布，预览用，最多显示 300 个。
  const marks = [];
  if (interval > 0) {
    for (let t = range.start; t <= range.end + 1e-6 && marks.length < 300; t += interval) {
      marks.push(t);
    }
  }

  // 刻度步长：让整段大约落在 12 格以内。
  const targets = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900];
  let tickStep = 900;
  for (let i = 0; i < targets.length; i++) {
    if (duration / targets[i] <= 12) { tickStep = targets[i]; break; }
  }
  const ticks = [];
  if (duration > 0) {
    for (let t = 0; t <= duration + 1e-6; t += tickStep) ticks.push(t);
  }

  const orange = "#e08a2b";

  return h(
    "div",
    {
      style: {
        userSelect: "none",
        background: "#1f1f1f",
        borderRadius: 6,
        padding: "6px 10px 8px",
        opacity: disabled ? 0.5 : 1,
      },
    },
    // 刻度栏
    h(
      "div",
      { style: { position: "relative", height: 16, marginBottom: 2 } },
      ticks.map(function (t, i) {
        return h(
          "div",
          {
            key: "tk" + i,
            style: {
              position: "absolute",
              left: pct(t) + "%",
              transform: "translateX(-50%)",
              fontSize: 10,
              color: "#8c8c8c",
              whiteSpace: "nowrap",
            },
          },
          clockLabel(t),
        );
      }),
    ),
    // 轨道
    h(
      "div",
      {
        ref: trackRef,
        onMouseDown: seekAt,
        style: {
          position: "relative",
          height: 40,
          background: "#111",
          borderRadius: 4,
          cursor: disabled ? "default" : "pointer",
          overflow: "hidden",
        },
      },
      // 选中区间（橙色带）
      h("div", {
        style: {
          position: "absolute",
          left: pct(range.start) + "%",
          width: Math.max(0, pct(range.end) - pct(range.start)) + "%",
          top: 8,
          bottom: 8,
          background: orange,
          borderRadius: 3,
        },
      }),
      // 采样点（转折点 菱形）
      marks.map(function (t, i) {
        return h("div", {
          key: "mk" + i,
          style: {
            position: "absolute",
            left: pct(t) + "%",
            top: "50%",
            width: 8,
            height: 8,
            marginLeft: -4,
            marginTop: -4,
            background: "#fff",
            transform: "rotate(45deg)",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
            pointerEvents: "none",
          },
        });
      }),
      // 起点手柄
      h("div", {
        onMouseDown: beginDrag("start"),
        title: "拖动调整起点",
        style: {
          position: "absolute",
          left: pct(range.start) + "%",
          top: 4,
          bottom: 4,
          width: 8,
          marginLeft: -4,
          background: "#fff",
          borderRadius: 2,
          cursor: disabled ? "default" : "ew-resize",
        },
      }),
      // 终点手柄
      h("div", {
        onMouseDown: beginDrag("end"),
        title: "拖动调整终点",
        style: {
          position: "absolute",
          left: pct(range.end) + "%",
          top: 4,
          bottom: 4,
          width: 8,
          marginLeft: -4,
          background: "#fff",
          borderRadius: 2,
          cursor: disabled ? "default" : "ew-resize",
        },
      }),
      // 播放头（当前帧）—— 可拖动
      h(
        "div",
        {
          onMouseDown: beginPlayheadDrag,
          title: "拖动调整当前帧",
          style: {
            position: "absolute",
            left: pct(playhead) + "%",
            top: 0,
            bottom: 0,
            width: 12,
            marginLeft: -6,
            cursor: disabled ? "default" : "ew-resize",
            zIndex: 3,
          },
        },
        // 顶部拓取旋钮
        h("div", {
          style: {
            position: "absolute",
            left: "50%",
            top: 0,
            width: 12,
            height: 8,
            marginLeft: -6,
            background: "#40a9ff",
            borderRadius: "2px 2px 0 0",
          },
        }),
        // 竖线
        h("div", {
          style: {
            position: "absolute",
            left: "50%",
            top: 8,
            bottom: 0,
            width: 2,
            marginLeft: -1,
            background: "#40a9ff",
          },
        }),
      ),
    ),
    // 采样数提示
    h(
      "div",
      { style: { marginTop: 4, fontSize: 11, color: "#8c8c8c" } },
      marks.length >= 300
        ? "采样点过多（预览已截断为 300 个），可增大间隔"
        : "预计 " + marks.length + " 个采样点（区间内每 " + interval + "s 一帧）",
    ),
  );
}

/** 双 Tab 视频抽帧弹窗。 */
function FrameExtractionModal(props) {
  const { open, onClose } = props;
  const context = props.context || {};
  const videoRef = React.useRef(null);
  // 由「工具」入口带入的目标视频 id（存在则锁定该视频，隐藏选择器）。
  const lockedVideoId =
    (context.target && context.target.videoIds && context.target.videoIds[0]) || null;

  const [videos, setVideos] = React.useState([]);
  const [loadingVideos, setLoadingVideos] = React.useState(false);
  const [videoId, setVideoId] = React.useState(null);
  const [probe, setProbe] = React.useState(null);
  const [probing, setProbing] = React.useState(false);
  const [playhead, setPlayhead] = React.useState(0);
  const [range, setRange] = React.useState({ start: 0, end: 0 });
  const [interval, setIntervalSec] = React.useState(1);
  const [tags, setTags] = React.useState([]);

  const [extracting, setExtracting] = React.useState(false);
  const [session, setSession] = React.useState(null);
  const [tab, setTab] = React.useState("setup");
  const [reviewSeg, setReviewSeg] = React.useState("accepted");

  const [groups, setGroups] = React.useState([]);
  const [targetKind, setTargetKind] = React.useState("root");
  const [groupId, setGroupId] = React.useState(undefined);
  const [newName, setNewName] = React.useState("");
  const [committing, setCommitting] = React.useState(false);

  React.useEffect(function () {
    setLoadingVideos(true);
    api
      .listVideos({})
      .then(function (list) { setVideos(list || []); })
      .catch(function (err) { message.error(err && err.message ? err.message : "加载视频失败"); })
      .finally(function () { setLoadingVideos(false); });
    api.listImageGroups().then(function (list) { setGroups(list || []); }).catch(function () {});
  }, []);

  const duration = probe ? probe.duration : 0;
  const step = probe && probe.fps ? 1 / probe.fps : 0.04;
  const accepted = (session && session.accepted) || [];
  const rejected = (session && session.rejected) || [];

  const selectVideo = function (id) {
    setVideoId(id);
    setProbe(null);
    setPlayhead(0);
    setSession(null);
    setProbing(true);
    invokeTool(TOOL_ID, "probe", { video_id: id })
      .then(function (res) {
        setProbe(res);
        setRange({ start: 0, end: res.duration });
      })
      .catch(function (err) { message.error(err && err.message ? err.message : "读取视频信息失败"); })
      .finally(function () { setProbing(false); });
  };

  // 由资源/分组「工具」入口带入 videoId 时，自动加载该视频，跳过手动选择。
  const autoLoadedRef = React.useRef(false);
  React.useEffect(function () {
    if (autoLoadedRef.current) return;
    const target = context.target || {};
    const ids = target.videoIds || [];
    if (ids.length > 0) {
      autoLoadedRef.current = true;
      selectVideo(ids[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  const seek = function (t) {
    const clamped = Math.max(0, Math.min(t, duration));
    setPlayhead(clamped);
    if (videoRef.current) videoRef.current.currentTime = clamped;
  };

  const runExtract = function () {
    if (!videoId || !probe) { message.warning("请先选择视频"); return; }
    setExtracting(true);
    invokeTool(TOOL_ID, "extract", {
      video_id: videoId,
      start: range.start,
      end: range.end,
      interval: interval,
      tags: tags,
    })
      .then(function (res) {
        setSession({
          sessionId: res.session_id,
          videoTitle: probe.title,
          accepted: res.accepted || [],
          rejected: res.rejected || [],
        });
        setReviewSeg("accepted");
        setTab("candidate");
        message.success("抽帧完成，请在「候选」页复核");
      })
      .catch(function (err) { message.error(err && err.message ? err.message : "抽帧失败"); })
      .finally(function () { setExtracting(false); });
  };

  const move = function (frame, toAccepted) {
    setSession(function (s) {
      if (!s) return s;
      const from = toAccepted ? "rejected" : "accepted";
      const to = toAccepted ? "accepted" : "rejected";
      const moved = { ...frame, status: toAccepted ? "extracted" : "skipped_no_good_frame" };
      return {
        ...s,
        [from]: s[from].filter(function (f) { return f.frame_id !== frame.frame_id; }),
        [to]: [...s[to], moved],
      };
    });
  };

  const discardSession = function () {
    if (session) invokeTool(TOOL_ID, "discard", { session_id: session.sessionId }).catch(function () {});
    setSession(null);
    setTab("setup");
  };

  const commit = function () {
    if (!session || !accepted.length) { message.warning("没有可入库的帧"); return; }
    let target = { kind: "root" };
    if (targetKind === "group") {
      if (!groupId) { message.warning("请选择目标分组"); return; }
      target = { kind: "group", group_id: groupId };
    } else if (targetKind === "new_group") {
      if (!newName.trim()) { message.warning("请输入新分组名称"); return; }
      target = { kind: "new_group", name: newName.trim() };
    }
    setCommitting(true);
    invokeTool(TOOL_ID, "commit", {
      session_id: session.sessionId,
      accepted_ids: accepted.map(function (f) { return f.frame_id; }),
      tags: tags,
      target: target,
    })
      .then(function (res) {
        message.success("已入库 " + res.created + " 张图片" + (res.group_name ? "（" + res.group_name + "）" : ""));
        setSession(null);
        setTab("setup");
        if (context.onDone) context.onDone();
      })
      .catch(function (err) { message.error(err && err.message ? err.message : "入库失败"); })
      .finally(function () { setCommitting(false); });
  };

  const handleClose = function () {
    if (session) invokeTool(TOOL_ID, "discard", { session_id: session.sessionId }).catch(function () {});
    onClose();
  };

  const grid = function (frames, actionLabel, toAccepted, emptyText) {
    if (!frames.length) return h(Empty, { image: Empty.PRESENTED_IMAGE_SIMPLE, description: emptyText });
    return h(
      Flex,
      { wrap: "wrap", gap: 8 },
      frames.map(function (f) {
        return h(FrameCard, {
          key: f.frame_id,
          frame: f,
          actionLabel: actionLabel,
          onAction: function (fr) { move(fr, toAccepted); },
        });
      }),
    );
  };

  // -- 「操作」页 -----------------------------------------------------------
  const previewArea = probing
    ? h("div", { style: { height: 240, display: "flex", alignItems: "center", justifyContent: "center", background: "#000", borderRadius: 6 } }, h(Spin, { tip: "读取视频…" }))
    : probe
    ? h("video", {
        key: videoId,
        ref: videoRef,
        src: "/api/videos/" + encodeURIComponent(videoId) + "/stream",
        controls: true,
        preload: "metadata",
        style: { width: "100%", height: 320, objectFit: "contain", background: "#000", borderRadius: 6 },
        onTimeUpdate: function (e) { setPlayhead(e.target.currentTime); },
      })
    : h(
        "div",
        { style: { height: 240, display: "flex", alignItems: "center", justifyContent: "center", background: "#000", borderRadius: 6, color: "#888" } },
        "请选择视频后在此预览与框选",
      );

  const rangeCard = h(
    Card,
    { size: "small", title: "抽取区间" },
    h(
      Space,
      { direction: "vertical", style: { width: "100%" }, size: 8 },
      h(RangeTimeline, {
        duration: duration,
        range: range,
        interval: interval,
        playhead: playhead,
        disabled: !probe,
        onChange: function (r) { setRange(r); },
        onSeek: function (t) { setPlayhead(t); seek(t); },
      }),
      h(
        Flex,
        { justify: "space-between", align: "center" },
        h(Text, { type: "secondary", style: { fontSize: 12 } }, "起 " + fmt(range.start) + " · 止 " + fmt(range.end)),
        h(Text, { type: "secondary", style: { fontSize: 12 } }, "播放头 " + fmt(playhead)),
      ),
      h(
        Space,
        { size: 6 },
        h(Button, { size: "small", disabled: !probe, onClick: function () { setRange(function (r) { return { start: playhead, end: r.end }; }); } }, "设为起点"),
        h(Button, { size: "small", disabled: !probe, onClick: function () { setRange(function (r) { return { start: r.start, end: playhead }; }); } }, "设为终点"),
      ),
    ),
  );

  const paramsCard = h(
    Card,
    { size: "small", title: "抽帧参数" },
    h(
      Space,
      { direction: "vertical", style: { width: "100%" }, size: 10 },
      h(
        "div",
        null,
        h(Text, { type: "secondary" }, "抽帧间隔（秒）"),
        h(InputNumber, {
          min: 0.1,
          step: 0.1,
          style: { width: "100%", marginTop: 4 },
          value: interval,
          onChange: function (v) { setIntervalSec(v || 1); },
        }),
      ),
      h(
        "div",
        null,
        h(Text, { type: "secondary" }, "标签（统一附加到所有抽出图片）"),
        h(Select, {
          mode: "tags",
          style: { width: "100%", marginTop: 4 },
          placeholder: "输入后回车添加",
          value: tags,
          onChange: setTags,
        }),
      ),
      h(
        Button,
        { type: "primary", block: true, disabled: !probe, loading: extracting, icon: h(icons.ScissorOutlined), onClick: runExtract },
        "开始抽帧",
      ),
      probe
        ? h(Text, { type: "secondary", style: { fontSize: 12 } }, probe.width + "×" + probe.height + " · " + (probe.fps || 0).toFixed(1) + "fps · " + fmt(duration))
        : null,
    ),
  );

  const setupTab = h(
    Row,
    { gutter: 12 },
    h(
      Col,
      { span: 14 },
      h(
        Space,
        { direction: "vertical", style: { width: "100%" }, size: 10 },
        lockedVideoId
          ? h(
              "div",
              {
                style: {
                  padding: "6px 12px",
                  background: "#1b1e26",
                  borderRadius: 4,
                  color: "#c9d1d9",
                },
              },
              "当前视频：" + (probe ? probe.title : (probing ? "加载中…" : lockedVideoId)),
            )
          : h(Select, {
              showSearch: true,
              style: { width: "100%" },
              placeholder: "选择要抽帧的视频",
              loading: loadingVideos,
              optionFilterProp: "label",
              value: videoId || undefined,
              onChange: selectVideo,
              options: videos.map(function (v) { return { value: v.id, label: v.title }; }),
            }),
        previewArea,
        rangeCard,
      ),
    ),
    h(Col, { span: 10 }, paramsCard),
  );

  // -- 「候选」页 -----------------------------------------------------------
  const framesView = h(
    Space,
    { direction: "vertical", style: { width: "100%" }, size: 10 },
    h(Segmented, {
      block: true,
      value: reviewSeg,
      onChange: setReviewSeg,
      options: [
        { label: "粗筛通过 (" + accepted.length + ")", value: "accepted" },
        { label: "初筛拒绝 (" + rejected.length + ")", value: "rejected" },
      ],
    }),
    reviewSeg === "accepted"
      ? grid(accepted, "移到拒绝", false, session ? "暂无通过帧" : "尚未抽帧：请到「操作」页选择视频并开始抽帧")
      : grid(rejected, "移回通过", true, session ? "没有被拒绝的帧" : "尚未抽帧"),
  );

  const commitCard = h(
    Card,
    { size: "small", title: "入库设置" },
    h(
      Space,
      { direction: "vertical", style: { width: "100%" }, size: 10 },
      h(
        Radio.Group,
        { value: targetKind, onChange: function (e) { setTargetKind(e.target.value); } },
        h(
          Space,
          { direction: "vertical" },
          h(Radio, { value: "root" }, "图片库根目录"),
          h(Radio, { value: "group" }, "加入现有分组"),
          h(Radio, { value: "new_group" }, "新建分组后加入"),
        ),
      ),
      targetKind === "group"
        ? h(Select, {
            style: { width: "100%" },
            placeholder: "选择分组",
            value: groupId,
            onChange: setGroupId,
            options: groups.map(function (g) { return { value: g.id, label: g.name }; }),
          })
        : null,
      targetKind === "new_group"
        ? h(Input, { placeholder: "新分组名称", value: newName, onChange: function (e) { setNewName(e.target.value); } })
        : null,
      h(
        Button,
        { type: "primary", block: true, disabled: !session || !accepted.length, loading: committing, onClick: commit },
        "确认入库" + (accepted.length ? "（" + accepted.length + " 张）" : ""),
      ),
      h(Button, { block: true, danger: true, disabled: !session, onClick: discardSession }, "放弃本次抽帧"),
    ),
  );

  const candidateTab = h(
    Row,
    { gutter: 12 },
    h(Col, { span: 16 }, framesView),
    h(Col, { span: 8 }, commitCard),
  );

  const items = [
    { key: "setup", label: "操作", children: setupTab },
    { key: "candidate", label: "候选 (" + accepted.length + ")", children: candidateTab },
  ];

  return h(
    Modal,
    {
      title: "视频抽帧",
      open: open,
      onCancel: handleClose,
      footer: null,
      width: "100vw",
      destroyOnClose: true,
      maskClosable: false,
      keyboard: false,
      style: { top: 0, maxWidth: "100vw", margin: 0, paddingBottom: 0 },
      styles: {
        content: { height: "100vh", display: "flex", flexDirection: "column", borderRadius: 0 },
        body: { flex: 1, overflowY: "auto", overflowX: "hidden", paddingTop: 4 },
      },
    },
    h(Tabs, { activeKey: tab, onChange: setTab, items: items }),
  );
}

registerTool({
  id: TOOL_ID,
  name: "视频抽帧",
  description: "选择视频后按间隔抽帧并做邻近帧择优，粗筛复核后入库",
  icon: h(icons.ScissorOutlined),
  scopes: ["video"],
  selections: ["single"],
  source: "external",
  ui: "modal",
  launch: function (launchProps) {
    return h(FrameExtractionModal, launchProps);
  },
});
