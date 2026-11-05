// Run after `yarn build`: node --test tests/akd-lamps.test.cjs
//
// A Kingdom Divided gives two antique lamps of 10,000 XP (Wiki), which "can be safely destroyed and
// claimed again". Lamps and the book are moved by the real bank ops, Talk-to and Rub go through
// dispatch, and a reload is the real PlayerSave and JSON codec round trip.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const XpReward = require("../plugins/interface/XpReward.plugin");

const HOME = [3222, 3218];
const QUEST = "A Kingdom Divided";
const COMPLETE = 150;
const LAMP_XP = 10000;
const DEPOSIT_1 = 2;

let core;
let I;
let codec;
let next = 4800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("akdlamp" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  for (const skill of core.Skill.values()) {
    p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  }
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  QuestRuntime.questNamed(QUEST).setStage(p, COMPLETE);
  return { p, c, inv: p.getInventory() };
}

function reload(t, f) {
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const g = actor(t);
  codec.hydratePlayerSave(raw).applyToPlayer(g.p);
  g.p.setRegistered(true);
  g.p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  g.p.needsPlacement = false;
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false });
  return g;
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const lamp = () => I.ANTIQUE_LAMP_24;
const book = () => I.BOOK_OF_THE_DEAD;
const item = (id, amount = 1) => new core.Item(id, amount);
const slotOf = (f, id) => f.inv.getItems().findIndex((held) => held?.getId() === id);
const attack = (f) => f.p.getSkillManager().getExperience(core.Skill.ATTACK);

function banked(f, id) {
  return f.p.getBanks().reduce((sum, bank, tab) => (
    bank && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? sum + bank.getAmount(id) : sum), 0);
}

const owned = (f, id) => f.inv.getAmount(id) + f.p.getEquipment().getAmount(id) + banked(f, id);

function closeUi(f) {
  f.p.getDialogueManager().reset();
  f.p.getPacketSender().sendInterfaceRemoval();
}

async function talk(t, f) {
  const npc = core.NPC.create(core.NpcIdentifiers.COMMANDER_FULLORE, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  const index = npc.getCurrentDefinition(f.p).getActions().findIndex((action) => action === "Talk-to");
  assert.ok(index >= 0, "Fullore has Talk-to");
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: index + 1 });
  ticks(f, 3);
  closeUi(f);
  core.World.getNpcs().remove(npc);
}

/** Deposit-1 on every copy held, by the bank's real inventory-panel op. */
function depositAll(f, id) {
  f.p.getBank(0).open();
  assert.equal(core.Bank.isOpen(f.p), true, "the bank is open");
  while (f.inv.getAmount(id) > 0) {
    const before = f.inv.getAmount(id);
    core.Bank.handleWidgetAction(f.p, {
      groupId: core.Bank.SIDE_INTERFACE_ID, childId: core.Bank.SIDE_ITEMS_CHILD,
      buttonNum: DEPOSIT_1, slot: slotOf(f, id), itemId: id,
    });
    assert.equal(f.inv.getAmount(id), before - 1, "the real deposit took one");
  }
  closeUi(f);
}

/** Drags the held copy onto a tab, as the client does with the bank open. */
function dragToTab(f, id, tab) {
  f.p.getBank(0).open();
  const moved = core.Bank.handleDrag(f.p, {
    sourceWidgetId: (core.Bank.SIDE_INTERFACE_ID << 16) | core.Bank.SIDE_ITEMS_CHILD,
    sourceSlot: slotOf(f, id),
    sourceItemId: id,
    targetWidgetId: (core.Bank.MAIN_INTERFACE_ID << 16) | core.Bank.TABS_CHILD,
    targetSlot: core.Bank.TAB_BUTTON_SLOT_OFFSET + tab,
  });
  assert.equal(moved, true, "the drag was accepted");
  closeUi(f);
}

function xpSlot(skill) {
  for (let slot = 0; slot < 24; slot++) if (XpReward._test.skillForSlot(slot) === skill) return slot;
  assert.fail("no xpreward slot for the skill");
}

async function rub(f) {
  const slot = slotOf(f, lamp());
  await send(f, { type: "inventory_action", slot, itemId: lamp(), widgetId: 3214, option: "Rub" });
  await send(f, { type: "dialogue_continue", widgetId: 240 << 16, childIndex: xpSlot(core.Skill.ATTACK) });
  closeUi(f);
}

test("control: Fullore gives two lamps once, and they pay 20,000 XP between them", async (t) => {
  const f = actor(t);
  await talk(t, f);
  assert.equal(f.inv.getAmount(lamp()), 2, "two lamps");
  await talk(t, f);
  assert.equal(f.inv.getAmount(lamp()), 2, "none more while holding both");
  const start = attack(f);
  await rub(f);
  await rub(f);
  assert.equal(attack(f) - start, 2 * LAMP_XP, "two lamps' XP");
  assert.equal(f.inv.getAmount(lamp()), 0, "both consumed");
  await talk(t, f);
  assert.equal(f.inv.getAmount(lamp()), 0, "rubbed lamps aren't replaced");
});

test("a destroyed lamp is replaced, and the total stays two (Wiki)", async (t) => {
  const f = actor(t);
  await talk(t, f);
  await send(f, { type: "inventory_action", slot: slotOf(f, lamp()), itemId: lamp(), widgetId: 3214, option: "Destroy" });
  await send(f, { type: "dialogue_continue", widgetId: 584 << 16, childIndex: 1 });
  closeUi(f);
  assert.equal(f.inv.getAmount(lamp()), 1, "one destroyed");
  await talk(t, f);
  assert.equal(owned(f, lamp()), 2, "only that one comes back");
});

test("banked lamps count: Fullore doesn't top up past two", async (t) => {
  const f = actor(t);
  await talk(t, f);
  assert.equal(f.inv.getAmount(lamp()), 2, "control: two lamps");
  depositAll(f, lamp());
  assert.equal(banked(f, lamp()), 2, "both really reached the bank");
  await talk(t, f);
  assert.equal(owned(f, lamp()), 2, "no more lamps");
});

test("lamps in any bank tab count", async (t) => {
  const f = actor(t);
  await talk(t, f);
  dragToTab(f, lamp(), 3);
  assert.equal(f.inv.getAmount(lamp()), 1, "control: one lamp left the inventory");
  assert.equal(f.p.getBank(0).getAmount(lamp()), 0, "not in the first tab");
  assert.equal(banked(f, lamp()), 1, "but in the bank");
  await talk(t, f);
  assert.equal(owned(f, lamp()), 2, "no third lamp");
});

test("lamps already stockpiled pay for two rubs in all, and the spares are kept", async (t) => {
  const f = actor(t);
  for (let i = 0; i < 4; i++) f.inv.add(item(lamp()), false);
  const start = attack(f);
  await rub(f);
  await rub(f);
  assert.equal(attack(f) - start, 2 * LAMP_XP, "control: the first two pay");
  assert.equal(f.inv.getAmount(lamp()), 2, "control: and are consumed");
  await rub(f);
  assert.equal(attack(f) - start, 2 * LAMP_XP, "a third pays nothing");
  assert.equal(f.inv.getAmount(lamp()), 2, "and isn't consumed");
});

test("the rubbed count survives a real save and reload", async (t) => {
  const f = actor(t);
  await talk(t, f);
  await rub(f);
  const g = reload(t, f);
  assert.equal(g.inv.getAmount(lamp()), 1, "control: the other lamp is still held");
  await talk(t, g);
  assert.equal(g.inv.getAmount(lamp()), 1, "no replacement for the rubbed one");
  const start = attack(g);
  await rub(g);
  assert.equal(attack(g) - start, LAMP_XP, "the second lamp pays");
  g.inv.add(item(lamp()), false);
  await rub(g);
  assert.equal(attack(g) - start, LAMP_XP, "a third pays nothing after the reload");
});

test("the book: lost comes back once; held, worn or banked in any tab gives no copy", async (t) => {
  const f = actor(t);
  await talk(t, f);
  assert.equal(owned(f, book()), 1, "control: the book is handed over");
  await talk(t, f);
  assert.equal(owned(f, book()), 1, "control: held, no second");

  const lost = actor(t);
  await talk(t, lost);
  lost.inv.setItem(slotOf(lost, book()), item(-1, 0));
  lost.inv.refreshItems();
  assert.equal(owned(lost, book()), 0, "the book is gone");
  await talk(t, lost);
  assert.equal(owned(lost, book()), 1, "control: a lost book comes back");

  const worn = actor(t);
  await talk(t, worn);
  await send(worn, { type: "inventory_action", slot: slotOf(worn, book()), itemId: book(), widgetId: 3214, option: "Wield" });
  closeUi(worn);
  assert.equal(worn.p.getEquipment().getAmount(book()), 1, "the book is worn");
  await talk(t, worn);
  assert.equal(owned(worn, book()), 1, "worn: no copy");

  const bank = actor(t);
  await talk(t, bank);
  depositAll(bank, book());
  await talk(t, bank);
  assert.equal(owned(bank, book()), 1, "banked: no copy");

  const tab = actor(t);
  await talk(t, tab);
  dragToTab(tab, book(), 2);
  assert.equal(tab.p.getBank(0).getAmount(book()), 0, "not in the first tab");
  await talk(t, tab);
  assert.equal(owned(tab, book()), 1, "banked in another tab: no copy");
});
