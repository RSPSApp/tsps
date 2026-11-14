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
  const messages = [], strings = [], scripts = [], models = [], sounds = [];
  const out = p.getPacketSender();
  for (const [method, rows] of [["sendString", strings], ["sendClientScript", scripts], ["sendInterfaceRawModel", models], ["sendSoundEffect", sounds]]) {
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
  return { p, c, messages, strings, scripts, models, sounds };
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
  for (const [index, id] of KEY_IDS.entries()) { add(f, id); await store(f, id, index % 2 === 0); assert.equal(amount(f, id), 0); assert.equal(available(f, id), true);
    assert.ok(f.messages.includes(`You add the ${core.CacheDefinitions.getItem(id).name.toLowerCase()} to your key ring.`)); }
  await check(f); assert.equal(setup(f)[3], 13);
  const recorded = new Map([
    [983, ["Brass key", "Allows access to Edgeville dungeon.", 5623]],
    [1590, ["Dusty key", "Opens door in Taverley dungeon.", 5623]],
    [2887, ["Battered key", "Elemental workshop key.", 5623]],
    [1542, ["Maze key", "Allows access to Melzar's maze.", 5623]],
    [4077, ["Crystal mine key", "Crystal mine key.", 5623]],
    [6792, ["Key", "Key to the Spirits of the Elid cave.", 10216]],
    [6754, ["Key", "Key to find hidden treasure!", 5623]],
  ]);
  const visited = [];
  for (let n = 0; n < 13; n++) {
    const id = setup(f)[0]; visited.push(id);
    if (recorded.has(id)) {
      const [name, description, highlight] = recorded.get(id);
      assert.equal(f.strings.filter(([, uid]) => uid === (GROUP << 16 | 10)).at(-1)[0], name);
      assert.equal(f.strings.filter(([, uid]) => uid === (GROUP << 16 | 11)).at(-1)[0], description);
      assert.equal(f.models.filter(([uid]) => uid === core.CacheDefinitions.getComponentId("favour_keyring:main_highlight")).at(-1)[1], highlight);
    }
    await button(f, 2);
  }
  assert.deepEqual(new Set(visited), new Set(KEY_IDS));
  await button(f, 1); assert.equal(setup(f)[0], KEY_IDS[11]);
  for (let n = 0; n < 13; n++) await button(f, 0);
  assert.equal(setup(f)[3], 0);
  for (const id of KEY_IDS) { assert.equal(amount(f, id), 1); assert.equal(available(f, id), false);
    assert.ok(f.messages.includes(`You remove the ${core.CacheDefinitions.getItem(id).name.toLowerCase()} from your key ring.`)); }
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
  for (const mode of ["none", "empty", "stored", "banked", "physical", "both"]) {
    const f = actor(t);
    if (mode !== "none" && mode !== "physical") ring(f);
    if (["stored", "banked", "physical", "both"].includes(mode)) add(f, 983);
    if (["stored", "banked", "both"].includes(mode)) await store(f, 983);
    if (mode === "both") add(f, 983);
    if (mode === "banked") { f.p.getInventory().deleteNumber(RING, 1); f.p.getBank(0).adds(RING, 1); }
    f.p.closeInterruptibleInterfaces();
    await input(f, { type: "object_option", id: 1804, x: 3115, y: 3450, clickType: 1 }, 6);
    if (["stored", "physical", "both"].includes(mode)) {
      assert.equal(f.p.getLocation().getY(), 3450, `${mode} existing door crosses`);
      assert.equal(amount(f, 983), ["physical", "both"].includes(mode) ? 1 : 0);
      if (mode === "stored") assert.equal(available(f, 983), true);
      assert.ok(f.messages.includes(mode === "stored" ? "You use your keyring to unlock the door." : "You unlock the door."));
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
  for (const both of [false, true]) {
    if (both) add(f, KEY);
    const beforeMessages = f.messages.length;
    await input(f, { type: "object_option", id: door.getId(), x: at.getX(), y: at.getY(), clickType: 1 }, 4);
    assert.ok(f.messages.slice(beforeMessages).includes(both
      ? "You unlock the door using the key you're carrying." : "You use your keyring to unlock the door."));
    assert.equal(amount(f, KEY), both ? 1 : 0);
    assert.equal(available(f, KEY), true);
    if (both) f.p.getInventory().deleteNumber(KEY, 1);
  }
  await input(f, { type: "inventory_use_on", widgetId: 3214, itemId: KEY, slot: slot(f, RING),
    target: { kind: "player", id: other.p.getIndex() } }, 4);
  assert.equal(amount(other, KEY), 0); assert.equal(amount(f, KEY), 0); assert.equal(available(f, KEY), true);
});

// These regressions invoke the existing transcript query/action producers directly with supplied
// quest state; they do not claim a complete merchant conversation or natural quest playthrough.
function merchantCondition(f, stepId) {
  return PM.emitNpcDialogueCondition({ player: f.p, npcId: core.NpcIdentifiers.SILVER_MERCHANT,
    pages: [{ page: "Silver merchant" }], stepId, text: ({
      q_Kz9y: "If the player no longer has an Enchanted key:",
      "07rNIp": "If the player still has an Enchanted key on a steel key ring:",
      APjFg8: "After completing The Enchanted Key miniquest and the Enchanted key dissolving:",
    })[stepId] });
}
function purchase(f) {
  const event = { player: f.p, npcId: core.NpcIdentifiers.SILVER_MERCHANT,
    pages: [{ page: "Silver merchant" }], kind: "action", stepId: "uDpunX", handled: false };
  PM.emitCustomEvent("npc-dialogue:action", event); assert.equal(event.handled, true);
}
function ownedStored(f, id) {
  const request = { player: f.p, itemId: id, owned: false };
  PM.emitCustomEvent("steel-key-ring:contains", request); return request.owned;
}

test("Making History replacement respects carried/banked stored ownership and rechecks paid commits", async t => {
  const KEY = core.ItemIdentifiers.ENCHANTED_KEY, COINS = core.ItemIdentifiers.COINS;
  const quest = Runtime.getRegisteredQuests().find(q => q.key === "making_history"); assert.ok(quest);
  for (const mode of ["none", "carried", "banked-ring", "physical", "banked-key", "stale", "search-only", "placeholder-ring", "late-stored", "poor", "full", "incomplete"]) {
    const f = actor(t); quest.setStage(f.p, mode === "incomplete" ? 1 : 2);
    add(f, COINS, mode === "poor" ? 499 : 1000);
    if (["carried", "banked-ring", "stale", "search-only", "placeholder-ring"].includes(mode)) {
      ring(f); add(f, KEY); await store(f, KEY);
      if (mode !== "carried") f.p.getInventory().deleteNumber(RING, 1);
      if (["banked-ring", "placeholder-ring"].includes(mode)) f.p.getBank(0).adds(RING, 1);
      if (mode === "placeholder-ring") f.p.getBank(0).getItems().find(item => item.getId() === RING).setAmount(0);
      if (mode === "search-only") f.p.getBank(core.Bank.BANK_SEARCH_TAB_INDEX).adds(RING, 1);
    }
    if (mode === "physical") add(f, KEY);
    if (mode === "banked-key") f.p.getBank(0).adds(KEY, 1);
    const storedOwned = ["carried", "banked-ring"].includes(mode);
    const owns = storedOwned || ["physical", "banked-key"].includes(mode);
    assert.equal(ownedStored(f, KEY), storedOwned, mode);
    assert.equal(available(f, KEY), mode === "carried", "bank ownership never grants carried access");
    assert.equal(merchantCondition(f, "q_Kz9y"), !owns, `${mode} purchase offer`);
    assert.equal(merchantCondition(f, "07rNIp"), storedOwned, `${mode} canonical ring dialogue`);
    assert.equal(merchantCondition(f, "APjFg8"), false, "no miniquest completion invented");
    if (mode === "late-stored") { ring(f); add(f, KEY); await store(f, KEY); }
    if (mode === "full") while (f.p.getInventory().getFreeSlots() > 0) add(f, 1511);
    const beforeKey = amount(f, KEY), beforeCoins = amount(f, COINS);
    purchase(f);
    const sells = ["none", "stale", "search-only", "placeholder-ring"].includes(mode);
    assert.equal(amount(f, KEY), beforeKey + (sells ? 1 : 0), `${mode} key conservation`);
    assert.equal(amount(f, COINS), beforeCoins - (sells ? 500 : 0), `${mode} coin conservation`);
    if (storedOwned || mode === "late-stored") assert.equal(ownedStored(f, KEY), true);
    if (sells) { purchase(f); assert.equal(amount(f, KEY), beforeKey + 1); assert.equal(amount(f, COINS), beforeCoins - 500); }
  }
});

test("free key recovery recognizes a carried or banked stored copy and still recovers a genuinely lost key", async t => {
  for (const banked of [false, true]) {
    const f = actor(t); ring(f);
    for (const id of [1590, 2887, 6792]) { add(f, id); await store(f, id); }
    if (banked) { f.p.getInventory().deleteNumber(RING, 1); f.p.getBank(0).adds(RING, 1); }
    const velrak = { player: f.p, npcId: core.NpcIdentifiers.VELRAK_THE_EXPLORER,
      pages: [{ page: "Velrak the explorer" }] };
    assert.equal(PM.emitNpcDialogueCondition({ ...velrak, text: "Without having a dusty key in the inventory:" }), false);
    assert.equal(PM.emitNpcDialogueCondition({ ...velrak, text: "With a dusty key in the inventory:" }), true);
    const ew = Runtime.getRegisteredQuests().find(q => q.key === "elemental_workshop_i"); assert.ok(ew);
    ew.setStage(f.p, 1 << 2); // supplied existing slashed-book bit, not quest progress proof
    const spirits = Runtime.getRegisteredQuests().find(q => q.key === "spirits_of_the_elid"); assert.ok(spirits);
    spirits.setStage(f.p, 20);
    const recover = () => {
      const dusty = { ...velrak, kind: "message", stepId: "sM-0Hv", handled: false };
      PM.emitCustomEvent("npc-dialogue:action", dusty); assert.equal(dusty.handled, true);
      const bookcase = new core.GameObject(core.ObjectIdentifiers.BOOKCASE_99, f.p.getLocation().clone(), 10, 0, null);
      assert.equal(PM.emitObjectInteraction({ player: f.p, object: bookcase, objectId: bookcase.getId(),
        location: bookcase.getLocation(), definition: { getName: () => "Bookcase", getInteractions: () => ["Search"] }, clickType: 1, handled: false }), true);
      const ballad = { player: f.p, npcId: core.NpcIdentifiers.GHASLOR_THE_ELDER, stepId: "4JXIDh", handled: false };
      PM.emitCustomEvent("npc-dialogue:action", ballad); assert.equal(ballad.handled, true);
    };
    const ground = () => core.ItemOnGroundManager.getGroundItem(f.p.getUsername(), 6792, new core.Location(3432, 2928, 0), null);
    recover();
    for (const id of [1590, 2887, 6792]) { assert.equal(amount(f, id), 0); assert.equal(ownedStored(f, id), true); }
    assert.equal(ground(), null, "stored ancestral copy does not respawn");
    // Existing completed-loss producer clears contents after the final ring is actually removed.
    if (banked) f.p.getBank(0).deleteNumber(RING, 1); else f.p.getInventory().deleteNumber(RING, 1);
    PM.emitCustomEvent("item:discarded", { player: f.p, item: new core.Item(RING, 1) });
    recover(); assert.equal(amount(f, 1590), 1); assert.equal(amount(f, 2887), 1);
    assert.ok(ground(), "genuinely lost ancestral key retains its existing ground respawn");
    recover(); assert.equal(amount(f, 1590), 1); assert.equal(amount(f, 2887), 1);
  }
});


// Enchanted Key: Wiki geometry/contract and independently reconstructed rsprox1702
// inventory93 deltas. No import of the new implementation/data: this same fixture
// must reach the missing postquest Feel assertion on the original source baseline.
const EK_ORDER = "enchanted-key:order", EK_FOUND = "enchanted-key:treasures-found";
const EK_BITS = { rellekka: 0, "grand-exchange": 5, "al-kharid": 3, "mudskipper-point": 8,
  "lumbridge-swamp": 4, "south-ardougne": 9, "gnome-stronghold": 10, "south-falador": 2,
  "west-ardougne": 7, "south-east-varrock": 1, "body-altar": 6 };
const EK_SITES = {
  rellekka: [2716, 3606, [[448, 10], [563, 15], [886, 20]]],
  "grand-exchange": [3160, 3490, [[7937, 39], [563, 15], [888, 10]]],
  "al-kharid": [3291, 3220, [[448, 10], [7937, 40], [6764, 1]]],
  "mudskipper-point": [3016, 3166, [[441, 15], [560, 15], [888, 20]]],
  "lumbridge-swamp": [3161, 3176, [[7937, 29], [558, 20], [886, 20]]],
  "south-ardougne": [2621, 3239, [[7937, 36], [554, 30], [441, 15]]],
  "gnome-stronghold": [2448, 3443, [[7937, 39], [40, 20], [555, 30]]],
  "south-falador": [2972, 3304, [[6762, 1], [557, 15], [884, 20]]],
  "west-ardougne": [2417, 3382, [[7937, 40], [40, 20], [554, 20]]],
  "south-east-varrock": [3299, 3349, [[7937, 40], [6760, 1], [441, 15]]],
  "body-altar": [3033, 3437, [[448, 10], [557, 45], [441, 15]]],
};
function ekQuest() { const q = Runtime.getRegisteredQuests().find(q => q.key === "making_history"); assert.ok(q); return q; }
function ekActor(t) {
  const f = actor(t); ekQuest().setStage(f.p, 2); assert.equal(ekQuest().isComplete(f.p), true);
  add(f, 6754); add(f, 952); return f;
}
function ekMove(f, x, y, z = 0) {
  core.RegionManager.loadMapFiles(x, y); f.p.moveTo(new core.Location(x, y, z));
  for (let i = 0; i < 4 && f.p.isNeedsPlacement(); i++) turn();
  assert.equal(f.p.isNeedsPlacement(), false);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()], [x, y, z]);
}
async function ekAction(f, id) {
  await input(f, { type: "widget_action", widgetId: 149 << 16, groupId: 149, childId: 0,
    buttonNum: 2, slot: slot(f, id), itemId: id });
}
async function ekFeel(f) { const before = f.messages.length; await ekAction(f, 6754); return f.messages.slice(before); }
function ekOrder(f) {
  const order = f.p.getAttribute(EK_ORDER);
  assert.equal(order?.length, 11); assert.equal(order[0], "rellekka");
  assert.deepEqual([...order].sort(), Object.keys(EK_SITES).sort()); return [...order];
}
function ekSnapshot(f) { return f.p.getInventory().getCopiedItems().map(i => i && [i.getId(), i.getAmount(), i.getMeta()]); }
function ekReload(from, to) {
  const persistence = new (require("../plugins/persistence/JsonPlayerPersistence.plugin").JsonPlayerPersistence)();
  const raw = JSON.stringify(PlayerSave.fromPlayer(from.p), persistence.replacer.bind(persistence));
  PM.emitPlayerLogout({ player: from.p, username: from.p.getUsername() });
  persistence.hydratePlayerSave(JSON.parse(raw, persistence.reviver.bind(persistence))).applyToPlayer(to.p);
  PM.emitPlayerLogin({ player: to.p, username: to.p.getUsername() });
  return raw;
}

test("Enchanted Key postquest causal Feel and all eleven once-only rewards through actual item packets", async t => {
  let f = ekActor(t); ekMove(f, 2716, 3606);
  assert.deepEqual(await ekFeel(f), ["The key is steaming. It must be right below your feet."],
    "missing-feature baseline: completed quest with physical key must locate first postquest treasure");
  for (const [id, expected] of [[1391, [604, 21, 31]], [13717, [3403, 8, 9]]]) {
    const bit = core.CacheDefinitions.getVarbit(id);
    assert.deepEqual([bit.baseVar, bit.startBit, bit.endBit], expected, `actual cache field ${id}`);
  }
  const order = ekOrder(f), ids = [...new Set(Object.values(EK_SITES).flatMap(row => row[2].map(([id]) => id)))];
  // Actual deployment cache identity/stackability, independently pinned physical recorded awards.
  for (const [base, note] of [[440, 441], [447, 448], [7936, 7937]]) {
    assert.equal(core.ItemDefinition.forId(base).getNoteId(), note);
    assert.equal(core.ItemDefinition.forId(note).isNoted(), true);
    assert.equal(core.ItemDefinition.forId(note).unNote(), base);
    assert.equal(core.ItemDefinition.forId(note).isStackable(), true);
  }
  let expectedMask = 0;
  for (let count = 0; count < order.length; count++) {
    const [x, y, rewards] = EK_SITES[order[count]], before = new Map(ids.map(id => [id, amount(f, id)]));
    if (count === 10) {
      // Fill all but the extra slots needed beyond the slot freed by the final physical key.
      const newSlots = rewards.filter(([id]) => amount(f, id) === 0).length;
      while (f.p.getInventory().getFreeSlots() > Math.max(0, newSlots - 1)) add(f, 1511);
      assert.equal(f.p.getInventory().getFreeSlots(), Math.max(0, newSlots - 1), "final reward needs the key's slot");
    }
    const lowerBits = f.p.getPacketSender().getVarp(604) & 0x1fffff;
    ekMove(f, x + 4, y + 4); // Chebyshev diagonal 4 is eligible, not Euclidean distance.
    await ekAction(f, 952);
    for (const id of ids) assert.equal(amount(f, id) - before.get(id), rewards.find(([n]) => n === id)?.[1] ?? 0, `${order[count]} award ${id}`);
    assert.equal(f.p.getAttribute(EK_FOUND), count + 1); assert.deepEqual(ekOrder(f), order);
    expectedMask |= 1 << EK_BITS[order[count]];
    assert.equal(f.p.getPacketSender().getVarbit(1391), expectedMask);
    assert.equal(f.p.getPacketSender().getVarp(604) & 0x1fffff, lowerBits, "parent quest bits preserved");
    assert.equal(f.p.getPacketSender().getVarbit(13717), count === 10 ? 2 : 1);
    assert.equal(amount(f, 6754), count === 10 ? 0 : 1);
    if (count === 10) assert.equal(f.p.getInventory().getFreeSlots(), Math.max(0, 1 - rewards.filter(([id]) => before.get(id) === 0).length), "final batch uses the freed physical-key slot");
    assert.equal(f.messages.at(-1), count === 10 ? "You find some items, but the key dissolves in your hand." : "You found some treasure.");
    const after = ekSnapshot(f); await ekAction(f, 952); assert.deepEqual(ekSnapshot(f), after, "duplicate click cannot award old treasure");
    if (count === 3) {
      const reloaded = actor(t); ekReload(f, reloaded); f = reloaded;
      assert.deepEqual(ekOrder(f), order); assert.equal(f.p.getAttribute(EK_FOUND), 4);
    }
    if (count < 10) {
      ekMove(f, 1000, 1000);
      assert.deepEqual(await ekFeel(f), ["It's freezing"], "treasure/relogin resets comparison");
    }
  }
  for (const id of [6760, 6762, 6764]) assert.equal(amount(f, id), 1);
  assert.equal(merchantCondition(f, "APjFg8"), true); assert.equal(merchantCondition(f, "q_Kz9y"), false);
  f.p.getInventory().deleteNumber(1511, 28); // End the final-slot experiment before merchant setup.
  add(f, 995, 1000); purchase(f); assert.equal(amount(f, 995), 1000); assert.equal(amount(f, 6754), 0);
  const loaded = actor(t); ekReload(f, loaded);
  assert.equal(loaded.p.getAttribute(EK_FOUND), 11); assert.equal(merchantCondition(loaded, "APjFg8"), true);
  assert.equal(loaded.p.getPacketSender().getVarbit(1391), 2047);
  assert.equal(loaded.p.getPacketSender().getVarbit(13717), 2, "old completed-quest login cannot reset completed miniquest");
  purchase(loaded); assert.equal(amount(loaded, 6754), 0); assert.equal(amount(loaded, 995), 1000);
});

test("Enchanted Key exact distance boundaries, comparative distance and JSON session reset", async t => {
  const f = ekActor(t);
  const rows = [[1001,"It's freezing"],[1000,"It's very cold"],[701,"It's very cold"],[700,"It's cold"],
    [401,"It's cold"],[400,"It's warm"],[101,"It's warm"],[100,"It's hot"],[61,"It's hot"],
    [60,"It's very hot"],[31,"It's very hot"],[30,"Ouch! It's burning hot"],[5,"Ouch! It's burning hot"],
    [4,"The key is steaming. It must be right below your feet."]];
  let previous;
  for (const [distance, text] of rows) {
    ekMove(f, 2716 + distance, 3606);
    const suffix = distance > 4 && previous != null ? " and warmer than last time" : "";
    assert.deepEqual(await ekFeel(f), [text + suffix]); previous = distance;
  }
  ekMove(f, 2726, 3616); assert.deepEqual(await ekFeel(f), ["Ouch! It's burning hot but colder than last time"]);
  ekMove(f, 2725, 3615); assert.deepEqual(await ekFeel(f), ["Ouch! It's burning hot and warmer than last time"]);
  assert.deepEqual(await ekFeel(f), ["Ouch! It's burning hot and the same temperature as last time"]);
  const loaded = actor(t), order = ekOrder(f); ekReload(f, loaded); ekMove(loaded, 2725, 3615);
  assert.deepEqual(await ekFeel(loaded), ["Ouch! It's burning hot"]); assert.deepEqual(ekOrder(loaded), order);
  ekMove(loaded, 2721, 3606); const before = ekSnapshot(loaded); await ekAction(loaded, 952);
  assert.deepEqual(ekSnapshot(loaded), before); assert.equal(loaded.p.getAttribute(EK_FOUND) ?? 0, 0);
  ekMove(loaded, 2716, 3606, 1); await ekAction(loaded, 952);
  assert.deepEqual(ekSnapshot(loaded), before); assert.equal(loaded.p.getAttribute(EK_FOUND) ?? 0, 0);
});

test("Enchanted Key full-batch capacity retry, stack limit and physical versus stored key", async t => {
  const f = ekActor(t); ekMove(f, 2726, 3606); await ekFeel(f); const order = ekOrder(f);
  while (f.p.getInventory().getFreeSlots() > 0) add(f, 1511);
  const before = ekSnapshot(f); ekMove(f, 2716, 3606); await ekAction(f, 952);
  assert.deepEqual(ekSnapshot(f), before); assert.equal(f.p.getAttribute(EK_FOUND) ?? 0, 0); assert.deepEqual(ekOrder(f), order);
  ekMove(f, 2726, 3606); assert.deepEqual(await ekFeel(f), ["Ouch! It's burning hot and the same temperature as last time"], "failed capacity does not reset comparison");
  f.p.getInventory().deleteNumber(1511, 3); add(f, 886, 2147483647);
  const limited = ekSnapshot(f); ekMove(f, 2716, 3606); await ekAction(f, 952);
  assert.deepEqual(ekSnapshot(f), limited); assert.equal(f.p.getAttribute(EK_FOUND) ?? 0, 0);
  f.p.getInventory().deleteNumber(886, 2147483647); await ekAction(f, 952);
  assert.equal(f.p.getAttribute(EK_FOUND), 1); assert.equal(amount(f, 886), 20);
  f.p.getInventory().deleteNumber(1511, 28); ring(f); await store(f, 6754);
  const stored = ekSnapshot(f), count = f.p.getAttribute(EK_FOUND); const [x,y] = EK_SITES[order[count]];
  ekMove(f, x, y); await ekAction(f, 952); assert.deepEqual(ekSnapshot(f), stored); assert.equal(f.p.getAttribute(EK_FOUND), count);
  await check(f); await button(f, 0); assert.equal(amount(f, 6754), 1);
  await ekAction(f, 952); assert.equal(f.p.getAttribute(EK_FOUND), count + 1);
});

test("Enchanted Key recovery uses genuine ring entitlement and rechecks stale merchant commits", async t => {
  const f = ekActor(t); ekMove(f, 2716, 3606); await ekFeel(f); const order = ekOrder(f);
  f.p.getInventory().deleteNumber(6754, 1); add(f, 995, 1500); purchase(f);
  assert.equal(amount(f, 6754), 1); assert.equal(amount(f, 995), 1000); assert.deepEqual(ekOrder(f), order);
  reward(f); f.p.getInventory().deleteNumber(6754, 1); f.p.getInventory().deleteNumber(RING, 1);
  PM.emitCustomEvent("item:discarded", { player: f.p, item: new core.Item(RING, 1) });
  assert.equal(merchantCondition(f, "q_Kz9y"), false); purchase(f);
  assert.equal(amount(f, 6754), 0); assert.equal(amount(f, 995), 1000);
  // Canonical complete One Small Favour is an entitlement even on an old save without a receipt marker.
  assert.equal(f.p.getAttribute("steel-key-ring:received") ?? false, false);
  ring(f); assert.equal(merchantCondition(f, "q_Kz9y"), true);
  f.p.getInventory().deleteNumber(RING, 1); purchase(f); assert.equal(amount(f, 995), 1000);
  f.p.getBank(0).adds(RING, 1); purchase(f); assert.equal(amount(f, 6754), 1); assert.equal(amount(f, 995), 500);
  assert.deepEqual(ekOrder(f), order);
});


test("Enchanted Key observed Feel sound policies accompany ordinary packet responses", async t => {
  const f = ekActor(t);
  // Five observed rsprox1702 categories only. Unobserved hot/very-hot/very-cold tones are not inferred.
  for (const [distance, prefix, sound] of [[1001, "It's freezing", 1199], [700, "It's cold", 1198],
    [400, "It's warm", 1202], [30, "Ouch! It's burning hot", 1197],
    [4, "The key is steaming. It must be right below your feet.", 1201]]) {
    ekMove(f, 2716 + distance, 3606); const start = f.sounds.length;
    const messages = await ekFeel(f); assert.equal(messages.length, 1); assert.ok(messages[0].startsWith(prefix));
    assert.deepEqual(f.sounds.slice(start), [[sound, 1, 0, 1]], "one observed sound, loops1/delay0");
  }
});


test("Enchanted Key respects claimed Dig dispatch and refuses corrupt persisted routes", async t => {
  const f = ekActor(t); ekMove(f, 2716, 3606); await ekFeel(f); const order = ekOrder(f), before = ekSnapshot(f);
  // Explicit synthetic competing owner, not a claim that native Zombie Head retrieval exists.
  const other = { pluginName: "SyntheticDigOwner", handler(event) {
    if (event.player === f.p && event.itemId === 952) { event.handled = true; f.p.sendMessage("synthetic other dig"); }
  } };
  PM.itemActionHooks.unshift(other);
  try { await ekAction(f, 952); } finally { PM.itemActionHooks.splice(PM.itemActionHooks.indexOf(other), 1); }
  assert.equal(f.messages.at(-1), "synthetic other dig"); assert.deepEqual(ekSnapshot(f), before);
  assert.equal(f.p.getAttribute(EK_FOUND) ?? 0, 0); assert.deepEqual(ekOrder(f), order);
  f.p.setAttribute(EK_FOUND, 1); f.p.setAttribute(EK_ORDER, []);
  await ekAction(f, 952); assert.deepEqual(ekSnapshot(f), before);
  assert.equal(f.p.getAttribute(EK_FOUND), 1); assert.deepEqual(f.p.getAttribute(EK_ORDER), [], "never reroll a corrupt progressed save");
  const reversedFirst = [...order]; [reversedFirst[0], reversedFirst[1]] = [reversedFirst[1], reversedFirst[0]];
  f.p.setAttribute(EK_ORDER, reversedFirst);
  const wire = f.p.getPacketSender().getVarbit(1391);
  PM.emitCustomEvent("enchanted-key:sync", { player: f.p });
  assert.equal(f.p.getPacketSender().getVarbit(1391), wire, "nonfixed-first corrupt route cannot publish progress");
  await ekAction(f, 952); assert.deepEqual(ekSnapshot(f), before); assert.equal(f.p.getAttribute(EK_FOUND), 1);
});

test("successful precompletion ring handover records entitlement; failed grant cannot invent it", async t => {
  for (const full of [false, true]) {
    const f = ekActor(t); f.p.getInventory().deleteNumber(6754, 1); add(f, 995, 1000);
    const q = Runtime.getRegisteredQuests().find(q => q.key === "one_small_favour"); assert.ok(q); q.setStage(f.p, 42);
    assert.equal(q.isComplete(f.p), false);
    if (full) while (f.p.getInventory().getFreeSlots() > 0) add(f, 1511);
    PM.emitCustomEvent("npc-dialogue:action", { player: f.p, npcId: core.NpcIdentifiers.YANNI_SALIKA,
      pages: [{ page: "One Small Favour" }], kind: "action", stepId: "-A_EOB", handled: false });
    assert.equal(amount(f, RING), full ? 0 : 1);
    assert.equal(f.p.getAttribute("steel-key-ring:received") ?? false, !full);
    if (!full) {
      f.p.getInventory().deleteNumber(RING, 1); const loaded = actor(t); ekReload(f, loaded);
      assert.equal(q.isComplete(loaded.p), false); assert.equal(loaded.p.getAttribute("steel-key-ring:received"), true);
      purchase(loaded); assert.equal(amount(loaded, 6754), 0); assert.equal(amount(loaded, 995), 1000);
    }
  }
});
