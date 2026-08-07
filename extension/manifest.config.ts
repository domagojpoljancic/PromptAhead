import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "PromptAhead",
  version: "0.1.0",
  description:
    "Privacy-first prompt helper — Manual by default; optional Smart host access.",
  permissions: ["sidePanel", "activeTab", "scripting", "storage", "contextMenus"],
  // Runtime grant/revoke only (S0.6). Never listed under host_permissions.
  optional_host_permissions: ["<all_urls>"],
  // Dummy match so CRXJS packages engagement-boot; real http(s) injection is
  // registered at runtime after Smart host grant (see engagement-scripts.ts).
  content_scripts: [
    {
      matches: ["https://promptahead.invalid/*"],
      js: ["src/content/engagement-boot.ts"],
      run_at: "document_idle",
    },
  ],
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
