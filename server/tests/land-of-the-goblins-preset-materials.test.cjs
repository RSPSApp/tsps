// Run after `yarn build`: node --test tests/land-of-the-goblins-preset-materials.test.cjs
// Land of the Goblins: Oldak's moving-over-distance sphere is a fresh, tradeable item, so only plain law runes pay
// for it; and grinding black dye turns the vial into the dye in place, so a preset vial gives a preset dye. Preset
// copies are untradeable, unbankable and preset, as Presets.PvpMode tags them. Real engine: every plugin loaded, a
// real Player and Inventory, Oldak's Buy-sphere option through PM.emitNpcInteraction with a real NPC, and the
// quest's own item-on-item handler.
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
let next = 9900;
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
  p.setUsername("oldak" + p.getIndex());
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
const PRESET_TEXT = "Preset items cannot be used for this.";
const OLDAK = 11384;

function buySphere(f) {
  const actions = core.CacheDefinitions.getNpc(OLDAK).actions;
  const clickType = actions.findIndex((action) => action === "Buy-sphere") + 1;
  assert.ok(clickType > 0, `Oldak's ops: ${actions}`);
  const npc = new NPC(OLDAK, f.p.getLocation().clone());
  PM.emitNpcInteraction({ player: f.p, npc, npcId: OLDAK, clickType, handled: false,
    definition: { getActions: () => actions, getName: () => "Oldak", getId: () => OLDAK } });
}

function itemOnItem(f, used, usedWith, slots) {
  const slot = (id) => f.inv.getItems().findIndex((item) => item?.getId() === id);
  PM.emitItemOnItem?.({ player: f.p, usedItemId: used, usedWithItemId: usedWith, usedItemSlot: slots?.used ?? slot(used), usedWithItemSlot: slots?.usedWith ?? slot(usedWith),
    usedItem: f.inv.getItems()[slots?.used ?? slot(used)], usedWithItem: f.inv.getItems()[slots?.usedWith ?? slot(usedWith)], handled: false });
}

test("preset law runes cannot buy a sphere; plain ones still do", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.LAW_RUNE, 20)));
  f.inv.setItem(1, new core.Item(I.MOLTEN_GLASS, 1));
  buySphere(f);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(f.inv.getAmount(I.DORGESH_KAAN_SPHERE), 0);
  assert.equal(amount(f.inv, I.LAW_RUNE, true), 20);
  f.inv.setItem(2, new core.Item(I.LAW_RUNE, 2));
  buySphere(f);
  assert.equal(amount(f.inv, I.DORGESH_KAAN_SPHERE, false), 1);
  assert.equal(amount(f.inv, I.LAW_RUNE, false), 0, "the plain runes paid");
  assert.equal(amount(f.inv, I.LAW_RUNE, true), 20, "the preset stack is left alone");
});

test("grinding black dye into a preset vial gives a preset dye, not a plain one", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.VIAL, 1)));
  f.inv.setItem(1, new core.Item(I.BLACK_MUSHROOM, 1));
  f.inv.setItem(2, new core.Item(I.PESTLE_AND_MORTAR, 1));
  itemOnItem(f, I.BLACK_MUSHROOM, I.VIAL);
  assert.equal(f.inv.getAmount(I.BLACK_MUSHROOM), 0);
  assert.equal(amount(f.inv, I.BLACK_DYE, false), 0, "no plain dye");
  assert.equal(amount(f.inv, I.BLACK_DYE, true), 1);
});

test("a plain vial still makes plain black dye, with the pestle used on the mushroom", (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.VIAL, 1));
  f.inv.setItem(1, new core.Item(I.BLACK_MUSHROOM, 1));
  f.inv.setItem(2, new core.Item(I.PESTLE_AND_MORTAR, 1));
  itemOnItem(f, I.PESTLE_AND_MORTAR, I.BLACK_MUSHROOM);
  assert.equal(amount(f.inv, I.BLACK_DYE, false), 1);
  assert.equal(f.inv.getAmount(I.VIAL), 0);
});

test("the clicked vial and mushroom are the ones used: a preset vial or mushroom in an earlier slot is left alone", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.VIAL, 1)));
  f.inv.setItem(1, new core.Item(I.VIAL, 1));
  f.inv.setItem(2, preset(new core.Item(I.BLACK_MUSHROOM, 1)));
  f.inv.setItem(3, new core.Item(I.BLACK_MUSHROOM, 1));
  f.inv.setItem(4, new core.Item(I.PESTLE_AND_MORTAR, 1));
  itemOnItem(f, I.BLACK_MUSHROOM, I.VIAL, { used: 3, usedWith: 1 });
  assert.equal(amount(f.inv, I.BLACK_DYE, false), 1, "the clicked plain vial became plain dye");
  assert.equal(amount(f.inv, I.BLACK_DYE, true), 0);
  assert.equal(amount(f.inv, I.VIAL, true), 1, "the preset vial is untouched");
  assert.equal(amount(f.inv, I.BLACK_MUSHROOM, true), 1, "the preset mushroom is untouched");
  assert.equal(amount(f.inv, I.BLACK_MUSHROOM, false), 0);
  // The other way round (vial used on mushroom), with the pestle on the clicked plain mushroom too.
  f.inv.setItem(1, new core.Item(I.VIAL, 1));
  f.inv.setItem(3, new core.Item(I.BLACK_MUSHROOM, 1));
  f.inv.setItem(5, new core.Item(I.VIAL, 1));
  itemOnItem(f, I.VIAL, I.BLACK_MUSHROOM, { used: 5, usedWith: 3 });
  assert.equal(f.inv.getItems()[5].getId(), I.BLACK_DYE, "the clicked vial in slot 5");
  assert.equal(f.inv.getItems()[1].getId(), I.VIAL);
  f.inv.setItem(3, new core.Item(I.BLACK_MUSHROOM, 1));
  itemOnItem(f, I.PESTLE_AND_MORTAR, I.BLACK_MUSHROOM, { used: 4, usedWith: 3 });
  assert.equal(f.messages.at(-1) === PRESET_TEXT, false, "the clicked plain mushroom is not refused for the preset one");
  assert.equal(amount(f.inv, I.BLACK_MUSHROOM, true), 1, "the preset mushroom is still untouched");
  assert.equal(amount(f.inv, I.BLACK_MUSHROOM, false), 0);
});

test("a preset black dye cannot dye goblin mail", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.BLACK_DYE, 1)));
  f.inv.setItem(1, new core.Item(I.GOBLIN_MAIL, 1));
  itemOnItem(f, I.BLACK_DYE, I.GOBLIN_MAIL);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(f.inv.getAmount(I.GOBLIN_MAIL), 1);
  assert.equal(amount(f.inv, I.BLACK_DYE, true), 1);
});

test("a plain dye cannot launder a preset dye in an earlier slot into plain goblin mail", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.BLACK_DYE, 1)));
  f.inv.setItem(1, new core.Item(I.GOBLIN_MAIL, 1));
  f.inv.setItem(2, new core.Item(I.BLACK_DYE, 1));
  itemOnItem(f, I.BLACK_DYE, I.GOBLIN_MAIL, { used: 2, usedWith: 1 });
  assert.equal(amount(f.inv, I.BLACK_DYE, true), 1, "the preset dye is untouched");
  assert.equal(amount(f.inv, I.BLACK_DYE, false), 0, "the plain dye was consumed");
  assert.equal(f.inv.getAmount(I.GOBLIN_MAIL), 0);
  assert.equal(f.inv.getAmount(I.BLACK_GOBLIN_MAIL), 1);
});

test("a preset goblin mail is not dyed, and a plain mail beside it is not taken for it", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.GOBLIN_MAIL, 1)));
  f.inv.setItem(1, new core.Item(I.GOBLIN_MAIL, 1));
  f.inv.setItem(2, new core.Item(I.BLACK_DYE, 1));
  itemOnItem(f, I.BLACK_DYE, I.GOBLIN_MAIL, { used: 2, usedWith: 0 });
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(f.inv.getAmount(I.BLACK_GOBLIN_MAIL), 0);
  assert.equal(f.inv.getAmount(I.BLACK_DYE), 1);
  itemOnItem(f, I.BLACK_DYE, I.GOBLIN_MAIL, { used: 2, usedWith: 1 });
  assert.equal(f.inv.getAmount(I.BLACK_GOBLIN_MAIL), 1);
  assert.equal(amount(f.inv, I.GOBLIN_MAIL, true), 1, "the preset mail is left alone");
});

test("a preset molten glass cannot pay for a sphere", (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.LAW_RUNE, 2));
  f.inv.setItem(1, preset(new core.Item(I.MOLTEN_GLASS, 1)));
  buySphere(f);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(f.inv.getAmount(I.DORGESH_KAAN_SPHERE), 0);
  assert.equal(amount(f.inv, I.LAW_RUNE, false), 2);
  assert.equal(amount(f.inv, I.MOLTEN_GLASS, true), 1);
});

// Oldak's "If the player does not have the materials" (PwO-Ik) / "has the materials" (4j8klO) conditions count preset
// copies too, so the player is not sent off to fetch glass already held; the paid teleport (6cDx_0) then refuses.
test("with only preset molten glass Oldak's dialogue takes the has-materials branch and the teleport refuses", (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.LAW_RUNE, 2));
  f.inv.setItem(1, preset(new core.Item(I.MOLTEN_GLASS, 1)));
  const condition = (stepId) => PM.emitNpcDialogueCondition({ player: f.p, npcId: OLDAK, stepId, text: "",
    definition: { getName: () => "Oldak", getId: () => OLDAK } });
  assert.equal(condition("PwO-Ik"), false, "not sent off for materials it holds");
  assert.equal(condition("4j8klO"), true);
  const at = f.p.getLocation().clone();
  PM.emitCustomEvent("npc-dialogue:action", { player: f.p, npcId: OLDAK, stepId: "6cDx_0", handled: false });
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.ok(f.p.getLocation().equals(at), "no teleport");
  assert.equal(f.inv.getAmount(I.DORGESH_KAAN_SPHERE), 0);
  assert.equal(amount(f.inv, I.LAW_RUNE, false), 2);
  f.inv.deleteAtSlot(1, 1);
  assert.equal(condition("PwO-Ik"), true, "no glass at all: the fetch-them branch");
  assert.equal(condition("4j8klO"), false);
});

test("a plain molten glass pays when a preset one sits first", (t) => {
  const f = actor(t);
  f.inv.setItem(0, preset(new core.Item(I.MOLTEN_GLASS, 1)));
  f.inv.setItem(1, new core.Item(I.LAW_RUNE, 2));
  f.inv.setItem(2, new core.Item(I.MOLTEN_GLASS, 1));
  buySphere(f);
  assert.equal(amount(f.inv, I.DORGESH_KAAN_SPHERE, false), 1);
  assert.equal(amount(f.inv, I.MOLTEN_GLASS, true), 1, "the preset glass is left alone");
  assert.equal(amount(f.inv, I.MOLTEN_GLASS, false), 0);
});

test("a preset black mushroom does not grind into a plain dye", (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.VIAL, 1));
  f.inv.setItem(1, preset(new core.Item(I.BLACK_MUSHROOM, 1)));
  f.inv.setItem(2, new core.Item(I.PESTLE_AND_MORTAR, 1));
  itemOnItem(f, I.BLACK_MUSHROOM, I.VIAL);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(f.inv.getAmount(I.BLACK_DYE), 0);
  assert.equal(f.inv.getAmount(I.VIAL), 1);
});
