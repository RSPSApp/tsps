# Testing the quest and the helper together

Goal: drive a quest headless with the agent MCP by following **everything Quest Helper tells the
player to do** — who to talk to, which dialogue choice to pick, which item to fetch, which object
to click, which teleport and requirement each step declares. Travel is only one of the step
kinds, not the subject of the test.

Every step then proves two things at once:

1. **Helper integration** — the step's ids, tiles, NPCs, objects, items, dialogue choices and
   varps all exist and agree with this server.
2. **Quest correctness** — playing the step actually advances the quest's saved stage and its
   client-visible wire value.

So a divergence is attributable rather than a shrug: helper-integration fault, or quest fault. No
browser, no human clicks, one loop per quest.

See [quest-testing.md](quest-testing.md) for sources, account ownership and the stop rule; this
page only covers the helper-driven variant.

## How it runs

```
agent MCP ──► QuestHelperRuntime.evaluateHeadless ──► Quest Helper bridge (Java, 127.0.0.1:16471)
                    │
                    ├─ authoritatively overrides varps/varbits/questStates/inventory/
                    │  equipment/localPlayer with the server's own values
                    └─ returns the step, sections and diagnostics
```

The snapshot is built from server state (`Snapshot.QuestHelper.js`): scene base, NPCs, objects,
ground items, skills, widget text and instance chunk palette. The only client-side pieces in the
normal path are the client's own snapshot/event builders, which is exactly why the conformance
check below exists.

```bash
yarn bridge            # quest-helper bridge, reads QUEST_HELPER_TOKEN from the root .env
AGENT_MCP=1 yarn start # server (and client, if you want one)
```

`QUEST_HELPER_TOKEN` (24+ characters) must be in the root `.env`: the server and the bridge share
it, and the browser never sees it. Set `QUEST_HELPER_URL` if the bridge is not reachable at
`127.0.0.1:16471` from the server process. Use an HTTP(S) URL without credentials, a query or a
fragment. `yarn bridge` finds a JDK 21 itself (`JAVA_HOME`,
`QUEST_HELPER_JAVA_HOME`, then a `jdk-21` install). One bridge serves every worktree — sessions
are per-request UUIDs, so no port slot is needed and no two worktrees share state. `GET /health`
is public; `/catalog`, `/evaluate` and `/close` need the token.

Without the bridge, only the native Tutorial Island and Recipe for Disaster routes answer.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `quest_helper` | `player`, `quest` (key or name), `variant?`, `radius?` (8-64, default 32), `config?`, `bankTab?`, `section?`, `fresh?`, `overlays?`, `verbose?` | the two sides below |
| `quest_helper_result` | `player` | what a connected browser was last told, or the last headless result |
| `quest_helper_quests` | `player`, `filter?` | every quest's saved status, stage and wire |

`quest_helper` returns, in one response:

- `questStatus`, `stage`, `complete`, `wire` — the saved quest, and the `{kind, id, value}` it
  mirrors to a varp or varbit (with the parent varp and bit range when it is a varbit).
- `contract` — the cache's own completion threshold for that quest (quest DB table 0,
  `endstate`), the value this player's client would hold, and whether the two agree. The guide has
  no say in this field: `agrees: false` is a defect in this server whatever the step says.
- `helperStatus` — what the helper engine answered (`active`, `complete`, `unavailable`).
- `step` — `id`, `text`, `targets`, `requirements`, `recommended`, `teleports`,
  `dialogueChoices`, `choiceRules`, `geItems`, `inventoryHighlights`.
- `targets` — each target resolved against the cache and the scene: `cache: known|missing`,
  `scene: on-tile|nearby|absent|carried|on-ground|n/a`.
- `section` — the current panel with its own steps, plus `sections` (index, titles, step counts)
  so the agent knows how much of the guide is left.
- `pluginMessages`, `diagnostics`, `requests`.

## Two sides, one comparison

After playing a step:

| | stage advanced | stage unchanged |
| --- | --- | --- |
| **step advanced** | pass | helper moved without the server progressing: wrong varp or wire mapping |
| **step unchanged** | server progressed, helper did not see it: dirty-flag or varbit gap; a user sees a stale step | broken action, or a step the server genuinely does not implement |

Both "wrong column" cells are user-visible integration bugs, so the response carries both sides.
`contract` is the third opinion that neither column can supply on its own: it compares what we send
against the cache's `endstate`, so a wrong wire mapping cannot hide behind a guide that happens to
agree with it.

A further failure class is found without walking anywhere: `targets` reports a step whose ids are
not in this cache (`cache: missing`) or whose object is not on the tile it names. `scene: absent`
alone is only a warning — the step may be across the map.

When the step and the stage disagree, decide which side is wrong before touching a quest. The
pinned helper is very close to the real game but not identical, so a route that does not finish a
quest is as likely to be a guide quirk as a server bug. Check the upstream issue tracker for a known
one first — <https://github.com/Zoinkwiz/quest-helper/issues> — and quote the issue and the pinned
commit in the note. Triangulate with the cache for ids and the wiki for intent: a helper quirk the
server already handles correctly is a documented difference, not a regression.

Dialogue is where helper/quest drift concentrates (the helper is one guided route and can route a
shared NPC to the wrong quest owner — see [quest-testing.md](quest-testing.md)). Compare
`dialogueChoices` and `choiceRules` with the options the server's dialogue actually offers, at the
dialogue, not later.

## Building a quest from scratch

It is not only a debugger. The same call turns the guide into a work plan for content that does not
exist yet:

1. **Plan.** `quest_helper { quest, verbose: true }` returns `sections` — every panel with its title
   and steps. That is the shape of the quest: how many stages, what each names, where it branches.
2. **Pre-flight the world before writing a single interaction.** Every step's targets come back
   resolved against the cache and the scene. Implement the object, the NPC spawn and the object
   transforms first, and re-call until the steps you have built report `cache: known` and
   `scene: on-tile`/`nearby`. Wrong id, missing spawn, missing transform, tile off by one — all of
   it surfaces without a click.
3. **Work one section at a time.** `section: {section, locked: true}` marks a finished panel
   complete, so the helper advances to the panel you are actually building. Re-read `sections`
   first: section indices are positional and move when a panel becomes hidden.
4. **Close each stage.** After the interaction, the helper must name the next step. If it does not,
   either the saved stage or the wire mapping is wrong — `contract` says which: the wire disagreeing
   with the saved stage is a mapping bug, both disagreeing with the cache's `endstate` is a stage
   bug.

**Fit the experience to the guide; never fit the mechanism.** Take ordering, targets, dialogue
choices and requirements from the helper — that is the player-facing specification it is good at.
Do not take varp ids, stage numbering or transitions from it just because they make the step
advance: that is the tautology in the table above, and this server's own stage contract comes from
the cache, not from the guide. Nothing here can do that for you either — the bridge is read-only,
so there is no path from the helper into a quest.

What the guide does not cover, and you still owe a new quest: rewards, XP, drops, timers, combat
balance, journal text, music, quest-list entry, post-quest dialogue, refusal branches,
out-of-order play and recovery.

## Conformance

Headless evaluation goes server → bridge; users go client → server → bridge. With a client logged
in and the helper panel open on the same quest, `quest_helper_result` returns what that client was
told (`source: client`); diff its step sequence against `quest_helper`'s for the same tick. Without
that diff a headless verdict says nothing about what a user sees. The visual panel stays with
`vision_screenshot` ([testing.md](testing.md)).

## Known limits

- **No camera geometry.** Overlays that project through `Perspective` lose their drawing and
  report an `overlayDiagnostics` entry; the step itself is unaffected. Use `vision_clip` when the
  drawing is the thing under test.
- **Widgets are text-only.** The server has the interface text it sent, not the widget tree, so
  steps that read an interface's layout or bounds will report `MISSING_STATE`.
- **Instanced scenes** are implemented (the chunk palette comes from the server's own
  `buildScenePalette`) and unit-tested, but not yet played through live; treat the first instanced
  quest as the check.
- **Guide quirks are upstream bugs, not ours.** A route that stops short of completing a quest may
  be a known helper defect: check <https://github.com/Zoinkwiz/quest-helper/issues> before changing
  quest code, and record the issue id with the pinned commit when it explains the difference.
- A step can be right and the quest still wrong, or the reverse. Record which, per step; never
  reduce a run to "the quest passed".

## Validation

`server/tests/quest-helper-headless.test.cjs` covers the headless path with a fake bridge: server
truth overriding the supplied vars, per-quest session parking, route changes, variant rejection,
native routes answering with the bridge down, the client tap, the scene base invariant, instance
palettes, and target resolution.

Live audit of the completion contract (fresh account, bridge and server up): all 185 registered
quests matched a quest DB row by name, and none disagreed — the agreement branch is covered by the
unit tests, which drive a wire value that disagrees with the saved stage.

Live check (main checkout, bridge and server up, fresh account):

- `quest_helper cooks_assistant` → "Purchase a bucket from the Lumbridge General Store", the
  2×Coins requirement unmet, and the shopkeeper target resolved `known`/`nearby`.
- bought the bucket at the Lumbridge General Store → the next call returns "Purchase a pot from
  the Lumbridge General Store": the helper moved on the server's authoritative inventory.
- `quest_helper the_final_dawn` → "Talk to Servius in the Sunrise Palace…" with its `Yes.`
  choice, wire `{varbit 16663, value 0}` inside varp 4737 bits 0-6.

Both conversations exercised the real bridge; neither needed a client.
