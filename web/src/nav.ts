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
  { key: "videos", path: "/videos", title: "视频库", subtitle: "视频管理与抽帧", mvp: true },
  { key: "images", path: "/images", title: "图片库", subtitle: "浏览与筛选", mvp: true },
  { key: "export", path: "/export", title: "数据集", subtitle: "训练集导出", mvp: true },
  { key: "settings", path: "/settings", title: "设置", subtitle: "参数配置", mvp: true },
] as const;
