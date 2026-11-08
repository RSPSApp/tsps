# The bug loop

The maintained instructions live in the repo-owned
[TSPS bugfix skill](https://github.com/RSPSApp/tsps/blob/main/.agents/skills/tsps-bugfix-loop/SKILL.md).
Read that skill to claim issues, dispatch workers, verify fixes, publish ready PRs and clean up.

Its short references cover worker recovery, gameplay/client verification, capture searches,
generated-data repairs and safe worktree retirement, including the diagonal-door lessons.
Update those versioned files when a new lesson changes how the next fix should be handled.

The helpers remain in `scripts/agents/`. Reading these instructions does not start a loop;
a one-off fix or local preview does not resume stopped bugfix or review loops.
