/**
 * Minimal in-memory stand-in for the Chrome APIs PromptAhead uses.
 * Covers `storage.local`, `runtime` message dispatch, `tabs.query`,
 * `sidePanel.open`, `scripting.executeScript`, and `action` badge APIs.
 */

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

export type InjectionDetails = {
  target: { tabId: number };
  args?: unknown[];
};

export type ChromeMockOptions = {
  initialStorage?: Record<string, unknown>;
  activeTab?: { id?: number; url?: string } | null;
  openSidePanel?: (options: { tabId: number }) => Promise<void>;
  /** Omit to emulate a tab PromptAhead has no `activeTab` grant for. */
  executeScript?: (details: InjectionDetails) => unknown;
  /** Optional sender tab id attached to runtime.sendMessage. */
  senderTabId?: number;
};

export type BadgeCall = {
  kind: "text" | "background" | "title";
  value: string;
};

export type ChromeMock = {
  storage: Record<string, unknown>;
  listeners: MessageListener[];
  sidePanelOpens: number[];
  injections: number[];
  badgeCalls: BadgeCall[];
  badgeText: string;
  badgeBackground: string;
  actionTitle: string;
  api: typeof chrome;
};

function cloneKeys(
  keys: string | string[] | null | undefined,
  store: Map<string, unknown>,
) {
  const wanted =
    keys === null || keys === undefined
      ? [...store.keys()]
      : Array.isArray(keys)
        ? keys
        : [keys];

  const result: Record<string, unknown> = {};
  for (const key of wanted) {
    if (store.has(key)) {
      result[key] = structuredClone(store.get(key));
    }
  }
  return result;
}

export function createChromeMock(options: ChromeMockOptions = {}): ChromeMock {
  const store = new Map<string, unknown>(
    Object.entries(structuredClone(options.initialStorage ?? {})),
  );
  const listeners: MessageListener[] = [];
  const sidePanelOpens: number[] = [];
  const injections: number[] = [];
  const badgeCalls: BadgeCall[] = [];
  let badgeText = "";
  let badgeBackground = "";
  let actionTitle = "PromptAhead";

  const local = {
    get: async (keys?: string | string[] | null) => cloneKeys(keys, store),
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, structuredClone(value));
      }
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        store.delete(key);
      }
    },
    clear: async () => {
      store.clear();
    },
  };

  function sendMessage(message: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const sendResponse = (response?: unknown) => {
        if (!settled) {
          settled = true;
          resolve(response);
        }
      };

      const sender =
        options.senderTabId !== undefined
          ? { tab: { id: options.senderTabId } }
          : {};
      const keepOpen = listeners.map((listener) =>
        listener(message, sender, sendResponse),
      );
      if (!settled && !keepOpen.some(Boolean)) {
        reject(
          new Error("Could not establish connection. Receiving end does not exist."),
        );
      }
    });
  }

  const api = {
    runtime: {
      id: "promptahead-test",
      sendMessage,
      openOptionsPage: async () => undefined,
      onMessage: {
        addListener: (listener: MessageListener) => {
          listeners.push(listener);
        },
        removeListener: (listener: MessageListener) => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        },
      },
    },
    storage: { local },
    tabs: {
      query: async () =>
        options.activeTab === null ? [] : [options.activeTab ?? { id: 1 }],
    },
    sidePanel: {
      open: async ({ tabId }: { tabId: number }) => {
        sidePanelOpens.push(tabId);
        await options.openSidePanel?.({ tabId });
      },
    },
    scripting: {
      executeScript: async (details: InjectionDetails) => {
        injections.push(details.target.tabId);
        if (!options.executeScript) {
          // Chrome's wording when neither activeTab nor a host permission applies.
          throw new Error(
            "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
          );
        }
        return [{ frameId: 0, result: options.executeScript(details) }];
      },
    },
    action: {
      setBadgeText: async ({ text }: { text: string }) => {
        badgeText = text;
        badgeCalls.push({ kind: "text", value: text });
      },
      setBadgeBackgroundColor: async ({ color }: { color: string }) => {
        badgeBackground = color;
        badgeCalls.push({ kind: "background", value: color });
      },
      setTitle: async ({ title }: { title: string }) => {
        actionTitle = title;
        badgeCalls.push({ kind: "title", value: title });
      },
      getBadgeText: async () => badgeText,
    },
  } as unknown as typeof chrome;

  return {
    get storage() {
      return Object.fromEntries(store.entries());
    },
    listeners,
    sidePanelOpens,
    injections,
    badgeCalls,
    get badgeText() {
      return badgeText;
    },
    get badgeBackground() {
      return badgeBackground;
    },
    get actionTitle() {
      return actionTitle;
    },
    api,
  };
}

export function installChromeMock(options: ChromeMockOptions = {}): ChromeMock {
  const mock = createChromeMock(options);
  (globalThis as { chrome?: typeof chrome }).chrome = mock.api;
  return mock;
}

export function uninstallChromeMock(): void {
  delete (globalThis as { chrome?: typeof chrome }).chrome;
}
