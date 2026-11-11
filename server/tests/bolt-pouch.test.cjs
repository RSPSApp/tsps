// Run after `yarn build`: node --test tests/bolt-pouch.test.cjs
//
// The bolt pouch: Hirko's sale through his transcript, storing with Use, and interface 433's
// Remove and Unwield, read back from the varbits the cache scripts draw from.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDialogue } = require("../dist/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../dist/game/model/dialogues/entries/impl/PlayerDialogue");
const BoltPouch = require("../plugins/items/BoltPouch.plugin");

const HIRKO_AT = [2885, 10202];

let core;
let I;
let C;
let next = 9800;
const { useOnPouch, click, drag, open } = BoltPouch._test;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  C = core.CacheDefinitions;
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
  p.setUsername("boltp" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HIRKO_AT[0], HIRKO_AT[1] - 1, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); });
  t.after(() => {
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return { p, inv: p.getInventory(), messages };
}

const varbit = (f, name) => f.p.getPacketSender().getVarbit(C.getVarbitId(name));
const slotView = (f) => [1, 2, 3, 4].map((n) => [varbit(f, `xbows_pouch_slot${n}`), varbit(f, `xbows_pouch_num${n}`)]);
const typeOf = (id) => BoltPouch._test.typeOf(id);
const worn = (f) => f.p.getEquipment().get(core.Equipment.AMMUNITION_SLOT);
const uid = (name) => C.getComponentId(`xbows_pouch:${name}`);

function withPouch(f, slots = null) {
  f.inv.add(new core.Item(I.BOLT_POUCH, 1), false);
  if (slots) BoltPouch.setSlots(f.p, slots.map((s) => (s ? { id: s[0], amount: s[1] } : null)));
}

function use(f, itemId) {
  const pouch = f.inv.getItems().find((item) => item?.getId() === I.BOLT_POUCH);
  const used = f.inv.getItems().find((item) => item?.getId() === itemId);
  const event = { player: f.p, usedItem: used, usedWithItem: pouch, handled: false };
  useOnPouch(event);
  return event.handled;
}

function opened(f) {
  open({ player: f.p });
  assert.equal(f.p.getInterfaceId(), 433);
  const side = f.p.getPacketSender().getSubInterfaceAt(C.getComponentId("toplevel_osrs_stretch:sidemodal"));
  assert.equal(side?.groupId, 433, "433 fills the side panel");
}

function press(f, name) {
  const id = uid(name);
  click({ player: f.p, groupId: id >>> 16, childId: id & 0xffff, action: 1, handled: false });
}

function dragged(f, from, to) {
  const event = { player: f.p, packet: { sourceWidgetId: uid(from), targetWidgetId: uid(to), sourceSlot: -1, targetSlot: -1 }, handled: false };
  drag(event);
  return event.handled;
}

/** Talks to Hirko through his transcript, picking `choices` in order; returns every line said. */
function talk(f, choices) {
  const npc = core.NPC.create(core.NpcIdentifiers.HIRKO, new core.Location(...HIRKO_AT, 0));
  const clickType = npc.getDefinition().getActions().indexOf("Talk-to") + 1;
  PM.emitNpcInteraction({ player: f.p, npc, npcId: npc.getId(), definition: npc.getDefinition(), clickType, handled: false });
  const manager = f.p.getDialogueManager();
  const lines = [];
  const picks = [...choices];
  for (let i = 0; i < 80; i++) {
    const prompt = core.MultiChatboxPrompt.getPending(f.p);
    if (!manager.isActive() && prompt?.options) {
      if (!picks.length) break;
      const index = prompt.options.indexOf(picks.shift());
      assert.ok(index >= 0, `option offered: ${prompt.options.join(" | ")}`);
      core.MultiChatboxPrompt.handleInterfaceActionClick({
        player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: index + 1, action: index + 1,
      });
      continue;
    }
    if (!manager.isActive()) break;
    const current = manager.getCurrent();
    if (current instanceof NpcDialogue || current instanceof PlayerDialogue) lines.push(current.getText().replace(/\s+/g, " ").trim());
    manager.advance();
  }
  manager.reset?.();
  return lines;
}

const BUY = ["What about ammo?", "Yes I'll pay the 1500gp."];

test("Hirko sells a bolt pouch for 1,500 coins", (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.COINS, 2000), false);
  const refresh = f.inv.refreshItems.bind(f.inv);
  const shown = [];
  t.mock.method(f.inv, "refreshItems", () => { shown.push(f.inv.getAmount(I.BOLT_POUCH)); return refresh(); });
  const lines = talk(f, BUY);
  assert.ok(lines.includes("Well let's see now... for you? 1500 gold pieces should do the trick."), lines.join("\n"));
  assert.equal(f.inv.getAmount(I.BOLT_POUCH), 1);
  assert.equal(f.inv.getAmount(I.COINS), 500);
  assert.equal(shown.at(-1), 1, "the client is sent the inventory with the pouch in it");
});

test("Hirko: short of 1,500 coins, nothing is sold", (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.COINS, 1499), false);
  const lines = talk(f, BUY);
  assert.ok(lines.includes("Oh, I don't have that much on me."), lines.join("\n"));
  assert.equal(f.inv.getAmount(I.BOLT_POUCH), 0);
  assert.equal(f.inv.getAmount(I.COINS), 1499);
});

test("Hirko: one pouch at a time, a banked one included", (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.COINS, 2000), false);
  f.p.getBank(0).add(new core.Item(I.BOLT_POUCH, 1), false);
  const lines = talk(f, ["What about ammo?"]);
  assert.ok(lines.some((line) => /You can only have one at a time/.test(line)), lines.join("\n"));
  assert.equal(f.inv.getAmount(I.COINS), 2000);
  assert.equal(f.inv.getAmount(I.BOLT_POUCH), 0);
});

test("Destroy warns how to get another pouch; the bolts come back with the next one from Hirko", (t) => {
  const f = actor(t);
  withPouch(f, [[I.RUNITE_BOLTS, 400], null, null, null]);
  const pouch = f.inv.getItems().find((item) => item?.getId() === I.BOLT_POUCH);
  const prompt = { player: f.p, item: pouch, question: "Are you sure you want to destroy this item?", warning: "This item will be destroyed permanently." };
  PM.emitCustomEvent("destroy-item:prompt", prompt);
  assert.equal(prompt.warning, "You can get another pouch from Hirko in Keldagrim.");
  f.inv.delete(I.BOLT_POUCH, 1);
  assert.equal(f.inv.getAmount(I.BOLT_POUCH), 0);
  PM.emitCustomEvent("destroy-item:destroyed", { player: f.p, itemId: I.BOLT_POUCH, amount: 1 });
  f.inv.add(new core.Item(I.COINS, 1500), false);
  talk(f, BUY);
  assert.equal(f.inv.getAmount(I.BOLT_POUCH), 1);
  assert.equal(f.inv.getAmount(I.COINS), 0, "a new pouch was bought");
  assert.deepEqual(BoltPouch.slots(f.p)[0], { id: I.RUNITE_BOLTS, amount: 400 });
});

test("bolts used on the pouch go into a slot, up to 10,000, and the varbits show them", (t) => {
  const f = actor(t);
  withPouch(f, [[I.RUNITE_BOLTS, 9000], null, null, null]);
  f.inv.add(new core.Item(I.RUNITE_BOLTS, 1500), false);
  f.inv.add(new core.Item(I.BROAD_BOLTS, 300), false);
  assert.equal(use(f, I.RUNITE_BOLTS), true);
  assert.equal(use(f, I.BROAD_BOLTS), true);
  assert.equal(f.inv.getAmount(I.RUNITE_BOLTS), 500, "what doesn't fit stays");
  assert.equal(f.inv.getAmount(I.BROAD_BOLTS), 0);
  assert.deepEqual(slotView(f), [[typeOf(I.RUNITE_BOLTS), 10000], [typeOf(I.BROAD_BOLTS), 300], [0, 0], [0, 0]]);
  assert.equal(use(f, I.RUNITE_BOLTS), true);
  assert.deepEqual(f.messages, ["The pouch can't hold that."]);
});

test("a fifth bolt type is refused; ammo the pouch can't hold is left to other handlers", (t) => {
  const f = actor(t);
  withPouch(f, [[I.BRONZE_BOLTS, 1], [I.IRON_BOLTS, 1], [I.STEEL_BOLTS, 1], [I.MITHRIL_BOLTS, 1]]);
  f.inv.add(new core.Item(I.ADAMANT_BOLTS, 10), false);
  f.inv.add(new core.Item(I.KEBBIT_BOLTS, 10), false);
  assert.equal(use(f, I.ADAMANT_BOLTS), true);
  assert.deepEqual(f.messages, ["The pouch can't hold that."]);
  assert.equal(use(f, I.KEBBIT_BOLTS), false);
  assert.equal(f.inv.getAmount(I.ADAMANT_BOLTS), 10);
});

test("bolts carrying item state (preset ammo) stay out of the pouch", (t) => {
  const f = actor(t);
  withPouch(f);
  f.inv.add(new core.Item(I.RUNITE_BOLTS, 50).setMeta({ preset: 1 }), false);
  assert.equal(use(f, I.RUNITE_BOLTS), true);
  assert.deepEqual(f.messages, ["Preset items cannot be used for this."]);
  assert.equal(f.inv.getAmount(I.RUNITE_BOLTS), 50);
  assert.deepEqual(BoltPouch.slots(f.p), [null, null, null, null]);
});

test("a slot holds one Mith grapple", (t) => {
  const f = actor(t);
  withPouch(f);
  f.inv.add(new core.Item(I.MITH_GRAPPLE_2, 1), false);
  f.inv.add(new core.Item(I.MITH_GRAPPLE_2, 1), false);
  use(f, I.MITH_GRAPPLE_2);
  assert.equal(f.inv.getAmount(I.MITH_GRAPPLE_2), 1);
  assert.deepEqual(BoltPouch.slots(f.p)[0], { id: I.MITH_GRAPPLE_2, amount: 1 });
});

test("Open: Remove takes a slot's bolts out, Unwield takes the worn ammo off", (t) => {
  const f = actor(t);
  withPouch(f, [[I.DRAGON_BOLTS_2, 250], null, null, null]);
  f.p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(I.BROAD_BOLTS, 40));
  opened(f);
  press(f, "bolt_1");
  assert.equal(f.inv.getAmount(I.DRAGON_BOLTS_2), 250);
  assert.equal(BoltPouch.slots(f.p)[0], null);
  press(f, "current_bolt");
  assert.equal(f.inv.getAmount(I.BROAD_BOLTS), 40);
  assert.equal(worn(f)?.getId() ?? -1, -1);
});

test("a drag inside the pouch changes nothing yet, and the slots are sent again", (t) => {
  const f = actor(t);
  withPouch(f, [[I.DRAGON_BOLTS_2, 250], [I.BROAD_BOLTS, 5], null, null]);
  f.p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(I.BROAD_BOLTS, 40));
  opened(f);
  const sent = [];
  t.mock.method(f.p.getPacketSender(), "sendVarbit", function (id, value) { sent.push(id); return this; });
  assert.equal(dragged(f, "bolt_1", "bolt_2"), true);
  assert.equal(dragged(f, "bolt_1", "current_bolt"), true);
  assert.deepEqual(BoltPouch.slots(f.p).slice(0, 2), [{ id: I.DRAGON_BOLTS_2, amount: 250 }, { id: I.BROAD_BOLTS, amount: 5 }]);
  assert.equal(worn(f).getId(), I.BROAD_BOLTS);
  assert.equal(sent.length, 16, "both drags resend the four slots' two varbits");
});

test("with the interface closed or no pouch carried, clicks and drags change nothing", (t) => {
  const f = actor(t);
  BoltPouch.setSlots(f.p, [{ id: I.DRAGON_BOLTS_2, amount: 250 }, null, null, null]);
  press(f, "bolt_1");
  assert.equal(dragged(f, "bolt_1", "bolt_2"), true);
  assert.equal(f.inv.getAmount(I.DRAGON_BOLTS_2), 0);
  assert.deepEqual(BoltPouch.slots(f.p)[0], { id: I.DRAGON_BOLTS_2, amount: 250 });
});
