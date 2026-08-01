/**
 * Curated fallback actions (handoff §13), verbatim in intent and expanded into
 * the task + output shape the prompt builder needs.
 *
 * Order is the ranking: the first three of each list are the primary
 * suggestions, the rest sit behind "More…". This is data, not logic — adding a
 * direction means adding an entry here.
 */

import type { PageType } from "../../shared/types/page-context";
import type { SuggestedAction } from "./types";

type CatalogEntry = Omit<SuggestedAction, "pageType">;

const ARTICLE_ACTIONS: CatalogEntry[] = [
  {
    id: "article.background",
    title: "Explain the missing background",
    description: "Fill in the history, actors and context this piece assumes you know.",
    category: "context",
    outputFormat: "structured_explanation",
    task: "Explain the background this article assumes the reader already has: how the situation developed, who the main actors are, and which context the page leaves out.",
    outputSpec: [
      "A plain-language summary of what the page is actually about.",
      "The prior events and decisions that led here, in order.",
      "Who the named actors are and what interest each of them has.",
      "Definitions for the terms a newcomer would not know.",
      "What the page leaves unexplained or takes for granted.",
    ],
  },
  {
    id: "article.perspectives",
    title: "Compare independent perspectives",
    description: "See how other credible outlets frame the same story differently.",
    category: "perspectives",
    outputFormat: "comparison",
    task: "Compare how independent, credible sources cover this same story, and show where their framing, facts or emphasis diverge from the page above.",
    outputSpec: [
      "A table: source, framing or stance, key claim, link.",
      "At least three sources independent of each other and of the page.",
      "The points every source agrees on.",
      "The points where they disagree, and the likely reason why.",
      "Any perspective missing from the coverage entirely.",
    ],
  },
  {
    id: "article.developments",
    title: "Find the latest developments",
    description: "Check what happened since publication and whether it still holds.",
    category: "developments",
    outputFormat: "timeline",
    task: "Find what has happened on this topic since the page was published, and tell me whether its claims still hold today.",
    outputSpec: [
      "A dated timeline of developments after the page's publication date.",
      "For each entry: what changed, who reported it, and a link.",
      "Which claims on the page are now outdated, corrected or superseded.",
      "What is still unresolved and worth watching.",
    ],
  },
  {
    id: "article.primary-sources",
    title: "Find the original or primary sources",
    description: "Trace the reporting back to documents, filings, studies or data.",
    category: "sources",
    outputFormat: "source_map",
    task: "Trace the claims on this page back to their primary sources — original documents, filings, datasets, studies, transcripts or first-hand reporting — and link them.",
    outputSpec: [
      "Each significant claim mapped to its primary source, with links.",
      "Whether the page represents each source accurately.",
      "Claims you could not trace to any primary source.",
      "A short reliability note per source.",
    ],
  },
  {
    id: "article.timeline",
    title: "Build a timeline of events",
    description: "Lay out how this story unfolded, from first cause to today.",
    category: "timeline",
    outputFormat: "timeline",
    task: "Build a chronological timeline of the events this page describes, from the earliest relevant cause to the current state.",
    outputSpec: [
      "Dated entries in chronological order.",
      "One line per entry: what happened and why it mattered.",
      "A source link for every entry.",
      "Explicit gaps where the record is unclear or contested.",
    ],
  },
  {
    id: "article.challenge",
    title: "Challenge the main claims",
    description: "Stress-test the argument: evidence, counterarguments, weak links.",
    category: "critique",
    outputFormat: "other",
    task: "Stress-test the main claims on this page: check them against independent evidence, present the strongest counterarguments, and identify the weakest links in the reasoning.",
    outputSpec: [
      "A claim-by-claim assessment: claim, supporting evidence, contrary evidence, verdict.",
      "The strongest good-faith counterargument to the page's overall position.",
      "Any missing context that would change the conclusion.",
      "A clear split between what is verified, disputed and unknown.",
    ],
  },
  {
    id: "article.level",
    title: "Explain it simpler — or go deeper",
    description: "Re-explain at your level, from plain language to expert detail.",
    category: "level",
    outputFormat: "structured_explanation",
    task: "Re-explain this topic at two levels: a plain-language version for someone new to it, and a deeper technical version for someone who already knows the basics.",
    outputSpec: [
      "A plain-language explanation with no jargon.",
      "A deeper explanation with the mechanisms, numbers and caveats.",
      "A short glossary of the terms that matter.",
      "One good beginner resource and one good advanced resource, linked.",
    ],
  },
];

const PRODUCT_ACTIONS: CatalogEntry[] = [
  {
    id: "product.same-elsewhere",
    title: "Find this exact product elsewhere",
    description: "Check other retailers for stock, price gaps and delivery terms.",
    category: "price",
    outputFormat: "comparison",
    task: "Find this exact product at other retailers and compare price, availability, shipping, warranty and return terms against the listing above.",
    outputSpec: [
      "A table: retailer, price, availability, shipping, returns, link.",
      "Whether each listing is the identical model or a variant.",
      "Any price history or seasonal pattern you can find.",
      "Which sellers are authorised or otherwise reputable.",
    ],
  },
  {
    id: "product.alternatives",
    title: "Find the best alternatives",
    description: "Compare credible competitors on the things that actually differ.",
    category: "alternatives",
    outputFormat: "comparison",
    task: "Find the strongest alternatives to this product and compare them on the specifications, trade-offs and real-world performance that actually differ.",
    outputSpec: [
      "A table of three to five alternatives with price and key specs.",
      "What each alternative does better and worse than the product above.",
      "Which one suits which kind of buyer.",
      "Links to independent reviews or tests, not retailer copy.",
    ],
  },
  {
    id: "product.complaints",
    title: "Investigate recurring complaints",
    description: "Look for failure patterns, reliability issues and later regrets.",
    category: "weaknesses",
    outputFormat: "other",
    task: "Investigate what owners complain about with this product: recurring faults, reliability problems, support experiences, and what buyers regret after a few months.",
    outputSpec: [
      "Recurring complaints grouped by theme and ranked by how often they appear.",
      "Where each pattern was reported, with links (forums, reviews, teardowns).",
      "Whether the manufacturer acknowledged or fixed the issue.",
      "Which complaints are dealbreakers and which are noise.",
    ],
  },
  {
    id: "product.total-cost",
    title: "Compare total long-term cost",
    description: "Add up consumables, subscriptions, repairs and resale over years.",
    category: "cost",
    outputFormat: "comparison",
    task: "Estimate the total cost of owning this product over three to five years — consumables, subscriptions, accessories, repairs, energy — and compare it with the main alternatives.",
    outputSpec: [
      "A per-year cost breakdown for this product and its alternatives.",
      "Every recurring cost, with a source for the figure.",
      "The break-even point against a cheaper or a pricier option.",
      "The assumptions you made, listed explicitly.",
    ],
  },
  {
    id: "product.compatibility",
    title: "Check it fits my setup",
    description: "Verify compatibility with what you already own before committing.",
    category: "compatibility",
    outputFormat: "decision_brief",
    task: "Check whether this product is compatible with what I already own and use. Ask me for whatever you need to know, then flag the requirements, adapters and limitations I would hit.",
    outputSpec: [
      "The compatibility requirements the listing does not spell out.",
      "The questions I must answer for you to be certain.",
      "Known incompatibilities reported by other owners, with links.",
      "A go / no-go summary with its conditions attached.",
    ],
  },
  {
    id: "product.previous-model",
    title: "Compare with the previous model",
    description: "Decide whether this generation's changes justify the price gap.",
    category: "comparison",
    outputFormat: "comparison",
    task: "Compare this product with the previous generation and any close sibling model, and tell me whether the differences justify the price gap.",
    outputSpec: [
      "A table of the meaningful differences between the generations.",
      "Which changes are real improvements and which are marketing.",
      "The street price of the older model and whether it is still sold.",
      "A recommendation for who should buy which.",
    ],
  },
  {
    id: "product.cheaper-tradeoffs",
    title: "See what a cheaper option costs you",
    description: "Find the budget pick and name exactly what you give up for it.",
    category: "tradeoffs",
    outputFormat: "decision_brief",
    task: "Find the best cheaper alternative to this product and state precisely what I would give up by choosing it.",
    outputSpec: [
      "The strongest cheaper option, with price and link.",
      "A concrete list of what is worse, with numbers where they exist.",
      "What stays the same despite the price difference.",
      "Who should save the money, and who should not.",
    ],
  },
];

const GENERIC_ACTIONS: CatalogEntry[] = [
  {
    id: "generic.understand",
    title: "Understand this",
    description: "Explain the main idea, unfamiliar concepts and missing context.",
    category: "context",
    outputFormat: "structured_explanation",
    task: "Explain what this page is about: the main idea, the concepts a newcomer would not know, and the context it assumes.",
    outputSpec: [
      "A plain-language summary of the main idea.",
      "Definitions for the unfamiliar terms and concepts.",
      "The context or prerequisites the page assumes.",
      "What this is useful for, and what it is not.",
      "Two or three links for going deeper.",
    ],
  },
  {
    id: "generic.research",
    title: "Research further",
    description: "Find current, trustworthy sources and the developments that matter.",
    category: "sources",
    outputFormat: "source_map",
    task: "Find current, trustworthy sources on this topic and summarise the developments that matter, going beyond what the page itself says.",
    outputSpec: [
      "Five to eight sources worth reading, each with a link and a one-line reason.",
      "What is new or has changed recently, with dates.",
      "Where the consensus sits, and where it is contested.",
      "Which sources are primary and which are commentary.",
    ],
  },
  {
    id: "generic.challenge",
    title: "Challenge it",
    description: "Check the claims, find the weaknesses, name the open questions.",
    category: "critique",
    outputFormat: "other",
    task: "Check the claims on this page against independent evidence, identify weaknesses and counterarguments, and be explicit about what remains uncertain.",
    outputSpec: [
      "A claim-by-claim check: claim, evidence for, evidence against, verdict.",
      "The strongest counterargument to the page's position.",
      "Weaknesses in the reasoning or in the evidence base.",
      "An explicit list of open questions and unknowns.",
    ],
  },
  {
    id: "generic.compare",
    title: "Compare alternatives or perspectives",
    description: "Set this against the other credible options or schools of thought.",
    category: "alternatives",
    outputFormat: "comparison",
    task: "Compare what this page describes with the credible alternatives or competing perspectives, on the dimensions that actually matter.",
    outputSpec: [
      "A comparison table of the realistic options.",
      "The criteria you compared on, and why those.",
      "Which option suits which situation.",
      "A link to evidence for each option.",
    ],
  },
  {
    id: "generic.next-steps",
    title: "Extract practical next steps",
    description: "Turn the page into a short, ordered checklist you can act on.",
    category: "next-steps",
    outputFormat: "other",
    task: "Turn this page into a practical, ordered checklist I can act on, and add the steps the page leaves out.",
    outputSpec: [
      "An ordered checklist of concrete steps.",
      "Per step: what to do, roughly how long, and what to watch out for.",
      "Prerequisites and tools needed before starting.",
      "The mistakes people commonly make, with links.",
    ],
  },
  {
    id: "generic.custom",
    title: "Write a custom research prompt",
    description: "Get the sharpest questions to ask about this page — and answers.",
    category: "custom",
    outputFormat: "other",
    task: "Based on the page above, propose the three most useful research questions I could ask about it, then answer the one you judge most valuable.",
    outputSpec: [
      "Three sharply-worded research questions, ranked, each with why it matters.",
      "A full answer to the top question, with links.",
      "What you would need from me to answer the other two well.",
      "A clear separation of fact, interpretation and uncertainty.",
    ],
  },
];

/**
 * Offered on any page type, but only when the user actually selected text —
 * an "explain the selection" action with nothing selected is noise.
 */
const SELECTED_TEXT_ACTION: CatalogEntry = {
  id: "any.selection",
  title: "Explain the text I selected",
  description: "Zoom in on your selection and explain it in its wider context.",
  category: "selection",
  outputFormat: "structured_explanation",
  task: "Explain the passage quoted as SELECTED_TEXT in the source data: what it means, why it matters, and how it fits the rest of the page.",
  outputSpec: [
    "A plain-language reading of the selected passage.",
    "The jargon, references or implied context it relies on.",
    "How it relates to the rest of the page.",
    "Whether it is accurate, with a link to a check.",
  ],
};

const BY_PAGE_TYPE: Record<PageType, CatalogEntry[]> = {
  article: ARTICLE_ACTIONS,
  product: PRODUCT_ACTIONS,
  generic: GENERIC_ACTIONS,
};

function withPageType(entry: CatalogEntry, pageType: PageType): SuggestedAction {
  return { ...entry, pageType };
}

/** Ranked catalog for a page type, best-first. */
export function curatedActionsFor(
  pageType: PageType,
  options: { hasSelectedText?: boolean } = {},
): SuggestedAction[] {
  const entries = [...BY_PAGE_TYPE[pageType]];
  if (options.hasSelectedText) {
    entries.push(SELECTED_TEXT_ACTION);
  }
  return entries.map((entry) => withPageType(entry, pageType));
}

export const CURATED_CATALOG_IDS: readonly string[] = [
  ...ARTICLE_ACTIONS,
  ...PRODUCT_ACTIONS,
  ...GENERIC_ACTIONS,
  SELECTED_TEXT_ACTION,
].map((entry) => entry.id);
