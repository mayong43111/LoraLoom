import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

/** 全局暗色主题配置。集中管理设计令牌，避免样式散落各页面。 */
export const appTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: "#4c8bf5",
    colorBgLayout: "#14161c",
    colorBgContainer: "#1c1f27",
    colorBorderSecondary: "#2a2e39",
    borderRadius: 8,
    fontSize: 14,
  },
  components: {
    Layout: {
      siderBg: "#1a1d24",
      headerBg: "#1a1d24",
      bodyBg: "#14161c",
    },
    Menu: {
      itemBg: "transparent",
      darkItemBg: "transparent",
    },
    Card: {
      colorBgContainer: "#1c1f27",
    },
  },
};
