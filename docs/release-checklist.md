# Release checklist (Chrome Web Store dry run)

**Status:** Internal checklist (DOM-44)  
**Product version in repo:** `0.1.0` (`extension/manifest.config.ts`) — bump before a real store push  
**Privacy disclosure:** [`chrome-web-store-privacy.md`](./chrome-web-store-privacy.md)  
**§25 acceptance + rubric:** [`acceptance-map-m4.md`](./acceptance-map-m4.md) (DOM-45)

Use this for a **submission dry run**. Tick boxes only when verified on the **built** unpacked (or zipped) package you intend to upload.

## 0. Scope gate

Confirm the cut matches M4 exit intent ([`implementation-plan.md`](./implementation-plan.md)):

- [ ] No half-finished features advertised as Done in README / listing
- [ ] WIP banner accurate (or removed only when packaging is truly store-ready)
- [ ] Unrelated scope (full history UI, developer export, Nano latency spikes) not blocking if still Backlog — either ship or omit from listing claims

## 1. Build & package

```bash
npm ci
npm run test:ci
npm run build
```

- [ ] `npm run test:ci` green (typecheck, lint, Vitest+coverage, Playwright)
- [ ] `extension/dist/` loads as unpacked on `chrome://extensions` (Developer mode)
- [ ] Zip for CWS is **`extension/dist/`** contents (not repo root / not `src/`)
- [ ] Manifest version bumped if this is not still `0.1.0` WIP
- [ ] No secrets in package (`.env`, tokens, private keys)

## 2. Privacy & permissions

- [ ] [`chrome-web-store-privacy.md`](./chrome-web-store-privacy.md) matches Dashboard answers
- [ ] [`privacy-threat-model.md`](./privacy-threat-model.md) §8 still consistent
- [ ] Required permissions = sidePanel, activeTab, scripting, storage, contextMenus only
- [ ] `<all_urls>` is **optional** host permission only; Manual works without it
- [ ] Listing privacy text matches “no PromptAhead backend / analytics”

## 3. Automated gates (already in CI)

- [ ] Vitest coverage gates (domain + messaging)
- [ ] Playwright: MV3 load, navigate→stale, Nano-off curated, Smart invite/pause/revoke, homepage empty, axe a11y, sensitive Manual override
- [ ] No live LLM / live Nano calls in CI

## 4. Manual release smoke (keep tiny)

From [`test-plan.md`](./test-plan.md) §4 / §12 — **real Chrome**, not Playwright:

- [ ] Toolbar / context menu / `Alt+Shift+P` extracts active page (Manual `activeTab`)
- [ ] After navigate, Refresh / stale UX; re-invoke extension for new page
- [ ] Copy prompt; OS paste check once
- [ ] One live provider **Open in …** — deep link or clipboard; **nothing auto-submitted**; panel stays open
- [ ] Network tab: no PromptAhead analytics / backend calls during Manual happy path
- [ ] Smart (optional): grant → badge invite path once; revoke → Manual still works
- [ ] Sensitive page: Manual override modal appears; decline does not extract
- [ ] Onboarding: Skip / basic private mode still reachable; Nano check loading or skip OK

Optional depth (not blocking dry run): [`nano-verification-checklist.md`](./nano-verification-checklist.md) on hardware with Nano.

## 5. Fixtures / safety claims

- [ ] Injection fixtures still green in CI (SOURCE_DATA sealed)
- [ ] Sensitive fixture matrix covered (Vitest / Playwright as shipped)
- [ ] Do not claim “blocks all sensitive sites forever” — override exists for Manual

## 6. Store assets & listing copy

- [ ] Icons 16 / 48 / 128 present and crisp
- [ ] Screenshots: Manual happy path + Settings (Smart education / revoke) + privacy-honest caption
- [ ] Short description ≤132 chars; detailed description matches README product language (not internal DOM-IDs)
- [ ] Category / language accurate
- [ ] Support / privacy URL: point at repo docs or published privacy page when available

### Suggested short description

> Build editable AI prompts from the page you’re on — local-first, Manual by default, optional on-device Nano.

## 7. Post-upload / post-publish

- [ ] Install from CWS (or pending review build) and re-run §4 smoke once
- [ ] Tag git release matching manifest version
- [ ] Note Chrome version tested in release notes / Linear comment

## 8. Explicitly out of scope for this checklist

- GitHub Wiki (DOM-46)
- Full local history UI (DOM-41) / developer eval export (DOM-42) unless those shipped
- Nano latency optimization (DOM-66) — do not block store dry run on ~61s hardware suggest
- Strong-reasoning gap review (DOM-65)

## Related

| Doc / issue | Role |
| --- | --- |
| [`chrome-web-store-privacy.md`](./chrome-web-store-privacy.md) | Privacy practices answers |
| [`test-plan.md`](./test-plan.md) | Automated + manual map |
| [`perf-notes.md`](./perf-notes.md) | M4 perf spot-check |
| [DOM-45](https://linear.app/domagojp/issue/DOM-45) | Full §25 map + eval rubric dry run |
| [DOM-12](https://linear.app/domagojp/issue/DOM-12) | Historical Manual-only §25 map |
