# OpenCode Go opinions on menu highlights

Requested October 3, 2026. These are independent model opinions used to propose experiments. The user reported general selection errors and requested up to five highlights per meal. The user has not approved the individual expected dishes in the evaluation.

| Model | Useful recommendation | Advice or claim rejected |
| --- | --- | --- |
| Kimi K2.7 Code | Define mains explicitly, distinguish substantial plant entrees from vegetable/grain accompaniments, and use station hints | A keyword filter for rice/quinoa/polenta would reject composed dishes. Sides should not become mains just because few dishes exist. Its four-item recommendation preceded the user's five-item clarification. |
| MiniMax M2.7 | Make the maximum/no-minimum instruction explicit and prefer composed dishes over generic components | Calories and a hard station quota are weak proxies. Some annotations had source/date/meal errors, including locating Hoch's pork carnitas at lunch rather than dinner. |
| GLM-5.3, second brief | Survey all stations before ranking. Prefer specific names to generic staples, and do not infer recurrence from one day | It incorrectly described the assistant's provisional labels as user-verified facts. Its first run ended without a usable opinion. |
| DeepSeek V4.1 Flash | No opinion obtained | Provider rejected the request because this Go model requires Global regions under the current workspace privacy setting. No settings were changed. |

The shared direction is a clear definition of a main, explicit ranking, and station guidance as context. The prompt retains credible plant mains, allows empty services, and gives variety less weight than main-dish quality. Original dietary flags remain the only public dietary information.

All successful reviews used the configured OpenCode provider with `opencode-go/` model IDs. GPT-OSS 120B on Groq remains the generation model. The independent reviewers do not decide the expected answers by voting.

See [the refinement report](highlight-refinement.md) for live experiments, differences between rounds, and remaining limits.
