/**
 * Heuristic “meaningful product interaction” detectors (handoff §9).
 * Operates on plain attribute snapshots so unit tests stay DOM-free.
 */

export type ProductInteractionKind =
  | "media"
  | "specs"
  | "variant"
  | "reviews"
  | "other";

export type InteractionTargetSnapshot = {
  tagName: string;
  role?: string;
  type?: string;
  /** Lowercased concatenated id + class + aria-label + data-* hints. */
  hints: string;
  /** True when the node (or a close ancestor) looks like a product control. */
  inProductChrome?: boolean;
};

const MEDIA_HINTS = /\b(gallery|thumbnail|zoom|lightbox|carousel|swiper|media)\b/;
const SPECS_HINTS =
  /\b(spec|specs|specification|specifications|details|tech[-_]?specs)\b/;
const VARIANT_HINTS =
  /\b(variant|variants|swatch|size|colour|color|sku|option|options)\b/;
const REVIEWS_HINTS =
  /\b(review|reviews|rating|ratings|stars|customer[-_]?review)\b/;

function normalizeHints(raw: string): string {
  return raw.toLowerCase().replace(/[_/]+/g, " ");
}

/**
 * Classify a click / change / toggle target. Returns null when the event is
 * not a meaningful product interaction (plain navigation, cookie banner, etc.).
 */
export function classifyProductInteraction(
  target: InteractionTargetSnapshot,
): ProductInteractionKind | null {
  const tag = target.tagName.toLowerCase();
  const role = (target.role ?? "").toLowerCase();
  const type = (target.type ?? "").toLowerCase();
  const hints = normalizeHints(target.hints);

  // Ignore obvious non-product chrome.
  if (/\b(cookie|consent|newsletter|login|sign[-_]?in|cart-icon)\b/.test(hints)) {
    return null;
  }

  if (
    tag === "img" ||
    tag === "video" ||
    role === "img" ||
    MEDIA_HINTS.test(hints)
  ) {
    return "media";
  }

  if (SPECS_HINTS.test(hints) || /accordion|expand/.test(hints)) {
    if (SPECS_HINTS.test(hints)) {
      return "specs";
    }
  }

  if (
    VARIANT_HINTS.test(hints) ||
    ((tag === "select" || tag === "input" || role === "radio" || role === "option") &&
      (target.inProductChrome || VARIANT_HINTS.test(hints)))
  ) {
    return "variant";
  }

  if (REVIEWS_HINTS.test(hints)) {
    return "reviews";
  }

  if (SPECS_HINTS.test(hints)) {
    return "specs";
  }

  // Expandable product sections without a clear keyword still count when the
  // control sits inside product chrome.
  if (
    target.inProductChrome &&
    (tag === "button" ||
      role === "button" ||
      role === "tab" ||
      type === "button" ||
      tag === "summary")
  ) {
    return "other";
  }

  return null;
}

export function isMeaningfulProductInteraction(
  target: InteractionTargetSnapshot,
): boolean {
  return classifyProductInteraction(target) !== null;
}
