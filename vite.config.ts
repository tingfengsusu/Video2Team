import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

// publicDir 指向 data/：operators.json 与 aliases.json 作为插件静态资源随包分发，
// 运行时经 chrome.runtime.getURL("data/operators.json") 访问
export default defineConfig({
  plugins: [crx({ manifest })],
  publicDir: "data",
});
