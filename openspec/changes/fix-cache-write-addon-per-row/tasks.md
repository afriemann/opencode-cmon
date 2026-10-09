# Tasks

## 1. Pricing rule

- [x] 1.1 Add failing `pricing.test.ts` cases for each new scenario (non-zero catalog price with lacking cost applies; included cost gives 0; midpoint boundary; unknown output/reasoning and missing output price fall back; tiered output price), verify they fail
- [x] 1.2 Add `CostTier.output`, parse it in `parseTier`, and apply the per-row rule with fallback in `rowAddOn`/`cacheWriteExtraMicros`; verify `pricing.test.ts` passes

## 2. Data flow

- [x] 2.1 Add failing `store.test.ts` case that `summaryInputs` candidates carry `costMicros`, `outputTokens`, `reasoningTokens`; extend `Candidate` and the query; verify it passes
- [x] 2.2 Add failing `summary.test.ts` and `analysis.test.ts` cases (corrected figure 110,000; sidebar and report agree); verify both go through `rowAddOn` and pass

## 3. Wrap-up

- [x] 3.1 Run `bun run test`, `bun run lint`, `bun run build`; verify all pass
- [x] 3.2 Check README for the add-on rule and update if it describes the catalog-price condition
