# Character-based recommendations and step navigation

User request: recommend quests from real levels/completed quests, suggest the next quest after completion, and provide RuneLite-style arrows and directions.

Plan:
1. Read requirements directly from cache 241 quest database metadata, as the native quest list does. Compare base levels, completed quest rows, quest points and combat level on the server. Missing metadata remains unknown. Keep recommended combat/stats distinct from mandatory requirements.
2. Send eligibility with the catalog and refresh quest progress with evaluated steps, including immediately on completion. Refresh an idle catalog periodically so gaining levels also updates recommendations. Rank in-progress routes then eligible quests; prioritise those meeting recommended levels and lower difficulty. Show blockers for unavailable quests, and a completion prompt with a Start guide button rather than starting gameplay automatically.
3. Connect the active step to a helper-owned native hint arrow (world and minimap), preserving server arrows. Resolve nearby actors and remote target coordinates, show direction/distance and floor changes, and clear helper navigation on stop, logout, completion, disable and stale/error states. This is target guidance, not a global obstacle-aware route planner.
4. Regression-test eligibility changes, unknown data, recommendation ranking, completion refresh and arrow ownership/lifecycle. Compile and test in the existing isolated preplay checkout, then verify fresh and progressed test accounts before deploying with a safe save/backup.

No imported/generated game data is hand edited. The Java engine and source pin stay unchanged.
