// Run after `yarn build`: node --test tests/item-sets-preset.test.cjs
//
// Preset copies don't pack into an item set. A free preset piece would otherwise come back as an
// ordinary bankable set, and from there as ordinary pieces.
//
// The Dharok case loads the real global preset, after completing the quest its gear asks for.
// Dropping and Remove go through ClientConnection.dispatch as decoded packets, and so do the Pack
// clicks. One seam: the Sets screen opens through the object hook with a stand-in definition of the
// Grand Exchange booth, so the walk to the booth isn't run. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const QuestEquipment = require("../plugins/quests/data/quest-equipment.json");

const HOME = [3222, 3218];
const SETS = 451;
const MAIN_ITEMS_CHILD = 3;
const RECIPE_LIST = 1033;
const PRESET_TEXT = "Preset items cannot be used for this.";
const WORN_SLOTS = [0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 13];
const SKILLS = ["ATTACK", "DEFENCE", "STRENGTH"];

let core;
let I;
let next = 6700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("setsqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  for (const name of SKILLS) {
    p.getSkillManager().setMaxLevels(core.Skill[name], 99, false).setCurrentLevels(core.Skill[name], 99, false);
  }
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const original = p.sendMessage.bind(p);
  p.sendMessage = (message) => {
    messages.push(message);
    return original(message);
  };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), eq: p.getEquipment(), messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const item = (id, amount = 1) => new core.Item(id, amount);
const put = (f, value, slot) => f.inv.setItem(slot, value);
const pieces = () => [I.DHAROKS_HELM, I.DHAROKS_PLATEBODY, I.DHAROKS_PLATELEGS, I.DHAROKS_GREATAXE];
const held = (f, id) => f.inv.getItems().filter((entry) => entry.getId() === id && entry.getAmount() > 0);
const plain = (f, id) => held(f, id).filter((entry) => !entry.isPresetItem()).reduce((sum, entry) => sum + entry.getAmount(), 0);
const preset = (f, id) => held(f, id).filter((entry) => entry.isPresetItem()).reduce((sum, entry) => sum + entry.getAmount(), 0);

function openSets(f) {
  const location = new core.Location(f.p.getLocation().getX() + 1, f.p.getLocation().getY(), 0);
  const interactions = ["Exchange", "Collect", "Sets"];
  const definition = { getName: () => "Grand Exchange booth", getInteractions: () => interactions };
  // Named object hooks pick the action from clickType, not from `option`.
  const clickType = interactions.indexOf("Sets") + 1;
  PM.emitObjectInteraction({
    player: f.p, object: new core.GameObject(1, location, 10, 0, null), objectId: 1, clickType, option: "Sets", definition,
    location: { x: location.getX(), y: location.getY(), z: 0 },
    sourceLocation: { x: f.p.getLocation().getX(), y: f.p.getLocation().getY(), z: 0 },
    handled: false,
  });
  assert.equal(f.p.getInterfaceId(), SETS, "the Sets screen opened");
}

/** The row of the Sets list whose set is `setId`, from the cache enums the plugin reads. */
function row(setId) {
  for (const [slot, enumId] of core.CacheDefinitions.getEnumValues(RECIPE_LIST)) {
    if (core.CacheDefinitions.getEnumValues(enumId).get(-1) === setId) return slot;
  }
  assert.fail(`no Sets row for ${setId}`);
}

const pack = (f, setId) => send(f, {
  type: "widget_action", widgetId: (SETS << 16) | MAIN_ITEMS_CHILD, groupId: SETS, childId: MAIN_ITEMS_CHILD, buttonNum: 1, slot: row(setId),
});

function loadDharok(f) {
  const loaded = Presets.getGlobalPresetByName("Dharok");
  const ids = new Set([...loaded.getInventory(), ...loaded.getEquipment()].map((entry) => entry.getId()));
  const quests = QuestEquipment.quests.filter((entry) => entry.items.some((key) => ids.has(I[key]))).map((entry) => entry.quest);
  for (const quest of QuestRuntime.getRegisteredQuests().filter((entry) => quests.includes(entry.name))) {
    quest.complete(f.p, { experience: false });
  }
  Presets.applyPreset(f.p, loaded);
  for (const id of pieces()) assert.equal(f.eq.getItems().some((entry) => entry.getId() === id && entry.isPresetItem()), true, `worn preset ${id}`);
}

/** Drops carried items until `free` slots are free, then takes the four pieces off. */
async function piecesInHand(f, free = 4) {
  for (let slot = f.inv.capacity() - 1; slot >= 0 && f.inv.getFreeSlots() < free; slot--) {
    const entry = f.inv.getItems()[slot];
    if (entry.getId() > 0) await send(f, { type: "inventory_action", slot, itemId: entry.getId(), widgetId: 3214, option: "Drop" });
  }
  assert.ok(f.inv.getFreeSlots() >= free, "room for the pieces");
  for (const worn of [core.Equipment.HEAD_SLOT, core.Equipment.BODY_SLOT, core.Equipment.LEG_SLOT, core.Equipment.WEAPON_SLOT]) {
    const childId = 15 + WORN_SLOTS.indexOf(worn);
    await send(f, { type: "widget_action", widgetId: (387 << 16) | childId, groupId: 387, childId, buttonNum: 1 });
  }
  for (const id of pieces()) assert.equal(preset(f, id), 1, `preset ${id} in hand`);
}

test("the real Dharok preset does not pack into a set", async (t) => {
  const control = actor(t);
  pieces().forEach((id, slot) => put(control, item(id), slot));
  openSets(control);
  await pack(control, I.DHAROKS_ARMOUR_SET);
  assert.equal(plain(control, I.DHAROKS_ARMOUR_SET), 1, "control: plain pieces make a set");
  for (const id of pieces()) assert.equal(plain(control, id), 0, `control: ${id} went`);

  const f = actor(t);
  loadDharok(f);
  await piecesInHand(f);
  openSets(f);
  await pack(f, I.DHAROKS_ARMOUR_SET);
  assert.equal(f.inv.getAmount(I.DHAROKS_ARMOUR_SET), 0, "no set");
  for (const id of pieces()) assert.equal(preset(f, id), 1, `preset ${id} kept`);
  assert.ok(f.messages.includes(PRESET_TEXT), "says why");
});

test("one preset piece among plain ones refuses, and takes nothing", async (t) => {
  const f = actor(t);
  loadDharok(f);
  await piecesInHand(f);
  const [, ...rest] = pieces();
  f.inv.getItems().forEach((entry, slot) => {
    if (rest.includes(entry.getId())) put(f, item(entry.getId()), slot);
  });
  openSets(f);
  await pack(f, I.DHAROKS_ARMOUR_SET);
  assert.equal(f.inv.getAmount(I.DHAROKS_ARMOUR_SET), 0, "no set");
  assert.equal(preset(f, I.DHAROKS_HELM), 1, "the preset helm stays");
  for (const id of rest) assert.equal(plain(f, id), 1, `plain ${id} stays`);
  assert.ok(f.messages.includes(PRESET_TEXT), "says why");
});

test("with a preset and a plain copy of a piece, the set takes the plain one", async (t) => {
  const f = actor(t);
  loadDharok(f);
  await piecesInHand(f, 8);
  for (const id of pieces()) {
    const slot = f.inv.getEmptySlot();
    assert.ok(slot >= 0, "room for the plain copy");
    put(f, item(id), slot);
  }
  const slotOf = (test) => f.inv.getItems().findIndex((entry) => entry.getId() === I.DHAROKS_HELM && test(entry));
  assert.ok(slotOf((entry) => entry.isPresetItem()) < slotOf((entry) => !entry.isPresetItem()), "the preset copy comes first");
  openSets(f);
  await pack(f, I.DHAROKS_ARMOUR_SET);
  assert.equal(plain(f, I.DHAROKS_ARMOUR_SET), 1, "the set");
  for (const id of pieces()) {
    assert.equal(plain(f, id), 0, `plain ${id} went`);
    assert.equal(preset(f, id), 1, `preset ${id} stays`);
  }
});

test("missing a piece still lists the contents, not the preset line", async (t) => {
  const f = actor(t);
  pieces().slice(1).forEach((id, slot) => put(f, item(id), slot));
  openSets(f);
  await pack(f, I.DHAROKS_ARMOUR_SET);
  assert.ok(f.messages.some((message) => message.startsWith("Contents: ")), "lists the contents");
  assert.ok(!f.messages.includes(PRESET_TEXT));
});
