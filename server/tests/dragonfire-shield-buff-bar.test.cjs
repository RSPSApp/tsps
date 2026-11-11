// Run after `yarn build`: node --test tests/dragonfire-shield-buff-bar.test.cjs
// The buff bar's special cooldown for each charged shield (All Settings 132): the Dragonfire shield's in varbit
// 6539 and the ward's in 6540, both in steps of 8 ticks; the wyvern shield's as the tick it ends on, through
// buff_bar_start (script 5931, struct 840). The login script carries the tick so the bar's varbit cooldowns draw.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");
const { encodeGameframeBootstrap } = require("../dist/net/protocol/ClientProtocol");

const DragonfireShield = require("../plugins/items/DragonfireShield.plugin");

let cycle = 1000;
let loginHook = null;
const events = {};
const tasks = [];
DragonfireShield.register({
  core: {
    CombatMethod: class {},
    Equipment,
    ItemIdentifiers: ItemIds,
    World: { getProcessCycle: () => cycle },
    Task: class { constructor(delay) { this.delay = delay; } stop() { this.stopped = true; } },
    TaskManager: { submit: (task) => tasks.push(task) },
  },
  persistAttribute() {},
  onPlayerLogin(fn) { loginHook = fn; },
  onItemAction() {},
  onItemOnItem() {},
  registerBonusProvider() {},
  onCustomEvent(name, fn) { events[name] = fn; },
  registerCombatMethodResolver() {},
});

function createPlayer() {
  const attributes = new Map();
  const player = {
    varbits: [],
    scripts: [],
    isRegistered: () => true,
    getPacketSender: () => ({
      sendVarbit: (id, value) => player.varbits.push([id, value]),
      sendClientScript: (id, ...args) => player.scripts.push([id, ...args]),
    }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
  };
  return player;
}

const shield = (id) => DragonfireShield._test.shieldOf({ getId: () => id });

test("a Dragonfire shield blast counts down in dragonfire_shield_recharge (6539)", () => {
  const player = createPlayer();
  DragonfireShield._test.setRechargeSteps(player, 24, shield(ItemIds.DRAGONFIRE_SHIELD));
  DragonfireShield._test.setRechargeSteps(player, 23);
  assert.deepEqual(player.varbits, [[6539, 24], [6539, 23]]);
  assert.deepEqual(player.scripts, []);
});

test("a Dragonfire ward blast counts down in dragonfire_ward_recharge (6540), not the shield's varbit", () => {
  const player = createPlayer();
  DragonfireShield._test.setRechargeSteps(player, 24, shield(ItemIds.DRAGONFIRE_WARD));
  DragonfireShield._test.setRechargeSteps(player, 23);
  DragonfireShield._test.setRechargeSteps(player, 0);
  assert.deepEqual(player.varbits, [[6540, 24], [6540, 23], [6540, 0]]);
  assert.deepEqual(player.scripts, []);
});

test("an Ancient wyvern shield blast starts buff struct 840 with the tick the recharge ends on, and clears it at the end", () => {
  const player = createPlayer();
  cycle = 1000;
  DragonfireShield._test.setRechargeSteps(player, 24, shield(ItemIds.ANCIENT_WYVERN_SHIELD));
  assert.deepEqual(player.scripts, [[5931, 840, 1000 + 24 * 8]]);
  DragonfireShield._test.setRechargeSteps(player, 23);
  assert.equal(player.scripts.length, 1, "the bar counts the wyvern shield's cooldown down by itself");
  DragonfireShield._test.setRechargeSteps(player, 0);
  assert.deepEqual(player.scripts.at(-1), [5931, 840, 0]);
  assert.deepEqual(player.varbits, [], "no dragonfire shield or ward varbit");
});

test("a recharge running at logout comes back on the same shield's cooldown at login", () => {
  for (const [id, expect] of [
    [ItemIds.DRAGONFIRE_SHIELD, { varbits: [[6539, 10]], scripts: [] }],
    [ItemIds.DRAGONFIRE_WARD, { varbits: [[6540, 10]], scripts: [] }],
    [ItemIds.ANCIENT_WYVERN_SHIELD, { varbits: [], scripts: [[5931, 840, 5001 + 10 * 8]] }],
  ]) {
    const saved = createPlayer();
    DragonfireShield._test.setRechargeSteps(saved, 10, shield(id));
    const player = createPlayer();
    player.setAttribute("dragonfire-shield:recharge", saved.getAttribute("dragonfire-shield:recharge"));
    player.setAttribute("dragonfire-shield:recharge-shield", saved.getAttribute("dragonfire-shield:recharge-shield"));
    cycle = 5000;
    tasks.length = 0;
    loginHook({ player });
    // The wyvern shield's buff_bar_start waits a tick for the gameframe (and the buff bar) to open.
    cycle = 5001;
    for (const task of tasks.filter((task) => task.delay === 1)) task.execute();
    assert.deepEqual({ varbits: player.varbits, scripts: player.scripts }, expect, `shield ${id}`);
  }
});

test("a recharge saved before the shield was recorded stays on the Dragonfire shield's varbit", () => {
  const player = createPlayer();
  player.setAttribute("dragonfire-shield:recharge", 5);
  loginHook({ player });
  assert.deepEqual(player.varbits, [[6539, 5]]);
});

test("the welcome screen's Play restarts a running wyvern shield cooldown once the gameframe is open", () => {
  const player = createPlayer();
  cycle = 2000;
  DragonfireShield._test.setRechargeSteps(player, 12, shield(ItemIds.ANCIENT_WYVERN_SHIELD));
  player.scripts.length = 0;
  cycle = 2010;
  events["gameframe:ready"]({ player });
  assert.deepEqual(player.scripts, [[5931, 840, 2010 + 12 * 8]]);
  for (const id of [ItemIds.DRAGONFIRE_SHIELD, ItemIds.DRAGONFIRE_WARD]) {
    const other = createPlayer();
    DragonfireShield._test.setRechargeSteps(other, 12, shield(id));
    other.varbits.length = 0;
    events["gameframe:ready"]({ player: other });
    assert.deepEqual([other.varbits, other.scripts], [[], []], "a varbit cooldown needs no resend");
  }
  const idle = createPlayer();
  events["gameframe:ready"]({ player: idle });
  assert.deepEqual(idle.scripts, [], "no cooldown, nothing sent");
});

test("the login script (876) carries the tick it opens on as its first argument", () => {
  const script = (mapClock) => encodeGameframeBootstrap("BuffTester", 161, false, "REGULAR", true, mapClock)
    .find((packet) => packet.includes(Buffer.from("BuffTester")));
  // Its arguments: a count, then each one's type and value: [4][1][tick][1][0][0][name]...
  const firstArg = (packet) => {
    const at = packet.indexOf(Buffer.from("BuffTester")) - 12;
    assert.deepEqual([packet[at], packet[at + 1], packet[at + 6], packet[at + 11]], [4, 1, 1, 0], "four arguments: int, int, string");
    return packet.readInt32BE(at + 2);
  };
  assert.equal(firstArg(script(55120)), 55120);
  assert.equal(firstArg(encodeGameframeBootstrap("BuffTester").find((packet) => packet.includes(Buffer.from("BuffTester")))), 0,
    "0 when no tick is given");
});
