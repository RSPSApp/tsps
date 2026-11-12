// After yarn build: node --test --test-concurrency=1 tests/steel-key-ring-native.test.cjs
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
const Runtime = require("../plugins/quests/QuestRuntime");
const RING = 4446, GROUP = 127, BUTTONS = (GROUP << 16) | 1;
const KEY_IDS = [6792, 2887, 605, 983, 4077, 1590, 6754, 1542, 1839, 6104, 85, 759, 1843];
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
  p.setUsername(`ring${++serial}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute("bot-skip-persistence", true); assert.equal(core.World.getPlayers().add(p), true);
  p.moveTo(new core.Location(3115, 3449, 0));
  for (let n = 0; n < 4 && p.isNeedsPlacement(); n++) turn();
  assert.equal(p.isNeedsPlacement(), false); assert.equal(p.isRegistered(), true); assert.ok(p.getHitpoints() > 0);
  const messages = [], strings = [], scripts = [], models = [];
  const out = p.getPacketSender();
  for (const [method, rows] of [["sendString", strings], ["sendClientScript", scripts], ["sendInterfaceRawModel", models]]) {
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
  return { p, c, messages, strings, scripts, models };
}
async function input(f, packet, ticks = 1) { await f.c.dispatch([packet]); for (let n = 0; n < ticks; n++) turn(); }
function add(f, id, n = 1) { const before = amount(f, id); f.p.getInventory().adds(id, n); assert.equal(amount(f, id), before + n); }
function amount(f, id) { return f.p.getInventory().getAmount(id); }
function slot(f, id) { const n = f.p.getInventory().getSlotForItemId(id); assert.ok(n >= 0, `physical item ${id}`); return n; }
async function check(f) {
  await input(f, { type: "widget_action", widgetId: (149 << 16), groupId: 149, childId: 0,
    buttonNum: 2, slot: slot(f, RING), itemId: RING });
}
async function store(f, id, reversed = false) {
  const first = reversed ? RING : id, second = reversed ? id : RING;
  await input(f, { type: "inventory_use_on", widgetId: 3214, itemId: first, slot: slot(f, first),
    target: { kind: "inventory", id: second, slot: slot(f, second), widgetId: 3214 } });
}
async function button(f, action) { await input(f, { type: "dialogue_continue", widgetId: BUTTONS, childIndex: action }); }
function setup(f) { const rows = f.scripts.filter(([id]) => id === 861); assert.ok(rows.length, "native keyring setup script was sent"); return rows.at(-1).slice(1); }
function reward(f) {
  const q = Runtime.getRegisteredQuests().find(q => q.key === "one_small_favour"); assert.ok(q);
  q.complete(f.p); assert.equal(q.isComplete(f.p), true); assert.equal(amount(f, RING), 1, "actual quest reward producer supplies ring");
}
function ring(f) { add(f, RING); }
async function drop(f) { await input(f, { type: "inventory_action", widgetId: 3214, itemId: RING, slot: slot(f, RING), option: "Drop", optionIndex: 5 }); }
async function choose(f, index) {
  const opts = core.MultiChatboxPrompt.getPending(f.p)?.options ?? f.p.getDialogueManager().getCurrent()?.getOptions?.() ?? [];
  if (!opts.length) {
    const group = f.p.getPacketSender().getChatboxGroupId();
    const child = { 193: 0, 229: 4, 11: 4, 217: 5, 231: 5 }[group]; assert.ok(Number.isInteger(child), `warning continuation ${group}`);
    await input(f, { type: "dialogue_continue", widgetId: (group << 16) | child, childIndex: group === 193 ? 0 : -1 });
  }
  const choices = core.MultiChatboxPrompt.getPending(f.p)?.options ?? f.p.getDialogueManager().getCurrent()?.getOptions?.() ?? [];
  assert.equal(choices.length, 2, "two explicit drop-warning options");
  await input(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index });
}
function available(f, id) { const r = { player: f.p, itemId: id, available: false }; PM.emitCustomEvent("steel-key-ring:contains", r); return r.available; }

test("rewarded ring Check-keys opens the native empty then nonempty count and removal interface", async t => {
  const f = actor(t); reward(f);
  assert.equal(core.CacheDefinitions.getItem(RING).name, "Steel key ring");
  assert.equal(core.CacheDefinitions.getItem(RING).inventoryActions[0], "Check-keys");
  assert.equal(core.CacheDefinitions.getComponentId("favour_keyring:buttons"), BUTTONS);
  assert.equal(core.CacheDefinitions.getComponentId("favour_keyring:keytotal"), (GROUP << 16) | 14);
  await check(f);
  assert.equal(f.p.getInterfaceId(), GROUP, "ordinary Check-keys must open native interface 127");
  assert.deepEqual(setup(f), [-1, -1, -1, 0]);
  add(f, 983); await store(f, 983); assert.equal(amount(f, 983), 0);
  await check(f); assert.deepEqual(setup(f), [983, -1, -1, 1]);
  assert.ok(f.strings.some(([text, uid]) => text === "Brass key" && uid === (GROUP << 16 | 10)));
  await button(f, 0); assert.equal(amount(f, 983), 1); assert.deepEqual(setup(f), [-1, -1, -1, 0]);
  await button(f, 0); assert.equal(amount(f, 983), 1, "repeated remove cannot mint a key");
});

test("all thirteen supported keys add in both directions and native navigation/removal conserves every item", async t => {
  const f = actor(t); ring(f);
  for (const [index, id] of KEY_IDS.entries()) { add(f, id); await store(f, id, index % 2 === 0); assert.equal(amount(f, id), 0); assert.equal(available(f, id), true); }
  await check(f); assert.equal(setup(f)[3], 13);
  const visited = [];
  for (let n = 0; n < 13; n++) { visited.push(setup(f)[0]); await button(f, 2); }
  assert.deepEqual(new Set(visited), new Set(KEY_IDS));
  await button(f, 1); assert.equal(setup(f)[0], KEY_IDS[11]);
  for (let n = 0; n < 13; n++) await button(f, 0);
  assert.equal(setup(f)[3], 0);
  for (const id of KEY_IDS) { assert.equal(amount(f, id), 1); assert.equal(available(f, id), false); }
});

test("duplicates, unsupported keys, wrong bone key, preset and metadata items are retained", async t => {
  const f = actor(t); ring(f); add(f, 983, 2); await store(f, 983); await store(f, 983);
  assert.equal(amount(f, 983), 1); await check(f); assert.equal(setup(f)[3], 1);
  for (const id of [4272, 1591, 1588]) { add(f, id); await store(f, id); assert.equal(amount(f, id), 1); assert.equal(available(f, id), false); }
  add(f, 1590);
  const i = f.p.getInventory().getItems()[slot(f, 1590)]; i.setMeta({ proof: "retained" });
  await store(f, 1590); assert.equal(amount(f, 1590), 1); assert.equal(i.getMeta().proof, "retained");
  i.setMeta({ preset: true }); await store(f, 1590); assert.equal(amount(f, 1590), 1);
  await check(f); assert.equal(setup(f)[3], 1);
});

test("full inventory refuses removal without losing the stored key; stale UI and other actors cannot remove it", async t => {
  const f = actor(t), other = actor(t); ring(f); add(f, 983); await store(f, 983); await check(f);
  while (f.p.getInventory().getFreeSlots() > 0) add(f, 1511);
  await button(f, 0); assert.equal(amount(f, 983), 0); assert.equal(setup(f)[3], 1); assert.equal(available(f, 983), true);
  await button(other, 0); assert.equal(amount(other, 983), 0);
  f.p.getPacketSender().sendInterfaceRemoval();
  f.p.getInventory().deleteNumber(1511, 1); await button(f, 0); assert.equal(amount(f, 983), 0);
  await check(f); await button(f, 0); assert.equal(amount(f, 983), 1); assert.equal(available(f, 983), false);
});

test("stored keys survive the actual JSON save/load path, but a banked ring alone cannot provide a carried key", async t => {
  const f = actor(t), loaded = actor(t); ring(f); add(f, 983); await store(f, 983);
  const persistence = new (require("../plugins/persistence/JsonPlayerPersistence.plugin").JsonPlayerPersistence)();
  const raw = JSON.stringify(PlayerSave.fromPlayer(f.p), persistence.replacer.bind(persistence));
  persistence.hydratePlayerSave(JSON.parse(raw, persistence.reviver.bind(persistence))).applyToPlayer(loaded.p);
  assert.equal(amount(loaded, RING), 1); assert.equal(amount(loaded, 983), 0);
  await check(loaded); assert.deepEqual(setup(loaded), [983, -1, -1, 1]);
  loaded.p.getInventory().deleteNumber(RING, 1); loaded.p.getBank(0).adds(RING, 1);
  assert.equal(available(loaded, 983), false);
  await button(loaded, 0); assert.equal(amount(loaded, 983), 0);
});

test("ordinary Drop warns, cancellation preserves keys, final loss clears them and a real bank duplicate preserves them", async t => {
  assert.equal(core.ItemDefinition.forId(RING).isDropable(), true, "canonical definition preserves cache Drop action");
  for (const bankDuplicate of [false, true]) {
    const f = actor(t); ring(f); add(f, 983); await store(f, 983);
    if (bankDuplicate) f.p.getBank(0).adds(RING, 1);
    await drop(f); assert.equal(amount(f, RING), 1); assert.equal(available(f, 983), true);
    await choose(f, 2); assert.equal(amount(f, RING), 1); assert.equal(available(f, 983), true);
    await drop(f); await choose(f, 1); assert.equal(amount(f, RING), 0); assert.equal(available(f, 983), false);
    ring(f); await check(f); assert.equal(setup(f)[3], bankDuplicate ? 1 : 0);
  }
});

test("a stored brass key unlocks the existing door without materializing or consuming it; no-key controls stay locked", async t => {
  for (const mode of ["none", "empty", "stored", "banked", "physical"]) {
    const f = actor(t);
    if (mode !== "none" && mode !== "physical") ring(f);
    if (["stored", "banked", "physical"].includes(mode)) add(f, 983);
    if (["stored", "banked"].includes(mode)) await store(f, 983);
    if (mode === "banked") { f.p.getInventory().deleteNumber(RING, 1); f.p.getBank(0).adds(RING, 1); }
    f.p.closeInterruptibleInterfaces();
    await input(f, { type: "object_option", id: 1804, x: 3115, y: 3450, clickType: 1 }, 6);
    if (["stored", "physical"].includes(mode)) {
      assert.equal(f.p.getLocation().getY(), 3450, `${mode} existing door crosses`);
      assert.equal(amount(f, 983), mode === "physical" ? 1 : 0);
      if (mode === "stored") assert.equal(available(f, 983), true);
    } else { assert.equal(f.p.getLocation().getY(), 3449); assert.ok(f.messages.includes("The door is locked.")); }
  }
});


test("real PvM and skulled PvP death item processing keeps the ring and keys intact", async t => {
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  for (const pvp of [false, true]) {
    const f = actor(t), killer = pvp ? actor(t).p : null; ring(f); add(f, 983); await store(f, 983);
    if (pvp) { f.p.setSkullType(core.SkullType.WHITE_SKULL); f.p.setSkullTimer(100); }
    const kept = PlayerDeathTask.dropItems(f.p, killer, f.p.getLocation());
    assert.ok(kept.some(item => item.getId() === RING), "ring is explicitly kept even when no ranked item is protected");
    PlayerDeathTask.returnKeptItems(f.p, kept);
    assert.equal(amount(f, RING), 1); assert.equal(amount(f, 983), 0);
    await check(f); assert.deepEqual(setup(f), [983, -1, -1, 1]);
  }
});


test("physical weapon-store key-on-door remains connected; stored keys cannot be handed to another player", async t => {
  const f = actor(t), other = actor(t), KEY = core.ItemIdentifiers.WEAPON_STORE_KEY;
  const row = require("../data/definitions/npc-spawns.json").find(row => row.name === "Weaponsmaster");
  assert.ok(row); core.RegionManager.loadMapFiles(row.x, row.y);
  const candidates = [...core.MapObjects.mapObjects.values()].flat().filter(object => object.getId() === core.ObjectIdentifiers.DOOR_70);
  const door = candidates.find(object => Math.abs(object.getLocation().getX() - row.x) < 10 && Math.abs(object.getLocation().getY() - row.y) < 10);
  assert.ok(door, "actual cache weapon-store door near canonical Weaponsmaster");
  const at = door.getLocation(), cross = require("../plugins/objects/WallDoor.Doors").crossingFor(door, at);
  assert.ok(cross); f.p.moveTo(new core.Location(cross.approach.x, cross.approach.y, cross.approach.z));
  for (let n = 0; n < 4 && f.p.isNeedsPlacement(); n++) turn();
  assert.equal(f.p.isNeedsPlacement(), false); add(f, KEY);
  await input(f, { type: "inventory_use_on", widgetId: 3214, itemId: KEY, slot: slot(f, KEY),
    target: { kind: "loc", id: door.getId(), x: at.getX(), y: at.getY() } }, 4);
  assert.equal(amount(f, KEY), 1, "physical reusable key is retained");
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [cross.destination.x, cross.destination.y], "physical key-on-door crosses through its existing handler");
  assert.ok(f.messages.includes("You unlock the door using the key you're carrying."));
  ring(f); await store(f, KEY); assert.equal(amount(f, KEY), 0); assert.equal(available(f, KEY), true);
  await input(f, { type: "inventory_use_on", widgetId: 3214, itemId: KEY, slot: slot(f, RING),
    target: { kind: "player", id: other.p.getIndex() } }, 4);
  assert.equal(amount(other, KEY), 0); assert.equal(amount(f, KEY), 0); assert.equal(available(f, KEY), true);
});
