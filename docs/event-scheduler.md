# Holiday event scheduler

The reusable scheduler is the foundation of the Holiday & seasonal events tracker section.
It does not implement an annual activity. Each activity's window is configured in
`plugins/world/data/events.json`, and the four holiday events grant their once-per-account
rewards through the shared helper below: Christmas Din-Dins (`christmas-2025`), Easter 2026
(`easter-2026`), the 25th Anniversary (`anniversary-2026`) and Halloween 2025
(`halloween-2025`, plus `halloween-2025-tradeables` for Fred's later tradeables).

Each event keeps its own saved progress as the first gate, and its own capacity precheck so
its refusal messages are unchanged. The helper then re-plans and commits the grant and
records the completion. Saves claimed before the helper existed are imported on login: each
event sends `events:record-completion` when its own progress already shows the claim
(Christmas phase `complete`, the Easter `complete` bit, Birthday `rewarded`, Halloween stage
`COMPLETE` and `tradeableClaimed`). A rolled-back progress save therefore still cannot claim
twice, and nobody loses a claim. The 2026 re-run windows reuse the 2025 keys, as the events
themselves never reset per year.

## Configuration and contract

Each entry has `key` (unique lowercase name, hyphens allowed; `reset` is reserved), `enabled`
(boolean), and a nonempty `windows` array. Each window has `start` and `end` as UTC ISO
instants, e.g. `2026-12-24T00:00:00.000Z`. These example dates illustrate syntax only.
Start is inclusive; end is exclusive. Entries are validated together before startup, so an
invalid/duplicate key or malformed/reversed date leaves the scheduler stopped, logs the
reason, and activates no content. Dates are not extrapolated into future years.

- `events:active` sends `{ key, active }` once per transition. State changes before notification.
  Notifications are immutable and serialized: a consumer's nested override or shutdown waits
  until every subscriber has received the current transition. Later consumers therefore
  cannot receive an obsolete start after cleanup. Queries during a notification agree with it.
  Consumers attach their named handlers during plugin registration, spawn temporary content
  on start, and clean up their owned NPCs/objects/tasks on stop. They must also check status
  before rewarding or progressing a player. Do not register new interaction hooks each time
  a window opens. One consumer failing is not an atomic world rollback; consumers must be
  independently idempotent and tested through their own failure/cleanup paths.
- `events:status` uses a request `{ key, active: false }`; the scheduler writes its answer to
  `active`. Unknown keys and a stopped scheduler are inactive. No internal Set/Map escapes.
- `events:grant-reward` is the shared once-per-account reward helper. Content sends
  `{ player, eventKey, completion?, rewards: [{ itemId, amount }], take?: [{ itemId, amount }],
  unlock?: [cache obj names] }`. `take` lists items the event consumes in the same commit
  (the serving platter, the runaway egg): they leave the planning copy first, so their slots
  are free for the rewards, and an item that is not held refuses with `missing-items`.
  `completion` defaults to `eventKey`; give each annual run its own key (e.g. `christmas-2025`)
  so a later year is independent. The helper writes `granted` and `reason` back:
  `inactive` (window closed or scheduler stopped), `already-complete`, `missing-items`, `no-space`,
  `unlock-refused` (an `unlock` name is not in Diango's catalogue), `busy` (a grant for the
  same player is already running, e.g. from inside an unlock listener) or `invalid` (a
  malformed request, an id outside the active cache, or an amount above the stack cap).
  It plans every item on a copy of the inventory with the container's own `getAddableAmount`
  and `add` rules before changing anything, so a grant is all or nothing and a refusal never
  records the completion. `unlock` names (cache symbols such as `win05_hat1`) are passed to
  `holiday-rewards:unlock` for Diango's retrieval; an unknown name refuses the whole grant.
  The helper does not check that the player is still online: a delayed caller must.
  Item ids come from the content plugin, never from the scheduler, and the content plugin
  chooses the player-facing message for each `reason`.
- `events:completed` answers `{ player, completion }` with `completed`. Completions persist
  in the `events:completions` player attribute as an array of keys.
- `events:record-completion` takes `{ player, completion }` and records that key without granting
  anything, idempotently and whether or not the window is open (it answers `recorded`). It is for
  importing claims older saves already show, and for rewards settled another way (the 25th
  Anniversary's post-window Diango settlement).
- Owner-only `::forceevent <key> [on|off|auto]` overrides a window for testing (default on).
  `::forceevent reset` restores all configured windows. Overrides are local to this process
  and disappear on shutdown; no player saves or rights are changed. Invalid commands do
  not claim success or mutate state. The existing central command dispatcher enforces rank.
- On startup, the scheduler snapshots validated configuration, evaluates immediately and
  submits one repeating Task. A duplicate startup does nothing. It checks wall-clock UTC
  every 60 seconds, converted to ticks with the configured engine cycle length. This is a
  local infrastructure cadence, not an OSRS action timing; transitions can be observed up
  to one check interval after a window boundary.
- Shutdown makes every query inactive, stops the retained task, cancels the matching owned
  task key, clears overrides/configuration state and emits stop for each active key exactly
  once. Consumers use these notifications to tear down their temporary world changes.

## Production path and evidence

CommandPacketListener.execute sanitizes the native command and includes its base in
`parts[0]`; PluginManager.emitCommand checks registered Owner rights before invoking
forceEvent. The handler reads `parts[1]`, updates private overrides, evaluates the calendar
and emits the custom event. Server lifecycle hooks invoke start/stop through the normal
register API; TaskManager owns the pending/active task lists and cancellation. No new core
initialization hook, generated data, permanent spawn, dependency or persistence changes.

The content consumer's entity references, not NPC names or IDs alone, identify what it owns.
The regression uses api.spawnNpc/removeNpc and the real NPC registry to verify closing a
window leaves another NPC alive. Each later activity must separately prove cancellation,
death/respawn behaviour, pending additions and native client rendering.

- Local RSProx index searches `*xmas*`, `*halloween*`, `*easter*` returned no mentions. There
  is no cited recording of this internal server calendar. No recorded timing is claimed.
- The pinned revision-241 dump contains annual symbols (e.g. npc `easter_egg_rolling_bunny`
  and varp `easter_2005`) and holiday interfaces, but cannot establish calendar mechanics.
  No gameplay ID or UI is added here. Tests resolve the synthetic consumer's MAN identifier
  against the shipped active cache, not a guessed number or claimed holiday NPC.
- The [tracker](https://rsps.app/progress) specifies a reusable calendar/custom-event
  foundation and temporary-content cleanup. Start/end semantics, 60-second cadence and the
  Owner override syntax are implementation choices for this private server.
- No annual quest, exact holiday date, transcript, reward, RNG or OSRS parity is established
  by this PR. Those require their own Wiki/capture/cache evidence and native game checks.

## Verification

`node --test tests/event-scheduler.test.cjs` runs on the built server and shipped cache with
real PluginManager, Player, CommandPacketListener, NPC and TaskManager. Only player network
output and wall-clock time are controlled. The cached JSON configuration array is seeded
with explicit synthetic windows and restored after each test; the shipped file remains empty.
The suite exercises the scheduler's registered hooks, not a fake plugin API. This targeted
suite does not load/start all content plugins or verify rendering; registry/server startup
integration and independent review are recorded separately in the PR's testing evidence.
