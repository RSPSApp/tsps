// After yarn build: node --test --test-concurrency=1 tests/sir-tiffy-armour-native.test.cjs
// Ordinary decoded NPC/menu/shop inputs at supplied quest checkpoints and Falador
// placement. Materials/prerequisites are setup; no natural quest or rendered proof.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict"), path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Runtime = require("../plugins/quests/QuestRuntime");
const INITIATE = 1172, PROSELYTE = 1280;
const ARMOUR = [[5574, "Initiate sallet", "basic_tk_helm", 6000],
  [5575, "Initiate hauberk", "basic_tk_body", 10000],
  [5576, "Initiate cuisse", "basic_tk_legs", 8000]];
let core, tiffy, spawned = false, serial = 0, oldError, oldSubmit;
const errors = [], tasks = new Set();
before(async () => {
  oldError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi();
  oldSubmit = core.TaskManager.submit;
  core.TaskManager.submit = function(task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  core.RegionManager.init(); core.RegionManager.loadMapFiles(2997, 3373);
  PM.emitServerStartup({});
  const row = require("../data/definitions/npc-spawns.json").find(r => r.id === 4687);
  assert.deepEqual([row.x, row.y, row.level], [2997, 3373, 0], "canonical seated Tiffy spawn");
  tiffy = [...core.World.getNpcs()].find(n => n.getId() === row.id && n.getLocation().getX() === row.x && n.getLocation().getY() === row.y);
  if (!tiffy) { tiffy = PM.spawnNpc({ id: row.id, x: row.x, y: row.y, z: row.level, wanderRadius: 0 }); spawned = true; }
  assert.ok(tiffy?.isRegistered());
});
after(() => {
  try {
    if (spawned && tiffy?.isRegistered()) PM.removeNpc(tiffy);
    PM.emitServerShutdown({});
    for (const task of tasks) if (task.isRunning()) task.stop();
    assert.deepEqual(errors, [], "no swallowed engine/plugin errors");
  } finally { console.error = oldError; if (core) core.TaskManager.submit = oldSubmit; }
});
function quest(key) { const q = Runtime.getRegisteredQuests().find(q => q.key === key); assert.ok(q, key); return q; }
function seed(p, key, stage) { const q = quest(key); q.setStage(p, stage ?? q.completionValue); assert.equal(q.getStage(p), stage ?? q.completionValue); }
function turn() { core.World.process(); }
function actor(t, rd = 4) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel), p = new Player(session), c = new ClientConnection(channel);
  c.player = p; session.setPlayer(p); session.setTurnPacketProcessor(() => c.processTurnPackets());
  p.setUsername(`tiffy${++serial}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute("bot-skip-persistence", true); assert.equal(core.World.getPlayers().add(p), true);
  const stock = [INITIATE, PROSELYTE].map(id => [id, new Map(core.ShopManager.shopsById.get(id).stock)]);
  t.after(() => {
    const index = p.getIndex();
    PM.emitPlayerDisconnect({ player: p, username: p.getUsername() }); PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.closeInterruptibleInterfaces(); core.ShopManager.close(p);
    p.getMovementQueue().reset(); p.getMovementQueue().walkToReset();
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(index); core.World.getPlayers().remove(p);
    for (const [id, entries] of stock) { const s = core.ShopManager.shopsById.get(id).stock; s.clear(); for (const [item, n] of entries) s.set(item, n); }
    assert.equal(p.isRegistered(), false); assert.equal(core.TaskManager.hasActiveTask(p), false); assert.equal(core.TaskManager.hasActiveTask(index), false);
  });
  seed(p, "black_knights_fortress"); seed(p, "druidic_ritual"); seed(p, "recruitment_drive", rd);
  const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) =>
    core.RegionManager.canMove(2997 + dx, 3373 + dy, 2997, 3373, 0, 1, 1, null)
    && !core.RegionManager.blocked(new core.Location(2997 + dx, 3373 + dy, 0), null));
  assert.ok(adjacent, "real spawn has a walkable adjacent tile");
  p.moveTo(new core.Location(2997 + adjacent[0], 3373 + adjacent[1], 0));
  assert.equal(p.isNeedsPlacement(), true, "placement starts pending");
  const cycle = core.World.getProcessCycle();
  for (let i = 0; i < 4 && p.isNeedsPlacement(); i++) turn();
  assert.ok(core.World.getProcessCycle() > cycle); assert.equal(p.isNeedsPlacement(), false, "World settles placement");
  assert.equal(p.isRegistered(), true); assert.ok(p.getHitpoints() > 0); assert.equal(p.busy(), false);
  assert.equal(p.getPrivateArea(), null); assert.equal(core.WorldDefinition.isMembersWorld(), true);
  const messages = [], send = p.sendMessage.bind(p); p.sendMessage = text => { messages.push(text); return send(text); };
  return { p, c, messages };
}
async function input(f, packet) { await f.c.dispatch([packet]); for (let i = 0; i < 4; i++) turn(); }
function current(f) { return f.p.getDialogueManager().getCurrent(); }
function options(f) { return core.MultiChatboxPrompt.getPending(f.p)?.options ?? current(f)?.getOptions?.() ?? []; }
function text(f) { return String(current(f)?.getText?.() ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "); }
async function advance(f) {
  assert.equal(options(f).length, 0, "a menu needs explicit selection");
  const group = f.p.getPacketSender().getChatboxGroupId(), child = { 193: 0, 229: 4, 11: 4, 217: 5, 231: 5 }[group];
  assert.ok(Number.isInteger(child), `owned Continue group ${group}: ${text(f)}`);
  await input(f, { type: "dialogue_continue", widgetId: (group << 16) | child, childIndex: group === 193 ? 0 : -1 });
}
async function menu(f) {
  for (let i = 0; i < 100 && !options(f).length; i++) { assert.ok(current(f), "ordinary dialogue remains active before menu"); await advance(f); }
  assert.ok(options(f).length, "ordinary dialogue reaches choice"); return options(f);
}
async function choose(f, label) {
  const opts = await menu(f), n = opts.findIndex(o => (typeof o === "string" ? o : o.getText?.() ?? o.text) === label);
  assert.ok(n >= 0, `ordinary option ${label}; got ${JSON.stringify(opts)}`);
  await input(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: n + 1 });
}
async function drain(f) {
  for (let i = 0; i < 120 && current(f); i++) { assert.equal(options(f).length, 0); await advance(f); }
  assert.equal(current(f), undefined, "dialogue completes within bound");
}
async function talk(f) {
  f.p.closeInterruptibleInterfaces();
  const d = tiffy.getCurrentDefinition(f.p), clickType = d.getActions().indexOf("Talk-to") + 1;
  assert.equal(d.getId(), 4687); assert.equal(d.getName(), "Sir Tiffy Cashien"); assert.ok(clickType > 0);
  assert.equal(f.p.isNeedsPlacement(), false);
  let reached = 0; const emit = PM.emitNpcInteraction;
  PM.emitNpcInteraction = function(e) { if (e.player === f.p) { reached++; assert.equal(e.npc, tiffy); assert.equal(e.npcId, d.getId()); assert.equal(e.clickType, clickType); } return emit.call(this, e); };
  try { await input(f, { type: "npc_option", index: tiffy.getIndex(), clickType }); assert.equal(reached, 1, "decoded NPC input reaches exact registered actor once"); }
  finally { PM.emitNpcInteraction = emit; }
}
function add(f, id, n = 1) { f.p.getInventory().add(new core.Item(id, n), true); assert.ok(f.p.getInventory().getAmount(id) >= n); }
function amount(f, id) { return f.p.getInventory().getAmount(id); }
function shop(f, expected) {
  assert.equal(core.ShopManager.isOpen(f.p), true, "actual shop status/interface opened, not boolean open() result");
  assert.equal(core.ShopManager.activeShopByPlayer.get(f.p), expected, "exact active armoury");
  assert.equal(f.p.getInterfaceId(), core.ShopManager.MAIN_INTERFACE_ID);
}
async function armour(f, expected = INITIATE, label = "Can I buy some armour?") {
  await choose(f, label);
  for (let i = 0; i < 20 && !core.ShopManager.isOpen(f.p); i++) { assert.ok(current(f), "purchase dialogue precedes shop"); await advance(f); }
  shop(f, expected);
}
async function buy(f, id, expected = INITIATE) {
  shop(f, expected);
  const s = core.ShopManager.shopsById.get(expected), slot = core.ShopManager.displayEntries(s, f.p).findIndex(row => row.itemId === id);
  assert.ok(slot >= 0, "actual visible stock contains requested item");
  await input(f, { type: "widget_action", widgetId: (core.ShopManager.MAIN_INTERFACE_ID << 16) | 16,
    groupId: core.ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 1, slot: slot + 1, itemId: id, option: "Buy 1" });
}
function wantedEligible(f) { seed(f.p, "the_lost_tribe"); seed(f.p, "priest_in_peril"); f.p.setAttribute("quest.points", 32); }
function slugEligible(f) {
  wantedEligible(f); seed(f.p, "wanted"); seed(f.p, "sea_slug");
  for (const skill of [core.Skill.CRAFTING, core.Skill.RUNECRAFTING, core.Skill.SLAYER, core.Skill.THIEVING]) {
    f.p.getSkillManager().setMaxLevel(skill, 30).setCurrentLevel(skill, 30, false);
    assert.equal(f.p.getSkillManager().getMaxLevel(skill), 30);
  }
}

test("control: active cache and generated stock define real Tiffy and initiate items", () => {
  assert.equal(core.CacheDefinitions.getNpcId("rd_teleporter_guy"), 4687);
  for (const [id, name, symbol, price] of ARMOUR) {
    assert.equal(core.CacheDefinitions.getObjId(symbol), id); const d = core.ItemDefinition.forId(id);
    assert.equal(d.getName(), name); assert.equal(d.isNoted(), false); assert.equal(d.getValue(), price);
  }
  const s = core.ShopDefinition.forId(INITIATE); assert.equal(s.getName(), "Initiate Temple Knight Armoury");
  assert.deepEqual(s.getOriginalStock().map(row => [row.id, row.amount]), [[5574, 30], [5576, 30], [5575, 30], [9668, 30]]);
});
test("post-Recruitment Drive ordinary menu offers armour and sells all three pieces at exact prices", async t => {
  const f = actor(t); add(f, 995, 50000);
  assert.equal(quest("recruitment_drive").isComplete(f.p), true); assert.equal(quest("wanted").getStage(f.p), 0);
  await talk(f); assert.match(text(f), /Hello|Jolly good show|spiffing/i, "ordinary Tiffy dialogue is a working admission control");
  await armour(f);
  let coins = 50000;
  for (const [id, , , price] of ARMOUR) { const stock = core.ShopManager.shopsById.get(INITIATE).stock.get(id); await buy(f, id); coins -= price;
    assert.equal(amount(f, id), 1); assert.equal(amount(f, 995), coins); assert.equal(core.ShopManager.shopsById.get(INITIATE).stock.get(id), stock - 1); }
  await buy(f, 5574); assert.equal(amount(f, 5574), 2); assert.equal(amount(f, 995), coins - 6000, "repeat purchase is paid");
  assert.equal(quest("recruitment_drive").getStage(f.p), 4); assert.equal(quest("wanted").getStage(f.p), 0);
});
test("Wanted-eligible stage zero keeps armour and its ordinary jobs offer/start", async t => {
  const f = actor(t); wantedEligible(f); add(f, 995, 6000); await talk(f); await armour(f); await buy(f, 5574);
  assert.equal(amount(f, 5574), 1); assert.equal(quest("wanted").getStage(f.p), 0);
  await talk(f); await choose(f, "Do you have any jobs for me yet?"); await choose(f, "Yes.");
  assert.equal(quest("wanted").getStage(f.p), 1, "existing Wanted start hook still progresses once");
  assert.equal(f.p.getAttribute("quest.points"), 32);
});
test("active Wanted keeps its quest topic and existing armour choice opens a paid shop", async t => {
  const f = actor(t); wantedEligible(f); seed(f.p, "wanted", 1); add(f, 995, 10000);
  await talk(f); const opts = await menu(f); assert.ok(opts.includes("Ask about the Wanted! Quest"));
  await armour(f, INITIATE, "Ask about buying armour"); await buy(f, 5575);
  assert.equal(amount(f, 5575), 1); assert.equal(amount(f, 995), 0); assert.equal(quest("wanted").getStage(f.p), 1);
});
for (const full of [false, true]) test(`purchase refusal conserves stock/items/coins: ${full ? "full bag" : "insufficient coins"}`, async t => {
  const f = actor(t); add(f, 995, full ? 10000 : 5999);
  if (full) while (f.p.getInventory().getFreeSlots() > 0) add(f, 1511);
  await talk(f); await armour(f); const stock = core.ShopManager.shopsById.get(INITIATE).stock.get(5574), coins = amount(f, 995);
  await buy(f, 5574); assert.equal(amount(f, 5574), 0); assert.equal(amount(f, 995), coins); assert.equal(core.ShopManager.shopsById.get(INITIATE).stock.get(5574), stock);
  assert.ok(f.messages.some(s => full ? /space|room/i.test(s) : /enough coins/i.test(s)), "meaningful refusal feedback");
});
test("before Recruitment Drive the ordinary greeting has no armour; existing shop gate refuses", async t => {
  const f = actor(t, 0); await talk(f); assert.match(text(f), /Spiffing|Hello/i); await drain(f);
  assert.equal(core.ShopManager.isOpen(f.p), false);
  // A separate direct gate assertion verifies defence in depth; this is not a claimed ordinary purchase.
  core.ShopManager.open(f.p, INITIATE); assert.equal(core.ShopManager.isOpen(f.p), false); assert.equal(core.ShopManager.activeShopByPlayer.get(f.p), undefined);
  assert.ok(f.messages.some(s => /complete Recruitment Drive/.test(s)));
});
test("ordinary Recruitment Drive final hand-in rewards once; later armour talks do not pay again", async t => {
  const f = actor(t, 3), q = quest("recruitment_drive"), skills = [core.Skill.PRAYER, core.Skill.HERBLORE, core.Skill.AGILITY];
  const xp = skills.map(s => f.p.getSkillManager().getExperience(s));
  f.p.setAttribute("quest.points", 0); await talk(f); await drain(f);
  assert.equal(q.getStage(f.p), 4); assert.equal(amount(f, 5574), 1); assert.equal(amount(f, 995), 3000); assert.equal(f.p.getAttribute("quest.points"), 1);
  const paidXp = skills.map(s => f.p.getSkillManager().getExperience(s));
  paidXp.forEach((n, i) => assert.equal(n - xp[i], Math.floor(1000.5 * core.GameConstants.EXPERIENCE_MULTIPLIER * 10 + 1e-6) / 10));
  await talk(f); await armour(f); assert.equal(amount(f, 5574), 1); assert.equal(amount(f, 995), 3000); assert.equal(f.p.getAttribute("quest.points"), 1);
  assert.deepEqual(skills.map(s => f.p.getSkillManager().getExperience(s)), paidXp);
});
test("post-Wanted without Slug prerequisites uses common initiate menu", async t => {
  const f = actor(t); wantedEligible(f); seed(f.p, "wanted"); await talk(f); assert.match(text(f), /White Knights/); await armour(f);
});
test("active Slug keeps its mission, common armour topic and Commorb", async t => {
  const f = actor(t); slugEligible(f); seed(f.p, "the_slug_menace", 1); add(f, 9681);
  await talk(f); assert.ok((await menu(f)).includes("Slug Menace.")); await choose(f, "Slug Menace.");
  await armour(f); assert.equal(quest("the_slug_menace").getStage(f.p), 1); assert.equal(amount(f, 9681), 1);
});
test("Slug common-topic exit offers armour without starting or changing its mission", async t => {
  const f = actor(t); slugEligible(f); seed(f.p, "the_slug_menace", 1); add(f, 9681);
  await talk(f); await choose(f, "Something else."); await armour(f);
  assert.equal(quest("the_slug_menace").getStage(f.p), 1); assert.equal(amount(f, 9681), 1);
});
test("eligible pre-Slug lost Commorb still reclaims the original orb", async t => {
  const f = actor(t); slugEligible(f); await talk(f); assert.match(text(f), /lost my CommOrb/i); await drain(f);
  assert.equal(amount(f, core.ItemIdentifiers.COMMORB), 1); assert.equal(amount(f, core.ItemIdentifiers.COMMORB_V2), 0);
  assert.equal(quest("the_slug_menace").getStage(f.p), 0);
});
test("completed Slug keeps Proselyte armoury and paid initiate stock", async t => {
  const f = actor(t); slugEligible(f); seed(f.p, "the_slug_menace"); add(f, 9681); add(f, 995, 8000);
  await talk(f); assert.match(text(f), /Proselyte/); await armour(f, PROSELYTE); await buy(f, 5576, PROSELYTE);
  assert.equal(amount(f, 5576), 1); assert.equal(amount(f, 995), 0); assert.equal(amount(f, 9681), 1);
});
test("Devious Minds hand-in retains priority over completed Slug and completes once", async t => {
  const f = actor(t); slugEligible(f); seed(f.p, "the_slug_menace"); seed(f.p, "devious_minds", 9); add(f, 9681);
  await talk(f); assert.ok((await menu(f)).includes("Devious Minds.")); await choose(f, "Devious Minds."); await drain(f);
  assert.equal(quest("devious_minds").isComplete(f.p), true); const points = f.p.getAttribute("quest.points");
  await talk(f); await armour(f, PROSELYTE); assert.equal(f.p.getAttribute("quest.points"), points); assert.equal(amount(f, 9681), 1);
});
