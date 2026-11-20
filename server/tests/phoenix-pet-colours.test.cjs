// Run after `yarn build`: node --test tests/phoenix-pet-colours.test.cjs
// The phoenix's colours (Wiki: Phoenix): 250 firelighters unlock a colour for good and recolour the pet,
// with the double objectbox from rsprox 2783 tick 346, and Metamorphosis offers Red and the unlocked
// colours but the current one (rsprox 2780 tick 487, 2784 tick 600, 2783 tick 416). Every plugin is
// loaded; inventory clicks go through the real packet dispatch, uses through PluginManager's
// item-on-item and item-on-NPC emitters, and the follower is a real pet NPC.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

let core;
let next = 5600;
const obj = (name) => core.CacheDefinitions.getObjId(name);
const npcOf = (name) => core.CacheDefinitions.getNpcId(name);
const MESSAGEBOX_TEXT = (229 << 16) | 3;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("phoenix" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  const messages = [];
  const mesboxes = [];
  const strings = new Map();
  const sender = p.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendMessage", (m) => { messages.push(m); return sender; });
  t.mock.method(sender, "sendTypedMessage", (type, m) => { if (type === core.ChatType.MESBOX) mesboxes.push(m); return sender; });
  t.mock.method(sender, "sendString", (text, uid) => { strings.set(uid, text); return sendString(text, uid); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    for (const n of [...core.World.getNpcs()]) if (n?.getOwner?.() === p) core.World.getNpcs().remove(n);
  });
  return { p, c, messages, mesboxes, strings, inv: p.getInventory() };
}

async function metamorphosis(f, slot = 0) {
  const itemId = f.inv.get(slot).getId();
  await f.c.dispatch([{ type: "inventory_action", slot, itemId, widgetId: 3214, option: "Metamorphosis" }]);
  f.c.processTurnPackets();
}

function useOn(f, usedSlot, beaverSlot) {
  const event = {
    player: f.p, usedItem: f.inv.get(usedSlot), usedItemId: f.inv.get(usedSlot).getId(), usedItemSlot: usedSlot,
    usedWithItem: f.inv.get(beaverSlot), usedWithItemId: f.inv.get(beaverSlot).getId(), usedWithItemSlot: beaverSlot, handled: false,
  };
  PM.emitItemOnItem(event);
  return event;
}

function give(f, slot, name, amount = 1) { f.inv.setItem(slot, new core.Item(obj(name), amount)); }


const TITLE = "What colour would you like to transform your phoenix into?";
const PURPLE_TEXT = "You coat your phoenix in the Purple chemical, turning<br>it a brilliant Purple! You have now unlocked Purple as<br>a colour for your pet.";
const OBJECTBOX_DOUBLE = { model1: (11 << 16) | 1, text: (11 << 16) | 2, model2: (11 << 16) | 3 };

test("every colour is its own pet item and follower, red the base", () => {
  const Pets = require("../plugins/npcs/Pets.plugin");
  const getPetForItemId = (id) => Pets.__internals.PET_BY_ITEM_ID.get(id);
  for (const [item, npc] of [["phoenixpet", "phoenix_pet"], ["phoenixpet_blue", "phoenix_pet_blue"],
    ["phoenixpet_green", "phoenix_pet_green"], ["phoenixpet_purple", "phoenix_pet_purple"], ["phoenixpet_white", "phoenix_pet_white"]]) {
    const pet = getPetForItemId(obj(item));
    assert.ok(pet, `${item} is a pet`);
    assert.equal(pet.petId, npcOf(npc));
    assert.equal(pet.familyItemId, obj("phoenixpet"), "one family, one insurance record");
  }
});

test("250 purple firelighters on the white phoenix item: all taken, purple item, unlock and the captured box", (t) => {
  const f = actor(t);
  f.p.setAttribute("pets:phoenix-unlocks", ["white"]);
  give(f, 4, "phoenixpet_white");
  give(f, 5, "trail_gnomish_firelighter_purple", 250);
  const event = useOn(f, 5, 4);
  assert.equal(event.handled, true);
  assert.equal(f.inv.get(4).getId(), obj("phoenixpet_purple"));
  assert.equal(f.inv.getAmount(obj("trail_gnomish_firelighter_purple")), 0);
  assert.deepEqual(f.p.getAttribute("pets:phoenix-unlocks"), ["white", "purple"]);
  assert.deepEqual(f.mesboxes, [PURPLE_TEXT.replace(/<br>/g, " ")]);
  assert.equal(f.strings.get(OBJECTBOX_DOUBLE.text), PURPLE_TEXT);
  assert.ok(f.p.getAttribute("pets.owned").includes(obj("phoenixpet_purple")), "insurance follows the colour");
  assert.ok(!f.p.getAttribute("pets.owned").includes(obj("phoenixpet_white")), "one record per pet");
});

test("fewer than 250, an unlocked colour or a red firelighter are not taken", (t) => {
  const f = actor(t);
  f.p.setAttribute("pets:phoenix-unlocks", ["blue"]);
  give(f, 0, "phoenixpet");
  give(f, 1, "gnomish_firelighter_green", 249);
  give(f, 2, "gnomish_firelighter_blue", 300);
  give(f, 3, "gnomish_firelighter_red", 300);
  for (const slot of [1, 2, 3]) assert.equal(useOn(f, slot, 0).handled, false);
  assert.equal(f.inv.get(0).getId(), obj("phoenixpet"));
  assert.equal(f.inv.getAmount(obj("gnomish_firelighter_green")), 249);
  assert.equal(f.inv.getAmount(obj("gnomish_firelighter_blue")), 300);
  assert.deepEqual(f.p.getAttribute("pets:phoenix-unlocks"), ["blue"]);
});

test("item Metamorphosis lists Red and the unlocked colours but the current one, and the choice recolours it", async (t) => {
  const f = actor(t);
  f.p.setAttribute("pets:phoenix-unlocks", ["white"]);
  give(f, 0, "phoenixpet_white");
  f.messages.length = 0;
  await metamorphosis(f);
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p), { title: TITLE, options: ["Red.", "Cancel."] }, "rsprox 2780 tick 487");
  f.p.setAttribute("pets:phoenix-unlocks", ["white", "purple"]);
  await metamorphosis(f);
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p).options, ["Red.", "Purple.", "Cancel."], "rsprox 2784 tick 600");
  MultiChatboxPrompt.selectOption(f.p, 1);
  assert.equal(f.inv.get(0).getId(), obj("phoenixpet_purple"));
  await metamorphosis(f);
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p).options, ["Red.", "White.", "Cancel."], "rsprox 2783 tick 416");
  MultiChatboxPrompt.selectOption(f.p, 2);
  assert.equal(f.inv.get(0).getId(), obj("phoenixpet_purple"), "Cancel keeps it");
  assert.deepEqual(f.messages.filter((m) => !m.startsWith("New item added to your collection log")), [], "no chat line (rsprox 2783 tick 420)");
});

test("a red phoenix with nothing unlocked can't change", async (t) => {
  const f = actor(t);
  give(f, 0, "phoenixpet");
  await metamorphosis(f);
  assert.equal(MultiChatboxPrompt.getPending(f.p), null);
  assert.deepEqual(f.messages, ["Your pet can't change like that."]);
});

test("the follower: firelighters and Metamorphosis change it and the item the next pick-up gives", (t) => {
  const f = actor(t);
  give(f, 0, "phoenixpet");
  const Pets = require("../plugins/npcs/Pets.plugin");
  assert.equal(Pets.__internals.drop(f.p, obj("phoenixpet"), false), true);
  const follower = f.p.getAttribute("pets:current");
  assert.equal(follower.getId(), npcOf("phoenix_pet"));
  give(f, 1, "gnomish_firelighter_blue", 250);
  const event = { player: f.p, target: follower, npcId: follower.getId(), targetIndex: follower.getIndex(),
    item: f.inv.get(1), itemId: obj("gnomish_firelighter_blue"), slot: 1, interfaceId: 3214, handled: false };
  PM.emitItemOnNpc(event);
  assert.equal(event.handled, true);
  assert.equal(follower.getId(), npcOf("phoenix_pet_blue"));
  assert.equal(f.p.getAttribute("pets:active-item"), obj("phoenixpet_blue"));
  assert.equal(Pets.__internals.morph(f.p, follower), true);
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p).options, ["Red.", "Cancel."]);
  MultiChatboxPrompt.selectOption(f.p, 0);
  assert.equal(follower.getId(), npcOf("phoenix_pet"));
  assert.equal(Pets.__internals.morph(f.p, follower), true);
  MultiChatboxPrompt.selectOption(f.p, 0);
  assert.equal(follower.getId(), npcOf("phoenix_pet_blue"));
  assert.equal(Pets.__internals.pickup(f.p, follower), true);
  assert.ok(f.inv.getSlotForItemId(obj("phoenixpet_blue")) >= 0, "picked up as the blue item");
});
