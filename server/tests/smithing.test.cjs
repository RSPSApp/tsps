// Run after `yarn build`: node --test tests/smithing.test.cjs
const assert = require("node:assert/strict");
const { test, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { ItemIds: I } = require("../dist/util/IdEnums");
const { Skill } = require("../dist/game/model/Skill");
const Smithing = require("../plugins/skills/Smithing.plugin");

const buttons = new Map(), objects = new Map(), tasks = [], players = [];
let disconnect;
Smithing.register({
  getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
  onPlayerDisconnect: handler => { disconnect = handler; },
  onCustomEvent() {}, emitCustomEvent() {}, onItemOnObject() {}, log() {},
  onObjectInteraction: (name, actions) => objects.set(name, actions),
  onInterfaceActionButton: (ids, handler) => { for (const id of ids) buttons.set(id, handler); },
});
afterEach(() => { for (const player of players.splice(0)) disconnect({ player }); });

function playerWith(barId = I.BRONZE_BAR, bars = 27) {
  const items = new Map([[I.HAMMER, 1], [barId, bars]]);
  const player = { items, xp: 0, level: 99, moving: false, interfaceId: -1 };
  const sender = new Proxy({}, { get: () => () => sender });
  Object.assign(player, {
    getInventory: () => ({
      contains: id => (items.get(id) ?? 0) > 0,
      getAmount: id => items.get(id) ?? 0,
      deleteNumber: (id, n) => items.set(id, items.get(id) - n),
      addItem: item => items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()),
    }),
    getSkillManager: () => ({
      getCurrentLevel: () => player.level,
      addExperiences: (skill, xp) => { assert.equal(skill, Skill.SMITHING); player.xp += xp; },
    }),
    getPacketSender: () => sender,
    getInterfaceId: () => player.interfaceId,
    setInterfaceId: id => { player.interfaceId = id; },
    setEnteredAmountAction: action => { player.amountAction = action; },
    getMovementQueue: () => ({ size: () => player.moving ? 1 : 0 }),
    getForceMovement: () => null, isRegistered: () => true, getHitpoints: () => 99,
    performAnimation() {}, sendMessage() {},
  });
  players.push(player);
  return player;
}
function click(player, component) {
  const buttonId = (312 << 16) | component;
  return buttons.get(buttonId)({ player, buttonId });
}
function open(player) { objects.get("Anvil").Smith({ player }); }
function ticks(count = 140) {
  for (let i = 0; i < count; i++) {
    for (const task of [...tasks]) if (!task.tick()) tasks.splice(tasks.indexOf(task), 1);
  }
}

for (const [label, component, quantity] of [["1", 3, 1], ["5", 4, 5], ["10", 5, 10], ["X", 6, 3], ["All", 7, 27]]) {
  test(`${label} remains selected after making items and reopening the anvil`, () => {
    const player = playerWith();
    open(player);
    click(player, component);
    if (label === "X") player.amountAction.execute(quantity);
    click(player, 9);
    ticks();
    assert.equal(player.items.get(I.BRONZE_DAGGER), quantity);
    player.items.set(I.BRONZE_BAR, 27);
    open(player);
    click(player, 9);
    ticks();
    assert.equal(player.items.get(I.BRONZE_DAGGER), quantity * 2);
    assert.equal(player.xp, quantity * 2 * 12.5);
  });
}

test("walking closes the menu without clearing the selected quantity", () => {
  const player = playerWith();
  open(player);
  click(player, 7);
  player.moving = true;
  ticks(1);
  assert.equal(player.interfaceId, -1);
  player.moving = false;
  open(player);
  click(player, 9);
  ticks();
  assert.equal(player.items.get(I.BRONZE_DAGGER), 27);
});

test("disconnect clears the selection, and players do not share quantity state", () => {
  const first = playerWith(), second = playerWith();
  open(first);
  click(first, 7);
  open(second);
  click(second, 9);
  ticks();
  assert.equal(second.items.get(I.BRONZE_DAGGER), 1);
  disconnect({ player: first });
  open(first);
  click(first, 9);
  ticks();
  assert.equal(first.items.get(I.BRONZE_DAGGER), 1);
});

test("invalid X input preserves the previous selection", () => {
  const player = playerWith();
  open(player);
  click(player, 4);
  click(player, 6);
  for (const amount of [0, -1, 1.5, NaN]) player.amountAction.execute(amount);
  click(player, 9);
  ticks();
  assert.equal(player.items.get(I.BRONZE_DAGGER), 5);
});

test("anvil XP follows the metal and bars consumed, including multi-item recipes", () => {
  // OSRS Wiki Smithing tables: one bar's XP is independent of the product's output count.
  for (const [bar, xp] of [[I.BRONZE_BAR, 12.5], [I.IRON_BAR, 25], [I.STEEL_BAR, 37.5],
    [I.MITHRIL_BAR, 50], [I.ADAMANTITE_BAR, 62.5], [I.RUNITE_BAR, 75]]) {
    for (const [component, bars] of [[9, 1], [11, 2], [22, 5], [30, 1]]) {
      const player = playerWith(bar, bars);
      open(player);
      assert.equal(click(player, component), true);
      ticks(2);
      assert.equal(player.items.get(bar), 0);
      assert.equal(player.xp, xp * bars, `bar ${bar}, component ${component}`);
    }
  }
});

test("missing hammer, level, or bars preserves inventory and grants no XP", () => {
  for (const change of [p => p.items.delete(I.HAMMER), p => { p.level = 1; },
    p => p.items.set(I.BRONZE_BAR, 4)]) {
    const player = playerWith();
    change(player);
    const before = new Map(player.items);
    open(player);
    assert.equal(click(player, 22), false);
    ticks();
    assert.deepEqual(player.items, before);
    assert.equal(player.xp, 0);
  }
});
