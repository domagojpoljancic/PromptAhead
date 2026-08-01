export type SpikeId =
  | "S0.1"
  | "S0.2"
  | "S0.3"
  | "S0.4"
  | "S0.5"
  | "S0.6"
  | "S0.7";

/**
 * Prompt API spikes must execute in the realm under test (side panel / options
 * page), so the service worker refuses to run them on a caller's behalf.
 */
export type DocumentSpikeId = Extract<SpikeId, "S0.1" | "S0.2" | "S0.3">;

export const DOCUMENT_SPIKE_IDS: readonly DocumentSpikeId[] = [
  "S0.1",
  "S0.2",
  "S0.3",
];

export function isDocumentSpike(spikeId: string): spikeId is DocumentSpikeId {
  return (DOCUMENT_SPIKE_IDS as readonly string[]).includes(spikeId);
}

export type SpikeLogLevel = "info" | "warn" | "error" | "success";

export type SpikeStatus = "idle" | "running" | "pass" | "fail" | "blocked";

export interface SpikeLogEntry {
  timestamp: string;
  level: SpikeLogLevel;
  message: string;
}

export interface SpikeResult {
  spikeId: SpikeId;
  status: SpikeStatus;
  entries: SpikeLogEntry[];
  updatedAt: string;
}

export interface SpikeDefinition {
  id: SpikeId;
  title: string;
  question: string;
  /** Plain-language description of the experiment, for the tester. */
  testing: string;
  /** The product decision this spike unblocks — why it is worth running. */
  matters: string;
  /** What a trustworthy pass looks like. */
  pass: string;
  /** Conditions that make the result misleading rather than informative. */
  invalidIf: string;
}

export const SPIKE_DEFINITIONS: SpikeDefinition[] = [
  {
    id: "S0.1",
    title: "Where the on-device AI is reachable",
    question:
      "Does LanguageModel work in side panel, options page, and service worker?",
    testing:
      "Asks each of the extension's three execution contexts whether Chrome's built-in AI exists there, and what state the model is in.",
    matters:
      "Decides which part of PromptAhead is allowed to talk to the AI. The architecture assumes the side panel; if that is wrong, the message flow changes.",
    pass: "All three contexts report the LanguageModel surface, and the two availability() calls agree with each other.",
    invalidIf:
      "You read the availability values as a per-context capability. They report one global model state, so a context probed mid-download looks worse than one probed after it finished.",
  },
  {
    id: "S0.2",
    title: "Model readiness and download behaviour",
    question:
      "availability(), user-activated create(), and downloadprogress events",
    testing:
      "Opens a real AI session from your click, watching how Chrome reports readiness, download progress, session limits, and how long the first reply takes.",
    matters:
      "Drives onboarding: whether we can show a real progress bar, how big a page we can send, and what timeout the product should use.",
    pass: "A session is created, the warm-up prompt answers, and the log shows the input quota plus how progress events behaved.",
    invalidIf:
      "You close this panel mid-run — that aborts create(). Also note that a machine with the model already downloaded cannot tell us what a genuine cold download looks like.",
  },
  {
    id: "S0.3",
    title: "Reliable JSON action lists",
    question: "responseConstraint schema for action list generation",
    testing:
      "Sends three sample pages (article, product, generic) through the AI with a required JSON shape, then counts how many came back parseable.",
    matters:
      "The whole suggestion feature depends on the AI returning structured actions. If the shape is unreliable, we need validation, repair, and a curated fallback.",
    pass: "Every sample returns valid JSON with sensible action labels, ideally with no repair attempts used.",
    invalidIf:
      "You treat three clean synthetic samples as proof of robustness. Real pages are longer, multilingual, and sometimes hostile.",
  },
  {
    id: "S0.4",
    title: "Ways to open the side panel",
    question: "Open from toolbar, notification click, and context menu",
    testing:
      "Records which entry points actually managed to open this panel: the toolbar icon, the page context menu, and a notification click.",
    matters:
      "Manual mode needs a dependable way in, and Smart mode later needs to open the panel from a notification. A path that does not work has to be designed around.",
    pass: "All three entry points get recorded as having opened the panel, with no user-gesture errors.",
    invalidIf:
      "You only ever use one entry point — the untried paths stay unknown rather than proven broken.",
  },
  {
    id: "S0.5",
    title: "Reading the page without broad permissions",
    question:
      "Extract on action click without host_permissions; panel follow-up scripting",
    testing:
      "Reads a compact snapshot of your current tab using only the temporary access your click grants, then tests whether the panel can read that same tab again with no new click.",
    matters:
      "Decides whether Manual mode can stay on minimal permissions. If the panel cannot re-read a tab, PromptAhead must capture everything at the moment you click.",
    pass: "The card shows a title, URL, and excerpt captured from your click, and the follow-up attempt gives a clear allowed-or-refused answer.",
    invalidIf:
      "The gesture happened on a chrome:// or Web Store tab, which Chrome always refuses, or S0.6 left the all-sites permission granted — either way you are not measuring the temporary grant.",
  },
  {
    id: "S0.6",
    title: "Granting and revoking all-sites access",
    question: "permissions.request / remove / contains grant and revoke",
    testing:
      "Asks Chrome for optional access to all sites, checks that the grant registers, then gives it back and checks the revoke really took effect.",
    matters:
      "Smart mode depends on asking for broad access at runtime and letting people take it away again cleanly, without reinstalling the extension.",
    pass: "Chrome prompts, the grant and revoke both register immediately, and no extension reload is needed.",
    invalidIf:
      "The permission is left granted at the end. That silently invalidates S0.5, which is only meaningful without it.",
  },
  {
    id: "S0.7",
    title: "Inviting without touching the page",
    question: "Badge + compact notification opens panel without page injection",
    testing:
      "Puts a badge on the toolbar icon and raises a system notification, then checks whether clicking it opens the panel — all without modifying the page you are reading.",
    matters:
      "Smart mode must be able to offer help unobtrusively. This chooses between badge-only, notification, or both.",
    pass: "The badge appears, the notification is created, and clicking it opens this panel.",
    invalidIf:
      "macOS notification settings are suppressing Chrome notifications — that is an environment limit, not a Chrome API limit.",
  },
];
