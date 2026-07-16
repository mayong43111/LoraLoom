/**
 * 插件构建脚本。
 *
 * 步骤：
 * 1. 用 esbuild 把 src/index.jsx 打包成单文件 ESM（dist/index.js）。
 *    - 不打包 React/antd：它们来自宿主 window.DatasetToolkit。
 *    - JSX 通过 h() 工厂转换（文件顶部从 DatasetToolkit 取出 h）。
 * 2. 复制 manifest.json 与 handler.py 到 dist/，形成可直接投放的插件目录。
 *
 * 产物 dist/ 复制到主程序的 app/plugins/<id>/ 即自动注册。
 */
import { build } from "esbuild";
import { copyFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/index.jsx"],
  bundle: true,
  format: "esm",
  target: "es2020",
  jsxFactory: "h",
  jsxFragment: "Fragment",
  outfile: "dist/index.js",
  logLevel: "info",
});

await copyFile("manifest.json", "dist/manifest.json");
if (await exists("handler.py")) {
  await copyFile("handler.py", "dist/handler.py");
}

console.log("✔ 构建完成：dist/（可复制到 app/plugins/<id>/）");
