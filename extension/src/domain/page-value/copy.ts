import type { PromptValueReason } from "./assess";

const LOW_VALUE_COPY: Record<
  Exclude<PromptValueReason, "worth-prompting">,
  string
> = {
  "app-or-editor":
    "Not much to prompt ahead from here — open the article or page you want. Or select text on this page to use just that.",
  "site-home":
    "This is a homepage — open an article to prompt ahead from it. Or select text to use just that.",
  "listing-or-search":
    "This is a list of results — open one item to prompt ahead from it. Or select text to use just that.",
  "thin-content":
    "Not much to prompt ahead from here — open a page with more content, or select the text you want to use.",
};

export function lowValueMessageFor(reason: PromptValueReason): string {
  if (reason === "worth-prompting") {
    return LOW_VALUE_COPY["thin-content"];
  }
  return LOW_VALUE_COPY[reason];
}
