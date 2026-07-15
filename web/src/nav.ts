/**
 * 侧边导航配置。
 *
 * 每个条目对应一个页面路由。`mvp: false` 的条目属于后续阶段，
 * 在 UI 中以占位页展示并标注阶段，但保留入口以呈现完整信息架构。
 */

export interface NavItem {
  key: string;
  path: string;
  title: string;
  subtitle: string;
  mvp: boolean;
  phase?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", path: "/", title: "概览", subtitle: "数据集整体状态", mvp: true },
  { key: "import", path: "/import", title: "导入", subtitle: "批次与来源", mvp: true },
  {
    key: "browser",
    path: "/browser",
    title: "内置浏览器",
    subtitle: "网页采集",
    mvp: false,
    phase: "第二阶段",
  },
  { key: "downloads", path: "/downloads", title: "下载", subtitle: "任务队列", mvp: true },
  { key: "images", path: "/images", title: "图片库", subtitle: "浏览与筛选", mvp: true },
  { key: "frames", path: "/frames", title: "视频抽帧", subtitle: "抽帧与结果", mvp: true },
  { key: "quality", path: "/quality", title: "质量", subtitle: "质检与问题", mvp: true },
  { key: "people", path: "/people", title: "人物", subtitle: "聚类管理", mvp: true },
  { key: "review", path: "/review", title: "复核", subtitle: "人工标注", mvp: true },
  { key: "selection", path: "/selection", title: "组包", subtitle: "配额选片", mvp: true },
  { key: "export", path: "/export", title: "导出", subtitle: "训练集导出", mvp: true },
  { key: "settings", path: "/settings", title: "设置", subtitle: "参数配置", mvp: true },
] as const;
