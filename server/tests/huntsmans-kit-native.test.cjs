// After yarn build: node --test --test-concurrency=1 tests/huntsmans-kit-native.test.cjs
// Decoded inventory/use/resume/loc inputs on real Players through ClientConnection and World.
// Quest completion, items and positions are supplied setup, not a natural quest playthrough or rendered proof.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict"), path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const KIT = 29309, GROUP = 871, SIDE = 872, STORE = "storage-items:huntsmans-kit";
// Canonical Wiki item families mapped to cache242 gamevals, not all same-name quest objects.
const ELIGIBLE = [303,596,954,9948,9949,9950,10006,10008,10010,10012,10025,10027,10028,10029,10031,
  10035,10037,10039,10041,10043,10045,10047,10049,10051,10053,10055,10057,10059,10061,10063,
  10065,10067,10150,11259,11260,21126,28839,28842,28845,28848,28851,28854,28857,28860,
  29263,29265,29267,29269,29305,31235,31241,31243,34631];
let core, serial = 0, oldError, oldWarn, oldLog, oldSubmit;
const errors = [], tasks = new Set();
before(async () => {
  oldError = console.error; oldWarn = console.warn; oldLog = console.log;
  console.log = (...args) => { if (args.some(value => value instanceof Error)) errors.push(args.map(String).join(" ")); oldLog(...args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  console.warn = (...args) => { if (/\[plugins\].*hook.*(?:failed|threw)/.test(args.map(String).join(" "))) errors.push(args.map(String).join(" ")); oldWarn(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi();
  oldSubmit = core.TaskManager.submit;
  core.TaskManager.submit = function(task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3115, 3450);
  PM.emitServerStartup({});
});
after(() => {
  try {
    PM.emitServerShutdown({});
    for (const task of tasks) if (task.isRunning()) task.stop();
    assert.deepEqual(errors, [], "no swallowed engine/plugin errors");
  } finally { console.error = oldError; console.warn = oldWarn; console.log = oldLog; if (core) core.TaskManager.submit = oldSubmit; }
});
function turn() { core.World.process(); }
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel), p = new Player(session), c = new ClientConnection(channel);
  c.player = p; session.setPlayer(p); session.setTurnPacketProcessor(() => c.processTurnPackets());
  p.setUsername(`huntkit${++serial}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute("bot-skip-persistence", true); assert.equal(core.World.getPlayers().add(p), true);
  p.moveTo(new core.Location(3115, 3449, 0));
  for (let n = 0; n < 4 && p.isNeedsPlacement(); n++) turn();
  assert.equal(p.isNeedsPlacement(), false); assert.equal(p.isRegistered(), true); assert.ok(p.getHitpoints() > 0);
  const messages = [], strings = [], scripts = [], models = [], inventories = [];
  const out = p.getPacketSender();
  for (const [method, rows] of [["sendString", strings], ["sendClientScript", scripts], ["sendInterfaceRawModel", models], ["sendInventory", inventories]]) {
    const original = out[method].bind(out); out[method] = (...args) => { rows.push(args); return original(...args); };
  }
  const send = p.sendMessage.bind(p); p.sendMessage = text => { messages.push(text); return send(text); };
  t.after(() => {
    const index = p.getIndex();
    for (const item of [...core.World.getItems()]) if (item.getOwner() === p.getUsername()) {
      core.ItemOnGroundManager.deregister(item);
      const n = core.World.getItems().indexOf(item); if (n >= 0) core.World.getItems().splice(n, 1);
    }
    assert.equal(core.World.getItems().some(item => item.getOwner() === p.getUsername()), false);
    PM.emitPlayerDisconnect({ player: p, username: p.getUsername() }); PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.closeInterruptibleInterfaces(); p.getMovementQueue().reset(); p.getMovementQueue().walkToReset();
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(index); core.World.getPlayers().remove(p);
    assert.equal(p.isRegistered(), false); assert.equal(core.TaskManager.hasActiveTask(p), false); assert.equal(core.TaskManager.hasActiveTask(index), false);
  });
  return { p, c, messages, strings, scripts, models, inventories };
}
async function input(f, packet, ticks = 1) { await f.c.dispatch([packet]); for (let n = 0; n < ticks; n++) turn(); }
function add(f, id, n = 1) { const before = amount(f, id); f.p.getInventory().adds(id, n); assert.equal(amount(f, id), before + n); }
function amount(f, id) { return f.p.getInventory().getAmount(id); }
function slot(f, id) { const n = f.p.getInventory().getSlotForItemId(id); assert.ok(n >= 0, `physical item ${id}`); return n; }
async function action(f, option, id = KIT) {
  await input(f, { type: "inventory_action", widgetId: 3214, itemId: id, slot: slot(f, id), option,
    optionIndex: { View: 1, Fill: 2, Empty: 3, Destroy: 5, Open: 1 }[option] });
}
async function view(f) {
  await input(f, { type: "widget_action", widgetId: 149 << 16, groupId: 149, childId: 0,
    buttonNum: 2, slot: slot(f, KIT), itemId: KIT });
}
async function grid(f, group, sub, id, op = 1) {
  const child = group === GROUP ? 11 : 0;
  await input(f, { type: "widget_action", widgetId: (group << 16) | child, groupId: group,
    childId: child, buttonNum: op, slot: sub, itemId: id });
}
async function button(f, child) {
  await input(f, { type: "widget_action", widgetId: (GROUP << 16) | child, groupId: GROUP,
    childId: child, buttonNum: 1, slot: -1, itemId: -1 });
}
function saved(f) { return f.p.getAttribute(STORE) ?? []; }
function stored(f, id) { return saved(f).reduce((sum, row) => sum + (row?.[0] === id ? row[1] : 0), 0); }
function snapshot(f) { return f.inventories.filter(([id]) => id === 855).at(-1); }
function kit(f) { add(f, KIT); }

test("View reaches the empty native kit and captured take-out/deposit inputs conserve inventory", async t => {
  const f = actor(t); kit(f);
  assert.equal(core.CacheDefinitions.getItem(KIT).inventoryActions[0], "View");
  assert.equal(core.CacheDefinitions.getComponentId("huntsmans_kit:items"), (GROUP << 16) | 11);
  assert.equal(core.CacheDefinitions.getComponentId("huntsmans_kit_side:items"), SIDE << 16);
  await view(f);
  assert.equal(f.p.getInterfaceId(), GROUP, "View must open native Huntsman's kit interface");
  assert.equal(snapshot(f)[1], 32); assert.equal(snapshot(f)[2].filter(Boolean).length, 0);
  add(f, 303, 2); add(f, 954, 2);
  await grid(f, SIDE, slot(f, 303), 303); await grid(f, SIDE, slot(f, 954), 954);
  assert.equal(amount(f, 303), 1); assert.equal(stored(f, 303), 1);
  assert.equal(amount(f, 954), 1); assert.equal(stored(f, 954), 1);
  await grid(f, GROUP, 0, 303); await grid(f, GROUP, 1, 954);
  assert.equal(amount(f, 303), 2); assert.equal(amount(f, 954), 2);
  assert.equal(stored(f, 303), 0); assert.equal(stored(f, 954), 0);
});

test("Fill accepts every supported cache variant and leaves excluded, noted, preset and metadata items physical", async t => {
  for (const id of ELIGIBLE) {
    const f = actor(t); kit(f); add(f, id); await action(f, "Fill");
    assert.equal(amount(f, id), 0, `eligible ${id} moved`); assert.equal(stored(f, id), 1);
    await action(f, "Empty"); assert.equal(amount(f, id), 1); assert.equal(stored(f, id), 0);
  }
  const f = actor(t); kit(f);
  for (const id of [946,995,10033,10034,10092,4498,6209,7155,11046,20587,11268,29310]) {
    add(f, id); await action(f, "Fill"); assert.equal(amount(f, id), 1, `unsupported ${id} retained`); assert.equal(stored(f, id), 0);
  }
  const noted = core.ItemDefinition.forId(954).getNoteId(); assert.notEqual(noted, 954);
  add(f, noted); await action(f, "Fill"); assert.equal(amount(f, noted), 1);
  for (const meta of [{ proof: "retain" }, { preset: true }]) {
    add(f, 954); const item = f.p.getInventory().getItems()[slot(f, 954)]; item.setMeta(meta);
    await action(f, "Fill"); assert.deepEqual(item.getMeta(), meta); assert.equal(stored(f, 954), 0);
    f.p.getInventory().deleteAtSlot(f.p.getInventory().getItems().indexOf(item), 1);
  }
});

test("32 different types fit; a 33rd stays physical while an existing type can still grow", async t => {
  const f = actor(t); kit(f);
  for (const id of ELIGIBLE.slice(0, 32)) { add(f, id); await action(f, "Fill"); assert.equal(stored(f, id), 1); }
  assert.equal(saved(f).filter(Boolean).length, 32);
  const extra = ELIGIBLE[32]; add(f, extra); await action(f, "Fill"); assert.equal(amount(f, extra), 1); assert.equal(stored(f, extra), 0);
  add(f, 303); await action(f, "Fill"); assert.equal(stored(f, 303), 2); assert.equal(amount(f, 303), 0);
});

test("quantity buttons and direct 1/5/X/All operations preserve units in both grids", async t => {
  assert.equal(core.ItemDefinition.forId(10008).isStackable(), true, "cache-owned stackability wins over legacy JSON");
  const f = actor(t); kit(f); add(f, 10008, 30); await view(f);
  await button(f, 5); await grid(f, SIDE, slot(f, 10008), 10008); assert.equal(stored(f, 10008), 5);
  await button(f, 6); await grid(f, SIDE, slot(f, 10008), 10008);
  await input(f, { type: "dialogue_amount", amount: 7 }); assert.equal(stored(f, 10008), 12);
  await button(f, 7); await grid(f, SIDE, slot(f, 10008), 10008); assert.equal(stored(f, 10008), 30);
  await grid(f, GROUP, 0, 10008, 2); assert.equal(amount(f, 10008), 1);
  await grid(f, GROUP, 0, 10008, 3); assert.equal(amount(f, 10008), 6);
  await grid(f, GROUP, 0, 10008, 4); await input(f, { type: "dialogue_amount", amount: 4 }); assert.equal(amount(f, 10008), 10);
  await grid(f, GROUP, 0, 10008, 5); assert.equal(amount(f, 10008), 30); assert.equal(stored(f, 10008), 0);
  const rope = actor(t); kit(rope);
  assert.equal(core.ItemDefinition.forId(954).isStackable(), false);
  add(rope, 954, 20); await view(rope);
  await grid(rope, SIDE, slot(rope, 954), 954, 3); assert.equal(stored(rope, 954), 5); assert.equal(amount(rope, 954), 15);
  await grid(rope, SIDE, slot(rope, 954), 954, 4); await input(rope, { type: "dialogue_amount", amount: 7 });
  assert.equal(stored(rope, 954), 12); assert.equal(amount(rope, 954), 8);
  await grid(rope, SIDE, slot(rope, 954), 954, 5); assert.equal(stored(rope, 954), 20); assert.equal(amount(rope, 954), 0);
});

test("holes survive withdrawal, drag swaps native slots, and Empty starts from the last slot", async t => {
  const f = actor(t); kit(f); add(f, 303); add(f, 954); add(f, 596); await action(f, "Fill"); await view(f);
  await grid(f, GROUP, 1, 954); assert.equal(saved(f)[1], null); assert.equal(saved(f)[2][0], 596);
  await input(f, { type: "widget_drag", sourceWidgetId: (GROUP << 16) | 11, targetWidgetId: (GROUP << 16) | 11, sourceSlot: 0, targetSlot: 31 });
  assert.equal(saved(f)[0], null); assert.equal(saved(f)[31][0], 303);
  while (f.p.getInventory().getFreeSlots()) add(f, 1511);
  f.p.getInventory().deleteNumber(1511, 1); await action(f, "Empty");
  assert.equal(amount(f, 303), 1, "last slot emptied into only free inventory slot"); assert.equal(stored(f, 596), 1);
  f.p.getInventory().deleteNumber(1511, 2); await action(f, "Empty"); assert.equal(amount(f, 596), 1);
});

test("full inventory and signed-int stack headroom never lose stored or physical items", async t => {
  const f = actor(t); kit(f); add(f, 303); await action(f, "Fill");
  while (f.p.getInventory().getFreeSlots()) add(f, 1511);
  await action(f, "Empty"); assert.equal(stored(f, 303), 1); assert.equal(amount(f, 303), 0);
  const other = actor(t); kit(other); add(other, 10008, 0x7fffffff); await action(other, "Fill");
  add(other, 10008, 2); await action(other, "Fill"); assert.equal(amount(other, 10008), 2); assert.equal(stored(other, 10008), 0x7fffffff);
  await view(other); await grid(other, GROUP, 0, 10008, 5);
  assert.equal(amount(other, 10008), 0x7fffffff); assert.equal(stored(other, 10008), 2);
});

test("wrong IDs, unsupported ops, stale interfaces and stale amount replies cannot mutate contents", async t => {
  const f = actor(t), other = actor(t); kit(f); add(f, 954, 3); await action(f, "Fill"); await view(f);
  await grid(f, GROUP, 0, 303); await grid(f, GROUP, 0, 954, 6); await grid(other, GROUP, 0, 954);
  assert.equal(stored(f, 954), 3); assert.equal(amount(other, 954), 0);
  await grid(f, GROUP, 0, 954, 4); f.p.getPacketSender().sendInterfaceRemoval();
  await input(f, { type: "dialogue_amount", amount: 2 }); assert.equal(stored(f, 954), 3);
  await view(f); await grid(f, GROUP, 0, 954, 4);
  f.p.getInventory().deleteNumber(KIT, 1); kit(f);
  await input(f, { type: "dialogue_amount", amount: 2 }); assert.equal(stored(f, 954), 3);
  await view(f); await grid(f, GROUP, 0, 954, 4); await grid(f, GROUP, 0, 954, 2);
  await input(f, { type: "dialogue_amount", amount: 2 }); assert.equal(stored(f, 954), 2, "intervening storage change invalidates old prompt");
  await grid(f, GROUP, 32, 954); assert.equal(stored(f, 954), 2, "extra cache display slot cannot be used as storage");
  const physical = slot(f, 954); await grid(f, SIDE, physical, 954, 4);
  await input(f, { type: "widget_drag", sourceWidgetId: SIDE << 16, targetWidgetId: SIDE << 16, sourceSlot: physical, targetSlot: 27 });
  assert.equal(f.p.getInventory().getItems()[27].getId(), 954);
  await input(f, { type: "dialogue_amount", amount: 1 }); assert.equal(stored(f, 954), 2, "moved clicked source invalidates old deposit prompt");
});

test("actual JSON save/load and banking preserve contents without providing stored tools to Hunter", async t => {
  const f = actor(t), loaded = actor(t); kit(f); add(f, 10150); await action(f, "Fill");
  const C = require("../plugins/skills/hunter/Context.Hunter"); assert.equal(C.hasTool(f.p, 10150), false);
  const persistence = new (require("../plugins/persistence/JsonPlayerPersistence.plugin").JsonPlayerPersistence)();
  const raw = JSON.stringify(PlayerSave.fromPlayer(f.p), persistence.replacer.bind(persistence));
  persistence.hydratePlayerSave(JSON.parse(raw, persistence.reviver.bind(persistence))).applyToPlayer(loaded.p);
  assert.equal(stored(loaded, 10150), 1); assert.equal(amount(loaded, KIT), 1);
  loaded.p.getInventory().deleteNumber(KIT, 1); loaded.p.getBank(0).adds(KIT, 1);
  await grid(loaded, GROUP, 0, 10150); assert.equal(amount(loaded, 10150), 0);
  loaded.p.getBank(0).deleteNumber(KIT, 1); kit(loaded); await action(loaded, "Empty"); assert.equal(amount(loaded, 10150), 1);
});

test("Destroy confirmation cancellation preserves the kit; confirmation clears its contents", async t => {
  const f = actor(t); kit(f); add(f, 954); await action(f, "Fill");
  for (const answer of [0, 1]) {
    await action(f, "Destroy"); assert.equal(f.p.getPacketSender().getChatboxGroupId(), 584);
    assert.ok(f.scripts.some(([id, ...args]) => id === 814 && args.some(x => typeof x === "string" && x.includes("contains items"))));
    await input(f, { type: "dialogue_continue", widgetId: 584 << 16, childIndex: answer });
    assert.equal(amount(f, KIT), answer ? 0 : 1); assert.equal(stored(f, 954), answer ? 0 : 1);
  }
  kit(f); await view(f); assert.equal(snapshot(f)[2].filter(Boolean).length, 0);
});

test("normal and Wilderness PvM/PvP death and reclaim preserve kit contents", async t => {
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  for (const [wild, pvp] of [[false,false],[true,false],[true,true]]) {
    const f = actor(t), killer = pvp ? actor(t).p : null; kit(f); add(f, 954, 2); await action(f, "Fill");
    if (wild) { core.RegionManager.loadMapFiles(3094, 3525); f.p.moveTo(new core.Location(3094, 3525, 0)); for (let n=0;n<4&&f.p.isNeedsPlacement();n++) turn(); assert.equal(f.p.isNeedsPlacement(), false); assert.equal(core.Wilderness.isIn(f.p), true); }
    PM.emitCustomEvent("gravestones:met-death", { player: f.p });
    f.p.setSkullType(core.SkullType.WHITE_SKULL); f.p.setSkullTimer(100);
    const kept = PlayerDeathTask.dropItems(f.p, killer, f.p.getLocation());
    assert.equal(stored(f, 954), 2); assert.equal(amount(f, 954), 0);
    PlayerDeathTask.returnKeptItems(f.p, kept);
    if (!pvp) {
      assert.equal(amount(f, KIT), 0, "skulled PvM must actually lose this unprotected kit to a grave");
      const q = { player:f.p, grave:null,office:[] }; PM.emitCustomEvent("gravestones:state",q);
      assert.ok(q.grave?.items.some(x=>x.id===KIT), "lost kit is reclaimable in the actual grave");
      // Use actual grave take operation, without a second synthetic copy of the kit.
      const Grave = require("../plugins/world/gravestones/Grave.Gravestones");
      Grave.takeFree(f.p); Grave.payOrTake(f.p);
      assert.equal(amount(f, KIT), 1);
    }
    await action(f, "Empty"); assert.equal(amount(f, 954), 2); assert.equal(stored(f, 954), 0);
  }
});

function forceKitRolls() {
  const C = require("../plugins/skills/hunter/Context.Hunter"), original = C.roll;
  let rare = 0;
  C.roll = function(min,max) {
    if (!new Error().stack.split("\n")[2].includes("sackRewards")) return original(min,max);
    if (min === 1 && max === 50) return ++rare === 1 ? 1 : 2;
    return min;
  };
  return () => { C.roll = original; };
}
test("loot sacks reject duplicate kits held physically, banked or awaiting reclamation", async t => {
  const sack = core.ItemIdentifiers.HUNTERS_LOOT_SACK_ADEPT_;
  const Rumours = require("../plugins/skills/hunter/Rumours.Hunter");
  for (const banked of [false,true]) {
    const f = actor(t); kit(f); if (banked) { f.p.getInventory().deleteNumber(KIT,1); f.p.getBank(0).adds(KIT,1); }
    add(f,sack); Rumours.state(f.p).enhanced=true;
    const restore=forceKitRolls(); try { await action(f,"Open",sack); } finally { restore(); }
    assert.equal(amount(f,KIT)+(f.p.getBank(0).getAmount(KIT)),1); assert.equal(amount(f,sack),0);
  }
  for (const location of ["grave", "office", "retrieval"]) {
    const owned = actor(t);
    if (location === "retrieval") {
      // Supplied deathbank state exercises its real read-only query consumer, not a boss fight.
      const Mimic = require("../plugins/bosses/mimic/Retrieval.Mimic");
      owned.p.setAttribute(Mimic.ATTR, { items: [{ id: KIT, amount: 1 }], paid: false });
      const q = { player: owned.p, items: [] }; PM.emitCustomEvent("item-retrieval:items", q);
      assert.ok(q.items.some(x => x.itemId === KIT && x.amount === 1));
    } else {
      kit(owned); PM.emitCustomEvent("gravestones:met-death", { player: owned.p });
      owned.p.setSkullType(core.SkullType.WHITE_SKULL); owned.p.setSkullTimer(100);
      const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
      const kept = PlayerDeathTask.dropItems(owned.p, null, owned.p.getLocation());
      PlayerDeathTask.returnKeptItems(owned.p, kept);
      assert.equal(amount(owned, KIT), 0, "real death moves kit out of physical ownership");
      if (location === "office") PM.emitCustomEvent("gravestones:expire", { player: owned.p });
      const q = { player: owned.p, grave: null, office: [] }; PM.emitCustomEvent("gravestones:state", q);
      assert.ok((location === "grave" ? q.grave?.items : q.office)?.some(x => x?.id === KIT && x.amount === 1), location);
    }
    add(owned, sack); Rumours.state(owned.p).enhanced = true;
    const restore = forceKitRolls(); try { await action(owned, "Open", sack); } finally { restore(); }
    assert.equal(amount(owned, sack), 0, "ordinary sack opening reached delivery");
    assert.equal(amount(owned, KIT), 0, `${location} ownership suppresses duplicate kit award`);
  }
});

test("zero bank placeholders and search mirrors do not suppress replacement kit rolls", async t => {
  const sack = core.ItemIdentifiers.HUNTERS_LOOT_SACK_ADEPT_;
  const Rumours = require("../plugins/skills/hunter/Rumours.Hunter");
  for (const placeholder of [KIT, 29310]) {
    const absent = actor(t); absent.p.getBank(0).setItem(0, new core.Item(placeholder, 0));
    absent.p.getBank(core.Bank.BANK_SEARCH_TAB_INDEX).setItem(0, new core.Item(KIT, 1));
    add(absent, sack); Rumours.state(absent.p).enhanced = true;
    const restore = forceKitRolls(); try { await action(absent, "Open", sack); } finally { restore(); }
    assert.equal(amount(absent, KIT), 1, "zero placeholder and search mirror do not suppress legitimate kit reward");
  }
});

test("cached sack delivery rechecks kit ownership without rerolling other rewards", async t => {
  const sack = core.ItemIdentifiers.HUNTERS_LOOT_SACK_ADEPT_;
  const Rumours = require("../plugins/skills/hunter/Rumours.Hunter");
  const f=actor(t); add(f,sack); Rumours.state(f.p).enhanced=true;
  while(f.p.getInventory().getFreeSlots())add(f,1511);
  const restore=forceKitRolls(); try { await action(f,"Open",sack); } finally { restore(); }
  assert.equal(amount(f,sack),1,"full bag preserves sack and pending rolls"); assert.equal(amount(f,KIT),0);
  f.p.getInventory().deleteNumber(1511,10); kit(f);
  const log=[]; const api=PM.createApi("HuntsmansKitRewardsTest");api.onCustomEvent("collection-log:obtain",q=>{if(q.player===f.p)log.push([q.itemId,q.amount]);});
  await action(f,"Open",sack); assert.equal(amount(f,sack),0); assert.equal(amount(f,KIT),1);
  assert.ok(log.length>0); assert.equal(log.some(([id])=>id===KIT),false,"no second kit credited or delivered");
  assert.ok(log.every(([id,n])=>amount(f,id)>=n),"all non-kit cached rewards delivered");
});
