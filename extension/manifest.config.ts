import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "PromptAhead",
  version: "0.1.0",
  description:
    "Privacy-first prompt helper — Manual mode shell (Milestone 1 scaffold).",
  permissions: ["sidePanel", "activeTab", "scripting", "storage", "contextMenus"],
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  action: {
    default_title: "PromptAhead",
    default_icon: {
      "16": "public/icons/icon-16.png",
      "48": "public/icons/icon-48.png",
      "128": "public/icons/icon-128.png",
    },
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  commands: {
    "open-panel": {
      suggested_key: { default: "Alt+Shift+P" },
      description: "Open PromptAhead side panel",
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
