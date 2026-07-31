import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "PromptAhead Spikes (M0)",
  version: "0.0.1",
  description: "Technical validation spikes for PromptAhead — not for production use.",
  permissions: [
    "sidePanel",
    "activeTab",
    "scripting",
    "storage",
    "contextMenus",
    "notifications",
  ],
  optional_host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  action: {
    default_title: "Open PromptAhead Spikes",
    default_icon: {
      "16": "public/icons/icon-16.png",
      "48": "public/icons/icon-48.png",
      "128": "public/icons/icon-128.png",
    },
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  // Third activeTab-granting gesture for S0.5, alongside action click and
  // context menu. Chrome grants activeTab for command invocations too.
  commands: {
    "extract-on-gesture": {
      suggested_key: { default: "Alt+Shift+E" },
      description: "S0.5: extract the current page on a keyboard gesture",
    },
  },
  options_ui: {
    page: "src/options/index.html",
    open_in_tab: true,
  },
  icons: {
    "16": "public/icons/icon-16.png",
    "48": "public/icons/icon-48.png",
    "128": "public/icons/icon-128.png",
  },
});
