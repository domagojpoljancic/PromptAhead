/**
 * Fixture engine standing in for Gemini Nano until M2.
 *
 * It returns fixed, obviously-synthetic actions so tests can prove the seam is
 * swappable and so the panel can be developed against a non-curated engine
 * without a Nano-capable Chrome. It never calls a model and never varies.
 */

import { buildPrompt } from "../prompts";
import type { PageType } from "../../shared/types/page-context";
import {
  PRIMARY_ACTION_COUNT,
  type ActionGenerationInput,
  type PromptGenerationInput,
  type SuggestedAction,
  type SuggestionEngine,
  type SuggestionResult,
} from "./types";

type MockEntry = Omit<SuggestedAction, "pageType">;

/** Five per page type, mirroring the "five to seven" Nano contract (§30). */
const MOCK_ACTIONS: Record<PageType, MockEntry[]> = {
  article: [
    {
      id: "mock.article.who-benefits",
      title: "Ask who benefits from this framing",
      description: "Follow the incentives behind how the story is being told.",
      category: "perspectives",
      outputFormat: "other",
      task: "Identify who benefits from the way this story is framed, and what an equally defensible alternative framing would look like.",
      outputSpec: [
        "The interests served by the current framing, with evidence.",
        "An alternative framing supported by the same facts.",
        "Links to coverage that uses each framing.",
      ],
    },
    {
      id: "mock.article.numbers",
      title: "Check the numbers behind the claims",
      description: "Verify the figures against the underlying data.",
      category: "critique",
      outputFormat: "comparison",
      task: "Check every figure quoted on this page against its underlying dataset or filing, and show where the page rounds, omits or misreads.",
      outputSpec: [
        "A table: figure as quoted, figure in the source, difference, link.",
        "Figures you could not verify at all.",
      ],
    },
    {
      id: "mock.article.next-decision",
      title: "Find the next decision point",
      description: "Work out what happens next and when it is decided.",
      category: "developments",
      outputFormat: "timeline",
      task: "Work out what the next real decision point on this topic is, who makes it, and when.",
      outputSpec: [
        "A dated list of upcoming decisions and deadlines.",
        "Who decides each one and what the plausible outcomes are.",
      ],
    },
    {
      id: "mock.article.local-impact",
      title: "Translate this into local impact",
      description: "See what the story changes for an ordinary reader.",
      category: "context",
      outputFormat: "structured_explanation",
      task: "Explain what this story concretely changes for an ordinary person, and by when.",
      outputSpec: [
        "The concrete effects, ordered by how soon they land.",
        "Who is affected most, and who is not affected at all.",
      ],
    },
    {
      id: "mock.article.contrarian",
      title: "Find the credible contrarian case",
      description: "Read the best argument against the consensus here.",
      category: "critique",
      outputFormat: "other",
      task: "Find the most credible argument against the consensus this page presents, and assess how strong it actually is.",
      outputSpec: [
        "The contrarian case in its strongest form, with sources.",
        "Where it holds up and where it does not.",
      ],
    },
  ],
  product: [
    {
      id: "mock.product.spec-reality",
      title: "Check the specs against real tests",
      description: "Compare marketing numbers with independent measurements.",
      category: "weaknesses",
      outputFormat: "comparison",
      task: "Compare the manufacturer's specifications for this product with independent measurements from reviewers who tested it.",
      outputSpec: [
        "A table: spec, claimed, measured, tester, link.",
        "Specs no independent test has verified.",
      ],
    },
    {
      id: "mock.product.lifespan",
      title: "Estimate how long it will last",
      description: "Look at repairability, parts supply and support windows.",
      category: "cost",
      outputFormat: "decision_brief",
      task: "Estimate the realistic service life of this product from repairability, spare-parts availability, software-support windows and reported failure rates.",
      outputSpec: [
        "An expected lifespan with the reasoning behind it.",
        "Repairability score, parts availability and support end date, with links.",
      ],
    },
    {
      id: "mock.product.buy-now-or-wait",
      title: "Decide whether to buy now or wait",
      description: "Check release cadence and current discount patterns.",
      category: "price",
      outputFormat: "decision_brief",
      task: "Tell me whether to buy this now or wait, using the product's release cadence, current discounting and any announced successor.",
      outputSpec: [
        "A buy-now or wait recommendation with the trigger to change it.",
        "Release history and typical discount timing, with sources.",
      ],
    },
    {
      id: "mock.product.hidden-costs",
      title: "Surface the costs the listing hides",
      description: "Find the accessories and subscriptions you will end up buying.",
      category: "cost",
      outputFormat: "comparison",
      task: "List the accessories, subscriptions and consumables owners of this product end up buying that the listing does not mention.",
      outputSpec: [
        "Each hidden cost with a typical price and a source.",
        "Which ones are genuinely optional.",
      ],
    },
    {
      id: "mock.product.return-risk",
      title: "Assess the return and warranty risk",
      description: "Understand what happens when it goes wrong.",
      category: "compatibility",
      outputFormat: "decision_brief",
      task: "Assess what happens if this product fails: warranty terms, typical support experience, and how returns work with this seller.",
      outputSpec: [
        "Warranty length and what it excludes, with a link to the terms.",
        "Reported support experiences, good and bad.",
      ],
    },
  ],
  generic: [
    {
      id: "mock.generic.claims-map",
      title: "Map the claims to their evidence",
      description: "See which statements here are actually supported.",
      category: "sources",
      outputFormat: "source_map",
      task: "Map each substantive claim on this page to the evidence behind it, and mark the ones with no support.",
      outputSpec: [
        "A claim-to-evidence table with links.",
        "Claims with no traceable support.",
      ],
    },
    {
      id: "mock.generic.who-disagrees",
      title: "Find who disagrees and why",
      description: "Surface the credible dissent on this topic.",
      category: "perspectives",
      outputFormat: "comparison",
      task: "Find credible people or organisations who disagree with this page, and explain the substance of the disagreement.",
      outputSpec: [
        "Each dissenting position with who holds it and a link.",
        "What evidence would settle the disagreement.",
      ],
    },
    {
      id: "mock.generic.apply-it",
      title: "Show me how to apply this",
      description: "Turn the page into something you can use this week.",
      category: "next-steps",
      outputFormat: "other",
      task: "Show me how to apply what this page describes in a concrete, small first step I could complete this week.",
      outputSpec: [
        "A single small first step, described concretely.",
        "What success looks like and how to check it.",
      ],
    },
    {
      id: "mock.generic.prerequisites",
      title: "List what I need to know first",
      description: "Identify the prerequisites this page skips over.",
      category: "context",
      outputFormat: "structured_explanation",
      task: "List the prerequisites this page assumes, and explain each one briefly enough to unblock me.",
      outputSpec: [
        "Each prerequisite with a two-sentence explanation.",
        "A link to a good primer for each.",
      ],
    },
    {
      id: "mock.generic.staleness",
      title: "Check whether this is still current",
      description: "Find out if the page has quietly gone out of date.",
      category: "developments",
      outputFormat: "timeline",
      task: "Check whether the information on this page is still current, and list what has changed since it was written.",
      outputSpec: [
        "Dated changes since publication, with links.",
        "Which parts of the page are now wrong.",
      ],
    },
  ],
};

export type MockNanoOptions = {
  /** Lets tests exercise the "engine unavailable → curated" fallback. */
  available?: boolean;
};

export class MockNanoSuggestionEngine implements SuggestionEngine {
  readonly id = "mock-nano" as const;

  private readonly available: boolean;

  constructor(options: MockNanoOptions = {}) {
    this.available = options.available ?? true;
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available);
  }

  suggestActions(input: ActionGenerationInput): Promise<SuggestionResult> {
    const { pageType } = input.pageContext;
    const actions = MOCK_ACTIONS[pageType].map((entry) => ({ ...entry, pageType }));

    return Promise.resolve({
      engineId: this.id,
      primary: actions.slice(0, PRIMARY_ACTION_COUNT),
      more: actions.slice(PRIMARY_ACTION_COUNT),
    });
  }

  /** Prompt composition stays deterministic even behind a "model" engine. */
  generatePrompt(input: PromptGenerationInput): Promise<string> {
    return Promise.resolve(
      buildPrompt({
        pageContext: input.pageContext,
        task: input.action,
        userNote: input.userNote,
        languageOverride: input.languageOverride,
      }).text,
    );
  }
}

export const MOCK_NANO_ACTION_IDS: readonly string[] = Object.values(MOCK_ACTIONS)
  .flat()
  .map((entry) => entry.id);
