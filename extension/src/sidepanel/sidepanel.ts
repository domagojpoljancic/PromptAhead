import { sendToBackground } from "../shared/messaging";
import type { PageContext } from "../shared/types/page-context";
import {
  DESTINATION_IDS,
  DESTINATION_LABELS,
  type DestinationId,
} from "../shared/storage/schema";
import {
  copyAndMaybeOpen,
  destinationLabel,
} from "../domain/destinations";
import {
  selectSuggestionEngine,
  type SuggestedAction,
  type SuggestionResult,
} from "../domain/suggestions";

const PAGE_TYPE_LABELS: Record<PageContext["pageType"], string> = {
  article: "Article",
  product: "Product",
  generic: "Page",
};

type PanelStep = "empty" | "choose" | "refine" | "review" | "success";

const statusLine = document.getElementById("status");
const debugLine = document.getElementById("debug-line");
const contextCard = document.getElementById("context");
const contextType = document.getElementById("context-type");
const contextTitle = document.getElementById("context-title");
const contextUrl = document.getElementById("context-url");
const contextExcerpt = document.getElementById("context-excerpt");
const contextFacts = document.getElementById("context-facts");
const refreshButton = document.getElementById("refresh-context");

const chooseSection = document.getElementById("choose");
const refineSection = document.getElementById("refine");
const reviewSection = document.getElementById("review");
const successSection = document.getElementById("success");
const primaryActions = document.getElementById("primary-actions");
const moreActions = document.getElementById("more-actions");
const showMoreButton = document.getElementById("show-more");
const selectedActionLabel = document.getElementById("selected-action");
const userNoteInput = document.getElementById("user-note");
const promptTextArea = document.getElementById("prompt-text");
const promptMeta = document.getElementById("prompt-meta");
const destinationActions = document.getElementById("destination-actions");
const successMessage = document.getElementById("success-message");

let pageContext: PageContext | null = null;
let suggestions: SuggestionResult | null = null;
let selectedAction: SuggestedAction | null = null;
let builtPrompt = "";
let defaultDestination: DestinationId = "copy";

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

function firstExcerpt(ctx: PageContext): string {
  const section = ctx.article ?? ctx.product ?? ctx.generic;
  return section?.excerpts[0] ?? ctx.description ?? "";
}

function factsFor(ctx: PageContext): [string, string][] {
  const facts: [string, string][] = [["Language", ctx.language]];
  const { article, product, generic } = ctx;

  if (article) {
    if (article.publisher) facts.push(["Publisher", article.publisher]);
    if (article.author) facts.push(["Author", article.author]);
    if (article.publishedAt) facts.push(["Published", article.publishedAt]);
    facts.push(["Captured", `${article.headings.length} headings`]);
  }
  if (product) {
    if (product.brand) facts.push(["Brand", product.brand]);
    if (product.price) {
      facts.push([
        "Price",
        [product.price, product.currency].filter(Boolean).join(" "),
      ]);
    }
    if (product.availability) facts.push(["Availability", product.availability]);
    if (product.rating !== undefined) {
      const reviews =
        product.reviewCount === undefined ? "" : ` (${product.reviewCount} reviews)`;
      facts.push(["Rating", `${product.rating}${reviews}`]);
    }
    facts.push(["Captured", `${product.specifications.length} specifications`]);
  }
  if (generic) {
    facts.push(["Captured", `${generic.headings.length} headings`]);
  }

  return facts;
}

function renderFacts(ctx: PageContext): void {
  if (!contextFacts) {
    return;
  }
  contextFacts.replaceChildren();
  for (const [label, value] of factsFor(ctx)) {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value;
    contextFacts.append(term, definition);
  }
}

function showStep(next: PanelStep): void {
  setHidden(chooseSection, next !== "choose");
  setHidden(refineSection, next !== "refine");
  setHidden(reviewSection, next !== "review");
  setHidden(successSection, next !== "success");
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

function renderSuggestions(result: SuggestionResult): void {
  suggestions = result;
  primaryActions?.replaceChildren(...result.primary.map(renderActionButton));
  moreActions?.replaceChildren(...result.more.map(renderActionButton));
  setHidden(moreActions, true);
  if (showMoreButton instanceof HTMLButtonElement) {
    showMoreButton.hidden = result.more.length === 0;
    showMoreButton.textContent = "More…";
  }
}

async function loadSuggestions(ctx: PageContext): Promise<void> {
  setText(statusLine, "Building suggestions…");
  const engine = await selectSuggestionEngine();
  const result = await engine.suggestActions({ pageContext: ctx });
  renderSuggestions(result);
  showStep("choose");
  setText(
    statusLine,
    `Page context captured (${engine.id}) — nothing leaves this device.`,
  );
}

function renderPageContext(ctx: PageContext): void {
  pageContext = ctx;
  selectedAction = null;
  builtPrompt = "";
  setText(contextType, PAGE_TYPE_LABELS[ctx.pageType]);
  setText(contextTitle, ctx.title);
  setText(contextUrl, ctx.url);
  setText(contextExcerpt, firstExcerpt(ctx));
  renderFacts(ctx);
  contextCard?.removeAttribute("hidden");
  void loadSuggestions(ctx);
}

function renderEmpty(message: string): void {
  pageContext = null;
  suggestions = null;
  selectedAction = null;
  builtPrompt = "";
  contextCard?.setAttribute("hidden", "");
  showStep("empty");
  setText(statusLine, message);
}

async function selectAction(action: SuggestedAction): Promise<void> {
  selectedAction = action;
  setText(selectedActionLabel, action.title);
  if (userNoteInput instanceof HTMLTextAreaElement) {
    userNoteInput.value = "";
  }
  showStep("refine");
  setText(statusLine, "Add an optional note, then build the prompt.");
}

async function buildPromptFromSelection(): Promise<void> {
  if (!pageContext || !selectedAction) {
    return;
  }
  const note =
    userNoteInput instanceof HTMLTextAreaElement ? userNoteInput.value : "";
  const engine = await selectSuggestionEngine();
  builtPrompt = await engine.generatePrompt({
    pageContext,
    action: selectedAction,
    userNote: note,
  });

  if (promptTextArea instanceof HTMLTextAreaElement) {
    promptTextArea.value = builtPrompt;
  }
  setText(
    promptMeta,
    `${builtPrompt.length.toLocaleString()} characters · editable before copy`,
  );
  renderDestinationButtons();
  showStep("review");
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
      id === "copy" ? "Copy" : `Copy and open ${destinationLabel(id)}`;
    button.addEventListener("click", () => {
      void handoff(id);
    });
    destinationActions.append(button);
  }
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
    const result = await copyAndMaybeOpen({ prompt, destination });
    await sendToBackground({
      type: "ADD_RECENT_PROMPT",
      entry: {
        title: pageContext.title,
        url: pageContext.url,
        prompt,
        destination,
      },
    });

    const opened =
      result.openedUrl === null
        ? "Copied to clipboard."
        : `Copied and opened ${DESTINATION_LABELS[destination]}. Paste when ready — nothing was submitted.`;
    setText(successMessage, opened);
    showStep("success");
    setText(statusLine, "Prompt ready.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Copy failed";
    setText(statusLine, message);
  }
}

async function loadLatestContext(): Promise<void> {
  const response = await sendToBackground({ type: "GET_LATEST_PAGE_CONTEXT" });
  if (!response.ok) {
    renderEmpty(`Background unreachable — ${response.error}`);
    return;
  }
  if (response.pageContext) {
    renderPageContext(response.pageContext);
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
  setText(statusLine, "Re-reading this page…");

  const response = await sendToBackground({ type: "EXTRACT_ACTIVE_TAB" });
  if (response.ok) {
    renderPageContext(response.pageContext);
  } else {
    renderEmpty(response.error);
  }
  refreshButton.disabled = false;
}

async function renderDebugLine(): Promise<void> {
  const response = await sendToBackground({ type: "GET_SETTINGS" });
  if (!response.ok) {
    setText(debugLine, `Background unreachable — ${response.error}`);
    return;
  }

  const { mode, defaultDestination: destination, schemaVersion } = response.settings;
  defaultDestination = destination;
  setText(
    debugLine,
    [
      `mode: ${mode}`,
      `destination: ${DESTINATION_LABELS[destination]}`,
      `settings schema: v${schemaVersion}`,
    ].join(" · "),
  );
}

document.getElementById("open-options")?.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

refreshButton?.addEventListener("click", () => {
  void refreshFromPage();
});

showMoreButton?.addEventListener("click", () => {
  const hidden = moreActions?.hasAttribute("hidden") ?? true;
  setHidden(moreActions, !hidden);
  if (showMoreButton instanceof HTMLButtonElement) {
    showMoreButton.textContent = hidden ? "Hide more" : "More…";
  }
});

document.getElementById("build-prompt")?.addEventListener("click", () => {
  void buildPromptFromSelection();
});

document.getElementById("back-to-choose")?.addEventListener("click", () => {
  showStep("choose");
  setText(statusLine, "Choose a direction.");
});

document.getElementById("back-to-refine")?.addEventListener("click", () => {
  showStep("refine");
  setText(statusLine, "Add an optional note, then build the prompt.");
});

document.getElementById("start-over")?.addEventListener("click", () => {
  if (pageContext && suggestions) {
    renderSuggestions(suggestions);
    showStep("choose");
    setText(statusLine, "Choose another direction.");
  }
});

void loadLatestContext();
void renderDebugLine();

export {};
