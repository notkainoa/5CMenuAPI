# Original versus refined menu highlights

This is the earlier checklist comparison. The current [pick-by-pick audit](highlight-pick-audit.md) checks every selected item against its menu and includes freshly captured October 4 picks. The AgentDrop page now displays that fuller audit.

The refined selector is worth keeping. It catches more of the flagged mains and removes the four known side mistakes. It still needs work on ranking good mains and grouping meal bars with their components.

This compares both versions on the **same October 2, 2026 menus**, not actual October 3 versus October 4 menus. No saved results for those two calendar days were available for this report.

| Hall | Original checks met | Refined checks met |
| --- | --- | --- |
| Hoch | 1/2 | 2/2 |
| Malott | 3/4 | 4/4 |
| McConnell | 3/6 | 4/6 |
| Collins | 2/6 | 5/6 |
| Frank | 1/1 | 1/1 |
| Frary | 2/5 | 5/5 |
| Total | 12/24 | 21/24 |

That is nine more checks met, an increase from 50% to 87.5% on this preliminary checklist. It is **not an overall accuracy estimate**. The assistant drafted the checks; the user has not approved them. Some checks accept alternative dishes, and the checklist does not enumerate every main. The refinement loop already saw these menus.

Four known side mistakes fell to zero in the fixed final six-hall run: Malott roasted cauliflower, Collins hash brown potatoes and plain polenta, and Frary plain quinoa. This is a narrow audit of known mistakes, not proof that all selections are ideal.

The old limit was four picks per meal; the user requested five. There were 61 old picks and 77 refined picks. The extra slot contributes to the gain, so the full improvement cannot be attributed to the prompt alone.

Collins and Frary improved most. McConnell still missed tofu fajitas and a lunch check accepting potato tacos or roasted fire halal chicken. Collins still missed its Southwest grilled chicken bowl. A later McConnell repeat reached 5/6, but the main chart keeps the fixed all-hall run at 4/6 rather than mixing each hall's best result.

On the September 30 menus, Malott and Frary improved from 6/10 to 9/10 checks. Malott needed a retry after a wrong-meal item failed validation. Collins scored 6/6 on that date, but has no original comparison and is excluded from the before-and-after total.

Next, agree on human-reviewed expected selections, compare versions with the same five-pick limit, and repeat on unseen menu dates. Test meal-bar duplication and plant-main coverage in particular. The API implementation remains local and has not been deployed.

## Reproduce the graphic

Run `python3 docs/reports/build-highlight-comparison.py`. It builds a standalone HTML page with all before-and-after selections, per-hall charts, remaining misses, and methodology into `.wrangler/highlight-comparison/index.html`.

Frozen October 2 runs:

- Original: `.wrangler/highlight-eval/1791085430294-baseline-2026-10-02.json`
- Refined: `.wrangler/highlight-eval/1791086353782-live-2026-10-02.json`

September 30 runs:

- Original: `1791085430133-baseline-2026-09-30.json`
- Refined Frary and Collins: `1791086700143-live-2026-09-30.json`
- Valid Malott retry: `1791086980801-live-2026-09-30.json`

The report updates the existing private AgentDrop highlights page. Deployment credentials remain in the ignored `.wrangler/agentdrop-highlights.json` file, outside page content. Desktop and 390px phone layouts, hall selection, meal selection, and overflow were checked in the collaborative browser.
