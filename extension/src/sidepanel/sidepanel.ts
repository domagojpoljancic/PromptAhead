import {
  isBackgroundEvent,
  sendToBackground as defaultSendToBackground,
} from "../shared/messaging";
import type { PageContext } from "../shared/types/page-context";
import {
  DESTINATION_IDS,
  DESTINATION_LABELS,
  type DestinationId,
  type NanoPreference,
} from "../shared/storage/schema";
import {
  destinationLabel,
  openLLMWithFallback as defaultOpenLLMWithFallback,
  type OpenLLMResult,
} from "../domain/destinations";
import {
  NANO_THINKING_COPY,
  copyForNanoPanelNotice,
  didNanoFallBackToCurated,
  nanoPanelNoticeForPreference,
  nanoPanelNoticeFromFailureReason,
  probeNanoReadiness,
  selectSuggestionEngineForPreference as defaultSelectSuggestionEngineForPreference,
  type NanoPanelNotice,
  type SuggestedAction,
  type SuggestionEngine,
  type SuggestionEngineId,
  type SuggestionResult,
} from "../domain/suggestions";
import {
  applyContextInclusion,
  applyUserNoteInclusion,
  DEFAULT_CONTEXT_INCLUSION,
  EMPTY_SOURCE_INCLUSION_MESSAGE,
  hasUsableSourceInclusion,
  inclusionAvailability,
  type ContextInclusion,
} from "./context-inclusion";
import {
  isOnboardingBlocking,
  maybeStartOnboarding as defaultMaybeStartOnboarding,
  refreshOnboardingAfterClear as defaultRefreshOnboardingAfterClear,
} from "./onboarding";
import {
  hideSensitiveOverride,
  isSensitiveOverrideVisible,
  showSensitiveOverride,
} from "./sensitive-override";
import {
  assessPagePromptValue,
  lowValueMessageFor,
  toSelectionOnlyContext,
} from "../domain/page-value";
import type { SensitiveCategory } from "../domain/sensitive";
import {
  NAVIGATED_FROM_EMPTY_MESSAGE,
  STALE_CONTEXT_MESSAGE,
  type PanelStep,
  type WorkflowCardStep,
} from "./workflow";

/** Must match `SENSITIVE_PAGE_BLOCKED_ERROR` in background/sensitive-gate.ts */
const SENSITIVE_PAGE_BLOCKED_ERROR =
  "This page looks sensitive. Confirm in the side panel to analyze it anyway.";

const PAGE_TYPE_LABELS: Record<PageContext["pageType"], string> = {
  article: "Article",
  product: "Product",
  generic: "Page",
};

/** Compact wall-clock for the side-panel debug strip. */
function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "?ms";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

type FallbackKind = "extraction" | "suggestions" | "prompt" | "handoff";

export type SidePanelDeps = {
  sendToBackground: typeof defaultSendToBackground;
  selectSuggestionEngine: (
    preference: NanoPreference,
  ) => Promise<SuggestionEngine>;
  openLLMWithFallback: (options: {
    prompt: string;
    destination: DestinationId;
  }) => Promise<OpenLLMResult>;
  openOptionsPage: () => void | Promise<void>;
  addMessageListener: (listener: (message: unknown) => void) => () => void;
  maybeStartOnboarding: typeof defaultMaybeStartOnboarding;
  refreshOnboardingAfterClear: typeof defaultRefreshOnboardingAfterClear;
  /** Injected so tests can simulate missing / downloadable Nano without Chrome AI. */
  probeNanoReadiness: typeof probeNanoReadiness;
};

export type SidePanelController = {
  dispose: () => void;
};

function defaultOpenOptionsPage(): void {
  void chrome.runtime.openOptionsPage();
}

function defaultAddMessageListener(
  listener: (message: unknown) => void,
): () => void {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) {
    return () => undefined;
  }
  const wrapped = (message: unknown) => {
    listener(message);
  };
  chrome.runtime.onMessage.addListener(wrapped);
  return () => {
    chrome.runtime.onMessage.removeListener(wrapped);
  };
}

/**
 * Wire the side panel. Call once after the DOM is present.
 * Production entry boots via the guard at the bottom of this module.
 */
export async function initSidePanel(
  deps: Partial<SidePanelDeps> = {},
): Promise<SidePanelController> {
  const send = deps.sendToBackground ?? defaultSendToBackground;
  const selectEngine =
    deps.selectSuggestionEngine ?? defaultSelectSuggestionEngineForPreference;
  const openLLM = deps.openLLMWithFallback ?? defaultOpenLLMWithFallback;
  const openOptions = deps.openOptionsPage ?? defaultOpenOptionsPage;
  const maybeOnboarding =
    deps.maybeStartOnboarding ?? defaultMaybeStartOnboarding;
  const refreshOnboarding =
    deps.refreshOnboardingAfterClear ?? defaultRefreshOnboardingAfterClear;
  const addMessageListener =
    deps.addMessageListener ?? defaultAddMessageListener;
  const probeReadiness = deps.probeNanoReadiness ?? probeNanoReadiness;

  const statusLine = document.getElementById("status");
  const debugLine = document.getElementById("debug-line");
  const contextSummary = document.getElementById("context-summary");
  const contextType = document.getElementById("context-type");
  const contextTitle = document.getElementById("context-title");
  const contextUrl = document.getElementById("context-url");
  const contextSelection = document.getElementById("context-selection");
  const contextSelected = document.getElementById("context-selected");
  const refreshButton = document.getElementById("refresh-context");
  const understandingMessage = document.getElementById("understanding-message");

  const stepElements: Record<
    WorkflowCardStep | "empty" | "stale",
    HTMLElement | null
  > = {
    understanding: document.getElementById("understanding"),
    choose: document.getElementById("choose"),
    refine: document.getElementById("refine"),
    review: document.getElementById("review"),
    prompt: document.getElementById("prompt"),
    success: document.getElementById("success"),
    fallback: document.getElementById("fallback"),
    empty: document.getElementById("empty"),
    stale: document.getElementById("stale"),
  };

  const primaryActions = document.getElementById("primary-actions");
  const moreActions = document.getElementById("more-actions");
  const showMoreButton = document.getElementById("show-more");
  const selectedActionLabel = document.getElementById("selected-action");
  const userNoteInput = document.getElementById("user-note");
  const promptTextArea = document.getElementById("prompt-text");
  const promptMeta = document.getElementById("prompt-meta");
  const destinationActions = document.getElementById("destination-actions");
  const successMessage = document.getElementById("success-message");
  const fallbackHeading = document.getElementById("fallback-heading");
  const fallbackMessage = document.getElementById("fallback-message");
  const fallbackRetry = document.getElementById("fallback-retry");
  const fallbackChoose = document.getElementById("fallback-choose");
  const emptyMessage = document.getElementById("empty-message");
  const staleMessage = document.getElementById("stale-message");
  const nanoFallback = document.getElementById("nano-fallback");
  const nanoFallbackCopy = document.getElementById("nano-fallback-copy");
  const nanoRetryButton = document.getElementById("nano-retry");
  const nanoOpenSettingsButton = document.getElementById("nano-open-settings");
  const contextPreviewBody = document.getElementById("context-preview-body");
  const includeTitleUrl = document.getElementById("include-title-url");
  const includePageBody = document.getElementById("include-page-body");
  const includeSelectedText = document.getElementById("include-selected-text");
  const includeSelectedWrap = document.getElementById("include-selected-wrap");
  const includeUserNote = document.getElementById("include-user-note");
  const buildPromptButton = document.getElementById("build-prompt");

  let pageContext: PageContext | null = null;
  let boundTabId: number | null = null;
  let suggestions: SuggestionResult | null = null;
  let selectedAction: SuggestedAction | null = null;
  let builtPrompt = "";
  let defaultDestination: DestinationId = "copy";
  let nanoPreference: NanoPreference = "skipped";
  let inclusion: ContextInclusion = { ...DEFAULT_CONTEXT_INCLUSION };
  let currentStep: PanelStep = "understanding";
  let lastFallback: FallbackKind | null = null;
  /** Dedupes GET_LATEST vs PAGE_CONTEXT_UPDATED for the same capture. */
  let lastAcceptedKey: string | null = null;
  let acceptingKey: string | null = null;
  let lastSelectedEngineId: SuggestionEngineId | null = null;
  /** Bumps when onboarding completes or a new accept starts — stale loads bail out. */
  let suggestionGeneration = 0;
  let nanoPanelNotice: NanoPanelNotice = "none";
  /** Tab waiting on Manual sensitive confirm (DOM-39) — confirm is never sticky. */
  let pendingSensitiveTabId: number | null = null;

  function resetWorkflowAfterOnboarding(): void {
    suggestionGeneration += 1;
    acceptingKey = null;
    lastAcceptedKey = null;
    pageContext = null;
    boundTabId = null;
    pendingSensitiveTabId = null;
    hideSensitiveOverride();
    suggestions = null;
    selectedAction = null;
    builtPrompt = "";
    lastSelectedEngineId = null;
    clearWorkflowData();
    setNanoFallbackVisible(false);
    showStep("empty");
    setText(emptyMessage, "Reading this page…");
    setText(statusLine, "Reading this page…");
  }

  function setText(element: HTMLElement | null, text: string): void {
    if (element) {
      element.textContent = text;
    }
  }

  function setHidden(element: HTMLElement | null, hidden: boolean): void {
    if (!element) {
      return;
    }
    if (hidden) {
      element.setAttribute("hidden", "");
    } else {
      element.removeAttribute("hidden");
    }
  }

  function showStep(next: PanelStep): void {
    currentStep = next;
    for (const [id, element] of Object.entries(stepElements)) {
      setHidden(element, id !== next);
    }
  }

  function readInclusionFromDom(): ContextInclusion {
    return {
      titleUrl:
        includeTitleUrl instanceof HTMLInputElement
          ? includeTitleUrl.checked
          : true,
      pageBody:
        includePageBody instanceof HTMLInputElement
          ? includePageBody.checked
          : true,
      selectedText:
        includeSelectedText instanceof HTMLInputElement
          ? includeSelectedText.checked
          : true,
      userNote:
        includeUserNote instanceof HTMLInputElement
          ? includeUserNote.checked
          : true,
    };
  }

  function syncInclusionControls(ctx: PageContext): void {
    const availability = inclusionAvailability(ctx);
    if (includeTitleUrl instanceof HTMLInputElement) {
      includeTitleUrl.checked = inclusion.titleUrl;
      includeTitleUrl.disabled = !availability.titleUrl;
    }
    if (includePageBody instanceof HTMLInputElement) {
      includePageBody.checked = inclusion.pageBody;
      includePageBody.disabled = !availability.pageBody;
    }
    if (includeSelectedText instanceof HTMLInputElement) {
      includeSelectedText.checked = inclusion.selectedText;
    }
    setHidden(includeSelectedWrap, !availability.selectedText);
    if (includeUserNote instanceof HTMLInputElement) {
      includeUserNote.checked = inclusion.userNote;
    }
  }

  function previewRows(ctx: PageContext, note: string): [string, string][] {
    const rows: [string, string][] = [
      ["Title", ctx.title],
      ["URL", ctx.url],
    ];
    if (ctx.description) {
      rows.push(["Description", ctx.description]);
    }
    if (ctx.selectedText) {
      rows.push(["Selected text", ctx.selectedText]);
    }
    const section = ctx.article ?? ctx.product ?? ctx.generic;
    if (section && "headings" in section && section.headings.length > 0) {
      rows.push(["Headings", section.headings.join(" · ")]);
    }
    if (section && "excerpts" in section && section.excerpts.length > 0) {
      rows.push(["Excerpts", section.excerpts.slice(0, 2).join("\n\n")]);
    }
    if (ctx.product?.specifications.length) {
      rows.push([
        "Specs",
        ctx.product.specifications
          .slice(0, 4)
          .map((spec) => `${spec.name}: ${spec.value}`)
          .join(" · "),
      ]);
    }
    if (note.trim()) {
      rows.push(["Your note", note.trim()]);
    }
    return rows.filter(([, value]) => value.trim().length > 0);
  }

  function updateBuildPromptEnabled(): void {
    if (!(buildPromptButton instanceof HTMLButtonElement) || !pageContext) {
      return;
    }
    inclusion = readInclusionFromDom();
    const usable = hasUsableSourceInclusion(
      inclusion,
      inclusionAvailability(pageContext),
    );
    buildPromptButton.disabled = !usable;
  }

  function renderContextPreview(): void {
    if (!contextPreviewBody || !pageContext) {
      return;
    }
    inclusion = readInclusionFromDom();
    const filtered = applyContextInclusion(pageContext, inclusion);
    const note =
      userNoteInput instanceof HTMLTextAreaElement ? userNoteInput.value : "";
    const noteForPreview = applyUserNoteInclusion(note, inclusion);
    const rows = previewRows(filtered, noteForPreview);
    const usable = hasUsableSourceInclusion(
      inclusion,
      inclusionAvailability(pageContext),
    );

    contextPreviewBody.replaceChildren();
    if (!usable || rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "context-preview__item-value";
      empty.textContent = usable
        ? "Nothing left to preview — expand toggles above."
        : EMPTY_SOURCE_INCLUSION_MESSAGE;
      contextPreviewBody.append(empty);
      updateBuildPromptEnabled();
      return;
    }
    for (const [label, value] of rows) {
      const item = document.createElement("div");
      const heading = document.createElement("p");
      heading.className = "context-preview__item-label";
      heading.textContent = label;
      const body = document.createElement("p");
      body.className = "context-preview__item-value";
      body.textContent = value;
      item.append(heading, body);
      contextPreviewBody.append(item);
    }
    updateBuildPromptEnabled();
  }

  function renderActionButton(action: SuggestedAction): HTMLLIElement {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-card";
    button.dataset.actionId = action.id;

    const title = document.createElement("span");
    title.className = "action-card__title";
    title.textContent = action.title;

    const description = document.createElement("span");
    description.className = "action-card__description";
    description.textContent = action.description;

    button.append(title, description);
    button.addEventListener("click", () => {
      void selectAction(action);
    });
    item.append(button);
    return item;
  }

  function setNanoPanelNotice(notice: NanoPanelNotice): void {
    nanoPanelNotice = notice;
    const visible = notice !== "none";
    setHidden(nanoFallback, !visible);
    if (!visible) {
      return;
    }
    setText(nanoFallbackCopy, copyForNanoPanelNotice(notice));
    const needsDownload = notice === "needs-download";
    setHidden(nanoOpenSettingsButton, !needsDownload);
    if (nanoRetryButton instanceof HTMLButtonElement) {
      // Download path: Settings owns the user-activated create()/progress UI.
      setHidden(nanoRetryButton, needsDownload);
    }
  }

  function setNanoFallbackVisible(visible: boolean): void {
    setNanoPanelNotice(visible ? "fallback" : "none");
  }

  function renderSuggestions(
    result: SuggestionResult,
    options: { nanoNotice?: NanoPanelNotice } = {},
  ): void {
    suggestions = result;
    primaryActions?.replaceChildren(...result.primary.map(renderActionButton));
    moreActions?.replaceChildren(...result.more.map(renderActionButton));
    setHidden(moreActions, true);
    if (showMoreButton instanceof HTMLButtonElement) {
      showMoreButton.hidden = result.more.length === 0;
      showMoreButton.textContent = "More…";
    }
    setNanoPanelNotice(options.nanoNotice ?? "none");
  }

  async function resolveNanoPreference(): Promise<NanoPreference> {
    const response = await send({ type: "GET_SETTINGS" });
    if (response.ok) {
      nanoPreference = response.settings.nanoPreference;
      defaultDestination = response.settings.defaultDestination;
    }
    return nanoPreference;
  }

  function clearWorkflowData(): void {
    pageContext = null;
    suggestions = null;
    selectedAction = null;
    builtPrompt = "";
    inclusion = { ...DEFAULT_CONTEXT_INCLUSION };
    lastAcceptedKey = null;
    lastSelectedEngineId = null;
    setNanoFallbackVisible(false);
    if (userNoteInput instanceof HTMLTextAreaElement) {
      userNoteInput.value = "";
    }
    if (promptTextArea instanceof HTMLTextAreaElement) {
      promptTextArea.value = "";
    }
    contextSummary?.setAttribute("hidden", "");
    contextSelection?.setAttribute("hidden", "");
    setText(contextSelected, "");
  }

  function contextKey(ctx: PageContext, tabId?: number): string {
    return `${tabId ?? "?"}|${ctx.url}|${ctx.title}|${ctx.pageType}`;
  }

  function renderEmpty(message: string): void {
    stopSelectionWatchIfBound();
    clearWorkflowData();
    boundTabId = null;
    showStep("empty");
    setText(emptyMessage, message);
    setText(statusLine, message);
  }

  /**
   * Low-value page with no selection — keep the tab bound so Refresh (or
   * selection auto-watch) can pick up a later selection without another
   * toolbar click.
   */
  function renderLowValue(message: string, tabId?: number): void {
    clearWorkflowData();
    if (typeof tabId === "number") {
      boundTabId = tabId;
      void send({ type: "WATCH_SELECTION", tabId });
    }
    showStep("empty");
    setText(emptyMessage, message);
    setText(statusLine, message);
  }

  function stopSelectionWatchIfBound(): void {
    if (boundTabId === null) {
      return;
    }
    void send({ type: "STOP_WATCH_SELECTION", tabId: boundTabId });
  }

  function renderStale(message: string = STALE_CONTEXT_MESSAGE): void {
    clearWorkflowData();
    showStep("stale");
    setText(staleMessage, message);
    // Keep the status strip empty so the revoke copy isn't duplicated.
    setText(statusLine, "");
  }

  function renderFallback(
    kind: FallbackKind,
    message: string,
    options: { canChoose?: boolean } = {},
  ): void {
    lastFallback = kind;
    showStep("fallback");
    setText(
      fallbackHeading,
      kind === "handoff" ? "Couldn’t hand off" : "Something went wrong",
    );
    setText(fallbackMessage, message);
    setText(statusLine, "");
    setHidden(fallbackChoose, !options.canChoose);
  }

  function presentSensitiveBlock(detail: {
    tabId: number;
    category: SensitiveCategory;
    url?: string;
  }): void {
    if (isOnboardingBlocking()) {
      return;
    }
    pendingSensitiveTabId = detail.tabId;
    boundTabId = detail.tabId;
    pageContext = null;
    showSensitiveOverride({
      tabId: detail.tabId,
      category: detail.category,
      url: detail.url,
    });
    setText(statusLine, "");
  }

  async function confirmSensitiveOverride(): Promise<void> {
    const tabId = pendingSensitiveTabId ?? boundTabId;
    hideSensitiveOverride();
    pendingSensitiveTabId = null;
    if (tabId === null) {
      renderEmpty("Click the PromptAhead icon on the page you want to use.");
      return;
    }
    showStep("understanding");
    setText(statusLine, "Reading this page…");
    const response = await send({
      type: "EXTRACT_ACTIVE_TAB",
      tabId,
      force: true,
    });
    if (response.ok) {
      await acceptPageContext(response.pageContext, response.tabId);
    } else if (isExpectedReinvokeError(response.error)) {
      renderStale(response.error);
    } else {
      renderFallback("extraction", response.error, { canChoose: false });
    }
  }

  function cancelSensitiveOverride(): void {
    hideSensitiveOverride();
    pendingSensitiveTabId = null;
    renderEmpty(
      "This page was not analyzed. Click the PromptAhead icon on a page you want to use.",
    );
  }

  function isExpectedReinvokeError(message: string): boolean {
    return (
      /no longer has access to this tab/i.test(message) ||
      /can't read this page/i.test(message)
    );
  }

  function isSensitiveBlockedError(message: string): boolean {
    return (
      message === SENSITIVE_PAGE_BLOCKED_ERROR ||
      /looks sensitive/i.test(message)
    );
  }

  async function loadSuggestions(
    ctx: PageContext,
    options: { forceNanoRetry?: boolean } = {},
  ): Promise<void> {
    const generation = suggestionGeneration;
    const preference = await resolveNanoPreference();
    if (generation !== suggestionGeneration) {
      return;
    }
    const preferNano = options.forceNanoRetry || preference === "enabled";

    // Prefer a live readiness probe when the user wants Nano — Chrome can still
    // report "available" after uninstall while create()/prompt fail (DOM-31).
    let preflightNotice: NanoPanelNotice = "none";
    if (preferNano) {
      try {
        const readiness = await probeReadiness();
        if (generation !== suggestionGeneration) {
          return;
        }
        preflightNotice = nanoPanelNoticeForPreference({
          preference: "enabled",
          readiness,
        });
      } catch {
        preflightNotice = "unsupported";
      }
    }

    const willTryNano = preferNano && preflightNotice === "none";
    setText(
      understandingMessage,
      willTryNano
        ? "Asking on-device AI for page-specific directions…"
        : "Capturing compact context and ranking directions…",
    );
    setText(
      statusLine,
      willTryNano ? NANO_THINKING_COPY : "Building suggestions…",
    );
    try {
      if (preferNano && preflightNotice !== "none") {
        const curated = await selectEngine("basic");
        if (generation !== suggestionGeneration) {
          return;
        }
        lastSelectedEngineId = "nano";
        const result = await curated.suggestActions({ pageContext: ctx });
        if (generation !== suggestionGeneration) {
          return;
        }
        renderSuggestions(result, { nanoNotice: preflightNotice });
        showStep("choose");
        setText(statusLine, copyForNanoPanelNotice(preflightNotice));
        setText(
          debugLine,
          `nano blocked · ${preflightNotice}`,
        );
        return;
      }

      const engine = await selectEngine(
        options.forceNanoRetry ? "enabled" : preference,
      );
      if (generation !== suggestionGeneration) {
        return;
      }
      lastSelectedEngineId = engine.id;
      const result = await engine.suggestActions({ pageContext: ctx });
      if (generation !== suggestionGeneration) {
        return;
      }
      let notice: NanoPanelNotice = "none";
      const fellBack = didNanoFallBackToCurated({
        selectedEngineId: engine.id,
        resultEngineId: result.engineId,
      });
      if (fellBack) {
        // Re-classify after a silent Nano failure — uninstall often surfaces here.
        try {
          const readiness = await probeReadiness();
          notice = nanoPanelNoticeForPreference({
            preference: "enabled",
            readiness,
          });
        } catch {
          notice = "fallback";
        }
        if (notice === "none") {
          notice = nanoPanelNoticeFromFailureReason(
            result.debug?.nanoFailureReason,
          );
        }
      }
      renderSuggestions(result, { nanoNotice: notice });
      showStep("choose");
      if (notice !== "none") {
        setText(statusLine, copyForNanoPanelNotice(notice));
        const parts = [
          result.debug?.elapsedMs !== undefined
            ? `nano ${formatElapsed(result.debug.elapsedMs)}`
            : null,
          result.debug?.nanoFailureReason
            ? `failure: ${result.debug.nanoFailureReason}`
            : `notice: ${notice}`,
        ].filter(Boolean);
        if (parts.length > 0) {
          setText(debugLine, parts.join(" · "));
        }
      } else {
        setText(
          statusLine,
          `Page context captured (${result.engineId}) — nothing leaves this device.`,
        );
        if (
          result.engineId === "nano" &&
          result.debug?.elapsedMs !== undefined
        ) {
          setText(
            debugLine,
            `nano ok · ${formatElapsed(result.debug.elapsedMs)}`,
          );
        }
      }
    } catch (error) {
      if (generation !== suggestionGeneration) {
        return;
      }
      const message =
        error instanceof Error ? error.message : "Could not build suggestions";
      if (preferNano) {
        try {
          const curated = await selectEngine("basic");
          if (generation !== suggestionGeneration) {
            return;
          }
          const result = await curated.suggestActions({ pageContext: ctx });
          if (generation !== suggestionGeneration) {
            return;
          }
          lastSelectedEngineId = "nano";
          let notice: NanoPanelNotice = "fallback";
          try {
            const readiness = await probeReadiness();
            const mapped = nanoPanelNoticeForPreference({
              preference: "enabled",
              readiness,
            });
            if (mapped !== "none") {
              notice = mapped;
            }
          } catch {
            // keep fallback
          }
          renderSuggestions(result, { nanoNotice: notice });
          showStep("choose");
          setText(statusLine, copyForNanoPanelNotice(notice));
          return;
        } catch {
          // fall through to hard fallback
        }
      }
      renderFallback("suggestions", `${message}. You can retry.`, {
        canChoose: false,
      });
    }
  }

  function renderPageIdentity(ctx: PageContext): void {
    const selection = ctx.selectedText?.trim() ?? "";
    const selectionOnly =
      Boolean(selection) &&
      !ctx.article &&
      !ctx.product &&
      !ctx.generic &&
      !ctx.description;
    setText(
      contextType,
      selectionOnly ? "Selected text" : PAGE_TYPE_LABELS[ctx.pageType],
    );
    setText(contextTitle, ctx.title);
    setText(contextUrl, ctx.url);
    if (selection) {
      const preview =
        selection.length > 320 ? `${selection.slice(0, 317)}…` : selection;
      setText(contextSelected, preview);
      contextSelection?.removeAttribute("hidden");
    } else {
      setText(contextSelected, "");
      contextSelection?.setAttribute("hidden", "");
    }
    contextSummary?.removeAttribute("hidden");
  }

  async function acceptPageContext(
    ctx: PageContext,
    tabId?: number,
  ): Promise<void> {
    if (isOnboardingBlocking()) {
      return;
    }

    const value = assessPagePromptValue(ctx);
    if (!value.worthPrompting) {
      if (!ctx.selectedText?.trim()) {
        renderLowValue(lowValueMessageFor(value.reason), tabId);
        return;
      }
      ctx = toSelectionOnlyContext(ctx);
    }

    stopSelectionWatchIfBound();

    const key = contextKey(ctx, tabId);
    if (
      key === lastAcceptedKey &&
      currentStep !== "stale" &&
      currentStep !== "empty" &&
      currentStep !== "fallback"
    ) {
      return;
    }
    if (acceptingKey === key) {
      return;
    }
    acceptingKey = key;
    const generation = suggestionGeneration;

    pageContext = ctx;
    if (typeof tabId === "number") {
      boundTabId = tabId;
    }
    selectedAction = null;
    builtPrompt = "";
    inclusion = { ...DEFAULT_CONTEXT_INCLUSION };
    renderPageIdentity(ctx);
    showStep("understanding");
    setText(statusLine, "Understanding this page…");
    try {
      await loadSuggestions(ctx);
      if (generation === suggestionGeneration) {
        lastAcceptedKey = key;
      }
    } finally {
      if (acceptingKey === key) {
        acceptingKey = null;
      }
    }
  }

  async function selectAction(action: SuggestedAction): Promise<void> {
    selectedAction = action;
    setText(selectedActionLabel, action.title);
    if (userNoteInput instanceof HTMLTextAreaElement) {
      userNoteInput.value = "";
    }
    showStep("refine");
    setText(statusLine, "Add an optional note, then continue.");
  }

  function openReviewStep(): void {
    if (!pageContext || !selectedAction) {
      return;
    }
    syncInclusionControls(pageContext);
    renderContextPreview();
    updateBuildPromptEnabled();
    showStep("review");
    setText(statusLine, "Review what to include, then build the prompt.");
  }

  async function buildPromptFromSelection(): Promise<void> {
    if (!pageContext || !selectedAction) {
      return;
    }
    inclusion = readInclusionFromDom();
    if (
      !hasUsableSourceInclusion(inclusion, inclusionAvailability(pageContext))
    ) {
      setText(statusLine, EMPTY_SOURCE_INCLUSION_MESSAGE);
      updateBuildPromptEnabled();
      return;
    }
    const noteRaw =
      userNoteInput instanceof HTMLTextAreaElement ? userNoteInput.value : "";
    const note = applyUserNoteInclusion(noteRaw, inclusion);
    const filtered = applyContextInclusion(pageContext, inclusion);

    setText(statusLine, "Building prompt…");
    try {
      const preference = await resolveNanoPreference();
      const engine = await selectEngine(preference);
      builtPrompt = await engine.generatePrompt({
        pageContext: filtered,
        action: selectedAction,
        userNote: note,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not build the prompt";
      renderFallback("prompt", `${message}. Adjust inclusions or retry.`, {
        canChoose: true,
      });
      return;
    }

    if (promptTextArea instanceof HTMLTextAreaElement) {
      promptTextArea.value = builtPrompt;
    }
    setText(
      promptMeta,
      `${builtPrompt.length.toLocaleString()} characters · editable before open`,
    );
    renderDestinationButtons();
    showStep("prompt");
    setText(statusLine, "Review the prompt, then copy or open a destination.");
  }

  function renderDestinationButtons(): void {
    if (!destinationActions) {
      return;
    }
    destinationActions.replaceChildren();

    const ordered = [
      defaultDestination,
      ...DESTINATION_IDS.filter((id) => id !== defaultDestination),
    ];

    for (const id of ordered) {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        id === defaultDestination ? "btn btn--primary" : "btn";
      button.textContent =
        id === "copy"
          ? "Copy"
          : id === "gemini"
            ? `Open ${destinationLabel(id)} (paste)`
            : `Open in ${destinationLabel(id)}`;
      button.addEventListener("click", () => {
        void handoff(id);
      });
      destinationActions.append(button);
    }
  }

  function pasteShortcutHint(): string {
    const isMac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform ?? "");
    return isMac ? "Cmd+V" : "Ctrl+V";
  }

  function successCopyForHandoff(
    destination: DestinationId,
    mode: "deeplink" | "fallback-web" | "clipboard" | "copy-only",
  ): string {
    if (mode === "copy-only") {
      return "Copied to clipboard.";
    }
    const label = DESTINATION_LABELS[destination];
    if (mode === "clipboard") {
      return `Prompt copied — switch to ${label} and press ${pasteShortcutHint()} to paste. Nothing was submitted.`;
    }
    return `Opened ${label}. Prompt was prefilled where supported — nothing was submitted.`;
  }

  async function handoff(destination: DestinationId): Promise<void> {
    if (!pageContext || !builtPrompt) {
      return;
    }

    const prompt =
      promptTextArea instanceof HTMLTextAreaElement
        ? promptTextArea.value
        : builtPrompt;
    builtPrompt = prompt;

    try {
      const result = await openLLM({ prompt, destination });
      await send({
        type: "ADD_RECENT_PROMPT",
        entry: {
          title: pageContext.title,
          url: pageContext.url,
          prompt,
          destination,
        },
      });

      setText(successMessage, successCopyForHandoff(destination, result.mode));
      showStep("success");
      setText(
        statusLine,
        result.mode === "clipboard" || result.mode === "copy-only"
          ? "Prompt copied. Panel stays open."
          : "Opened destination. Panel stays open.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Handoff failed";
      renderFallback(
        "handoff",
        `${message}. You can copy again or pick another destination.`,
        { canChoose: true },
      );
    }
  }

  async function loadLatestContext(): Promise<void> {
    if (isOnboardingBlocking()) {
      return;
    }
    showStep("understanding");
    setText(statusLine, "Reading this page…");

    const response = await send({
      type: "GET_LATEST_PAGE_CONTEXT",
      ...(boundTabId !== null ? { tabId: boundTabId } : {}),
    });
    if (isOnboardingBlocking()) {
      return;
    }
    if (!response.ok) {
      renderEmpty(`Background unreachable — ${response.error}`);
      return;
    }
    if (response.sensitiveBlock) {
      presentSensitiveBlock({
        tabId: response.tabId ?? boundTabId ?? 0,
        category: response.sensitiveBlock.category,
        url: response.sensitiveBlock.url,
      });
      return;
    }
    if (
      response.error &&
      isSensitiveBlockedError(response.error) &&
      response.tabId !== undefined
    ) {
      // Fallback when category was not persisted (should be rare).
      presentSensitiveBlock({
        tabId: response.tabId,
        category: "sensitive_input",
        url: undefined,
      });
      return;
    }
    if (response.pageContext) {
      await acceptPageContext(response.pageContext, response.tabId);
      return;
    }
    renderEmpty(
      response.error ??
        "No page captured yet — click the PromptAhead icon on the page you want to use.",
    );
  }

  /**
   * Panel clicks do not grant `activeTab`, but the grant from the opening
   * gesture survives until the tab navigates (S0.5), so a re-extract of the same
   * page works until then and fails with a clear message afterwards.
   */
  async function refreshFromPage(): Promise<void> {
    if (!(refreshButton instanceof HTMLButtonElement)) {
      return;
    }
    refreshButton.disabled = true;
    showStep("understanding");
    setText(statusLine, "Re-reading this page…");
    // Same-page refresh must not no-op on lastAcceptedKey (would stick on Re-reading).
    lastAcceptedKey = null;
    acceptingKey = null;

    try {
      const response = await send({
        type: "EXTRACT_ACTIVE_TAB",
        ...(boundTabId !== null ? { tabId: boundTabId } : {}),
      });
      if (response.ok) {
        await acceptPageContext(response.pageContext, response.tabId);
      } else if (isSensitiveBlockedError(response.error)) {
        const latest = await send({
          type: "GET_LATEST_PAGE_CONTEXT",
          ...(boundTabId !== null ? { tabId: boundTabId } : {}),
        });
        if (latest.ok && latest.sensitiveBlock) {
          presentSensitiveBlock({
            tabId: latest.tabId ?? boundTabId ?? 0,
            category: latest.sensitiveBlock.category,
            url: latest.sensitiveBlock.url,
          });
        } else if (!isSensitiveOverrideVisible()) {
          renderEmpty(response.error);
        }
      } else if (isExpectedReinvokeError(response.error)) {
        // Expected after navigate / restricted URL — calm stale UX, not a generic failure.
        renderStale(response.error);
      } else {
        renderFallback("extraction", response.error, { canChoose: false });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not refresh this page";
      renderFallback("extraction", message, { canChoose: false });
    } finally {
      refreshButton.disabled = false;
    }
  }

  async function retryFallback(): Promise<void> {
    switch (lastFallback) {
      case "extraction":
        await refreshFromPage();
        return;
      case "suggestions":
        if (pageContext) {
          showStep("understanding");
          await loadSuggestions(pageContext);
        } else {
          await loadLatestContext();
        }
        return;
      case "prompt":
        await buildPromptFromSelection();
        return;
      case "handoff":
        showStep("prompt");
        setText(statusLine, "Try copying or opening a destination again.");
        return;
      default:
        await loadLatestContext();
    }
  }

  async function renderDebugLine(): Promise<void> {
    const response = await send({ type: "GET_SETTINGS" });
    if (!response.ok) {
      setText(debugLine, `Background unreachable — ${response.error}`);
      return;
    }

    const {
      mode,
      defaultDestination: destination,
      nanoPreference: preference,
      schemaVersion,
    } = response.settings;
    defaultDestination = destination;
    nanoPreference = preference;
    setText(
      debugLine,
      [
        `mode: ${mode}`,
        `destination: ${DESTINATION_LABELS[destination]}`,
        `nano: ${preference}`,
        `settings schema: v${schemaVersion}`,
      ].join(" · "),
    );
  }

  function handleBackgroundEvent(message: unknown): void {
    if (!isBackgroundEvent(message)) {
      return;
    }
    if (message.type === "SENSITIVE_PAGE_BLOCKED") {
      presentSensitiveBlock({
        tabId: message.tabId,
        category: message.category,
        url: message.url,
      });
      return;
    }
    if (message.type === "PAGE_CONTEXT_UPDATED") {
      if (isOnboardingBlocking()) {
        return;
      }
      hideSensitiveOverride();
      pendingSensitiveTabId = null;
      // Selection / post-empty navigation auto-refresh only applies while idle
      // on empty/stale so a mid-prompt highlight does not reset the workflow.
      if (
        (message.source === "selection" || message.source === "navigation") &&
        currentStep !== "empty" &&
        currentStep !== "stale"
      ) {
        return;
      }
      // Toolbar / shortcut re-capture while the panel is already open.
      void acceptPageContext(message.pageContext, message.tabId);
      return;
    }
    if (message.type !== "PAGE_CONTEXT_CLEARED") {
      return;
    }
    hideSensitiveOverride();
    pendingSensitiveTabId = null;
    // Clear-all uses tabId -1; otherwise only the bound tab invalidates the panel.
    const matchesBound =
      message.reason === "cleared" ||
      (boundTabId !== null && message.tabId === boundTabId);
    if (!matchesBound) {
      return;
    }
    if (message.reason === "cleared") {
      boundTabId = null;
      void refreshOnboarding({ sendToBackground: send });
      void renderDebugLine();
      return;
    }
    // Low-value empty: do not keep the old homepage/listing copy after navigate.
    // Do not STOP_WATCH here — that would clear awaitingPageUpgrade and block
    // Smart auto-extract when the article finishes loading (DOM-62).
    if (currentStep === "empty") {
      renderStale(
        message.reason === "closed"
          ? "That tab closed — click the PromptAhead icon on a page to capture it again."
          : NAVIGATED_FROM_EMPTY_MESSAGE,
      );
      return;
    }
    if (currentStep === "stale") {
      return;
    }
    stopSelectionWatchIfBound();
    boundTabId = null;
    renderStale(
      message.reason === "closed"
        ? "That tab closed — click the PromptAhead icon on a page to capture it again."
        : STALE_CONTEXT_MESSAGE,
    );
  }

  const removers: Array<() => void> = [];

  function on(
    element: Element | null,
    event: string,
    handler: EventListener,
  ): void {
    if (!element) {
      return;
    }
    element.addEventListener(event, handler);
    removers.push(() => element.removeEventListener(event, handler));
  }

  on(document.getElementById("open-options"), "click", () => {
    void openOptions();
  });

  on(refreshButton, "click", () => {
    void refreshFromPage();
  });

  on(document.getElementById("sensitive-override-confirm"), "click", () => {
    void confirmSensitiveOverride();
  });

  on(document.getElementById("sensitive-override-cancel"), "click", () => {
    cancelSensitiveOverride();
  });

  on(showMoreButton, "click", () => {
    const hidden = moreActions?.hasAttribute("hidden") ?? true;
    setHidden(moreActions, !hidden);
    if (showMoreButton instanceof HTMLButtonElement) {
      showMoreButton.textContent = hidden ? "Hide more" : "More…";
    }
  });

  on(document.getElementById("continue-to-review"), "click", () => {
    openReviewStep();
  });

  on(document.getElementById("build-prompt"), "click", () => {
    void buildPromptFromSelection();
  });

  on(document.getElementById("back-to-choose"), "click", () => {
    showStep("choose");
    setText(statusLine, "Choose a direction.");
  });

  on(document.getElementById("back-to-refine"), "click", () => {
    showStep("refine");
    setText(statusLine, "Add an optional note, then continue.");
  });

  on(document.getElementById("back-to-review"), "click", () => {
    openReviewStep();
  });

  on(document.getElementById("edit-prompt"), "click", () => {
    showStep("prompt");
    setText(statusLine, "Edit the prompt, then copy or open a destination.");
  });

  on(document.getElementById("start-over"), "click", () => {
    if (pageContext && suggestions) {
      const notice: NanoPanelNotice =
        lastSelectedEngineId === "nano" && suggestions.engineId === "curated"
          ? nanoPanelNotice === "none"
            ? "fallback"
            : nanoPanelNotice
          : "none";
      renderSuggestions(suggestions, { nanoNotice: notice });
      showStep("choose");
      setText(statusLine, "Choose another direction.");
    }
  });

  on(fallbackRetry, "click", () => {
    void retryFallback();
  });

  on(fallbackChoose, "click", () => {
    if (suggestions) {
      showStep("choose");
      setText(statusLine, "Choose a direction.");
    }
  });

  on(nanoRetryButton, "click", () => {
    if (!pageContext) {
      return;
    }
    showStep("understanding");
    void loadSuggestions(pageContext, { forceNanoRetry: true });
  });

  on(nanoOpenSettingsButton, "click", () => {
    void openOptions();
  });

  for (const control of [
    includeTitleUrl,
    includePageBody,
    includeSelectedText,
    includeUserNote,
  ]) {
    on(control, "change", () => {
      renderContextPreview();
      if (
        pageContext &&
        !hasUsableSourceInclusion(
          readInclusionFromDom(),
          inclusionAvailability(pageContext),
        )
      ) {
        setText(statusLine, EMPTY_SOURCE_INCLUSION_MESSAGE);
      } else if (currentStep === "review") {
        setText(statusLine, "Review what to include, then build the prompt.");
      }
    });
  }

  on(promptTextArea, "input", () => {
    if (!(promptTextArea instanceof HTMLTextAreaElement)) {
      return;
    }
    builtPrompt = promptTextArea.value;
    setText(
      promptMeta,
      `${builtPrompt.length.toLocaleString()} characters · editable before open`,
    );
  });

  removers.push(addMessageListener(handleBackgroundEvent));
  void renderDebugLine();

  const onboardingShown = await maybeOnboarding(() => {
    resetWorkflowAfterOnboarding();
    void renderDebugLine();
    void loadLatestContext();
  }, { sendToBackground: send });
  if (!onboardingShown) {
    void loadLatestContext();
  }

  return {
    dispose: () => {
      for (const remove of removers) {
        remove();
      }
    },
  };
}

// Production entry — skipped under Vitest so tests can call initSidePanel with deps.
if (typeof process === "undefined" || process.env.VITEST !== "true") {
  void initSidePanel();
}
