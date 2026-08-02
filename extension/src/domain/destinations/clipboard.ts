/**
 * Clipboard write with a DOM fallback for extension pages where the async
 * Clipboard API is missing or rejects (focus / permission edge cases).
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the textarea path.
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable in this context");
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  area.style.top = "0";
  document.body.append(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    area.remove();
  }

  if (!ok) {
    throw new Error("Could not copy the prompt — select it and copy manually");
  }
}
