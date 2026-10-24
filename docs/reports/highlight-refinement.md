# Menu highlight refinement

Ran a bounded loop on October 3, 2026 using Groq GPT-OSS 120B and saved menus for October 2 and September 30. Prompt version 5 is implemented locally, with up to five items per meal, no minimum, shared selection rules, and hall station guides. Production and the previously published snapshot page were not changed.

## Measured results

The original six-hall October 2 snapshot passed 12 of 24 provisional priority checks and included four clearly labeled non-mains. The final six-hall pass reached 21 of 24 with zero labeled non-mains. The final three-hall problem subset reached 14 of 15, compared with 7 of 15 originally. Ranking still varies among legitimate mains. See [the actual picks and remaining misses](highlight-selections.md).

| Experiment | Provisional priority checks | Labeled non-mains | Failed hall requests |
| --- | ---: | ---: | ---: |
| Saved original, six halls | 12/24 | 4 | 0 |
| Define mains and raise maximum to five, three halls | 11/15 | 0 | 0 |
| Add ranking, three halls | 14/15 | 0 | 0 |
| Add station guides, six halls | 19/22 | 0 | 1 |
| Medium reasoning, two halls | No valid selections | 0 | 2 |
| Compact IDs restarting per meal, McConnell | 5/6 | 0 | 0 |
| Add bar/component preference, six halls | 23/24 | 1 | 0 |
| Retry medium reasoning, McConnell | No valid selections | 0 | 1 |
| Explicit candidate output experiment, McConnell | 4/6 | 1 | 0 |
| Final: IDs unique across hall-day, six halls | 21/24 | 0 | 0 |
| Final: second-date check, three halls | 11/11 | 0 | 1 |
| Final: Malott retry | 4/5 | 0 | 0 |
| Final: McConnell repeat | 5/6 | 0 | 0 |

Labels were selected by the assistant from actual menu contents and are not user-approved ground truth. Alternatives are allowed in several checks. Non-main labels include the four initial side dishes and the saved McConnell dessert stations. Dessert annotations were expanded when the transient compact-ID experiment exposed cookie selections; the table above rescored every round using the same current labels. This is a focused regression evaluation, not a general accuracy percentage or full main-dish recall measurement. September 30 is a second date, not a blind holdout; reviewers saw both snapshots.

## What changed

- Survey all stations before ranking. Distinguish composed entrees, proteins and meal bars from grains, vegetables, sauces, headings and desserts.
- Prefer specific composed dishes over generic staples. Variety is a tie-breaker; featured status does not establish a main. Keep credible substantial plant entrees and allow empty meals.
- Use short, hall-day-unique inference IDs and resolve them back to unchanged public positional IDs. Restarting numbers per meal introduced ambiguity and allowed dinner protein IDs to resolve to lunch cookies; that failed experiment was corrected. Regression tests now reject cross-meal aliases.
- Require every meal in the strict schema, request at most five selections, and retain server validation of count, uniqueness and membership. Hash the actual hall prompt and bump the prompt version so prior cached results are invalidated.

The compact ID change reduced observed McConnell input by about 1,000 tokens. The final October 2 six-hall pass used 24,978 tokens. All live experiments made 34 outbound attempts and reported 135,642 tokens in responses that included usage, including responses later rejected by validation. 5 attempts failed. HTTP errors did not report usage, so this observed total is not a complete billing total. Requests were spaced by at least 65 seconds and the local evaluation cap was 34 attempts. The production scheduler retains its independent 21-attempt daily ceiling.

Medium reasoning produced HTTP 413 and HTTP 400 errors. A later compact-input retry returned json_validate_failed. There is no usable quality comparison supporting medium reasoning, so the generator stays on low. An explicit candidate-ID output stage also failed to improve selection and was not retained.

The final second-date Malott response initially contained a lunch ID under dinner. Validation rejected the entire response. The evaluation retried it as a separate recorded call, matching the production design's bounded retry behavior; no invalid selections were stored as ready. Structural validation and retries remain necessary. Native structured output provides the response contract, but it does not determine whether a dish is a main. [Groq structured-output documentation](https://console.groq.com/docs/structured-outputs)

## Verification and reviews

117 automated tests, TypeScript checks, the local Workers runtime test with real alarm delivery, and the Wrangler dry-run build passed. The public response shape and highlights=false opt-out remain the same. Original menu names and dietary labels are still resolved from source items. No production deployment or snapshot-page publication occurred.

[OpenCode Go review opinions](highlight-model-reviews.md) came from Kimi K2.7 Code, MiniMax M2.7 and GLM-5.3. DeepSeek V4.1 could not run under the workspace region setting. Their suggestions were hypotheses, not votes or verified labels.

## Reproduce the evaluation

The fixtures and scorer in this checkout reproduce the original failures without inference:

```sh
rtk proxy npm run highlights:eval -- baseline 2026-10-02 hoch,malott,mcconnell,collins,frank,frary
```

Baseline deliberately exits nonzero when it catches missing priorities or labeled non-mains. To test the current generator:

```sh
rtk proxy npm run highlights:eval -- live 2026-10-02 collins,malott,frary
```

Live mode uses GROQ_API_KEY from the environment or ignored .dev.vars and consumes account quota. Raw selection-only outputs, usage and run metadata are saved under ignored .wrangler/highlight-eval. The persisted budget has reached this batch's limit; start a deliberate new evaluation batch by moving its budget.json aside first. Keep one evaluator process active at a time.

Before claiming consistent selection quality, review these actual picks with the user and add more dates. Remaining McConnell bar/component and plant-entree preferences need user-approved examples; several omitted priority dishes compete with other real mains for the five-item limit.
