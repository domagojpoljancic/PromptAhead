/**
 * Curated action catalog (handoff §13), expanded into the task + output shape
 * the prompt builder needs.
 *
 * Order is the deterministic ranking: the first three of each list are the
 * curated primary suggestions, the rest sit behind "More…". The pool is
 * deliberately deep — on-device AI ranks it per page (DOM-66/67), so breadth
 * here is what makes ranked suggestions feel page-aware. This is data, not
 * logic: adding a direction means adding an entry.
 */

import type { ComparableItemKind, PageType } from "../../shared/types/page-context";
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
  {
    id: "article.numbers",
    title: "Check the numbers and statistics",
    description: "Verify the figures, their sources and whether they are used fairly.",
    category: "critique",
    outputFormat: "other",
    task: "Check every number, statistic and chart claim on this page: find the original figures, verify them, and flag misleading framing such as cherry-picked baselines or missing denominators.",
    outputSpec: [
      "A table: figure as stated, original source, verified value, verdict.",
      "Any statistic that is misleading even if technically correct, and why.",
      "The base rates or denominators the page omits.",
      "Figures you could not verify at all.",
    ],
  },
  {
    id: "article.who-benefits",
    title: "Follow the incentives",
    description: "Work out who gains, who pays, and who is funding the argument.",
    category: "perspectives",
    outputFormat: "structured_explanation",
    task: "Analyse the incentives around this story: who benefits from the outcome described, who bears the cost, and what funding, ownership or lobbying interests shape how it is presented.",
    outputSpec: [
      "The main parties, each with their stake and likely motivation.",
      "Funding, ownership or political ties relevant to the framing, with links.",
      "Who pays if the described outcome happens.",
      "Which claims should be discounted given these incentives.",
    ],
  },
  {
    id: "article.expert-take",
    title: "Find what domain experts say",
    description: "Look past the coverage to what specialists in the field conclude.",
    category: "perspectives",
    outputFormat: "source_map",
    task: "Find what recognised experts in this specific field say about the topic on this page, and where their view differs from the general press coverage.",
    outputSpec: [
      "Four to six named experts or institutions, with credentials and links.",
      "Each expert's position in one or two lines.",
      "Where expert consensus differs from the page's framing.",
      "Which questions the experts consider still open.",
    ],
  },
  {
    id: "article.bias",
    title: "Assess this source's reliability",
    description: "Judge the outlet's track record, slant and editorial standards.",
    category: "critique",
    outputFormat: "structured_explanation",
    task: "Assess the reliability of the publication behind this page: ownership, editorial standards, known slant, correction history, and how it has covered this topic before.",
    outputSpec: [
      "Ownership, funding and editorial stance, with sources.",
      "Track record on accuracy and corrections.",
      "Language on this page that signals slant, quoted.",
      "How much weight to give this page, and what to cross-check.",
    ],
  },
  {
    id: "article.what-next",
    title: "Map what happens next",
    description: "Lay out the realistic scenarios, triggers and things to watch.",
    category: "developments",
    outputFormat: "decision_brief",
    task: "Map the realistic scenarios for how this situation develops from here, with the triggers that would make each more likely and the signals worth watching.",
    outputSpec: [
      "Three to four scenarios with rough likelihood and reasoning.",
      "The concrete trigger or decision point behind each.",
      "Leading indicators I could watch to tell them apart.",
      "The dates or milestones already on the calendar.",
    ],
  },
  {
    id: "article.impact-on-me",
    title: "Explain what this means for me",
    description: "Translate the story into practical consequences for your situation.",
    category: "next-steps",
    outputFormat: "decision_brief",
    task: "Translate this story into practical consequences for an ordinary person. Ask me for my situation if it matters, then explain what changes, when, and what I should do about it.",
    outputSpec: [
      "What actually changes in practice, and for whom.",
      "The timeline on which it would affect me.",
      "Concrete actions worth taking, ranked by value.",
      "What I can safely ignore, and why.",
    ],
  },
  {
    id: "article.key-people",
    title: "Profile the key people and organisations",
    description: "Who the named actors are, their history and their track record.",
    category: "context",
    outputFormat: "structured_explanation",
    task: "Profile the people and organisations named on this page: their role, background, track record on this issue, and their relationships to each other.",
    outputSpec: [
      "One short profile per key actor, with a link.",
      "Their prior involvement with this topic.",
      "How the actors are connected to each other.",
      "Anything in their record that changes how to read their claims.",
    ],
  },
  {
    id: "article.precedents",
    title: "Find historical precedents",
    description: "Compare with past cases and what actually happened after them.",
    category: "comparison",
    outputFormat: "comparison",
    task: "Find historical precedents comparable to the situation on this page, and explain what happened in each case and how well the analogy holds.",
    outputSpec: [
      "Three to five precedents with dates, places and links.",
      "The outcome of each, briefly.",
      "Where the analogy holds and where it breaks down.",
      "What the pattern suggests about this case.",
    ],
  },
  {
    id: "article.data",
    title: "Find the underlying data",
    description: "Locate the datasets, filings or studies behind the story.",
    category: "sources",
    outputFormat: "source_map",
    task: "Find the datasets, official statistics, filings or studies that underlie this story, and point me at the ones I can inspect myself.",
    outputSpec: [
      "Datasets and reports with direct links and publishers.",
      "What each one measures, and its known limitations.",
      "How to read or query the important ones.",
      "Gaps where no public data exists.",
    ],
  },
  {
    id: "article.legal",
    title: "Explain the legal or regulatory angle",
    description: "The rules, obligations and enforcement behind the story.",
    category: "context",
    outputFormat: "structured_explanation",
    task: "Explain the legal or regulatory framework behind this story: which rules apply, what obligations they create, who enforces them, and what the realistic penalties or timelines are. Do not give legal advice.",
    outputSpec: [
      "The applicable laws, rules or cases, with links.",
      "The obligations they create and on whom.",
      "Enforcement bodies, penalties and typical timelines.",
      "Where interpretation is genuinely unsettled.",
    ],
  },
  {
    id: "article.market-impact",
    title: "Analyse the market impact",
    description: "Which companies, sectors and jobs win or lose from this.",
    category: "developments",
    outputFormat: "comparison",
    task: "Analyse the commercial impact of what this page describes: which companies, sectors, supply chains and roles are advantaged or disadvantaged, and over what horizon. This is analysis, not investment advice.",
    outputSpec: [
      "A table: party, exposure, direction of impact, reasoning.",
      "Short-term versus multi-year effects.",
      "Second-order effects the page does not mention.",
      "The evidence behind each call, with links.",
    ],
  },
  {
    id: "article.verify",
    title: "Check whether this is true",
    description: "Fact-check the story against reporting, records and known hoaxes.",
    category: "critique",
    outputFormat: "other",
    task: "Fact-check this page: confirm whether the central story is accurate, whether it has been corrected, disputed or debunked elsewhere, and whether any part resembles a known hoax or recycled claim.",
    outputSpec: [
      "A verdict on the central claim with confidence level.",
      "Confirming and contradicting reports, with links and dates.",
      "Any corrections, retractions or fact-checks already published.",
      "What would need to be true for the story to hold.",
    ],
  },
  {
    id: "article.reading-path",
    title: "Build a reading path on this topic",
    description: "An ordered set of sources from foundations to the current edge.",
    category: "sources",
    outputFormat: "source_map",
    task: "Build an ordered reading path on this topic, from the foundational pieces to the current state of the debate, so I can go from newcomer to well-informed.",
    outputSpec: [
      "An ordered list of six to ten sources with links.",
      "Why each one earns its place, in one line.",
      "Roughly how long each takes to read or watch.",
      "The one piece to read if I only read one.",
    ],
  },
  {
    id: "article.brief",
    title: "Turn this into a short brief",
    description: "A tight summary you could send to a colleague or your future self.",
    category: "next-steps",
    outputFormat: "decision_brief",
    task: "Turn this page into a short brief I could send to a colleague: what happened, why it matters, what is uncertain, and what to do or watch next.",
    outputSpec: [
      "A three-sentence summary at the top.",
      "Key facts as bullets, each with a source.",
      "What is contested or unknown.",
      "Recommended next action or watch item.",
    ],
  },
  {
    id: "article.questions",
    title: "Ask the sharpest follow-up questions",
    description: "The questions a good editor would ask — then the best answer.",
    category: "custom",
    outputFormat: "other",
    task: "Propose the sharpest follow-up questions a skeptical editor would ask about this page, rank them by how much they would change my understanding, then answer the top one in full.",
    outputSpec: [
      "Five ranked questions, each with why it matters.",
      "A full, sourced answer to the top question.",
      "What information would be needed to answer the rest.",
      "A clear split of fact, inference and speculation.",
    ],
  },
];

const PRODUCT_ACTIONS: CatalogEntry[] = [
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
    id: "product.reviews",
    title: "Summarise independent reviews",
    description: "What testers and long-term owners actually concluded.",
    category: "sources",
    outputFormat: "source_map",
    task: "Summarise what independent reviewers and long-term owners conclude about this product, separating measured testing from impressions and sponsored content.",
    outputSpec: [
      "Five to eight reviews with links, dates and verdicts.",
      "Points where reviewers agree, and where they split.",
      "Measured results versus subjective impressions.",
      "Which reviews look sponsored or unreliable.",
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
  {
    id: "product.specs-decoded",
    title: "Translate the specs into plain benefits",
    description: "What each number means in daily use — and which ones are padding.",
    category: "level",
    outputFormat: "structured_explanation",
    task: "Translate this product's specifications into plain-language consequences for everyday use, and point out which numbers are marketing padding.",
    outputSpec: [
      "Each significant spec with what it means in practice.",
      "The specs that genuinely differentiate this product.",
      "Numbers that sound impressive but change nothing.",
      "The specs the listing conspicuously omits.",
    ],
  },
  {
    id: "product.use-case-fit",
    title: "Check it does what I need",
    description: "Test the product against your actual use case, not the marketing.",
    category: "compatibility",
    outputFormat: "decision_brief",
    task: "Assess whether this product suits my actual use case. Ask me what I intend to use it for, then judge fit against evidence rather than marketing claims.",
    outputSpec: [
      "The questions you need answered about my use case.",
      "A fit verdict per requirement, with evidence.",
      "Where this product is overkill or underpowered for me.",
      "A better-suited option if one exists.",
    ],
  },
  {
    id: "product.right-variant",
    title: "Pick the right size or configuration",
    description: "Choose between variants without overpaying for the wrong one.",
    category: "selection",
    outputFormat: "decision_brief",
    task: "Compare the available variants, sizes or configurations of this product and recommend which one I should buy, with the reasoning behind it.",
    outputSpec: [
      "A table of variants with price and the real differences.",
      "Which upgrades are worth paying for and which are not.",
      "The variant most buyers should choose, and the exception cases.",
      "What to check about my needs before deciding.",
    ],
  },
  {
    id: "product.deal-timing",
    title: "Check whether now is a good time to buy",
    description: "Price history, sale cycles and whether a new model is coming.",
    category: "price",
    outputFormat: "decision_brief",
    task: "Tell me whether now is a good time to buy this product: recent price history, typical sale periods, and any sign that a replacement model is imminent.",
    outputSpec: [
      "Price trend over the last year, with sources.",
      "The sale events where this typically drops.",
      "Evidence about an upcoming successor or refresh.",
      "A buy-now or wait recommendation with the trigger to watch.",
    ],
  },
  {
    id: "product.longevity",
    title: "Estimate how long it will last",
    description: "Durability, wear points and what owners report after years.",
    category: "weaknesses",
    outputFormat: "structured_explanation",
    task: "Estimate the realistic lifespan of this product: typical failure points, what wears out first, and what long-term owners report after several years of use.",
    outputSpec: [
      "Expected lifespan with the evidence behind the estimate.",
      "The parts that fail first and roughly when.",
      "Maintenance that meaningfully extends life.",
      "Long-term owner reports, linked.",
    ],
  },
  {
    id: "product.warranty-repair",
    title: "Check warranty, support and repairability",
    description: "What happens when it breaks: cover, cost, parts and service.",
    category: "cost",
    outputFormat: "structured_explanation",
    task: "Explain what happens if this product breaks: warranty terms and exclusions, the maker's support reputation, spare-part availability, repair cost, and repairability scores.",
    outputSpec: [
      "Warranty length, cover and notable exclusions.",
      "Reported support quality, with sources.",
      "Spare parts and typical out-of-warranty repair cost.",
      "Repairability rating or teardown evidence, linked.",
    ],
  },
  {
    id: "product.lock-in",
    title: "Reveal subscriptions and lock-in",
    description: "Ongoing fees, proprietary parts and how hard it is to leave.",
    category: "cost",
    outputFormat: "other",
    task: "Identify any subscriptions, account requirements, proprietary consumables or ecosystem lock-in tied to this product, and how hard it is to switch away later.",
    outputSpec: [
      "Every recurring fee or account requirement, with prices.",
      "Which features stop working without a subscription.",
      "Proprietary parts or consumables and their cost.",
      "The realistic cost and effort of switching later.",
    ],
  },
  {
    id: "product.secondhand",
    title: "Consider used or refurbished instead",
    description: "Where to buy it second-hand, at what price, and what to inspect.",
    category: "price",
    outputFormat: "decision_brief",
    task: "Assess buying this product used or refurbished: typical prices, trustworthy sources, what to inspect, and when buying new is the better call.",
    outputSpec: [
      "Typical used and refurbished prices, with marketplaces linked.",
      "An inspection checklist for this specific product.",
      "Warranty differences between new, refurbished and used.",
      "When buying new is worth the premium.",
    ],
  },
  {
    id: "product.safety",
    title: "Check safety, recalls and certifications",
    description: "Look for recalls, incidents and the certifications that matter.",
    category: "weaknesses",
    outputFormat: "other",
    task: "Check this product and its maker for safety recalls, reported incidents, regulatory actions, and the certifications that are relevant for this category.",
    outputSpec: [
      "Any recalls or safety notices, with dates and links.",
      "Reported incidents or complaints to regulators.",
      "Certifications this category should have, and whether it has them.",
      "Practical safety guidance for using it.",
    ],
  },
  {
    id: "product.counterfeit",
    title: "Avoid fakes and grey imports",
    description: "Tell genuine listings from counterfeits, and check the seller.",
    category: "critique",
    outputFormat: "other",
    task: "Explain how to tell a genuine version of this product from counterfeits or grey imports, and assess how trustworthy the listing above looks.",
    outputSpec: [
      "The tells that distinguish genuine units from fakes.",
      "Red flags in this listing or seller, quoted.",
      "How to verify authenticity after delivery.",
      "Warranty consequences of grey imports.",
    ],
  },
  {
    id: "product.accessories",
    title: "Find the accessories worth buying",
    description: "The add-ons that matter, and the ones to skip entirely.",
    category: "next-steps",
    outputFormat: "comparison",
    task: "Recommend which accessories or add-ons are genuinely worth buying with this product, which can wait, and which are a waste of money.",
    outputSpec: [
      "Must-have accessories with prices and links.",
      "Nice-to-have items and when they pay off.",
      "Add-ons to skip, with the reason.",
      "Third-party options that beat the official ones.",
    ],
  },
  {
    id: "product.setup",
    title: "Plan setup and the first week",
    description: "Unboxing to configured: steps, settings and early mistakes.",
    category: "next-steps",
    outputFormat: "other",
    task: "Give me a practical setup and first-week plan for this product: what to check on arrival, how to configure it well, and the mistakes new owners commonly make.",
    outputSpec: [
      "An arrival checklist to catch defects inside the return window.",
      "Setup steps in order, with the settings that matter.",
      "Common beginner mistakes and how to avoid them.",
      "What to test before the return period ends.",
    ],
  },
  {
    id: "product.resale",
    title: "Estimate resale value",
    description: "How well it holds value and when to sell it on.",
    category: "cost",
    outputFormat: "structured_explanation",
    task: "Estimate how well this product holds its value: typical resale prices after one, two and three years, what drives depreciation in this category, and the best time to sell.",
    outputSpec: [
      "Estimated resale value at one, two and three years, with sources.",
      "How that compares with the main alternatives.",
      "What preserves value (packaging, condition, timing).",
      "Where this category sells best second-hand.",
    ],
  },
  {
    id: "product.eco",
    title: "Assess the environmental and ethical footprint",
    description: "Materials, energy, repair policy and supply-chain record.",
    category: "critique",
    outputFormat: "structured_explanation",
    task: "Assess the environmental and ethical footprint of this product and its maker: materials, energy use, repairability, end-of-life options, and supply-chain record.",
    outputSpec: [
      "Energy or resource use compared with alternatives.",
      "Repair, recycling and take-back options.",
      "Supply-chain or labour findings, with sources.",
      "Whether green claims by the maker hold up.",
    ],
  },
  {
    id: "product.seller-questions",
    title: "Draft the questions to ask before buying",
    description: "Exactly what to ask the seller so nothing surprises you later.",
    category: "next-steps",
    outputFormat: "other",
    task: "Draft the specific questions I should ask this seller or retailer before buying, based on what the listing leaves ambiguous.",
    outputSpec: [
      "Ranked questions, each with why it matters.",
      "The answer that should make me walk away.",
      "Details to get in writing (warranty, returns, condition).",
      "What to verify independently rather than ask.",
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
    id: "generic.how-it-works",
    title: "Explain how it actually works",
    description: "The mechanism underneath, step by step, without hand-waving.",
    category: "level",
    outputFormat: "structured_explanation",
    task: "Explain the mechanism behind what this page describes, step by step, including the parts most explanations skip.",
    outputSpec: [
      "A step-by-step walkthrough of the mechanism.",
      "An analogy that holds up, plus where it breaks.",
      "The parts commonly misunderstood or glossed over.",
      "A worked example end to end.",
    ],
  },
  {
    id: "generic.decide",
    title: "Help me decide",
    description: "A decision brief with criteria, options and a clear recommendation.",
    category: "selection",
    outputFormat: "decision_brief",
    task: "Help me make the decision this page is about. Ask for my constraints, then give criteria, realistic options, trade-offs and a recommendation.",
    outputSpec: [
      "The questions you need answered to advise well.",
      "Decision criteria ranked by importance.",
      "Options scored against those criteria.",
      "A recommendation with its conditions and risks.",
    ],
  },
  {
    id: "generic.tradeoffs",
    title: "Map the trade-offs",
    description: "What you gain and lose with each realistic option here.",
    category: "tradeoffs",
    outputFormat: "comparison",
    task: "Map the trade-offs involved in what this page describes: what each realistic choice gains, what it costs, and which constraints decide the answer.",
    outputSpec: [
      "A table of options with gains and costs.",
      "The constraint that most often decides it.",
      "Where a common assumption is wrong.",
      "The best default choice absent other information.",
    ],
  },
  {
    id: "generic.risks",
    title: "Identify the risks and failure modes",
    description: "What typically goes wrong here, and how to catch it early.",
    category: "weaknesses",
    outputFormat: "other",
    task: "Identify the realistic risks and failure modes around what this page describes, how likely each is, and how to detect or prevent them early.",
    outputSpec: [
      "Risks ranked by likelihood and impact.",
      "The early warning signs of each.",
      "Practical mitigations, with effort noted.",
      "Which risks are overstated in popular discussion.",
    ],
  },
  {
    id: "generic.examples",
    title: "Find concrete examples and case studies",
    description: "Real-world cases that show how this plays out in practice.",
    category: "sources",
    outputFormat: "source_map",
    task: "Find concrete real-world examples or case studies of what this page describes, including at least one that went badly.",
    outputSpec: [
      "Four to six examples with context and links.",
      "What was done and what resulted in each.",
      "At least one failure case and its lesson.",
      "What the examples have in common.",
    ],
  },
  {
    id: "generic.cost",
    title: "Work out what this costs",
    description: "Money, time and effort — including the parts people forget.",
    category: "cost",
    outputFormat: "structured_explanation",
    task: "Work out the realistic cost of what this page describes, in money, time and effort, including the hidden or recurring costs people forget.",
    outputSpec: [
      "An itemised cost breakdown with sources or ranges.",
      "Time and effort as well as money.",
      "Hidden or recurring costs.",
      "The cheapest credible way to achieve the same result.",
    ],
  },
  {
    id: "generic.timeline",
    title: "Show how this developed over time",
    description: "The history behind the current state, with dated milestones.",
    category: "timeline",
    outputFormat: "timeline",
    task: "Build a dated timeline showing how the topic on this page developed into its current state.",
    outputSpec: [
      "Dated milestones in order, each with a source.",
      "Why each milestone mattered.",
      "The turning points that shaped today's situation.",
      "What is expected or scheduled next.",
    ],
  },
  {
    id: "generic.beginner-path",
    title: "Build a learning path from zero",
    description: "An ordered plan to get competent, with time estimates.",
    category: "level",
    outputFormat: "other",
    task: "Build a learning path that takes me from no knowledge to competent on this topic, with ordered resources and rough time estimates.",
    outputSpec: [
      "Stages from beginner to competent, in order.",
      "One or two resources per stage, linked.",
      "Rough time investment per stage.",
      "How to tell I am ready for the next stage.",
    ],
  },
  {
    id: "generic.criteria",
    title: "Define how to evaluate options",
    description: "The criteria an expert would use — and the traps to avoid.",
    category: "selection",
    outputFormat: "other",
    task: "Define the criteria an experienced person would use to evaluate options in this area, including the ones beginners overlook and the marketing traps to ignore.",
    outputSpec: [
      "Criteria ranked by how much they matter.",
      "How to check each one in practice.",
      "Criteria that look important but are not.",
      "A short scoring sheet I can reuse.",
    ],
  },
  {
    id: "generic.apply",
    title: "Apply this to my situation",
    description: "Translate the page into advice for your actual circumstances.",
    category: "next-steps",
    outputFormat: "decision_brief",
    task: "Apply what this page describes to my specific situation. Ask me the questions you need answered, then give tailored guidance rather than general advice.",
    outputSpec: [
      "The questions you need answered first.",
      "Tailored guidance once I answer, not generic advice.",
      "What changes about the page's advice in my case.",
      "The first concrete step to take.",
    ],
  },
  {
    id: "generic.terminology",
    title: "Build a glossary of the key terms",
    description: "Plain definitions of the vocabulary this topic assumes.",
    category: "context",
    outputFormat: "structured_explanation",
    task: "Build a glossary of the important terms, acronyms and jargon around this topic, with plain definitions and the distinctions that actually matter.",
    outputSpec: [
      "Each term with a one-line plain definition.",
      "Terms commonly confused with each other, distinguished.",
      "Which terms are marketing labels rather than real categories.",
      "The handful of terms worth memorising first.",
    ],
  },
  {
    id: "generic.who-to-follow",
    title: "Find who to follow on this topic",
    description: "Credible people, publications and communities worth tracking.",
    category: "sources",
    outputFormat: "source_map",
    task: "Find the credible people, publications and communities worth following on this topic, and note the bias or angle of each.",
    outputSpec: [
      "Named people and outlets with links.",
      "Why each is worth following, in a line.",
      "The perspective or bias each brings.",
      "Where the useful ongoing discussion happens.",
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
const SELECTED_TEXT_ACTIONS: CatalogEntry[] = [
  {
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
  },
  {
    id: "any.selection-verify",
    title: "Fact-check the text I selected",
    description: "Verify the selected claim against independent evidence.",
    category: "critique",
    outputFormat: "other",
    task: "Fact-check the passage quoted as SELECTED_TEXT in the source data: verify each claim it makes against independent evidence and state a verdict.",
    outputSpec: [
      "Each claim in the selection with a verdict and confidence.",
      "Supporting and contradicting sources, linked.",
      "Any missing context that changes the meaning.",
      "What remains unverifiable.",
    ],
  },
  {
    id: "any.selection-sources",
    title: "Find sources for the text I selected",
    description: "Track the selected claim back to who first reported or published it.",
    category: "sources",
    outputFormat: "source_map",
    task: "Trace the passage quoted as SELECTED_TEXT in the source data back to its origin: who first said or published it, in what context, and how it has been repeated since.",
    outputSpec: [
      "The original source, with a link and date.",
      "The context it was originally said or written in.",
      "How the claim changed as it was repeated.",
      "Stronger or more current sources for the same point.",
    ],
  },
];

const BY_PAGE_TYPE: Record<PageType, CatalogEntry[]> = {
  article: ARTICLE_ACTIONS,
  product: PRODUCT_ACTIONS,
  generic: GENERIC_ACTIONS,
};

function withPageType(entry: CatalogEntry, pageType: PageType): SuggestedAction {
  return { ...entry, pageType };
}

const KIND_NOUN: Record<ComparableItemKind, { singular: string; plural: string }> = {
  product: { singular: "product", plural: "products" },
  article: { singular: "article", plural: "articles" },
  item: { singular: "item", plural: "items" },
};

/** Ids that are weak or redundant when a named comparable set is present. */
const SKIP_WHEN_COMPARABLE = new Set(["generic.understand", "generic.compare"]);

function joinNames(names: readonly string[]): string {
  if (names.length === 1) {
    return names[0]!;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function clampDescription(text: string, max = 90): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Dynamic “compare these N …” action for a small named set (DOM-64). */
export function compareTheseAction(
  pageType: PageType,
  comparable: { kind: ComparableItemKind; names: readonly string[] },
): SuggestedAction {
  const count = comparable.names.length;
  const noun = KIND_NOUN[comparable.kind];
  const label = count === 1 ? noun.singular : noun.plural;
  const listed = joinNames(comparable.names);
  return withPageType(
    {
      id: "generic.compare-these",
      title: `Compare these ${count} ${label}`,
      description: clampDescription(`Side-by-side on the dimensions that matter: ${listed}.`),
      category: "alternatives",
      outputFormat: "comparison",
      task: `Compare these ${count} ${label} from the page — ${listed} — on the specifications, trade-offs, price and real-world fit that actually differ. Stay focused on the named items; do not expand into a broad market survey unless asked.`,
      outputSpec: [
        `A comparison table covering all ${count} named ${label}.`,
        "The criteria you compared on, and why those matter for this choice.",
        "Clear winners per criterion where the data supports it.",
        "Who each option suits best, with a concise recommendation.",
      ],
    },
    pageType,
  );
}

/**
 * Full ranked pool for a page type, best-first.
 *
 * This is the deterministic ranking *and* the candidate pool Nano ranks over,
 * so it deliberately returns everything relevant. UI layers cap what they show.
 */
export function curatedActionsFor(
  pageType: PageType,
  options: {
    hasSelectedText?: boolean;
    comparableSet?: { kind: ComparableItemKind; names: readonly string[] };
  } = {},
): SuggestedAction[] {
  let entries = [...BY_PAGE_TYPE[pageType]];
  if (options.comparableSet && options.comparableSet.names.length >= 2) {
    entries = entries.filter((entry) => !SKIP_WHEN_COMPARABLE.has(entry.id));
  }
  if (options.hasSelectedText) {
    // The user pointed at that text on purpose, so the plain "explain it"
    // direction leads; the deeper selection work stays in the ranked tail.
    const [lead, ...rest] = SELECTED_TEXT_ACTIONS;
    entries = [lead!, ...entries, ...rest];
  }
  const actions = entries.map((entry) => withPageType(entry, pageType));
  if (options.comparableSet && options.comparableSet.names.length >= 2) {
    return [compareTheseAction(pageType, options.comparableSet), ...actions];
  }
  return actions;
}

export const CURATED_CATALOG_IDS: readonly string[] = [
  ...ARTICLE_ACTIONS,
  ...PRODUCT_ACTIONS,
  ...GENERIC_ACTIONS,
  ...SELECTED_TEXT_ACTIONS,
]
  .map((entry) => entry.id)
  .concat("generic.compare-these");
