# Testing a quest start to finish

A practical route for proving a quest works end to end with the agent MCP, quickly and
without inventing evidence. It is written for a fresh agent with no context on this repo.

**Authority:** use Quest Helper as the primary progression reference for this review;
the OSRS Wiki and live OSRS captures establish gameplay details; ids come from
`server/caches`; the plugin source is what this server claims. Never accept a private-server
recording as behaviour proof. See [sources.md](sources.md) and [cache.md](cache.md).

## The contract, once

Agree these before touching an account. They stop most time loss.

- **One account, one actor.** You own a single test account and its one MCP client. Do not run a
  second driver, drain its `messages`, or poll `observe` from another loop.
- **One scope.** Either source review, focused test, or live playthrough per owner. Do not
  rewrite a quest while someone is proving it; batch source fixes, then reload once.
- **Fresh or checkpoint, stated.** Record whether the run starts fresh or from an exported save
  or parent-verified checkpoint. Never present a checkpoint run as a fresh run.
- **Natural means normal.** Ordinary travel (teleports, boats/gliders, walking) and ordinary
  supplies, gear, skills and prerequisites are fine when declared. Mandatory ladders, doors,
  dungeons, puzzles, boat boarding/landing and scene handoffs must be played normally.
- **Cheats are a scalpel, not the route.** Use them only after the real encounter/phase has
  started, and never to skip a mandatory threshold, scene, dialogue chain or the final step.
- **Stop rule.** Two equivalent attempts that fail the same way means stop, inspect the exact
  cause (message, tile, object/menu, collision, source predicate), then report or fix. Do not
  retry the same click, do not "recover" with a relog and call it a pass.
- **Keep actors moving.** An old review hash is not a runtime mismatch. When the actual loaded
  source matches the published candidate, review the changes since the historical report,
  run its focused checks and record the current hashes. A frozen source claim does not reserve
  its native actor: record the source/native split and archive stale bookkeeping yourself.
  Apply the ready-row cap by archiving completed, offline rows verbatim.
- **Close out together.** Batch exact reward deltas, nearby repeat dialogue, normal logout/login,
  persistence and final logout/offline checks, then write a small evidence packet. Keep raw
  captures on disk; read selected fields. During slow walking or timers, advance another
  independent account. A hung call needs a bounded timeout and same-account reconnect,
  followed by inspecting whether the action already happened; it never authorizes a reset.

## Sources: what each can and cannot prove

1. **Quest Helper is the primary progression reference.** It gives the intended order, step
   markers, objects, items and often the stage/varp it keys on. Use it to plan the route.
   - Pin a commit when comparing; this repo's quest parity docs use
     `06da90f982518a093f2fe1c9cfac5547fa7053d3` (for example
     [custodia-dawn-qh-parity.md](../custodia-dawn-qh-parity.md)).
   - **It is not a complete oracle.** It follows one guided route and can miss early,
     out-of-order or shared-NPC cases. Observed class: a helper step that walks the full route
     can still route a shared NPC interaction to the wrong quest owner (e.g. a before-book
     Katrine/Straven step resolving to an unrelated NPC such as Achietties) while the full
     helper route "passes". Treat competing quests' NPCs as first-class risk.
2. **RSProx captures** are the best evidence for recorded speech, action order, varps/varbits,
   menus and exact tiles. Record the facts the feature relies on in docs; do not commit raw logs
   (they contain accounts). Re-check every id against this cache.
3. **The OSRS Wiki** fills recovery, uncaptured branches, requirements, rewards and post-quest
   dialogue. The cache wins on ids; the Wiki wins on intent.
4. **The cache** is the final id authority: names, placements, transforms, DB rows, action/menu
   data and bit layouts.

## Set up (worktree, ports, identity)

```bash
scripts/wt ls                 # SLOT, client URL, game port, MCP port, state
```

Use your own worktree's ports from its root `.env` (`PORT`, `WEBSOCKET_PORT`,
`AGENT_MCP_PORT`). Never connect to another worktree's server and never override ports in the
shell. Do not assume `49700`, `3101` or any previous slot: they are assigned per worktree.

```bash
AGENT_MCP=1 yarn start        # server + client for this worktree
# or: AGENT_MCP=1 yarn server
```

`AGENT_MCP=1` is required; `AGENT_MCP_PORT` comes from the `.env`. Register or connect to
`http://127.0.0.1:<AGENT_MCP_PORT>/mcp`. The main checkout defaults to 49700; a slot is
49800 + N.

Before any restart: `list_players`, confirm no human players, and validate the process is
yours (PID + cwd + command). Restarts are for your slot only. Do not touch `server/data`
saves, the DB, `.env`, other ports or other worktrees.

## Drive it over MCP

The tools are registered in `server/plugins/agent/mcp/`. Discover the live set with
`listTools`; the count changes, so no count or schema is a permanent contract. All player
arguments use the account username.

A durable SDK pattern is `server/scripts/agent-mcp-smoke.ts` (in-memory, good for tool
contract tests). For a live run use the installed SDK's HTTP transport. Save this outside the
repo (e.g. `/tmp/quest-run.cjs`) and run it from `server/` with that directory on the module
path; it is a CommonJS script, so keep the async wrapper.

```js
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const client = new Client({ name: "quest-run", version: "1.0.0" });
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
};

(async () => {
  await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:49801/mcp")));
  await client.listTools();                                // discover current names/schemas
  await call("login", { username: "q6test", password: "..." });
  const me = await call("observe", { player: "q6test", radius: 8, varbits: [16663] });
  await call("interact", { player: "q6test", target: "Servius", option: "Talk-to" });
  await call("dialogue", { player: "q6test" });
  await call("dialogue_choose", { player: "q6test", option: "Yes" });
  const servius = me.npcs.find(npc => npc.name === "Servius");
  if (!servius) throw new Error("Servius is not in the observed area");
  await call("npc_option", { player: "q6test", index: servius.index, option: "Talk-to" });
  await call("object_option", { player: "q6test", id: 56513, x: 1649, y: 3093, option: "Open" });
  await call("inventory_option", { player: "q6test", slot: 3, option: "Wield" });
  await call("wait_ticks", { player: "q6test", ticks: 2 });
  await call("logout", { player: "q6test" });
  await client.close();
})().catch((error) => { console.error(error); process.exit(1); });
```

```bash
cd server
NODE_PATH="$PWD/node_modules" node /tmp/quest-run.cjs
```

One persistent client per account is for ownership and batching, not server session state:
the MCP endpoint is stateless and every call names the player.

### Tool subset you actually need

| Goal | Tool and arguments |
| --- | --- |
| Find the player | `login`, `logout`, `disconnect`, `list_players` |
| State snapshot | `observe { player, radius, varbits, varps, widgets }` |
| Read dialogue | `dialogue`; advance `dialogue_continue`; answer `dialogue_choose` |
| Talk / attack NPC | `interact { target, option }` or `npc_option { index, option }` |
| Click object | `object_option { id, x, y, option }` |
| Inventory | `inventory_option { slot? item? option }`, `use_item { item, targetItem? target? }` |
| Walk and settle | `walk_to { x, y, run, maxTicks }` |
| Let time pass | `wait_ticks { ticks }` |
| Admin probe | `command { text }` (runs as developer for that call) |
| Rules only | `can_attack`, `can_teleport` |
| Damage after real entry | `set_npc_hitpoints { npcIndex, hitpoints }` |

Verified schema limits: `radius` 1-32 (default 15), `maxTicks` 1-50, `varbits`/`varps` up to 50
ids, `widgets` up to 100 packed ids, `ticks` 1-50. Do not guess property names; read
`listTools` once and cache the shape in your own notes.

`dialogue_continue` and `dialogue_choose` already sleep one tick. Do not add generic extra
sleeps. `interact`/`walk_to` settle on arrival, a dialogue/interface, or two idle ticks; still
assert the resulting position/state before the next action. Climbing or scene task completion
is not "three ticks later": wait bounded and verify the new plane/area/object.

Keep one persistent driver per account through the quest. Do not log out after each leg:
logout can cancel a live scene or timer. Use separate drivers and logs when one worker owns
several accounts, and overlap their walking or scene waits only while each account has one actor.

After `walk_to`, check the actual tile and `busy` before clicking. A response can still contain
`moving`; wait bounded ticks until movement settles, then send the interaction. A click sent
while moving can be silently rejected. Check that a supposed missing fence or ladder handler
is not an unfinished approach before changing server code.

For raw `use_item` with `on: "npc"`, `id` is the observed NPC **index**, not its cache type id.
Prefer the named target form when it is unambiguous. Use the action the guide and observed
menu actually specify: for example, a Swamp toad's `Inflate` option is a different dispatch
from using bellows on the NPC. Validate the resulting item/stage change before proceeding.

Only continue visible NPC/player/item/statement dialogues. A `kind: "other"` entry may be
an internal action waiting for its scheduled overhead or scene callback. Use bounded
`wait_ticks` and re-read it; clicking Continue there can invalidate the pending callback.

Before each travel leg, resolve the current Quest Helper conditional step from the actual
stage and auxiliary flags, then use that step's destination. A later scout or boss marker
is not the current destination. Reuse the cached live MCP schema for tool names and
arguments; do not search for a developer command when the documented tool exists.

For long walks or a failed direct path, use MCP `plan_route` before trying arbitrary
intermediate tiles. It reuses the bot long-distance collision planner and returns short
waypoints plus closed door/gate candidates at crossings. Walk each leg and open the
observed door normally before crossing; the plan does not establish that a locked quest
door is usable. It supports main-world, same-plane destinations within 319 tiles; split
longer journeys at real intermediate destinations and use guide-required transports.
Use `exact: true` when targeting a specific approach tile beside a counter or staircase;
the default proximity route can finish nearby on the other side of a wall.

Supply ordinary commodities such as beer, raw meat, nails, tools, food and travel items as
declared setup aids when sourcing them would distract from the quest. Record optional shop
or spawn failures separately. Earn quest-specific items and play mandatory doors, ladders,
scenes, transport handoffs and puzzles through their real interactions.

`observe.client` is a one-shot map of what the server told the client *since the last observe*
(varbits, varps, interfaces, graphics, interaction modes). It is the recorded PacketSender
stream, not a saved-state read; use `varbitValues`/`varpValues` for current values. Messages are
returned once per call.

Keep the raw response when reducing observations for logs. Nearby floor items are in
`groundItems`; reading a guessed `ground` field and defaulting it to `[]` falsely reports
missing spawns. Assert required response fields before using an abbreviated view as evidence.
`ground_item_option` sends a click; it does not prove pickup. Let the action settle for a
bounded number of ticks, then check the inventory and ground item before diagnosing a blocker.

## Stages: saved attribute is not the wire

`QuestRuntime` stores each quest's progress in a persisted player attribute,
`quest.<key>.stage`, and mirrors it to the client varp or varbit. They are related but not the
same contract:

- The attribute is the durable source. A save can hold a stage the client has not yet been
  sent, or a packet can set a transient value that is overwritten on login.
- Login bootstrap re-sends saved stages (`sendQuestVarps`) because the bootstrap clobbers
  shared varps. A relog is not proof by itself; compare the persisted stage and the wire value.
- Bitfield stages must be sent as their varbit; writing the whole parent varp clobbers sibling
  quest bits. `QuestRuntime.setStage` does this for you.

Worked example, **The Final Dawn**: plugin stage is `quest.the_final_dawn.stage`; wire progress
is varbit **16663** (`vmq4`) inside varp **4737** (`vmq4_primary`, bits 0-6); **68** is complete.
Sibling varbits (16664, 16666, 16667, 16672, 16675/16677, 16694, 16695-16697) share the varp.
Never assume "saved stage == helper stage == varbit value" without checking the mapping. The
same quest sends mirror varbits on state changes, so a transient packet value is not evidence
that the saved stage changed. Validate: saved attribute via save/checkpoint inspection or a
parent export, wire value via `observe`, and the client-visible consequence (object transform,
menu, NPC, quest list).

Some plugins also keep sub-state in their own attributes (flags, puzzle progress, pending
rewards). Check those when a stage looks right but the world does not.

### Check the cache's completion contract

The final `loadSteps` key is **not** a completion value. Quest Helper asks the cache's
`QUEST_STATUS_GET` script (4029) whether the quest finished; script 4024 reads its progress.
In cache `osrs-241_2026-10-20`, 4029 reads quest DB table 0, column 19 as the completion
threshold and considers progress at or above it complete. For example, Clock Tower's helper
still has finish steps at 5, 6 and 7; the cache requires varp 10 to reach **8**. A plugin
completing its own saved stage at 6 must map that to the correct wire state.

Read the current scripts rather than assuming these column numbers remain stable:

```bash
cd server
yarn dump:cs2 4029 4024
```

Find the quest's DB row id in RuneLite's `net.runelite.api.Quest` enum (Clock Tower is 14).
This read-only example uses the repository's decoders, from `server/`:

```bash
NODE_PATH="$PWD/node_modules" TS_NODE_COMPILER_OPTIONS='{"target":"es2020","module":"commonjs"}' \
node -r ts-node/register/transpile-only <<'NODE'
const { CachePipeline } = require('./dist/game/cache/CachePipeline');
const { CacheIndexDat2 } = require('./dist/game/cache/codec/rs/cache/CacheIndex');
const { IndexType } = require('./dist/game/cache/codec/rs/cache/IndexType');
const { ByteBuffer } = require('../client/rs/io/ByteBuffer.ts');
const { loadDbRow } = require('../client/rs/config/db/DbRowLoader.ts');
(async () => {
  await CachePipeline.initialize(process.cwd());
  const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore());
  const file = configs.getFile(38, 14); // DB rows archive, Clock Tower row.
  if (!file) throw Error('Missing quest DB row');
  const row = loadDbRow(14, new ByteBuffer(new Int8Array(file.data)));
  console.log('table', row.tableId, 'completion', row.getColumn(19)?.values);
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE
```

Script 4024's switch identifies the exact progress varp/varbit. Check a proposed parent-varp
alias against the varbit's bit range: equivalent full-width reads can be valid, while a
whole-varp write can overwrite siblings. Verify intermediate values, completion and bootstrap
resend. Preserve existing durable saves through an explicit wire mapping when needed; do not
renumber saved stages blindly. The completion threshold alone does not establish every later
post-quest wire value. The [issue 728 cache reference](../quest-helper-728-cache.md) records
this cache snapshot, separate from gameplay or native proof.

Check that a purported alias shares the actual parent and bit range. Creature of Fenkenstrain
still has legacy helper progress in varp 399, while this cache's quest-status varbit 13715 is
in varp 3403, bits 2–5, with completion threshold 9. Sending 399 alone cannot update it.

## Route facts: cache, transforms, tiles, items

- Look ids up in this cache, not from memory:
  ```bash
  cd server
  yarn dump:widget <group>
  yarn dump:cs2 <script>
  yarn dump:enum <enum>
  yarn dump:loc <query>
  TS_NODE_COMPILER_OPTIONS='{"target":"es2020"}' ts-node scripts/lookup-gameval.ts varbit vmq4
  ```
  `lookup-gameval.ts` prints the id, gameval name and, for a varbit, its parent varp and bit
  range.
- **Parent vs transformed id.** A cache loc can transform by varbit/NPC transform. `observe`
  returns `id` (the actual registered object id used by `object_option`) and `displayId`
  (the resolved definition supplying its visible name/menu). Use the returned `id` and real
  tile for the packet; do not substitute `displayId`. Where a private owner overlay replaces a
  base loc, inspect the owner's observation rather than another player's. A quest **start** NPC can
  likewise depend on a shared visibility varp, and the plugin may accept both the raw and
  resolved ids (The Final Dawn accepts raw 14054 plus resolved 13694/14377); verify the start
  is actually offered instead of assuming the base id is visible.
- **Helper marker vs object position.** A Quest Helper marker is a guide tile, not the object's
  position. In a newer cache an object can move one tile from the guide (field example seen in
  this workstream: a Phoenix ladder guide marker at x=3243 while the actual object position is
  x=3244). Always use the `x`/`y` from `observe`, then account for footprint and reach; a 1x1
  click tile at the object's origin is not always the adjacent reachable tile.
- **Names are not unique; ids and slots are.** Record exact item ids and inventory slots.
  Examples: Blood Moon's reward tome is `TOME_OF_EXPERIENCE_3` = **33715**, Sins of the
  Father's reward tome is **24690**, and the plain `TOME_OF_EXPERIENCE` = **22415** is a
  different item (often already held as a prerequisite). Final Dawn's antique lamp is
  **30960**. BCS gives Keris partisan **25979** and Circlet of water **26969**. "Use the tome"
  without an id can silently use the wrong one.
  Similarly record exact NPC ids when two quests share a name, and exact object ids when a
  family has several transforms.

## Go fast without faking the proof

### Preserve evidence between runs

Before starting or resuming a quest, read the committed coverage ledger and
[verification history](../quest-helper-728-verification.md). Reuse the recorded checkpoint
and verified route prefix. A new agent session is not a reason to repeat an unchanged test.

Record each reviewed result in the tracked quest ledger before handing off: quest and
scope, source/test/loaded hashes, Quest Helper revision, cache and relevant shared runtime
or dialogue dependencies, starting checkpoint, stages reached, rewards/repeat/relog/offline
checks, recovery checks and remaining gaps. Include a concise, sanitized evidence summary;
temporary report paths alone are not a durable record. Never commit raw logs or credentials.

Keep previous results when code changes. Mark the affected claim as needing revalidation,
with the changed dependency and required check; do not erase its history or label it never
tested. Inspect the diff before deciding whether a shared or generated-data change affects
that quest. An unrelated dialogue-page change does not require replaying every quest.
Resume from a preserved, verified checkpoint when valid, then test the affected route.

Report implementation, source review, focused tests and natural playthroughs separately.
Count original issue quests and supplemental work separately. A partial recovery failure
does not erase an observed main-route completion, and that completion does not certify the
unresolved recovery case. Commit and push ledger updates with the reviewed fix batches.

- Narrow the contract once: quest key, start state, mandatory legs, rewards, recovery cases.
  Write it down; do not re-derive it every turn.
- Position a fresh actor at the helper's first quest interaction before recording the
  baseline. Do not spend the test travelling from the default account spawn. If a
  preparation snapshot was already recorded but the quest is still unstarted and no
  target interaction occurred, preserve that snapshot, finish the declared positioning
  setup, and record a new baseline. Record any failed unrelated travel service separately;
  this does not prove that service works. Once quest progress begins, follow the natural
  route and its required transports.
- Include ordinary tools from the helper's item requirements in the declared setup before
  the baseline: hammers, needles, spades, food and standard travel supplies. Exercise an
  in-quest tool handout when it changes progression or is the recovery case being checked.
  Keep unique quest items and required acquisition triggers on the natural route.
- Provision ordinary ingredients in that batch too: Druidic Ritual's raw meats can be
  supplied; its enchanted meats must be earned at the cauldron. If an ordinary supply is
  missing later, record the supplemental setup, exact quantity, and unchanged quest state
  before continuing. Preserve the original baseline and disclose the aid; do not claim
  the item was gathered naturally. This exception never supplies a quest transformation
  or replaces a required acquisition trigger.
- Prefer a normal teleport or transport over a long walk. A declared ordinary ring or
  tablet may shorten travel; use its real menu and destination, then play every required
  door, ladder and arrival interaction. An admin teleport does not prove those steps.
- Split ownership: one owner reviews source/tests, one playthrough driver, one recovery
  specialist. Do not have two actors on one account.
- One persistent MCP client per account. When a driver reconnects, check `list_players` for
  its own username first: reuse an already-online account and log in only when it is offline.
  Reconnecting does not authorize repeating setup, granting items or resetting progress.
- A non-watch server can keep testing a reviewed, captured source revision while the
  worktree advances. Retain that exact Git blob or source snapshot and its loaded hash;
  never label newer disk content as loaded code. Continue unaffected route legs, and
  revalidate changed behavior on the next safe server release. Evidence from the older
  release does not certify the newer change.
  Batch normal packets; avoid LLM turns between every click. Use the highest batched action
  the tool supports, then assert once.
- Treat `walk_to` as a local minimap click. The route finder searches a 128-tile square
  centred on the player; distant targets can return `stuck` without taking a step. Plan
  ordinary walks through reachable road/map waypoints about 32 tiles apart and batch
  those hops. Open intervening doors normally. A failed long click does not establish a
  quest blockage or require teleport supplies; do not repeat the same distant target.
- A successful packet response does not mean its interaction finished. Approach the actual
  object, click, then wait for the observed open leaf, destination, menu or inventory change
  with a bounded tick loop. Moving before that can cancel the pending interaction. For an
  auto-closing door, open, verify and cross in the same script; a model turn between opening
  and crossing can outlast the opening. Record the settled crossing, not just the click.
- A tool can return `stuck` or `timeout` without an MCP error. End that driver batch and
  inspect its actual position/state. For a required pickup, assert the inventory increase
  before leaving or talking to the recipient; an acknowledged Take packet proves no grant.
  Reuse an earlier verified door/pickup route when that segment is unchanged.
- Send raw tool output to a temp file; keep only compact evidence in your notes (stage, tile,
  menu, message, id, HP). No giant JSON dumps in context, no repeated poll loops.
- Discover schemas once (`listTools`), then stop listing tools.
- Prefer `interact`/`object_option` with observed ids over broad re-scans. Use `can_attack`/
  `can_teleport` to test rules without causing side effects.
- Cache the route in your own notes and update only deltas. Do not re-walk a verified prefix.

For parallel OpenCode workers, assign disjoint quest/test files and separate test accounts
in the same worktree. Name one integration owner for shared runtime, restarts and Git.
Give each worker the pinned Quest Helper path, capture facts, expected report path and
explicit forbidden mutations. For this workstream the installed Flash model is
`deepseek/deepseek-flash`. Check `opencode models deepseek --verbose` for the actual
release name (currently **DeepSeek V4.1 Flash 1017**), provider and cost rather than
guessing an alias or assuming an endpoint is free:

```bash
opencode run --auto -m deepseek/deepseek-flash --variant low --format json \
  --dir /absolute/path/to/worktree '<bounded task and owned files>' > /tmp/quest-worker.jsonl
```

Keep the returned session id for a corrective `--session <id>` follow-up. Ask workers to
write a compact done report with changed files, red/green evidence, rejected findings and
remaining limits. Review reports between independent work blocks; avoid constant polling
or rereading raw streams. A done report is evidence to review, not permission to skip review.
Use low reasoning for a bounded follow-up with a reviewed contract and failing reproduction;
reserve higher reasoning for unresolved source or binary-format questions. Finish with one
bounded tool batch that writes both reports and hashes, verifies them once, then stops.
Repeated report-editing turns can take longer than the fix itself.

- Bound each source assignment to **one whole quest**, including its mandatory scenes and
  final hand-in. It does not mean fixing only one finding. Compare every helper `loadSteps`
  key with the action that earns that state and the varp/varbit actually sent; a durable
  plugin stage can differ from the helper's wire value. Test the mapping and login resend. Also map
  every auxiliary varp/varbit that the helper reads. A saved plugin attribute does not
  update the client: for example, RFD's ingredient-enchantment flags must be sent as their
  own native bits, including after login and recovery.
- Check the named NPC transcript pages as well as the quest transcript. Post-quest and
  recovery dialogue may already exist on the NPC page; do not invent a missing-data fix.
- Check each state-changing node's actual imported type. Spoken lines emit
  `npc-dialogue:line`; message boxes emit `npc-dialogue:action` with `kind: "message"`.
  Drive the real transcript runner in transition regressions: directly emitting a line
  event for a message node can make a broken mandatory conversation look green.
- Query generated JSON with a parser and print only the needed page, variant, node or
  definition fields. Do not `cat` or text-search an entire minified export: one matching
  line can flood the worker context and its saved history.
- Native drivers use the reviewed route contract and current source/loaded hashes. Start
  declared setup and the stage-zero baseline after reading the required guide; inspect
  the relevant helper/source segment when needed. Repeating the complete source audit
  before the first player action adds delay without supplying native evidence.
- Keep the OS process PID, execution-tool session id and OpenCode `ses_...` id distinct.
  A detached launcher must survive its parent shell (for example,
  `subprocess.Popen(..., start_new_session=True)` with separate output/error files). Record the
  session id from the first CLI event while the worker is alive, not only at completion.
- Keep long worker histories compact: save the route checkpoint and evidence paths before
  using OpenCode's same-session summarization at an idle boundary. Preserve baseline,
  inventory, account ownership and unresolved findings; do not replay a verified prefix.
- Bound focused tests with a timeout that terminates their whole process group, waits for
  exit and verifies no child remains. Killing only `node --test` can orphan its test-file
  process. If throughput drops, inspect CPU use, elapsed time, command and working directory
  before starting more workers; stop only confirmed leftovers from your own test run and
  diagnose the hang before repeating it. An old hung child is not evidence that the current
  file still hangs, so check the existing result and revision first.
- Count every successful worker launch against the concurrency limit, including recovery
  and corrective turns. Pause new launches when memory pressure rises. On macOS, compressed
  memory can make `ps` RSS misleading; inspect physical footprint before adding workers.
  If the coordinator stalls, stop its schedulers first, record session ids, clients and
  queued instructions, then recover only your own service. Verify histories survived and
  resume the same sessions in bounded batches rather than restarting their audits.
- Check provider retry status and pending permission/question requests when work stops.
  A live process may be waiting for a report-directory permission rather than the model.
  Verify the requested action and its assigned paths before replying. Preserve context;
  before changing endpoints, abort the server turn through the session API, confirm the
  session is idle and its client exited, then continue the same OpenCode session. Killing
  an attached CLI alone does not prove the server turn stopped. Final handoff also
  requires no pending permission/question for that session. A stopped client or an old
  final message can coexist with a blocked tool request. Confirm ordinary logout and
  account absence before releasing the source hold; assign one actor to final cleanup.
- Reviews can run alongside other quests' implementations. Repair a quest only after its
  own source/review actor stops; unrelated quests do not need to wait. Freeze reviewed
  files and record the exact revision loaded by the static server for native proof.
- A frozen playthrough may run alongside a read-only review of the same revision. Label
  its evidence provisional until that review passes; never claim a pending review passed.
  Keep its source frozen until the player logs out. Any subsequent fix needs a new loaded
  revision and explicit validation of the affected route before accepting completion.

## Combat and dangerous steps

- Headless MCP logins play as a normal player (no passive developer immunity); `command`
  temporarily elevates only for that call.
- Heal, then make invulnerability explicit. `::infhp` **toggles** and prints
  `Invulnerable: true` or `Invulnerable: false`; the attribute is
  `admin:infinite-health`. Never assume it is on, and never toggle blindly:
  ```js
  async function ensureInvulnerable(call, player) {
    const state = (r) => {
      const m = r.messages || [];
      if (m.includes("Invulnerable: true")) return true;
      if (m.includes("Invulnerable: false")) return false;
      throw new Error("no invulnerability acknowledgement; stop");
    };
    let r = await call("command", { player, text: "infhp", ticks: 0 });
    if (state(r) === false) r = await call("command", { player, text: "infhp", ticks: 0 });
    if (!state(r)) throw new Error("invulnerability not acknowledged");
  }
  ```
  Re-verify on each login; a restart or relog can leave it off or on unexpectedly.
  Record the command and acknowledgement as a declared combat aid. Such a route does not
  certify unassisted damage balance. Disable immunity when a required mechanic needs the
  player to take damage; still play the real encounter, phases and quest handoffs.
- `set_npc_hitpoints` only lowers HP on a living, registered NPC in your private area/plane,
  within 32 tiles, after the real encounter is targetable. It never starts a fight and never
  changes quest state. Use it after the real entry/trigger, then land an ordinary hit through
  the normal combat path.
- Do not use or document unverified kill-all, force-complete or arbitrary state commands.
- Preserve thresholds and scene handoffs: if the quest needs the boss phase, the cutscene, the
  cage/door state or a specific tile, perform it normally; cheats after that must not skip it.

## End-to-end pass criteria

A quest is **not** passed because the stage reached the completion value. Capture all of these
around the run:

1. **Before baseline** (on the same account, after login and HEAL/infhp verification):
   quest points varp/saved value, all skill XP, inventory (ids, slots, amounts), equipment.
   Without a baseline, never claim a delta.
2. **Route**: mandatory legs performed normally in order; diagnostic positioning (teleports
   used to inspect a stuck state) is labelled and does not count as full play.
3. **Completion**: final dialogue/action, completion jingle/scroll, exact reward items and
   XP/QP deltas, each rewarded once. Take an immediate pre-completion snapshot as well as
   the opening baseline, so ordinary activity XP stays accounted for. At First Light's
   natural route gave 274 Hunter XP and 10 Crafting XP before its 4,500 Hunter reward.
4. **Repeat**: repeat the completion action; expect no duplicate reward.
5. **Relog**: log out and back in; stage and rewards persist, no duplicated items/XP, no
   changed state.
6. **Offline**: confirm the save was written (parent export/DB or an official checkpoint
   comparison), not just the live session.
7. **Post-quest**: the canonical post-quest dialogue/use still works.
8. **Recovery**: test the documented full-bag/pending, destroy/reclaim, bank/equipment, and
   interrupted-conversation cases where the quest has them. Pending rewards must become
   claimable through the canonical route; do not invent a cap or auto-grant.
9. **Visual/QH overlay** is a separate check from the source contract and headless MCP. There
   is no Java Quest Helper overlay installed here; say "not checked visually" honestly.

Never report "PASS" if a mandatory leg, reward, relog or post-quest check is missing.

## Recovery and rewards details

- Check the quest's own pending flag before assuming a generic reward handles a full bag. Example:
  The Final Dawn sets a pending bit when there are no free slots, and the canonical post-quest
  dialogue offers the blade again once exploration is done. Blood Moon and Sins have tome
  reclaim routes with their own guards. Read the source, then exercise the canonical route.
- Keep reward identities separate: reward item id, reward label, "once" attribute, and the
  pending/reclaim flag are different things. Verify each.
- Declare ordinary supplies, gear, skills and prerequisite-completion fixtures before the
  target quest baseline. Verified developer command forms include `quest <prerequisite
  name> complete`, `master`, `item <id> <amount>` and `tele <x> <y> <plane>`. Complete only the
  prerequisite, verify the target remains at stage zero, then record every XP/QP/item delta
  in the setup and capture the baseline. This does not prove the prerequisite was played.
  After that baseline, never grant target quest items or set target stages, varbits, events
  or handlers in a run claimed as natural. Use ordinary travel and item acquisition; boss
  damage assistance still requires the real encounter and hit described above.

## Tests

- Run focused tests once, from `server/`: build if the test loads `dist/`, then
  `node --test tests/<focused>.test.cjs`.
- A meaningful regression test dispatches the real handler and asserts the user-visible
  effect (menu, NPC, transform, message, reward once, relog state). It must fail before the fix
  and pass after. Do not write a test that re-implements the plugin logic.
- The integration owner runs the full suite on frozen hashes:
  `cd server && yarn build && node --test tests/*.test.cjs`.
  Compare failures by name against the base branch, not just a count. Report the exact set.
- No new smoke scripts in the repo; extend an existing test or explain manual verification.
- TS build only when needed (tests importing `dist`, or you changed TS).

## If you find a bug

Prefer a small, human-readable fix: plugin/domain data first, named ids (constants from
`ItemIdentifiers`/`NpcIdentifiers`/`ObjectIdentifiers`), domain custom events, no core
special-cases for one quest, no invisible global shims. Add the smallest test that fails
before the fix. Batch related fixes and reload once rather than one fix per restart.

Never hand-edit generated dialogue JSON to fix a conversation or resolve a merge.
All JSON imported from `RSPSApp/osrsreboxed-db` must be fixed in its source/parser/export
logic, regenerated and compared with a second dump from the same inputs. Import that
output, including its related index; disclose any mismatch. See the generated-data rules
in `AGENTS.md` and `server/AGENTS.md`.

Read the raw Wiki transcript before adding a correction. Follow its nesting, menus,
conditions and navigation references; repair shared parser or runtime semantics rather
than copying a repaired JSON branch into an override. Conditions after a choice must
observe that choice when reached. If a reference is genuinely ambiguous, document a
reviewed source anchor with stale-input checks and no copied dialogue. Unresolved
markers elsewhere still need review; a passing main route does not prove every branch.

## Review the whole quest, then review the fix

Build a compact checklist from Quest Helper's `setupRequirements`, `setupSteps`,
`loadSteps` and conditional branches. Record each required item, dialogue choice,
saved-stage/wire-value transition, puzzle/scene handoff and reward. Follow the connected
plugin handlers and transcript conditions, including other quests that share its NPCs.
Check the actual registration order; an isolated selector test cannot prove ownership.

At every irreversible handover, check interruption before/after the action, zero/one free
slots, existing stacks, bank/equipment ownership, and canonical lost-item recovery. Include
fresh stage 0, early/out-of-order talks, active competing quests, and completion on either
side of a shared-NPC boundary. Scope named object hooks by the actual id and location when
their name is shared. Test both the intended target and unrelated targets.

Before accepting a finding, establish a naturally reachable trigger and a supported expected
result. Prerequisites can make a proposed state impossible; consumed items can free slots;
stackable rewards can fit a full bag; another plugin can already provide the item. A direct
action call that skips a transcript's capacity condition is not a natural reproduction.
Classify findings as fixed, rejected with evidence, or still unchecked. Do not invent speech
or recovery mechanics to make a speculative test pass.

Review each patch for clear names, narrow stage windows, existing engine APIs and domain
events. Remove duplicate logic and mock-only production fallbacks; update test fixtures to
the real contract. Check that a priority fix releases the NPC after its owning step and
does not block a different quest's start or hand-in. Run meaningful red/green tests, freeze
all worker edits, run integration checks, then reload the slot once. Record source revision,
loaded revision and exact coverage; source review is not a new end-to-end playthrough.

Dialogue condition handlers also compete: the first boolean wins. Test foreign conditions
through the real plugin dispatch order, including an earlier quest with similar prose.
An unscoped Sins of the Father requirements check answered Mori's Ascent conditions before
Ascent's correct handler could run. Testing the owning handler alone missed that failure.

## Report template

```md
# <Quest> — <fresh|checkpoint> <phase>

Account / worktree / MCP port:
Source + commit/hash + loaded?:
Start: stage, tile, HP, key items, infhp acknowledged
Legs: <ordered, stage transitions, actual menus/ids>
Blockers: <exact message/tile/object/source predicate; 2-attempt limit reached?>
Baseline -> after: QP, all skill XP, inventory, equipment (exact deltas)
Rewards: ids/amounts, once verified?, repeat verified?
Relog: stage/rewards persisted?, infhp re-checked?
Offline write verified:
Post-quest:
Recovery cases:
Visual/QH overlay: checked / not checked
Evidence paths (compact):
Limits/non-claims:
```

## Commit, push, PR, replies

Commit, push and update the PR when authorized; existing authorization persists across turns.
In **this repository** the requested identity is **NH via `rsps-shell`**
(`zsh -ic 'rsps-shell -c "<command>"'` with the RSPS GH config/SSH key), author `nharrison93`, never a
hardcoded personal identity copied from another repo. No merge/close/publish beyond the
requested action.

## Honest limits

Quest Helper is a route guide, not a verifier. Source tests, native MCP routes, negative
predicate checks and the live client overlay prove different things; no one of them guarantees
a 1:1 match on every branch. State which one you actually ran.
