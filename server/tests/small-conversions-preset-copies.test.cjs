// Run after `yarn build`: node --test tests/small-conversions-preset-copies.test.cjs
// Small item conversions never turn a preset copy (untradeable, unbankable, preset, as Presets.PvpMode tags it)
// into a plain, tradeable one: an item that becomes the product is converted in place (setId keeps its meta), and
// runes or arrows that only pay come from plain copies. Real engine: every plugin loaded, real Players, Inventory,
// skills and quest stages, and each plugin's own handler (item-on-item, item-on-object, NPC option, dialogue
// action, the bone staff's charge prompt and the archery round).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9930;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("conv" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}

function preset(item) {
  item.setMetaValue(core.Item.UNTRADEABLE_META, true);
  item.setMetaValue(core.Item.UNBANKABLE_META, true);
  item.setMetaValue(core.Item.PRESET_META, true);
  return item;
}

const amount = (inv, id, wantPreset) => inv.getItems()
  .filter((item) => item?.getId() === id && item.isPresetItem() === wantPreset)
  .reduce((total, item) => total + item.getAmount(), 0);

const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const RatBoneStaff = require("../plugins/items/ratboneweapons/Staff.RatBoneWeapons");
const RatBoneCreation = require("../plugins/items/ratboneweapons/Creation.RatBoneWeapons");
const Archery = require("../plugins/minigames/archerycompetition/Session.ArcheryCompetition");
const PRESET_TEXT = "Preset items cannot be used for this.";

const questStage = (f, key, stage) => {
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);
  quest.setStage(f.p, stage ?? quest.completionValue);
};
const slotOf = (f, id) => f.inv.getItems().findIndex((item) => item?.getId() === id);
function itemOnItem(f, used, usedWith) {
  PM.emitItemOnItem({ player: f.p, usedItemId: used, usedWithItemId: usedWith, usedItemSlot: slotOf(f, used), usedWithItemSlot: slotOf(f, usedWith),
    usedItem: f.inv.getItems()[slotOf(f, used)], usedWithItem: f.inv.getItems()[slotOf(f, usedWith)], handled: false });
}
const levels = (f, ...skills) => { for (const skill of skills) f.p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false); };

test("bone staff: preset chaos runes are refused; only plain ones charge, and Uncharge returns only them", (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.BONE_STAFF, 1));
  f.inv.setItem(1, preset(new core.Item(I.CHAOS_RUNE, 500)));
  const charge = (slot) => RatBoneStaff._test.charge({ player: f.p, usedItemId: I.CHAOS_RUNE, usedWithItemId: I.BONE_STAFF, usedItem: f.inv.getItems()[slot], usedWithItem: f.inv.getItems()[0], handled: false });
  charge(1);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  f.inv.setItem(2, new core.Item(I.CHAOS_RUNE, 50));
  charge(2);
  f.p.getEnteredAmountAction().execute(1000);
  assert.equal(RatBoneStaff.chargesOf(f.inv.getItems()[0]), 50);
  assert.equal(amount(f.inv, I.CHAOS_RUNE, true), 500, "the preset stack is left alone");
  RatBoneStaff._test.uncharge({ player: f.p, item: f.inv.getItems()[0] });
  assert.equal(amount(f.inv, I.CHAOS_RUNE, false), 50);
});

test("bone staff creation with only preset chaos runes says preset items cannot be used, not that runes are missing", (t) => {
  const f = actor(t);
  levels(f, core.Skill.CRAFTING);
  f.inv.setItem(0, new core.Item(I.BATTLESTAFF, 1));
  f.inv.setItem(1, new core.Item(I.SCURRIUS_SPINE, 1));
  f.inv.setItem(2, new core.Item(I.CHISEL, 1));
  f.inv.setItem(3, preset(new core.Item(I.CHAOS_RUNE, 1000)));
  itemOnItem(f, I.SCURRIUS_SPINE, I.BATTLESTAFF);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(f.inv.getAmount(I.BATTLESTAFF), 1, "nothing made");
  assert.equal(amount(f.inv, I.CHAOS_RUNE, true), 1000);
  // Preset and plain together still short of 1,000 plain: the preset line; too few in all: the runes line.
  f.inv.setItem(4, new core.Item(I.CHAOS_RUNE, 400));
  itemOnItem(f, I.SCURRIUS_SPINE, I.BATTLESTAFF);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  f.inv.setItem(3, new core.Item(-1, 0));
  itemOnItem(f, I.SCURRIUS_SPINE, I.BATTLESTAFF);
  assert.equal(f.messages.at(-1), "You need 1,000 chaos runes and a Scurrius' spine to create the Bone staff.");
});

test("rat bone mace: a preset rune mace makes a preset bone mace", (t) => {
  const f = actor(t);
  levels(f, core.Skill.SMITHING, core.Skill.CRAFTING, core.Skill.FLETCHING);
  f.inv.setItem(0, preset(new core.Item(I.RUNE_MACE, 1)));
  f.inv.setItem(1, new core.Item(I.SCURRIUS_SPINE, 1));
  f.inv.setItem(2, new core.Item(I.HAMMER, 1));
  RatBoneCreation._test.spineOnAnvil({ player: f.p });
  assert.equal(f.inv.getAmount(I.RUNE_MACE), 0);
  assert.equal(amount(f.inv, I.BONE_MACE, false), 0, "no plain bone mace");
  assert.equal(amount(f.inv, I.BONE_MACE, true), 1);
});

test("Ava's accumulator: preset steel arrows don't pay; plain ones do", (t) => {
  const f = actor(t);
  levels(f, core.Skill.RANGED);
  questStage(f, "animal_magnetism");
  f.inv.setItem(0, preset(new core.Item(I.STEEL_ARROW, 75)));
  f.inv.setItem(1, new core.Item(I.COINS, 999));
  const actions = core.CacheDefinitions.getNpc(I.AVAS_ACCUMULATOR && core.NpcIdentifiers.AVA).actions;
  const clickType = actions.findIndex((action) => action === "Devices") + 1;
  const npc = new NPC(core.NpcIdentifiers.AVA, f.p.getLocation().clone());
  // "Devices" opens Ava's Devices (interface 67); the accumulator row's Buy-1 is component 7, op 1.
  const devices = () => {
    PM.emitNpcInteraction({ player: f.p, npc, npcId: core.NpcIdentifiers.AVA, clickType, handled: false,
      definition: { getActions: () => actions, getName: () => "Ava", getId: () => core.NpcIdentifiers.AVA } });
    assert.equal(f.p.getInterfaceId(), 67);
    PM.emitInterfaceActionClick({ player: f.p, buttonId: (67 << 16) | 7, action: 1, opId: 1, handled: false });
  };
  devices();
  assert.equal(f.inv.getAmount(I.AVAS_ACCUMULATOR), 0);
  assert.equal(amount(f.inv, I.STEEL_ARROW, true), 75);
  f.inv.setItem(2, new core.Item(I.STEEL_ARROW, 75));
  devices();
  assert.equal(f.inv.getAmount(I.AVAS_ACCUMULATOR), 1);
  assert.equal(amount(f.inv, I.STEEL_ARROW, true), 75, "the preset arrows are left alone");
});

test("Ava's Devices: the attractor is bought outright and Buy-5 stops when the coins run out", (t) => {
  const f = actor(t);
  questStage(f, "animal_magnetism");
  f.inv.setItem(0, new core.Item(I.COINS, 999 * 2));
  const actions = core.CacheDefinitions.getNpc(core.NpcIdentifiers.AVA).actions;
  const clickType = actions.findIndex((action) => action === "Devices") + 1;
  const npc = new NPC(core.NpcIdentifiers.AVA, f.p.getLocation().clone());
  PM.emitNpcInteraction({ player: f.p, npc, npcId: core.NpcIdentifiers.AVA, clickType, handled: false,
    definition: { getActions: () => actions, getName: () => "Ava", getId: () => core.NpcIdentifiers.AVA } });
  assert.equal(f.p.getInterfaceId(), 67);
  PM.emitInterfaceActionClick({ player: f.p, buttonId: (67 << 16) | 2, action: 2, opId: 2, handled: false });
  assert.equal(f.inv.getAmount(I.AVAS_ATTRACTOR), 2);
  assert.equal(f.inv.getAmount(I.COINS), 0);
});

// Ava's Devices (interface 67): opens from Ava's "Devices" option; button 2 attractor, 12 assembler.
function avaDevices(f, button, op = 1) {
  const actions = core.CacheDefinitions.getNpc(core.NpcIdentifiers.AVA).actions;
  const clickType = actions.findIndex((action) => action === "Devices") + 1;
  const npc = new NPC(core.NpcIdentifiers.AVA, f.p.getLocation().clone());
  PM.emitNpcInteraction({ player: f.p, npc, npcId: core.NpcIdentifiers.AVA, clickType, handled: false,
    definition: { getActions: () => actions, getName: () => "Ava", getId: () => core.NpcIdentifiers.AVA } });
  assert.equal(f.p.getInterfaceId(), 67);
  PM.emitInterfaceActionClick({ player: f.p, buttonId: (67 << 16) | button, action: op, opId: op, handled: false });
}

test("Ava's Devices: preset coins never buy an attractor; plain coins do", (t) => {
  const f = actor(t);
  questStage(f, "animal_magnetism");
  f.inv.setItem(0, preset(new core.Item(I.COINS, 999)));
  avaDevices(f, 2);
  assert.equal(f.inv.getAmount(I.AVAS_ATTRACTOR), 0, "no attractor for preset coins");
  assert.equal(amount(f.inv, I.COINS, true), 999, "the preset coins are kept");
  f.inv.setItem(1, new core.Item(I.COINS, 999));
  avaDevices(f, 2);
  assert.equal(amount(f.inv, I.AVAS_ATTRACTOR, false), 1);
  assert.equal(amount(f.inv, I.COINS, false), 0, "the plain coins paid");
  assert.equal(amount(f.inv, I.COINS, true), 999, "the preset coins are still untouched");
});

test("Ava's Devices: a preset accumulator is never traded for a plain assembler; a plain one is", (t) => {
  const f = actor(t);
  questStage(f, "animal_magnetism");
  questStage(f, "dragon_slayer_ii");
  f.inv.setItem(0, preset(new core.Item(I.AVAS_ACCUMULATOR, 1)));
  f.inv.setItem(1, new core.Item(I.VORKATHS_HEAD, 1));
  f.inv.setItem(2, new core.Item(I.MITHRIL_ARROW, 75));
  avaDevices(f, 12);
  assert.equal(f.inv.getAmount(I.AVAS_ASSEMBLER), 0, "no assembler from a preset trade-in");
  assert.equal(amount(f.inv, I.AVAS_ACCUMULATOR, true), 1, "the preset accumulator is kept");
  assert.equal(f.inv.getAmount(I.VORKATHS_HEAD), 1, "the head is kept");
  assert.equal(f.inv.getAmount(I.MITHRIL_ARROW), 75, "the arrows are kept");
  f.inv.setItem(3, new core.Item(I.AVAS_ACCUMULATOR, 1));
  avaDevices(f, 12);
  assert.equal(amount(f.inv, I.AVAS_ASSEMBLER, false), 1);
  assert.equal(amount(f.inv, I.AVAS_ACCUMULATOR, false), 0, "the plain accumulator was traded in");
  assert.equal(amount(f.inv, I.AVAS_ACCUMULATOR, true), 1, "the preset one is still there");
  assert.equal(f.inv.getAmount(I.VORKATHS_HEAD), 0);
  assert.equal(f.inv.getAmount(I.MITHRIL_ARROW), 0);
});

test("Ava's Devices: the cost text strikes through what the player can't pay, like the Wiki's interface", (t) => {
  const f = actor(t);
  questStage(f, "animal_magnetism");
  const texts = new Map();
  t.mock.method(f.p.getPacketSender(), "sendString", (text, id) => { texts.set(id & 0xffff, text); return f.p.getPacketSender(); });
  f.inv.setItem(0, new core.Item(I.COINS, 1000));
  f.inv.setItem(1, preset(new core.Item(I.STEEL_ARROW, 75)));
  avaDevices(f, 2, 1);
  assert.equal(texts.get(6), "<str>999 coins</str>", "refreshed after buying an attractor with 999 of the 1,000 coins");
  assert.equal(texts.get(11), "<str>999 coins</str> OR an Attractor,<br>AND <str>75 steel arrows</str>",
    "the new attractor can be traded in; preset arrows don't count");
  assert.equal(texts.get(16), "<str>4999 coins</str> OR an <str>Accumulator</str>,<br>AND <str>75 mithril arrows</str>,<br>AND <str>the head of Vorkath</str>");
});

test("Ava's Devices: recorded refusal lines, and a purchase sends no message", (t) => {
  const f = actor(t);
  questStage(f, "animal_magnetism");
  questStage(f, "dragon_slayer_ii");
  levels(f, core.Skill.RANGED);
  f.inv.setItem(0, new core.Item(I.COINS, 5000));
  avaDevices(f, 7);
  assert.equal(f.messages.at(-1),
    "You need either <col=ef1020>999 coins or an Attractor</col>, and also <col=ef1020>75 steel arrows</col>.");
  f.inv.setItem(1, new core.Item(I.VORKATHS_HEAD, 1));
  avaDevices(f, 12);
  assert.equal(f.messages.at(-1),
    "You need either <col=ef1020>4999 coins or an Accumulator, Vorkath's head and also 75 mithril arrows</col>.",
    "the same line whichever parts are missing");
  const before = f.messages.length;
  avaDevices(f, 2);
  assert.equal(f.inv.getAmount(I.AVAS_ATTRACTOR), 1);
  assert.equal(f.messages.length, before, "no purchase message");
});

test("Death Plateau: preset climbing boots become preset spiked boots", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.CLIMBING_BOOTS, 1)));
  f.inv.setItem(1, new core.Item(I.IRON_BAR, 1));
  PM.emitCustomEvent("npc-dialogue:action", { player: f.p, npcId: core.NpcIdentifiers.DUNSTAN, stepId: "AuWfYt", kind: "message", pages: [], handled: false });
  assert.equal(amount(f.inv, I.SPIKED_BOOTS, false), 0);
  assert.equal(amount(f.inv, I.SPIKED_BOOTS, true), 1);
});

test("Shadow of the Storm: dyeing a preset desert shirt keeps it preset", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.DESERT_SHIRT, 1)));
  f.inv.setItem(1, new core.Item(I.BLACK_DYE, 1));
  itemOnItem(f, I.BLACK_DYE, I.DESERT_SHIRT);
  assert.equal(amount(f.inv, I.BLACK_DESERT_SHIRT, false), 0);
  assert.equal(amount(f.inv, I.BLACK_DESERT_SHIRT, true), 1);
});

test("Taste of Hope: a preset vial filled at the fountain stays preset", (t) => {
  const f = actor(t);
  questStage(f, "taste_of_hope", 45);
  f.inv.setItem(0, preset(new core.Item(I.VIAL, 1)));
  const fountain = { getId: () => 32557, getLocation: () => f.p.getLocation().clone() };
  const event = { player: f.p, itemId: I.VIAL, item: f.inv.getItems()[0], slot: 0, objectId: 32557, object: fountain, handled: false };
  PM.emitItemOnObject(event);
  assert.equal(event.handled, true, "the fountain took the vial");
  assert.equal(amount(f.inv, I.VIAL_OF_WATER, false), 0);
  assert.equal(amount(f.inv, I.VIAL_OF_WATER, true), 1);
});

test("archery: shots use the judge's plain arrows before preset ones", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.BRONZE_ARROW, 100)));
  Archery._test.sessions.set(f.p, { shots: 0, score: 0, provided: 10, finished: false, ticketsAwarded: false });
  f.inv.setItem(1, new core.Item(I.BRONZE_ARROW, 10)); // the judge's
  for (let i = 0; i < 10; i++) Archery.takeShot(f.p, () => 0.5);
  assert.equal(amount(f.inv, I.BRONZE_ARROW, false), 0, "the judge's arrows were shot");
  assert.equal(amount(f.inv, I.BRONZE_ARROW, true), 100, "the preset ones are untouched");
});

test("Shadow of the Storm: a preset black dye is refused; a plain dye on a cape leaves its own vial", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.BLACK_DYE, 1)));
  f.inv.setItem(1, new core.Item(I.RED_CAPE, 1));
  itemOnItem(f, I.BLACK_DYE, I.RED_CAPE);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(f.inv.getAmount(I.RED_CAPE), 1);
  f.inv.setItem(0, new core.Item(I.BLACK_DYE, 1));
  itemOnItem(f, I.BLACK_DYE, I.RED_CAPE);
  assert.equal(f.inv.getAmount(I.RED_CAPE), 0);
  assert.equal(f.inv.getAmount(I.VIAL), 1, "the dye's vial comes back");
  assert.equal(f.inv.getAmount(I.BLACK_DYE), 0);
});

// The copy the player used converts, not the first copy by id (review of #3012).
function itemOnSlots(f, usedSlot, usedWithSlot) {
  const items = f.inv.getItems();
  PM.emitItemOnItem({ player: f.p, usedItem: items[usedSlot], usedItemId: items[usedSlot].getId(), usedItemSlot: usedSlot,
    usedWithItem: items[usedWithSlot], usedWithItemId: items[usedWithSlot].getId(), usedWithItemSlot: usedWithSlot, handled: false });
}

test("Taste of Hope: the fountain fills the vial used, not the first vial", (t) => {
  const f = actor(t);
  questStage(f, "taste_of_hope", 45);
  f.inv.setItem(3, new core.Item(I.VIAL, 1));
  f.inv.setItem(27, preset(new core.Item(I.VIAL, 1)));
  const fountain = { getId: () => 32557, getLocation: () => f.p.getLocation().clone() };
  PM.emitItemOnObject({ player: f.p, itemId: I.VIAL, item: f.inv.getItems()[27], itemSlot: 27, objectId: 32557, object: fountain, handled: false });
  assert.equal(f.inv.getItems()[27].getId(), I.VIAL_OF_WATER, "the used vial in slot 27 is filled");
  assert.equal(f.inv.getItems()[3].getId(), I.VIAL, "the plain vial in slot 3 is untouched");
});

test("Shadow of the Storm: a plain dye used beside an earlier preset dye dyes, and the used dye leaves the vial", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.BLACK_DYE, 1)));
  f.inv.setItem(1, new core.Item(I.BLACK_DYE, 1));
  f.inv.setItem(2, new core.Item(I.RED_CAPE, 1));
  f.inv.setItem(3, new core.Item(I.RED_CAPE, 1));
  itemOnSlots(f, 1, 3);
  assert.notEqual(f.messages.at(-1), PRESET_TEXT);
  assert.equal(f.inv.getItems()[1].getId(), I.VIAL, "the used dye became the vial");
  assert.equal(f.inv.getItems()[0].getId(), I.BLACK_DYE, "the preset dye is untouched");
  assert.equal(f.inv.getItems()[3].getId(), I.BLACK_CAPE, "the cape used is dyed");
  assert.equal(f.inv.getItems()[2].getId(), I.RED_CAPE, "the other cape is untouched");
  itemOnSlots(f, 2, 0);
  assert.equal(f.messages.at(-1), PRESET_TEXT, "using the preset dye itself is refused");
  assert.equal(f.inv.getItems()[2].getId(), I.RED_CAPE);
});

test("rat bone shortbow: the spine goes onto the yew shortbow used, not the first one", (t) => {
  const f = actor(t);
  levels(f, core.Skill.FLETCHING);
  f.inv.setItem(0, preset(new core.Item(I.YEW_SHORTBOW, 1)));
  f.inv.setItem(1, new core.Item(I.SCURRIUS_SPINE, 1));
  f.inv.setItem(2, new core.Item(I.KNIFE, 1));
  f.inv.setItem(5, new core.Item(I.YEW_SHORTBOW, 1));
  itemOnSlots(f, 1, 5);
  assert.equal(f.inv.getItems()[5].getId(), I.BONE_SHORTBOW, "the bow used becomes the bone shortbow");
  assert.equal(f.inv.getItems()[5].isPresetItem(), false);
  assert.equal(f.inv.getItems()[0].getId(), I.YEW_SHORTBOW, "the preset bow in slot 0 is untouched");
});

// Smiths gloves: the shop item and ice gloves have reversible, confirmed use (Wiki transcripts).
test("Smiths gloves combine and dismantle through registered inventory actions", (t) => {
  const f = actor(t);
  const other = actor(t);
  const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
  const give = (slot, id) => f.inv.setItem(slot, new core.Item(id, 1));
  const prompt = () => core.MultiChatboxPrompt.getPending(f.p);
  const answer = (p, slot) => core.MultiChatboxPrompt.handleInterfaceActionClick({
    player: p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot, action: slot,
  });
  const use = (a, b) => UseItemPacketListener.itemOnItem(f.p, a, b);
  const dismantle = (slot) => {
    const item = f.inv.getItems()[slot];
    const index = core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf("Dismantle");
    assert.ok(index >= 0, "imbued gloves have a cache Dismantle action");
    PM.emitItemAction({ player: f.p, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(), slot,
      clickType: index + 1, option: "Dismantle", handled: false });
  };
  give(0, I.SMITHS_GLOVES);
  give(1, I.ICE_GLOVES);
  use(0, 1);
  assert.deepEqual(prompt(), { title: "Combine Smiths gloves with your Ice gloves?", options: ["Yes.", "No."] });
  assert.equal(answer(other.p, 1), false);
  answer(f.p, 2);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES), 1);
  assert.equal(f.inv.getAmount(I.ICE_GLOVES), 1);
  use(1, 0);
  assert.ok(prompt());
  answer(f.p, 1);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 1);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES) + f.inv.getAmount(I.ICE_GLOVES), 0);
  const slot = slotOf(f, I.SMITHS_GLOVES_I_);
  dismantle(slot);
  assert.deepEqual(prompt(), { title: "Dismantle your Smithing gloves (i)?", options: ["Yes.", "No."] });
  answer(f.p, 2);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 1);
  const shown = [];
  t.mock.method(f.p.getDialogueManager(), "startDialogues", (chain) => { shown.push(...chain.getDialogues().values()); });
  dismantle(slot);
  answer(f.p, 1);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 0);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES), 1);
  assert.equal(f.inv.getAmount(I.ICE_GLOVES), 1);
  // Wiki, Transcript:Smiths gloves (i): Yes ends with this line.
  assert.equal(shown.length, 1);
  assert.ok(shown[0] instanceof core.ItemStatementDialogue);
  assert.equal(shown[0].getText(), "The gloves get separated into smith gloves and ice gloves.");
});

test("worn Smiths gloves (i) get no Dismantle prompt", (t) => {
  const f = actor(t);
  const gloves = new core.Item(I.SMITHS_GLOVES_I_, 1);
  f.p.getEquipment().setItem(core.Equipment.HANDS_SLOT, gloves);
  const index = core.CacheDefinitions.getItem(I.SMITHS_GLOVES_I_).inventoryActions.indexOf("Dismantle");
  const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
  ItemActionPacketListener.handleAction(f.p, core.Equipment.INVENTORY_INTERFACE_ID, I.SMITHS_GLOVES_I_, core.Equipment.HANDS_SLOT,
    index + 1, "Dismantle");
  assert.equal(core.MultiChatboxPrompt.getPending(f.p), null);
  assert.equal(f.p.getEquipment().getItems()[core.Equipment.HANDS_SLOT], gloves);
});

test("Smiths gloves confirmations preserve stale, restricted and full inventories", (t) => {
  const f = actor(t);
  const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
  const answer = () => core.MultiChatboxPrompt.handleInterfaceActionClick({
    player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1, action: 1,
  });
  const use = () => UseItemPacketListener.itemOnItem(f.p, 0, 1);
  const itemAction = (slot) => {
    const item = f.inv.getItems()[slot];
    const index = core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf("Dismantle");
    assert.ok(index >= 0);
    PM.emitItemAction({ player: f.p, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(), slot,
      clickType: index + 1, option: "Dismantle", handled: false });
  };
  f.inv.setItem(0, new core.Item(I.SMITHS_GLOVES, 1));
  f.inv.setItem(1, new core.Item(I.ICE_GLOVES, 1));
  use();
  assert.ok(core.MultiChatboxPrompt.getPending(f.p));
  f.inv.setItem(1, new core.Item(I.ICE_GLOVES, 1));
  answer();
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 0);
  assert.equal(f.inv.getAmount(I.ICE_GLOVES), 1);
  f.inv.setItem(1, preset(new core.Item(I.ICE_GLOVES, 1)));
  use();
  assert.equal(core.MultiChatboxPrompt.getPending(f.p), null);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES), 1);
  f.inv.setItem(0, new core.Item(I.SMITHS_GLOVES_I_, 1));
  for (let i = 1; i < f.inv.capacity(); i++) f.inv.setItem(i, new core.Item(I.BONES, 1));
  itemAction(0);
  assert.ok(core.MultiChatboxPrompt.getPending(f.p));
  answer();
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 1);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES), 0);
  f.inv.deleteAtSlot(1, 1);
  itemAction(0);
  assert.ok(core.MultiChatboxPrompt.getPending(f.p));
  f.inv.setItem(1, new core.Item(I.BONES, 1));
  answer();
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 1, "space is checked again after the prompt");
  f.inv.deleteAtSlot(1, 1);
  itemAction(0);
  assert.ok(core.MultiChatboxPrompt.getPending(f.p));
  f.inv.setItem(0, new core.Item(I.SMITHS_GLOVES_I_, 1));
  answer();
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 1);
  assert.equal(f.inv.getAmount(I.ICE_GLOVES), 0);
});

test("Smiths gloves protect each restricted component and imbued glove", (t) => {
  const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
  for (const key of [core.Item.PRESET_META, core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META]) {
    for (const protectedId of [I.SMITHS_GLOVES, I.ICE_GLOVES]) {
      const f = actor(t);
      const smiths = new core.Item(I.SMITHS_GLOVES, 1);
      const ice = new core.Item(I.ICE_GLOVES, 1);
      (protectedId === I.SMITHS_GLOVES ? smiths : ice).setMetaValue(key, true);
      f.inv.setItem(0, smiths);
      f.inv.setItem(1, ice);
      UseItemPacketListener.itemOnItem(f.p, 0, 1);
      assert.equal(core.MultiChatboxPrompt.getPending(f.p), null);
      assert.strictEqual(f.inv.getItems()[0], smiths);
      assert.strictEqual(f.inv.getItems()[1], ice);
      assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 0);
    }
    const f = actor(t);
    const gloves = new core.Item(I.SMITHS_GLOVES_I_, 1);
    gloves.setMetaValue(key, true);
    f.inv.setItem(0, gloves);
    const index = core.CacheDefinitions.getItem(I.SMITHS_GLOVES_I_).inventoryActions.indexOf("Dismantle");
    assert.ok(index >= 0);
    PM.emitItemAction({ player: f.p, interfaceId: core.Inventory.INTERFACE_ID, item: gloves, itemId: gloves.getId(), slot: 0,
      clickType: index + 1, option: "Dismantle", handled: false });
    assert.equal(core.MultiChatboxPrompt.getPending(f.p), null);
    assert.strictEqual(f.inv.getItems()[0], gloves);
    assert.equal(f.inv.getAmount(I.SMITHS_GLOVES) + f.inv.getAmount(I.ICE_GLOVES), 0);
  }
});

test("Smiths gloves combine in a full inventory and dismantle with one free slot", (t) => {
  const f = actor(t);
  const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
  const answer = () => core.MultiChatboxPrompt.handleInterfaceActionClick({
    player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1, action: 1,
  });
  f.inv.setItem(0, new core.Item(I.SMITHS_GLOVES, 1));
  f.inv.setItem(1, new core.Item(I.ICE_GLOVES, 1));
  for (let i = 2; i < f.inv.capacity(); i++) f.inv.setItem(i, new core.Item(I.BONES, 1));
  assert.equal(f.inv.getFreeSlots(), 0);
  UseItemPacketListener.itemOnItem(f.p, 0, 1);
  assert.ok(core.MultiChatboxPrompt.getPending(f.p));
  answer();
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 1);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES) + f.inv.getAmount(I.ICE_GLOVES), 0);
  assert.equal(f.inv.getAmount(I.BONES), f.inv.capacity() - 2);
  assert.equal(f.inv.getFreeSlots(), 1);
  const slot = slotOf(f, I.SMITHS_GLOVES_I_);
  const gloves = f.inv.getItems()[slot];
  const index = core.CacheDefinitions.getItem(gloves.getId()).inventoryActions.indexOf("Dismantle");
  assert.ok(index >= 0);
  PM.emitItemAction({ player: f.p, interfaceId: core.Inventory.INTERFACE_ID, item: gloves, itemId: gloves.getId(), slot,
    clickType: index + 1, option: "Dismantle", handled: false });
  assert.ok(core.MultiChatboxPrompt.getPending(f.p));
  answer();
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 0);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES), 1);
  assert.equal(f.inv.getAmount(I.ICE_GLOVES), 1);
  assert.equal(f.inv.getAmount(I.BONES), f.inv.capacity() - 2);
  assert.equal(f.inv.getFreeSlots(), 0);
});

test("Ava's Devices Buy-X and Buy-All use the requested quantity and available payment", t => {
  const f = actor(t); questStage(f, 'animal_magnetism');
  f.inv.setItem(0, new core.Item(I.COINS, 999 * 6));
  avaDevices(f, 2, 3);
  const entered = f.p.getEnteredAmountAction();
  assert.ok(entered);
  entered.execute(3);
  assert.equal(f.inv.getAmount(I.AVAS_ATTRACTOR), 3);
  assert.equal(f.inv.getAmount(I.COINS), 999 * 3);
  avaDevices(f, 2, 4);
  assert.equal(f.inv.getAmount(I.AVAS_ATTRACTOR), 6);
  assert.equal(f.inv.getAmount(I.COINS), 0);
});

test("Ava's Devices refuses unmet Ranged and quest requirements without taking payment", t => {
  const f = actor(t); questStage(f, 'animal_magnetism');
  f.p.getSkillManager().setMaxLevels(core.Skill.RANGED, 49, false);
  f.inv.setItem(0, new core.Item(I.COINS, 4999));
  f.inv.setItem(1, new core.Item(I.STEEL_ARROW, 75));
  avaDevices(f, 7);
  assert.equal(f.inv.getAmount(I.AVAS_ACCUMULATOR), 0);
  assert.equal(f.inv.getAmount(I.STEEL_ARROW), 75);
  assert.equal(f.inv.getAmount(I.COINS), 4999);
  f.inv.setItem(2, new core.Item(I.VORKATHS_HEAD));
  f.inv.setItem(3, new core.Item(I.MITHRIL_ARROW, 75));
  avaDevices(f, 12);
  assert.equal(f.inv.getAmount(I.AVAS_ASSEMBLER), 0);
  assert.equal(f.inv.getAmount(I.VORKATHS_HEAD), 1);
  assert.equal(f.inv.getAmount(I.MITHRIL_ARROW), 75);
  assert.equal(f.inv.getAmount(I.COINS), 4999);
});

test("Elnock jar generator exchange requires the complete payment through Trade and Confirm", (t) => {
  const f = actor(t);
  f.p.setLocation(new core.Location(2592, 4318, 0));
  const elnock = new NPC(core.NpcIdentifiers.ELNOCK_INQUISITOR, new core.Location(2592, 4319, 0));
  elnock.setRegistered(true);
  t.after(() => elnock.setRegistered(false));
  f.inv.setItem(0, new core.Item(I.NATURE_IMPLING_JAR, 1));
  const elnockDefinition = elnock.getCurrentDefinition(f.p);
  const tradeAction = elnockDefinition.getActions().findIndex(action => action === "Trade") + 1;
  assert.ok(tradeAction > 0);
  assert.equal(PM.emitNpcInteraction({ player: f.p, npc: elnock, npcId: elnock.getId(), definition: elnockDefinition,
    clickType: tradeAction, handled: false }), true);
  assert.equal(f.p.getInterfaceId(), 540);
  const click = (childId, slot) => PM.emitInterfaceActionClick({ player: f.p, groupId: 540, childId,
    buttonId: (540 << 16) | childId, slot, action: 1, opId: 1, handled: false });
  assert.equal(click(4, 6), true);
  assert.equal(click(7, 9), true);
  assert.equal(f.inv.getAmount(I.JAR_GENERATOR), 0, "one nature jar alone cannot pay for the generator");
  assert.equal(f.inv.getAmount(I.NATURE_IMPLING_JAR), 1, "refused payment is preserved");
  assert.ok(f.messages.includes("You don't have the required implings in jars to trade for this."));
  for (let slot = 1; slot <= 3; slot++) f.inv.setItem(slot, new core.Item(I.ESSENCE_IMPLING_JAR, 1));
  for (let slot = 4; slot <= 5; slot++) f.inv.setItem(slot, new core.Item(I.ECLECTIC_IMPLING_JAR, 1));
  f.inv.setItem(0, preset(new core.Item(I.NATURE_IMPLING_JAR, 1)));
  assert.equal(click(7, 9), true);
  assert.equal(f.inv.getAmount(I.JAR_GENERATOR), 0, "restricted jars cannot pay for a plain generator");
  assert.equal(amount(f.inv, I.NATURE_IMPLING_JAR, true), 1);
  assert.equal(f.inv.getAmount(I.ESSENCE_IMPLING_JAR), 3);
  f.inv.setItem(0, new core.Item(I.NATURE_IMPLING_JAR, 1));
  for (let slot = 6; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.ASHES, 1));
  assert.equal(f.inv.getFreeSlots(), 0);
  assert.equal(click(7, 9), true);
  assert.equal(f.inv.getAmount(I.JAR_GENERATOR), 1);
  for (const id of [I.ESSENCE_IMPLING_JAR, I.ECLECTIC_IMPLING_JAR, I.NATURE_IMPLING_JAR]) assert.equal(f.inv.getAmount(id), 0);
  assert.equal(f.inv.getAmount(I.ASHES), 22, "unrelated inventory survives the exchange");
  assert.equal(click(7, 9), true);
  assert.equal(f.inv.getAmount(I.JAR_GENERATOR), 1, "repeated Confirm cannot duplicate the reward");
  f.p.closeInterruptibleInterfaces();
  assert.equal(f.p.getInterfaceId(), -1, "the player closes Elnock's exchange before using the generator");
  const generator = f.inv.getItems().find(item => item.getId() === I.JAR_GENERATOR);
  assert.equal(generatorAction(f, generator, 1), true);
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 1, "the purchased generator makes a usable jar");
  levels(f, core.Skill.HUNTER);
  f.p.setHitpoints(99);
  f.p.setLocation(new core.Location(2592, 4320, 0));
  f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.BUTTERFLY_NET, 1));
  const npc = core.NPC.create(core.NpcIdentifiers.BABY_IMPLING_2, f.p.getLocation().clone());
  npc.setRegistered(true); npc.setNeedsPlacement(false);
  t.after(() => npc.setRegistered(false));
  const definition = npc.getCurrentDefinition(f.p);
  const clickType = definition.getActions().findIndex(action => action === "Catch") + 1;
  assert.ok(clickType > 0);
  assert.equal(f.p.busy(), false, "the next Catch action is allowed after closing the exchange");
  const rng = t.mock.method(Math, "random", () => 0);
  PM.emitNpcInteraction({ player: f.p, npc, npcId: npc.getId(), definition, clickType, handled: false });
  rng.mock.restore();
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 0);
  assert.equal(f.inv.getAmount(I.BABY_IMPLING_JAR), 1);
});


const GENERATOR_CHARGES_META = "impetuous-impulses:jar-generator-charges";
function generatorAction(f, item, clickType, slot = f.inv.getItems().indexOf(item)) {
  return PM.emitItemAction({ player: f.p, interfaceId: core.Inventory.INTERFACE_ID, item,
    itemId: item.getId(), slot, clickType, handled: false });
}

test("jar generator makes 33 impling jars and one butterfly jar before depletion", (t) => {
  const f = actor(t);
  const generator = new core.Item(I.JAR_GENERATOR, 1);
  f.inv.setItem(0, generator);
  assert.equal(generatorAction(f, generator, 4), true, "Check is a registered generator action");
  assert.match(f.messages.at(-1), /100%/);
  for (let n = 0; n < 33; n++) {
    generatorAction(f, generator, 1);
    assert.equal(f.inv.getAmount(I.IMPLING_JAR), 1);
    f.inv.deleteNumber(I.IMPLING_JAR, 1);
  }
  generatorAction(f, generator, 4);
  assert.match(f.messages.at(-1), /1%/);
  generatorAction(f, generator, 1);
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 0, "one percent cannot fund an impling jar");
  assert.equal(generator.getMetaValue(GENERATOR_CHARGES_META), 1);
  generatorAction(f, generator, 3);
  assert.equal(f.inv.getAmount(I.JAR_GENERATOR), 0);
  assert.equal(f.inv.getAmount(I.BUTTERFLY_JAR), 1);
  assert.equal(f.inv.getItems()[0].getMetaValue(GENERATOR_CHARGES_META), undefined);
});

test("jar generator preserves charge on full bag, restricted copies and stale slots", (t) => {
  const f = actor(t), generator = new core.Item(I.JAR_GENERATOR, 1);
  f.inv.setItem(0, generator);
  for (let slot = 1; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.BONES, 1));
  generatorAction(f, generator, 1);
  assert.equal(generator.getMetaValue(GENERATOR_CHARGES_META), undefined, "full default charge is unchanged");
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 0);
  generator.setMetaValue(GENERATOR_CHARGES_META, 3);
  generatorAction(f, generator, 1);
  assert.equal(f.inv.getAmount(I.JAR_GENERATOR), 0, "depletion frees the generator's own slot");
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 1);
  assert.equal(f.inv.getAmount(I.BONES), 27);
  f.inv.setItem(0, generator.clone().setId(I.JAR_GENERATOR));
  f.inv.setItem(1, new core.Item(-1, 0));
  const current = f.inv.getItems()[0];
  preset(current);
  generatorAction(f, current, 1);
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 0);
  assert.equal(current.getMetaValue(GENERATOR_CHARGES_META), undefined);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  const ordinary = new core.Item(I.JAR_GENERATOR, 1);
  f.inv.setItem(0, ordinary);
  f.inv.setItem(0, new core.Item(I.BONES, 1));
  f.inv.setItem(1, ordinary);
  generatorAction(f, ordinary, 1, 0);
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 0);
  assert.equal(ordinary.getMetaValue(GENERATOR_CHARGES_META), undefined);
  generatorAction(f, ordinary, 1, 1);
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 0, "bag remains full after moving it");
});

test("jar generator recharges the banked instance after a fresh complete payment", (t) => {
  const f = actor(t), generator = new core.Item(I.JAR_GENERATOR, 1);
  generator.setMetaValue(GENERATOR_CHARGES_META, 17);
  // Tab 2 is valid only when tab 1 is nonempty; refresh compacts sparse tabs.
  f.p.getBank(1).setItem(0, new core.Item(I.BONES, 1));
  f.p.getBank(2).setItem(0, generator);
  const payment = () => {
    for (let slot = 0; slot < 3; slot++) f.inv.setItem(slot, new core.Item(I.ESSENCE_IMPLING_JAR, 1));
    for (let slot = 3; slot < 5; slot++) f.inv.setItem(slot, new core.Item(I.ECLECTIC_IMPLING_JAR, 1));
    f.inv.setItem(5, new core.Item(I.NATURE_IMPLING_JAR, 1));
  };
  const elnock = core.NPC.create(core.NpcIdentifiers.ELNOCK_INQUISITOR, f.p.getLocation().clone());
  elnock.setRegistered(true); elnock.setNeedsPlacement(false);
  t.after(() => elnock.setRegistered(false));
  const definition = elnock.getCurrentDefinition(f.p);
  const tradeAction = definition.getActions().findIndex(action => action === "Trade") + 1;
  assert.ok(tradeAction > 0);
  const offer = () => {
    assert.equal(PM.emitNpcInteraction({ player: f.p, npc: elnock, npcId: elnock.getId(), definition,
      clickType: tradeAction, handled: false }), true);
    assert.equal(f.p.getInterfaceId(), 540);
    PM.emitInterfaceActionClick({ player: f.p, buttonId: (540 << 16) | 4, slot: 6, action: 1, opId: 1, handled: false });
    PM.emitInterfaceActionClick({ player: f.p, buttonId: (540 << 16) | 7, slot: 9, action: 1, opId: 1, handled: false });
  };
  // The player and bank are supplied; registered exchange and real dialogue-choice handler run.
  payment(); offer();
  assert.equal(f.inv.getAmount(I.JAR_GENERATOR), 0);
  f.p.getDialogueManager().handleOption(2);
  assert.equal(generator.getMetaValue(GENERATOR_CHARGES_META), 17);
  assert.equal(f.inv.getAmount(I.NATURE_IMPLING_JAR), 1);
  offer();
  const replacement = new core.Item(I.JAR_GENERATOR, 1);
  replacement.setMetaValue(GENERATOR_CHARGES_META, 9);
  f.p.getBank(2).setItem(0, replacement);
  f.p.getDialogueManager().handleOption(1);
  assert.equal(replacement.getMetaValue(GENERATOR_CHARGES_META), 9, "a changed generator cannot consume a stale recharge choice");
  assert.equal(f.inv.getAmount(I.NATURE_IMPLING_JAR), 1);
  assert.equal(f.inv.getAmount(I.ESSENCE_IMPLING_JAR), 3);
  assert.equal(f.inv.getAmount(I.JAR_GENERATOR), 0);
  f.p.getBank(2).setItem(0, generator);
  offer(); f.inv.deleteNumber(I.NATURE_IMPLING_JAR, 1);
  f.p.getDialogueManager().handleOption(1);
  assert.equal(generator.getMetaValue(GENERATOR_CHARGES_META), 17, "payment is rechecked after choosing recharge");
  assert.equal(f.inv.getAmount(I.ESSENCE_IMPLING_JAR), 3);
  payment(); offer(); f.p.getDialogueManager().handleOption(1);
  assert.equal(generator.getMetaValue(GENERATOR_CHARGES_META), 100);
  assert.equal(f.inv.getAmount(I.JAR_GENERATOR), 0);
  for (const id of [I.ESSENCE_IMPLING_JAR, I.ECLECTIC_IMPLING_JAR, I.NATURE_IMPLING_JAR]) assert.equal(f.inv.getAmount(id), 0);
  f.p.setStatus(core.PlayerStatus.BANKING);
  f.p.setInterfaceId(core.Bank.MAIN_INTERFACE_ID);
  core.Bank.withdraw(f.p, I.JAR_GENERATOR, 0, 1, 2);
  const withdrawn = f.inv.getItems().find(item => item.getId() === I.JAR_GENERATOR);
  assert.ok(withdrawn);
  assert.equal(f.p.getBank(1).getAmount(I.BONES), 1);
  f.p.closeInterruptibleInterfaces();
  assert.equal(f.p.busy(), false);
  generatorAction(f, withdrawn, 1);
  assert.equal(withdrawn.getMetaValue(GENERATOR_CHARGES_META), 97);
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 1);
  assert.equal(f.p.getBank(2).getAmount(I.JAR_GENERATOR), 0);
});

test("jar generator death policy never keeps or drops a lost generator", (t) => {
  const f = actor(t), item = new core.Item(I.JAR_GENERATOR, 1);
  assert.equal(PM.emitShouldKeepItemOnDeath(f.p, item), false);
  const unsafe = { player: f.p, item, kept: false, shouldDropItems: true, location: f.p.getLocation(), handled: false };
  assert.equal(PM.emitPlayerDeathItemDrop(unsafe), true);
  const safe = { ...unsafe, shouldDropItems: false, handled: false };
  assert.equal(PM.emitPlayerDeathItemDrop(safe), false, "safe deaths preserve items");
});

test('anchovy supplies make an impling jar that can catch a Puro-Puro impling', (t) => {
  const f = actor(t);
  const { UseItemPacketListener } = require('../dist/net/packet/impl/UseItemPacketListener');
  questStage(f, 'druidic_ritual');
  levels(f, core.Skill.HERBLORE, core.Skill.HUNTER);
  f.p.setHitpoints(99);
  f.inv.setItem(0, new core.Item(I.ANCHOVY_PASTE, 8));
  f.inv.setItem(1, new core.Item(I.VIAL, 1));
  f.inv.setItem(2, new core.Item(I.SIEVE, 1));
  f.inv.setItem(3, new core.Item(I.MARIGOLDS, 1));
  f.inv.setItem(4, new core.Item(I.BUTTERFLY_JAR, 1));
  UseItemPacketListener.itemOnItem(f.p, 0, 1);
  assert.equal(f.inv.getAmount(I.ANCHOVY_PASTE), 0);
  assert.equal(f.inv.getAmount(I.ANCHOVY_OIL), 1);
  assert.equal(f.inv.getAmount(I.SIEVE), 1);
  UseItemPacketListener.itemOnItem(f.p, slotOf(f, I.ANCHOVY_OIL), slotOf(f, I.MARIGOLDS));
  assert.equal(f.inv.getAmount(I.IMP_REPELLENT), 1);

  // The map lookup and approach are supplied; the real item-on-object listener and plugin hooks run.
  const at = new core.Location(2937, 3210, 0);
  f.p.setLocation(new core.Location(2937, 3209, 0));
  const still = new core.GameObject(core.ObjectIdentifiers.LAMP_OIL_STILL, at, 10, 0, null);
  assert.equal(core.ObjectDefinition.forPlayer(still.getId(), f.p)?.getName(), "Lamp oil still");
  t.mock.method(core.MapObjects, 'getPrivateArea', () => still);
  t.mock.method(core.MapObjects, 'stillStands', () => true);
  t.mock.method(f.p.getMovementQueue(), 'walkToObject', (_object, options) => { options.execute(); return true; });
  const useStill = (id) => UseItemPacketListener.itemOnObject(f.p, 94, still.getId(), id, slotOf(f, id), at.getX(), at.getY());
  useStill(I.IMP_REPELLENT);
  assert.equal(f.inv.getAmount(I.IMP_REPELLENT), 0);
  useStill(I.BUTTERFLY_JAR);
  assert.equal(f.inv.getAmount(I.BUTTERFLY_JAR), 0);
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 1);

  // Seed the actor and location; the registered Catch hook and real inventory exchange run.
  f.p.setLocation(new core.Location(2592, 4320, 0));
  f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.BUTTERFLY_NET, 1));
  const npc = core.NPC.create(core.NpcIdentifiers.BABY_IMPLING_2, f.p.getLocation().clone());
  npc.setRegistered(true); npc.setNeedsPlacement(false);
  t.after(() => npc.setRegistered(false));
  const definition = npc.getCurrentDefinition(f.p);
  const clickType = definition.getActions().findIndex(action => action === 'Catch') + 1;
  assert.ok(clickType > 0);
  const rng = t.mock.method(Math, 'random', () => 0);
  PM.emitNpcInteraction({ player: f.p, npc, npcId: npc.getId(), definition, clickType, handled: false });
  rng.mock.restore();
  assert.equal(f.inv.getAmount(I.IMPLING_JAR), 0);
  assert.equal(f.inv.getAmount(I.BABY_IMPLING_JAR), 1);
});

test('anchovy oil preserves remaining paste and refuses restricted input in a full inventory', (t) => {
  const f = actor(t);
  const { UseItemPacketListener } = require('../dist/net/packet/impl/UseItemPacketListener');
  f.inv.setItem(0, new core.Item(I.ANCHOVY_PASTE, 9));
  f.inv.setItem(1, new core.Item(I.VIAL, 1));
  f.inv.setItem(2, new core.Item(I.SIEVE, 1));
  for (let slot = 3; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.BONES, 1));
  UseItemPacketListener.itemOnItem(f.p, 0, 1);
  assert.equal(f.inv.getAmount(I.ANCHOVY_PASTE), 1);
  assert.equal(f.inv.getAmount(I.ANCHOVY_OIL), 1);
  assert.equal(f.inv.getAmount(I.SIEVE), 1);
  assert.equal(f.inv.getAmount(I.BONES), 25);
  f.inv.setItem(0, preset(new core.Item(I.ANCHOVY_PASTE, 8)));
  f.inv.setItem(1, new core.Item(I.VIAL, 1));
  UseItemPacketListener.itemOnItem(f.p, 0, 1);
  assert.equal(amount(f.inv, I.ANCHOVY_PASTE, true), 8);
  assert.equal(f.inv.getAmount(I.VIAL), 1);
  assert.equal(f.inv.getAmount(I.ANCHOVY_OIL), 0);
});

test('still ignores a repellent moved while the player walks to it', (t) => {
  const f = actor(t);
  const { UseItemPacketListener } = require('../dist/net/packet/impl/UseItemPacketListener');
  const at = new core.Location(2937, 3210, 0);
  const still = new core.GameObject(core.ObjectIdentifiers.LAMP_OIL_STILL, at, 10, 0, null);
  t.mock.method(core.MapObjects, 'getPrivateArea', () => still);
  t.mock.method(core.MapObjects, 'stillStands', () => true);
  let arrive;
  t.mock.method(f.p.getMovementQueue(), 'walkToObject', (_object, options) => { arrive = options.execute; return true; });
  const repellent = new core.Item(I.IMP_REPELLENT, 1);
  f.inv.setItem(0, repellent);
  UseItemPacketListener.itemOnObject(f.p, 94, still.getId(), I.IMP_REPELLENT, 0, at.getX(), at.getY());
  assert.equal(typeof arrive, 'function');
  f.inv.setItem(0, new core.Item(I.BONES, 1));
  f.inv.setItem(1, repellent);
  arrive();
  assert.equal(f.inv.getAmount(I.IMP_REPELLENT), 1);
  assert.equal(f.inv.getAmount(I.BONES), 1);
  assert.notEqual(f.p.getAttribute('oil-lights:distilled-oil'), '2937,3210,0:repellent');
});
