// Run after `yarn build`: node --test tests/price-checker-full-inventory.test.cjs
//
// Chopping goes on while the price checker is open, and logs can fill the slot an item left. Closing
// the checker must not strand that item. Native fixture: every step is a packet dispatched through
// ClientConnection and handled by real World.process ticks. It shows the server's behaviour for these
// packets in this order, not that a client sends them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { World } = require("../dist/game/World");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");

const HOME = [3222, 3218];
const TREE_TILE = [3223, 3218];
const OAK_TREE = 10820;
const OPEN_PRICE_CHECKER = (387 << 16) | 3;
const PRICE_CHECKER_INTERFACE = 464;
const PRICE_CHECKER_INVENTORY = 238 << 16;
const LOGS_WANTED = 2;

let core;
let I;
let PlayerSave;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  ({ PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
});

function actor(t, username) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const session = new PlayerSession(channel);
  const p = new Player(session, new core.Location(HOME[0], HOME[1], 0));
  p.setUsername(username);
  p.setNeedsPlacement(false);
  session.setPlayer(p);
  t.mock.method(p, "onAdd", () => {});
  t.mock.method(p, "onRemove", () => {});
  p.setAttribute("bot-skip-persistence", true);
  for (const name of ["ATTACK", "WOODCUTTING"]) {
    p.getSkillManager().setMaxLevels(core.Skill[name], 99, false).setCurrentLevels(core.Skill[name], 99, false);
  }
  const c = new ClientConnection(channel);
  c.player = p;
  session.setTurnPacketProcessor(() => c.processTurnPackets());
  assert.ok(World.getPlayers().add(p), "the player is in the world");
  t.after(() => World.getPlayers().remove(p));
  World.refreshActiveRegions();
  return { p, c, inv: p.getInventory() };
}

/** A real oak beside the player, and rolls that land a log, with no nest and no pet. */
function oak(t) {
  const tree = new core.GameObject(OAK_TREE, new core.Location(...TREE_TILE, 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => core.ObjectManager.deregister(tree, true));
  t.mock.method(Math, "random", () => (new Error().stack.includes("maybeDropBirdNest") ? 0.99 : 0.3));
  return tree;
}

function kit(f, freeSlots) {
  f.inv.setItem(0, new core.Item(I.ARMADYL_GODSWORD, 1));
  f.inv.setItem(1, new core.Item(I.DRAGON_AXE, 1));
  while (f.inv.getFreeSlots() > freeSlots) f.inv.add(new core.Item(I.RAKE, 1), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), freeSlots);
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  World.process();
}

const widget = (uid, extra = {}) => ({ type: "widget_action", widgetId: uid, groupId: uid >>> 16, childId: uid & 0xffff, buttonNum: 1, ...extra });

/** Chop, open the checker from the Worn tab's button, Add the godsword, and wait for the logs. */
async function chopThenCheck(f) {
  await send(f, { type: "object_option", id: OAK_TREE, x: TREE_TILE[0], y: TREE_TILE[1], action: "Chop down" });
  await send(f, widget(OPEN_PRICE_CHECKER));
  assert.equal(f.p.getInterfaceId(), PRICE_CHECKER_INTERFACE, "the price checker opened");
  await send(f, widget(PRICE_CHECKER_INVENTORY, { slot: 0, itemId: I.ARMADYL_GODSWORD }));
  assert.equal(f.inv.getAmount(I.ARMADYL_GODSWORD), 0, "the godsword went into the checker");
  for (let i = 0; i < 60 && f.inv.getAmount(I.OAK_LOGS) < LOGS_WANTED; i++) World.process();
  assert.equal(f.inv.getAmount(I.OAK_LOGS), LOGS_WANTED, "chopping went on with the checker open");
  assert.equal(f.p.getInterfaceId(), PRICE_CHECKER_INTERFACE, "the checker is still open");
}

function floor(f, id) {
  const found = ItemOnGroundManager.getGroundItem(f.p.getUsername(), id, f.p.getLocation(), f.p.getPrivateArea?.());
  return found ? found.getItem().getAmount() : 0;
}

function reloaded(t, f, username) {
  f.p.onLogout();
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const g = new Player(new PlayerSession(channel), new core.Location(HOME[0], HOME[1], 0));
  g.setUsername(username);
  PlayerSave.fromPlayer(f.p).applyToPlayer(g);
  return g;
}

test("logs filling the inventory while the price checker is open don't strand the item in it", async (t) => {
  oak(t);

  const control = actor(t, "checkercontrol");
  kit(control, 3);
  await chopThenCheck(control);
  assert.ok(control.inv.getFreeSlots() > 0, "control: room is left");
  await send(control, { type: "interface_close" });
  assert.equal(control.inv.getAmount(I.ARMADYL_GODSWORD), 1, "control: closing returns the godsword");
  const controlSave = reloaded(t, control, "checkercontrol2");
  assert.equal(controlSave.getInventory().getAmount(I.ARMADYL_GODSWORD), 1, "control: it is in the save");

  const f = actor(t, "checkerfull");
  kit(f, 1);
  await chopThenCheck(f);
  assert.equal(f.inv.getFreeSlots(), 0, "the logs took the slot the godsword left");
  await send(f, { type: "interface_close" });
  const held = f.inv.getAmount(I.ARMADYL_GODSWORD);
  const onFloor = floor(f, I.ARMADYL_GODSWORD);
  const inChecker = f.p.__priceCheckerContainer?.getAmount?.(I.ARMADYL_GODSWORD) ?? 0;
  t.diagnostic(`after close: held=${held} floor=${onFloor} checker=${inChecker}`);
  const saved = reloaded(t, f, "checkerfull2").getInventory().getAmount(I.ARMADYL_GODSWORD);
  t.diagnostic(`after logout and reload: saved=${saved} floor=${floor(f, I.ARMADYL_GODSWORD)}`);
  assert.equal(held + onFloor, 1, "closing leaves the godsword held or on the floor");
  assert.equal(saved + floor(f, I.ARMADYL_GODSWORD), 1, "after a logout it is in the save or still on the floor");
});

test("closing returns what fits and puts the rest on the floor, and says so", async (t) => {
  const start = async (f, items) => {
    t.mock.method(f.p.getPacketSender(), "sendMessage", (message) => {
      (f.messages ??= []).push(message);
      return f.p.getPacketSender();
    });
    items.forEach((item, slot) => f.inv.setItem(slot, item));
    await send(f, widget(OPEN_PRICE_CHECKER));
    for (let slot = 0; slot < items.length; slot++) {
      const item = items[slot];
      await send(f, widget(PRICE_CHECKER_INVENTORY, { slot, itemId: item.getId(), buttonNum: 4 }));
      assert.equal(f.inv.getAmount(item.getId()), 0, "it went into the checker");
    }
  };
  const close = (f) => send(f, { type: "interface_close" });
  const onTheGround = (f) => (f.messages ?? []).filter((message) => /on the ground/.test(message)).length;

  const control = actor(t, "checkerroom");
  await start(control, [new core.Item(I.ARMADYL_GODSWORD, 1), new core.Item(I.ABYSSAL_WHIP, 1)]);
  await close(control);
  assert.equal(control.inv.getAmount(I.ARMADYL_GODSWORD), 1, "control: both come back");
  assert.equal(control.inv.getAmount(I.ABYSSAL_WHIP), 1, "control: both come back");
  assert.equal(onTheGround(control), 0, "control: nothing to say");

  const some = actor(t, "checkersome");
  await start(some, [new core.Item(I.ARMADYL_GODSWORD, 1), new core.Item(I.ABYSSAL_WHIP, 1)]);
  while (some.inv.getFreeSlots() > 1) some.inv.add(new core.Item(I.RAKE, 1), false);
  await close(some);
  for (const id of [I.ARMADYL_GODSWORD, I.ABYSSAL_WHIP]) {
    assert.equal(some.inv.getAmount(id) + floor(some, id), 1, "each is held or on the floor, once");
  }
  assert.equal(some.p.__priceCheckerContainer.getValidItems().length, 0, "the checker is empty");
  assert.equal(some.inv.getFreeSlots(), 0, "one fitted");
  assert.equal(onTheGround(some), 1, "and the player is told once");

  const stack = actor(t, "checkerstack");
  await start(stack, [new core.Item(I.DEATH_RUNE, 100)]);
  stack.inv.setItem(5, new core.Item(I.DEATH_RUNE, MAX_STACK_AMOUNT - 40));
  await close(stack);
  assert.equal(stack.inv.getAmount(I.DEATH_RUNE), MAX_STACK_AMOUNT, "the stack fills");
  assert.equal(floor(stack, I.DEATH_RUNE), 60, "the exact remainder is on the floor");
  assert.equal(stack.p.__priceCheckerContainer.getValidItems().length, 0, "the checker is empty");
  assert.equal(onTheGround(stack), 1);
});
