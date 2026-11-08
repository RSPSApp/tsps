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
  const devices = () => PM.emitNpcInteraction({ player: f.p, npc, npcId: core.NpcIdentifiers.AVA, clickType, handled: false,
    definition: { getActions: () => actions, getName: () => "Ava", getId: () => core.NpcIdentifiers.AVA } });
  devices();
  assert.equal(f.inv.getAmount(I.AVAS_ACCUMULATOR), 0);
  assert.equal(amount(f.inv, I.STEEL_ARROW, true), 75);
  f.inv.setItem(2, new core.Item(I.STEEL_ARROW, 75));
  devices();
  assert.equal(f.inv.getAmount(I.AVAS_ACCUMULATOR), 1);
  assert.equal(amount(f.inv, I.STEEL_ARROW, true), 75, "the preset arrows are left alone");
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
  dismantle(slot);
  answer(f.p, 1);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 0);
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES), 1);
  assert.equal(f.inv.getAmount(I.ICE_GLOVES), 1);
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
  f.inv.setItem(1, null);
  itemAction(0);
  assert.ok(core.MultiChatboxPrompt.getPending(f.p));
  f.inv.setItem(1, new core.Item(I.BONES, 1));
  answer();
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 1, "space is checked again after the prompt");
  f.inv.setItem(1, null);
  itemAction(0);
  assert.ok(core.MultiChatboxPrompt.getPending(f.p));
  f.inv.setItem(0, new core.Item(I.SMITHS_GLOVES_I_, 1));
  answer();
  assert.equal(f.inv.getAmount(I.SMITHS_GLOVES_I_), 1);
  assert.equal(f.inv.getAmount(I.ICE_GLOVES), 0);
});
