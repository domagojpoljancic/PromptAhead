import type { DestinationId } from "../../shared/storage/schema";
import { copyTextToClipboard } from "./clipboard";
import { generateLLMDeepLink } from "./generate-deep-link";
import {
  APP_SCHEME_FALLBACK_MS,
  type OpenLLMResult,
  type ProviderId,
} from "./types";

export type TabHandle = {
  id?: number;
  url?: string;
  pendingUrl?: string;
};

export type OpenLLMDeps = {
  openTab: (url: string) => void | Promise<TabHandle | void>;
  updateTab?: (tabId: number, url: string) => void | Promise<void>;
  getTab?: (tabId: number) => Promise<TabHandle | null>;
  delay?: (ms: number) => Promise<void>;
  copy?: (text: string) => Promise<void>;
  fallbackMs?: number;
};

async function chromeOpenTab(url: string): Promise<TabHandle> {
  const tab = await chrome.tabs.create({ url, active: true });
  return { id: tab.id, url: tab.url, pendingUrl: tab.pendingUrl };
}

async function chromeUpdateTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
}

async function chromeGetTab(tabId: number): Promise<TabHandle | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return { id: tab.id, url: tab.url, pendingUrl: tab.pendingUrl };
  } catch {
    return null;
  }
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function looksLikeFailedProtocol(url: string | undefined): boolean {
  if (!url) {
    return true;
  }
  if (url.startsWith("chrome-error://") || url.startsWith("chrome://")) {
    return true;
  }
  // Still parked on a custom scheme → OS did not hand off cleanly.
  if (!/^https?:\/\//i.test(url) && !url.startsWith("file:")) {
    return true;
  }
  return false;
}

function resolveDeps(partial?: OpenLLMDeps): {
  openTab: (url: string) => Promise<TabHandle | void>;
  updateTab?: (tabId: number, url: string) => Promise<void>;
  getTab?: (tabId: number) => Promise<TabHandle | null>;
  delay: (ms: number) => Promise<void>;
  copy: (text: string) => Promise<void>;
  fallbackMs: number;
} {
  const hasChromeTabs =
    typeof chrome !== "undefined" && Boolean(chrome.tabs?.create);

  const openTab = async (url: string): Promise<TabHandle | void> => {
    if (partial?.openTab) {
      return partial.openTab(url);
    }
    if (hasChromeTabs) {
      return chromeOpenTab(url);
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return {
    openTab,
    updateTab: partial?.updateTab
      ? async (tabId, url) => {
          await partial.updateTab?.(tabId, url);
        }
      : hasChromeTabs
        ? chromeUpdateTab
        : undefined,
    getTab: partial?.getTab ?? (hasChromeTabs ? chromeGetTab : undefined),
    delay: partial?.delay ?? defaultDelay,
    copy: partial?.copy ?? copyTextToClipboard,
    fallbackMs: partial?.fallbackMs ?? APP_SCHEME_FALLBACK_MS,
  };
}

/**
 * Try the app scheme first; if the tab is still stuck on the protocol (or
 * chrome-error) after the fallback window, rewrite it to the web URL.
 */
async function openAppThenMaybeWeb(options: {
  appUrl: string;
  webUrl: string;
  usedModel: string | null;
  openTab: (url: string) => Promise<TabHandle | void>;
  updateTab: (tabId: number, url: string) => Promise<void>;
  getTab: (tabId: number) => Promise<TabHandle | null>;
  delay: (ms: number) => Promise<void>;
  fallbackMs: number;
}): Promise<OpenLLMResult> {
  const created = await options.openTab(options.appUrl);
  const tabId =
    created && typeof created === "object" ? created.id : undefined;

  if (tabId == null) {
    await options.openTab(options.webUrl);
    return {
      mode: "fallback-web",
      openedUrl: options.webUrl,
      copied: false,
      usedModel: options.usedModel,
    };
  }

  await options.delay(options.fallbackMs);
  const tab = await options.getTab(tabId);

  if (tab === null) {
    return {
      mode: "deeplink",
      openedUrl: options.appUrl,
      copied: false,
      usedModel: options.usedModel,
    };
  }

  const probe = tab.pendingUrl ?? tab.url;
  if (looksLikeFailedProtocol(probe)) {
    await options.updateTab(tabId, options.webUrl);
    return {
      mode: "fallback-web",
      openedUrl: options.webUrl,
      copied: false,
      usedModel: options.usedModel,
    };
  }

  return {
    mode: "deeplink",
    openedUrl: probe ?? options.appUrl,
    copied: false,
    usedModel: options.usedModel,
  };
}

/**
 * Copy-only or open a provider via web deep link (or clipboard + base URL).
 *
 * Chrome extensions open destinations in a browser tab. App/custom schemes
 * (`com.openai.chat://…`) briefly look like a broken redirect before fallback,
 * so we open the https deep link directly. App scheme templates remain in the
 * registry for docs/tests and future non-tab surfaces.
 *
 * Never auto-submits; Gemini / oversized prompts use clipboard + base URL.
 */
export async function openLLMWithFallback(options: {
  destination: DestinationId;
  prompt: string;
  model?: string | null;
  /** When true, try app scheme first (tests / future non-tab hosts). Default false. */
  preferAppScheme?: boolean;
  deps?: OpenLLMDeps;
}): Promise<OpenLLMResult> {
  const deps = resolveDeps(options.deps);

  if (options.destination === "copy") {
    await deps.copy(options.prompt);
    return {
      mode: "copy-only",
      openedUrl: null,
      copied: true,
      usedModel: null,
    };
  }

  const provider = options.destination as ProviderId;
  const link = generateLLMDeepLink({
    provider,
    prompt: options.prompt,
    model: options.model,
  });

  if (link.strategy === "clipboard") {
    await deps.copy(options.prompt);
    await deps.openTab(link.webUrl);
    return {
      mode: "clipboard",
      openedUrl: link.webUrl,
      copied: true,
      usedModel: link.usedModel,
    };
  }

  if (
    options.preferAppScheme &&
    link.appUrl &&
    deps.getTab &&
    deps.updateTab
  ) {
    return openAppThenMaybeWeb({
      appUrl: link.appUrl,
      webUrl: link.webUrl,
      usedModel: link.usedModel,
      openTab: deps.openTab,
      updateTab: deps.updateTab,
      getTab: deps.getTab,
      delay: deps.delay,
      fallbackMs: deps.fallbackMs,
    });
  }

  await deps.openTab(link.webUrl);
  return {
    mode: "deeplink",
    openedUrl: link.webUrl,
    copied: false,
    usedModel: link.usedModel,
  };
}
