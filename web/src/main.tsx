import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import { LabelsProvider } from "./api/labels";
import { appTheme } from "./theme";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider theme={appTheme} locale={zhCN}>
      <AntdApp>
        <LabelsProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </LabelsProvider>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
