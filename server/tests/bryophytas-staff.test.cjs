// Run after `yarn build`: node --test tests/bryophytas-staff.test.cjs
// Bryophyta's staff (docs/bryophytas-staff.md): nature runes charge it (rsprox local 1000564, tick 31098-31099:
// every rune held, at once, objectbox "Your Bryophyta's staff now has 31 charges."), worn it pays spells' nature
// runes with a 1/15 save (Wiki), and its charges combine with the rune pouch's fire runes for High Level Alchemy.
// Real engine: every plugin loaded, a real Player, the native inventory_use_on packet and the alchemy listener.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MagicOnItemPacketListener } = require("../dist/net/packet/impl/MagicOnItemPacketListener");
const { Skill } = require("../dist/game/model/Skill");
const Staff = require("../plugins/items/BryophytasStaff.plugin")._test;
const Pouch = require("../plugins/items/runepouch/Common.RunePouch");

let core;
let I;
let next = 9870;
let cycle = 1000;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.World.getProcessCycle = () => cycle;
  PM.emitServerStartup({});
});
after(() => { Staff.setRandom(null); PM.emitServerShutdown({}); });

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("bryo" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  p.getSkillManager().setCurrentLevel(Skill.MAGIC, 99, false).setMaxLevels(Skill.MAGIC, 99, false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); Staff.setRandom(null); });
  return { p, c, inv: p.getInventory(), messages };
}

async function useRunesOnStaff(f, runeSlot) {
  await f.c.dispatch([{ type: "inventory_use_on", slot: runeSlot, itemId: f.inv.getItems()[runeSlot].getId(),
    target: { kind: "inventory", slot: 0, id: f.inv.getItems()[0].getId() } }]);
  f.c.processTurnPackets();
}

function shownStatement(f) {
  const dialogue = f.p.getDialogueManager().getCurrent?.() ?? null;
  return dialogue ? { item: dialogue.getItemId?.(), text: dialogue.getText?.() } : null;
}

function wearStaff(f, chargeCount) {
  const staff = new core.Item(I.BRYOPHYTAS_STAFF, 1);
  Staff.setCharges(staff, chargeCount);
  f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, staff);
  return staff;
}

const listener = new MagicOnItemPacketListener();
function highAlch(f, itemId) {
  cycle += 10;
  f.p.setAttribute("magic:alchemy-queued", null);
  listener.castAlchemy(f.p, MagicOnItemPacketListener.HIGH_ALCH_SPELL_ID, f.inv.getSlotForItemId(itemId), itemId);
}

test("nature runes charge the uncharged staff with every rune held, at once, in an objectbox", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.BRYOPHYTAS_STAFF_UNCHARGED_, 1));
  f.inv.setItem(1, new core.Item(I.NATURE_RUNE, 31));
  await useRunesOnStaff(f, 1);
  const staff = f.inv.getItems()[0];
  assert.equal(staff.getId(), I.BRYOPHYTAS_STAFF, "same slot, now the charged staff");
  assert.equal(Staff.charges(staff), 31);
  assert.equal(f.inv.getAmount(I.NATURE_RUNE), 0, "all 31 runes taken, no amount prompt");
  assert.deepEqual(shownStatement(f), { item: I.BRYOPHYTAS_STAFF, text: "Your Bryophyta's staff now has 31 charges." });
});

test("charging stops at 1,000 and leaves the rest of the stack", async (t) => {
  const f = actor(t);
  const staff = new core.Item(I.BRYOPHYTAS_STAFF, 1);
  Staff.setCharges(staff, 990);
  f.inv.setItem(0, staff);
  f.inv.setItem(1, new core.Item(I.NATURE_RUNE, 50));
  await useRunesOnStaff(f, 1);
  assert.equal(Staff.charges(f.inv.getItems()[0]), 1000);
  assert.equal(f.inv.getAmount(I.NATURE_RUNE), 40);
  await useRunesOnStaff(f, 1);
  assert.equal(f.inv.getAmount(I.NATURE_RUNE), 40, "a full staff takes nothing");
  assert.equal(f.messages.at(-1), "Your Bryophyta's staff already has 1,000 charges.");
});

test("Check names the charges", async (t) => {
  const f = actor(t);
  const staff = new core.Item(I.BRYOPHYTAS_STAFF, 1);
  Staff.setCharges(staff, 234);
  f.inv.setItem(0, staff);
  await f.c.dispatch([{ type: "inventory_action", slot: 0, itemId: I.BRYOPHYTAS_STAFF, widgetId: 3214, option: "Check" }]);
  f.c.processTurnPackets();
  assert.equal(f.messages.at(-1), "Your Bryophyta's staff has 234 charges.");
});

test("worn and charged, the staff pays High Level Alchemy's nature rune; inventory runes go first", (t) => {
  const f = actor(t);
  const staff = wearStaff(f, 3);
  f.inv.add(new core.Item(I.RUNE_PLATEBODY, 1), false);
  f.inv.add(new core.Item(I.FIRE_RUNE, 50), false);
  Staff.setRandom(() => 0.5); // no save
  highAlch(f, I.RUNE_PLATEBODY);
  assert.equal(f.inv.getAmount(I.RUNE_PLATEBODY), 0, "cast with no nature rune held");
  assert.equal(f.inv.getAmount(I.FIRE_RUNE), 45);
  assert.equal(Staff.charges(staff), 2);

  f.inv.add(new core.Item(I.RUNE_PLATEBODY, 1), false);
  f.inv.add(new core.Item(I.NATURE_RUNE, 1), false);
  highAlch(f, I.RUNE_PLATEBODY);
  assert.equal(f.inv.getAmount(I.NATURE_RUNE), 0, "Ours: a held nature rune pays before the staff");
  assert.equal(Staff.charges(staff), 2);
});

test("a 1-in-15 save keeps the charge, with the Wiki's message; the last charge leaves it uncharged", (t) => {
  const f = actor(t);
  const staff = wearStaff(f, 1);
  f.inv.add(new core.Item(I.RUNE_PLATEBODY, 2), false);
  f.inv.add(new core.Item(I.FIRE_RUNE, 50), false);
  Staff.setRandom(() => 0.01); // floor(0.15) = 0: saved
  highAlch(f, I.RUNE_PLATEBODY);
  assert.equal(Staff.charges(staff), 1);
  assert.equal(f.messages.at(-1), Staff.SAVE_MESSAGE);
  Staff.setRandom(() => 0.5);
  highAlch(f, I.RUNE_PLATEBODY);
  assert.equal(f.inv.getAmount(I.RUNE_PLATEBODY), 0);
  assert.equal(staff.getId(), I.BRYOPHYTAS_STAFF_UNCHARGED_, "no charges left");
  assert.equal(Staff.charges(staff), 0);
});

test("an uncharged or unworn staff pays nothing", (t) => {
  const f = actor(t);
  const held = new core.Item(I.BRYOPHYTAS_STAFF, 1);
  Staff.setCharges(held, 100);
  f.inv.add(held, false);
  f.inv.add(new core.Item(I.RUNE_PLATEBODY, 1), false);
  f.inv.add(new core.Item(I.FIRE_RUNE, 50), false);
  highAlch(f, I.RUNE_PLATEBODY);
  assert.equal(f.inv.getAmount(I.RUNE_PLATEBODY), 1, "held in the inventory, it is no rune source");
  assert.match(f.messages.at(-1), /Nature Runes/);
  assert.equal(Staff.charges(held), 100);
});

test("rune pouch fire runes and staff nature charges pay one cast together", (t) => {
  const f = actor(t);
  const staff = wearStaff(f, 10);
  f.inv.add(new core.Item(I.RUNE_POUCH, 1), false);
  Pouch.store(f.p, I.FIRE_RUNE, 100);
  f.inv.add(new core.Item(I.RUNE_PLATEBODY, 1), false);
  Staff.setRandom(() => 0.5);
  highAlch(f, I.RUNE_PLATEBODY);
  assert.equal(f.inv.getAmount(I.RUNE_PLATEBODY), 0);
  assert.equal(Pouch.amountOf(f.p, I.FIRE_RUNE), 95);
  assert.equal(Staff.charges(staff), 9);
});

test("a combat spell's nature rune comes from the staff too (Bind: earth, water, nature)", (t) => {
  const f = actor(t);
  const staff = wearStaff(f, 5);
  f.inv.add(new core.Item(I.EARTH_RUNE, 10), false);
  f.inv.add(new core.Item(I.WATER_RUNE, 10), false);
  Staff.setRandom(() => 0.5);
  const bind = core.CombatSpells.BIND;
  assert.equal(bind.canCast(f.p, true), true);
  assert.equal(Staff.charges(staff), 5 - bind.itemsRequired(f.p).find((item) => item.getId() === I.NATURE_RUNE).getAmount());
  assert.equal(f.inv.getAmount(I.NATURE_RUNE), 0);
});
