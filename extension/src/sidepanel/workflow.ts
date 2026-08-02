/**
 * Side-panel workflow steps (handoff §15). Pure helpers so unit tests can
 * cover transitions without the DOM.
 */

export const PANEL_STEPS = [
  "understanding",
  "choose",
  "refine",
  "review",
  "prompt",
  "success",
  "empty",
  "stale",
  "fallback",
] as const;

export type PanelStep = (typeof PANEL_STEPS)[number];

/** Steps that render a primary workflow card (one visible at a time). */
export const WORKFLOW_CARD_STEPS = [
  "understanding",
  "choose",
  "refine",
  "review",
  "prompt",
  "success",
  "fallback",
] as const satisfies readonly PanelStep[];

export type WorkflowCardStep = (typeof WORKFLOW_CARD_STEPS)[number];

export function isWorkflowCardStep(step: PanelStep): step is WorkflowCardStep {
  return (WORKFLOW_CARD_STEPS as readonly string[]).includes(step);
}

/** Back navigation for the linear happy path. */
export function previousStep(step: PanelStep): PanelStep | null {
  switch (step) {
    case "refine":
      return "choose";
    case "review":
      return "refine";
    case "prompt":
      return "review";
    case "success":
      return "prompt";
    default:
      return null;
  }
}

export const STALE_CONTEXT_MESSAGE =
  "This page changed — click the PromptAhead icon to capture it again.";
