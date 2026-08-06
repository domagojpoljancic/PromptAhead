/**
 * Parse + validate Nano action JSON (handoff §30 safeguards).
 * Pure — no Prompt API dependency, easy to unit test.
 */

import type { PageType } from "../../shared/types/page-context";
import type { OutputFormat } from "../prompts";
import {
  MAX_ACTION_DESCRIPTION_CHARS,
  MAX_ACTION_TITLE_CHARS,
  PRIMARY_ACTION_COUNT,
  type ActionCategory,
  type SuggestedAction,
  type SuggestionResult,
} from "./types";
import {
  NANO_ACTION_CATEGORIES,
  NANO_OUTPUT_FORMATS,
} from "./nano-schema";

const CATEGORY_SET = new Set<string>(NANO_ACTION_CATEGORIES);
const FORMAT_SET = new Set<string>(NANO_OUTPUT_FORMATS);

export type NanoValidationOk = {
  ok: true;
  result: SuggestionResult;
};

export type NanoValidationFail = {
  ok: false;
  reason: string;
};

export type NanoValidationResult = NanoValidationOk | NanoValidationFail;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strip optional ```json fences some models still emit. */
export function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function parseNanoActionJson(raw: string): unknown {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch (initialError) {
    // Some models emit commentary around the JSON; attempt to extract the
    // first JSON object that contains an `actions` field.
    const extracted = extractJsonObjectContainingActions(raw);
    if (extracted !== null) {
      return JSON.parse(extracted);
    }
    throw initialError;
  }
}

function extractJsonObjectContainingActions(raw: string): string | null {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }
  const candidate = raw.slice(firstBrace, lastBrace + 1).trim();
  // Cheap guard to avoid parsing unrelated blobs.
  if (!candidate.includes('"actions"') && !candidate.includes("'actions'")) {
    return null;
  }
  return candidate;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, max: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function nearDuplicate(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) {
    return true;
  }
  return left.includes(right) || right.includes(left);
}

function looksLikeInstructionLeak(text: string): boolean {
  return (
    /ignore (all )?(previous|prior|above) instructions/i.test(text) ||
    /you are (now )?chatgpt/i.test(text) ||
    /system prompt/i.test(text)
  );
}

function looksLikeResearchClaim(text: string): boolean {
  return (
    /\bI (found|searched|discovered)\b/i.test(text) ||
    /\baccording to my (search|research)\b/i.test(text)
  );
}

function asAction(
  value: unknown,
  pageType: PageType,
  pageTitle: string,
): SuggestedAction | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? normalizeWhitespace(value.id) : "";
  const title =
    typeof value.title === "string" ? clip(value.title, MAX_ACTION_TITLE_CHARS) : "";
  const description =
    typeof value.description === "string"
      ? clip(value.description, MAX_ACTION_DESCRIPTION_CHARS)
      : "";
  const task = typeof value.task === "string" ? normalizeWhitespace(value.task) : "";
  const category =
    typeof value.category === "string" && CATEGORY_SET.has(value.category)
      ? (value.category as ActionCategory)
      : null;
  const outputFormat =
    typeof value.outputFormat === "string" && FORMAT_SET.has(value.outputFormat)
      ? (value.outputFormat as OutputFormat)
      : null;
  const outputSpec = Array.isArray(value.outputSpec)
    ? value.outputSpec
        .filter((item): item is string => typeof item === "string")
        .map(normalizeWhitespace)
        .filter(Boolean)
    : [];

  if (!id || !title || !description || !task || !category || !outputFormat) {
    return null;
  }
  if (outputSpec.length === 0) {
    return null;
  }
  if (nearDuplicate(title, pageTitle) || title.toLowerCase() === pageTitle.toLowerCase()) {
    return null;
  }
  if (
    looksLikeInstructionLeak(title) ||
    looksLikeInstructionLeak(description) ||
    looksLikeInstructionLeak(task)
  ) {
    return null;
  }
  if (
    looksLikeResearchClaim(title) ||
    looksLikeResearchClaim(description) ||
    looksLikeResearchClaim(task)
  ) {
    return null;
  }

  return {
    id,
    title,
    description,
    category,
    pageType,
    task,
    outputFormat,
    outputSpec,
  };
}

/**
 * Validate raw model output into a SuggestionResult, or explain why not.
 */
export function validateNanoActionOutput(
  raw: unknown,
  options: { pageType: PageType; pageTitle: string },
): NanoValidationResult {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = parseNanoActionJson(raw);
    } catch {
      return { ok: false, reason: "Response was not valid JSON" };
    }
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.actions)) {
    return { ok: false, reason: "Response missing an actions array" };
  }

  const accepted: SuggestedAction[] = [];
  for (const item of parsed.actions) {
    const action = asAction(item, options.pageType, options.pageTitle);
    if (!action) {
      continue;
    }
    const duplicate = accepted.some(
      (existing) =>
        existing.id === action.id ||
        nearDuplicate(existing.title, action.title) ||
        nearDuplicate(existing.task, action.task),
    );
    if (duplicate) {
      continue;
    }
    accepted.push(action);
  }

  if (accepted.length === 0) {
    return { ok: false, reason: "No valid actions after validation" };
  }

  return {
    ok: true,
    result: {
      engineId: "nano",
      primary: accepted.slice(0, PRIMARY_ACTION_COUNT),
      more: accepted.slice(PRIMARY_ACTION_COUNT),
    },
  };
}
