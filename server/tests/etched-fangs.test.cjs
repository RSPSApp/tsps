// Run after `yarn build`: node --test tests/etched-fangs.test.cjs
//
// Wiki (Necklace of rupture, Etched elder venator fang): the Elder venator fang is etched with a
// chisel at 84 Crafting; the etched fang and a Necklace of anguish make the Necklace of rupture
// near a bank at 84 Crafting for 500 Crafting experience, after a non-reversible warning.
// Wiki (Amulet of rancour, Etched araxyte fang, Araxyte fang and transcripts): the Araxyte fang is
// etched with a chisel at 86 Crafting; the etched fang and an Amulet of torture make the Amulet of
// rancour at 86 Crafting for 500 Crafting experience, with no bank needed.
//
// Real Player, Inventory, dialogue entries and plugins, through the server's own item-action and
// item-on-item paths. The network, the dialogue window and the bank check are stubbed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const plugin = require("../plugins/items/EtchedFangs.plugin");
let TEXT;
let RANCOUR;
let bank = true;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  plugin.register(PluginManager.createApi("EtchedFangsTest"));
  [{ text: TEXT }, RANCOUR] = plugin._test.recipes();
  TEXT = { ...TEXT, preset: plugin._test.PRESET };
  PluginManager.createApi("EtchedFangsBank").onCustomEvent("league:near-bank", (query) => { query.near = bank; });
});

let index = 3500;
function crafter(t, level = 84) {
  bank = true;
  const player = new Player(null);
  player.setUsername(`rupture${index}`);
  player.setIndex(index++);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  const messages = [];
  t.mock.method(player, "sendMessage", (text) => messages.push(text));
  const state = { player, messages, dialogue: null, xp: [] };
  player.getDialogueManager = () => ({ startDialogues: (chain) => { state.dialogue = chain; }, reset: () => { state.dialogue = null; } });
  player.getSkillManager().setMaxLevel(core.Skill.CRAFTING, 99);
  player.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, level, false);
  t.mock.method(player.getSkillManager(), "addExperiences", (skill, amount) => { state.xp.push([skill, amount]); return player.getSkillManager(); });
  const inventory = player.getInventory();
  t.mock.method(inventory, "refreshItems", () => inventory);
  inventory.resetItems();
  state.inventory = inventory;
  return state;
}

const entries = (state) => [...(state.dialogue?.getDialogues().values() ?? [])];
const texts = (state) => entries(state).map((entry) => entry.getText?.() ?? entry.getTitle?.());

function choose(state, option) {
  const entry = entries(state).find((e) => e instanceof core.OptionDialogue);
  assert.ok(entry, "expected the Yes/No choice");
  assert.deepEqual(entry.getOptions(), ["Yes.", "No."]);
  entry.execute(option);
}

function use(player, used, on) {
  const items = player.getInventory().getItems();
  return PluginManager.emitItemOnItem({
    player,
    usedItem: items[used], usedItemId: items[used].getId(), usedItemSlot: used,
    usedWithItem: items[on], usedWithItemId: items[on].getId(), usedWithItemSlot: on,
    handled: false,
  });
}

function etchBy(player, slot) {
  const item = player.getInventory().getItems()[slot];
  const option = core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf("Etch");
  assert.ok(option >= 0, "the cache gives the fang an Etch option");
  return PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(), slot,
    clickType: option + 1, option: "Etch", handled: false,
  });
}

function pair(state, fangSlot = 2, necklaceSlot = 7) {
  state.inventory.setItem(fangSlot, new core.Item(I.ETCHED_ELDER_VENATOR_FANG, 1));
  state.inventory.setItem(necklaceSlot, new core.Item(I.NECKLACE_OF_ANGUISH, 1));
}

test("Etch with a chisel turns the Elder venator fang into the etched one in its slot", (t) => {
  const state = crafter(t);
  state.inventory.setItem(0, new core.Item(I.CHISEL, 1));
  state.inventory.setItem(4, new core.Item(I.ELDER_VENATOR_FANG, 1));
  assert.equal(etchBy(state.player, 4), true);
  assert.equal(state.inventory.getItems()[4].getId(), I.ETCHED_ELDER_VENATOR_FANG);
  assert.equal(state.inventory.getAmount(I.ELDER_VENATOR_FANG), 0);
  assert.deepEqual(texts(state), [TEXT.etched]);
  assert.deepEqual(state.xp, [], "etching gives no experience");
});

test("Etch without a chisel, or below 84 Crafting, keeps the fang", (t) => {
  const state = crafter(t);
  state.inventory.setItem(4, new core.Item(I.ELDER_VENATOR_FANG, 1));
  assert.equal(etchBy(state.player, 4), true);
  assert.deepEqual(texts(state), [TEXT.noChisel]);
  assert.equal(state.inventory.getItems()[4].getId(), I.ELDER_VENATOR_FANG);

  const low = crafter(t, 83);
  low.inventory.setItem(0, new core.Item(I.CHISEL, 1));
  low.inventory.setItem(1, new core.Item(I.ELDER_VENATOR_FANG, 1));
  assert.equal(etchBy(low.player, 1), true);
  assert.deepEqual(low.messages, [TEXT.etchLevel]);
  assert.equal(low.inventory.getItems()[1].getId(), I.ELDER_VENATOR_FANG);
});

for (const [label, used, on] of [["the fang on the necklace", 2, 7], ["the necklace on the fang", 7, 2]]) {
  test(`${label}, near a bank, warns, then Yes makes the Necklace of rupture for 500 XP`, (t) => {
    const state = crafter(t);
    pair(state);
    assert.equal(use(state.player, used, on), true);
    assert.deepEqual(texts(state), [...TEXT.confirm, TEXT.title]);
    assert.equal(state.inventory.getAmount(I.NECKLACE_OF_ANGUISH), 1, "nothing is used up before Yes");
    choose(state, 1);
    assert.equal(state.inventory.getItems()[7].getId(), I.NECKLACE_OF_RUPTURE, "the necklace's slot");
    assert.equal(state.inventory.getItems()[2].getId(), -1, "the fang is used up");
    assert.equal(state.inventory.getAmount(I.NECKLACE_OF_ANGUISH), 0);
    assert.deepEqual(state.xp, [[core.Skill.CRAFTING, 500]]);
    assert.deepEqual(texts(state), [TEXT.crafted]);
  });
}

test("No keeps both items", (t) => {
  const state = crafter(t);
  pair(state);
  use(state.player, 2, 7);
  choose(state, 2);
  assert.equal(state.inventory.getAmount(I.NECKLACE_OF_ANGUISH), 1);
  assert.equal(state.inventory.getAmount(I.ETCHED_ELDER_VENATOR_FANG), 1);
  assert.equal(state.inventory.getAmount(I.NECKLACE_OF_RUPTURE), 0);
  assert.deepEqual(state.xp, []);
});

test("away from a bank, or below 84 Crafting, nothing is offered", (t) => {
  const state = crafter(t);
  pair(state);
  bank = false;
  assert.equal(use(state.player, 2, 7), true);
  assert.deepEqual(texts(state), [TEXT.noBank]);

  const low = crafter(t, 83);
  pair(low);
  assert.equal(use(low.player, 2, 7), true);
  assert.equal(low.dialogue, null);
  assert.deepEqual(low.messages, [TEXT.combineLevel]);
  assert.equal(low.inventory.getAmount(I.NECKLACE_OF_ANGUISH), 1);
});

test("leaving the bank before Yes still refuses", (t) => {
  const state = crafter(t);
  pair(state);
  use(state.player, 2, 7);
  bank = false;
  choose(state, 1);
  assert.equal(state.inventory.getAmount(I.NECKLACE_OF_RUPTURE), 0);
  assert.equal(state.inventory.getAmount(I.NECKLACE_OF_ANGUISH), 1);
  assert.deepEqual(texts(state), [TEXT.noBank]);
});

test("a preset copy is refused", (t) => {
  const state = crafter(t);
  pair(state);
  state.inventory.getItems()[7].setMetaValue(core.Item.PRESET_META, true);
  assert.equal(use(state.player, 2, 7), true);
  assert.deepEqual(state.messages, [TEXT.preset]);
  assert.equal(state.dialogue, null);
});

test("the cache's other Necklace of anguish copy is left alone", (t) => {
  const state = crafter(t);
  state.inventory.setItem(2, new core.Item(I.ETCHED_ELDER_VENATOR_FANG, 1));
  state.inventory.setItem(7, new core.Item(I.NECKLACE_OF_ANGUISH_4, 1));
  assert.equal(use(state.player, 2, 7), false);
  assert.equal(state.dialogue, null);
});

// Amulet of rancour.

function rancourPair(state, fangSlot = 3, amuletSlot = 9) {
  state.inventory.setItem(fangSlot, new core.Item(I.ETCHED_ARAXYTE_FANG, 1));
  state.inventory.setItem(amuletSlot, new core.Item(I.AMULET_OF_TORTURE, 1));
}

test("Etch with a chisel turns the Araxyte fang into the etched one, with no message or XP", (t) => {
  const state = crafter(t, 86);
  state.inventory.setItem(0, new core.Item(I.CHISEL, 1));
  state.inventory.setItem(5, new core.Item(I.ARAXYTE_FANG, 1));
  assert.equal(etchBy(state.player, 5), true);
  assert.equal(state.inventory.getItems()[5].getId(), I.ETCHED_ARAXYTE_FANG);
  assert.equal(state.inventory.getAmount(I.ARAXYTE_FANG), 0);
  assert.equal(state.dialogue, null, "the transcript shows no box on success");
  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.xp, []);
});

test("Etching the Araxyte fang without a chisel shows the chisel box; below 86 Crafting it is refused", (t) => {
  const state = crafter(t, 86);
  state.inventory.setItem(5, new core.Item(I.ARAXYTE_FANG, 1));
  assert.equal(etchBy(state.player, 5), true);
  assert.deepEqual(texts(state), [RANCOUR.text.noChisel]);
  assert.equal(entries(state)[0] instanceof core.ItemStatementDialogue, true, "the box shows the chisel");
  assert.equal(state.inventory.getItems()[5].getId(), I.ARAXYTE_FANG);

  const low = crafter(t, 85);
  low.inventory.setItem(0, new core.Item(I.CHISEL, 1));
  low.inventory.setItem(1, new core.Item(I.ARAXYTE_FANG, 1));
  assert.equal(etchBy(low.player, 1), true);
  assert.deepEqual(low.messages, [RANCOUR.text.etchLevel]);
  assert.equal(low.inventory.getItems()[1].getId(), I.ARAXYTE_FANG);
});

for (const [label, used, on] of [["the etched fang on the amulet", 3, 9], ["the amulet on the etched fang", 9, 3]]) {
  test(`${label}, away from a bank, warns, then Yes makes the Amulet of rancour for 500 XP`, (t) => {
    const state = crafter(t, 86);
    rancourPair(state);
    bank = false;
    assert.equal(use(state.player, used, on), true);
    assert.deepEqual(texts(state), [...RANCOUR.text.confirm, RANCOUR.text.title]);
    assert.equal(state.inventory.getAmount(I.AMULET_OF_TORTURE), 1, "nothing is used up before Yes");
    choose(state, 1);
    assert.equal(state.inventory.getItems()[9].getId(), I.AMULET_OF_RANCOUR, "the amulet's slot");
    assert.equal(state.inventory.getItems()[3].getId(), -1, "the fang is used up");
    assert.equal(state.inventory.getAmount(I.AMULET_OF_TORTURE), 0);
    assert.deepEqual(state.xp, [[core.Skill.CRAFTING, 500]]);
    assert.deepEqual(texts(state), [RANCOUR.text.crafted]);
  });
}

test("No keeps the amulet and the etched fang; below 86 Crafting nothing is offered", (t) => {
  const state = crafter(t, 86);
  rancourPair(state);
  use(state.player, 3, 9);
  choose(state, 2);
  assert.equal(state.inventory.getAmount(I.AMULET_OF_TORTURE), 1);
  assert.equal(state.inventory.getAmount(I.ETCHED_ARAXYTE_FANG), 1);
  assert.equal(state.inventory.getAmount(I.AMULET_OF_RANCOUR), 0);

  const low = crafter(t, 85);
  rancourPair(low);
  assert.equal(use(low.player, 3, 9), true);
  assert.equal(low.dialogue, null);
  assert.deepEqual(low.messages, [RANCOUR.text.combineLevel]);
});

for (const [label, used, on] of [["the plain fang on the amulet", 3, 9], ["the amulet on the plain fang", 9, 3]]) {
  test(`${label} says it must be etched first`, (t) => {
    const state = crafter(t, 86);
    state.inventory.setItem(3, new core.Item(I.ARAXYTE_FANG, 1));
    state.inventory.setItem(9, new core.Item(I.AMULET_OF_TORTURE, 1));
    assert.equal(use(state.player, used, on), true);
    assert.deepEqual(texts(state), [RANCOUR.text.unetched]);
    assert.equal(state.inventory.getAmount(I.ARAXYTE_FANG), 1);
    assert.equal(state.inventory.getAmount(I.AMULET_OF_TORTURE), 1);
  });
}

test("a preset Amulet of torture is refused", (t) => {
  const state = crafter(t, 86);
  rancourPair(state);
  state.inventory.getItems()[9].setMetaValue(core.Item.PRESET_META, true);
  assert.equal(use(state.player, 3, 9), true);
  assert.deepEqual(state.messages, [TEXT.preset]);
  assert.equal(state.dialogue, null);
});
