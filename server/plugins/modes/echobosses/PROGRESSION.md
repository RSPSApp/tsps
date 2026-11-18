# Echo encounter progression

`Progress.EchoBosses` consumes only the central service's validated, committed
`echo-boss:credited { player, boss, token, killCount }` event. `killCount` is the monotonic
per-boss count. A duplicate or older count, malformed event, main profile, or other League
does not mutate progression. Multi-NPC encounters contribute one completion.

The profile persists `echo-boss:progress` with version 1 and per-boss counts. Total and distinct
counts are derived from the nine supported encounter keys. Login republishes and catches up
eligible milestones through `league:complete-task`, preserving the existing completion bits,
League Points, Pact points and reset reward flow. Task thresholds are 1/2/3/4 distinct Echo
encounters and 25/75/150 total. No generated task catalog is patched.

Each native `league_echo_killcount_<region>` varbit resolves through the active cache's
gamevals. Full saved counts remain intact; narrower native displays clamp to their actual
bit width rather than wrapping to zero. `league:echo-statistics` updates the existing summary
counter (tracking_echo_bosses_killed, resolved by LeagueMode's canonical statistics map),
and ordinary boss/NPC summary totals once per encounter.

Marked Echo NPC deaths do not award normal same-name League kill tasks, ordinary Combat
Achievement kill counts or fight-condition achievements. Explicit Corrupted Gauntlet
completion credit remains available through its existing scripted completion event.

Focused verification extends the existing League Pacts, League Tasks and Combat Achievements
suites, covering threshold grants, duplicate suppression, profile scope, reconnect-shaped
state, native overflow bounds and normal same-name NPC regressions.
