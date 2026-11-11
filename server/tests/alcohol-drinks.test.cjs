// Run after `yarn build`: node --test tests/alcohol-drinks.test.cjs
//
// Issue 4461: Drink on Karamjan rum, Asgarnian ale and Vodka did nothing. They (and the other bar
// spirits) drink like Beer through Potions.plugin.js, clicked here as the inventory widget op the
// cache gives "Drink" (op6 for Karamjan rum, op2 for the rest), through ClientConnection.dispatch.
//
// rsprox captures: Asgarnian ale (rec 3455) human_eat, sound 2401, "You drink the ale. You feel
// slightly reinvigorated..." / "...and slightly dizzy too." (spam), beer glass left. Karamjan rum
// (rec 4287) and Rum 28896 (recs 4101, 4291) the same with "You drink the rum...", nothing left,
// and at 99 Attack / 99 Strength: Attack 95, Strength 104.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");

const HOME = [3222, 3218];
const NOTHING = -1;
let core;
let I;
let next = 7300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, { attack = 99, strength = 99, hitpoints = 99, hitpointsCurrent = 80 } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("booze" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const skills = p.getSkillManager();
  for (const [name, level] of [["ATTACK", attack], ["STRENGTH", strength], ["HITPOINTS", hitpoints]]) {
    const skill = core.Skill[name];
    skills.setExperience(skill, core.SkillManager.getExperienceForLevel(level));
    skills.setMaxLevel(skill, level);
    skills.setCurrentLevel(skill, level, false);
  }
  p.setHitpoints(hitpointsCurrent);
  const c = new ClientConnection(channel);
  c.player = p;
  const game = [];
  const spam = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    game.push(message);
    return p.getPacketSender();
  });
  const sendTyped = p.getPacketSender().sendTypedMessage.bind(p.getPacketSender());
  t.mock.method(p.getPacketSender(), "sendTypedMessage", (type, message) => {
    if (type === core.ChatType.SPAM) spam.push(message);
    else game.push(message);
    return sendTyped(type, message);
  });
  const animations = [];
  const perform = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => {
    animations.push(animation.getId());
    return perform(animation);
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), skills, game, spam, animations };
}

function drinkOp(itemId) {
  for (const op of [2, 3, 4, 5, 6, 7]) {
    if (ItemActionPacketListener.resolveInventoryWidgetAction(itemId, op)?.option === "Drink") return op;
  }
  assert.fail(`the cache gives item ${itemId} no Drink op`);
}

async function drink(f, slot) {
  const itemId = f.inv.getItems()[slot].getId();
  await f.c.dispatch([{ type: "widget_action", widgetId: 149 << 16, groupId: 149, childId: 0, buttonNum: drinkOp(itemId), slot, itemId }]);
  f.c.processTurnPackets();
}

const level = (f, name) => f.skills.getCurrentLevel(core.Skill[name]);
const slotId = (f, slot) => f.inv.getItems()[slot]?.getId() ?? NOTHING;

const SPIRITS = [
  ["Karamjan rum", () => I.KARAMJAN_RUM, 431, "rum", 6],
  ["Rum", () => I.RUM_5, 28896, "rum", 2],
  ["Vodka", () => I.VODKA, 2015, "vodka", 2],
  ["Whisky", () => I.WHISKY, 2017, "whisky", 2],
  ["Gin", () => I.GIN, 2019, "gin", 2],
  ["Brandy", () => I.BRANDY, 2021, "brandy", 2],
];

for (const [name, id, expectedId, drinkName, op] of SPIRITS) {
  test(`${name} drinks: heals 5, Strength +1 + 5%, Attack -3 - 2%, bottle used up`, async t => {
    assert.equal(id(), expectedId);
    assert.equal(core.CacheDefinitions.getItem(expectedId).name, name);
    assert.equal(drinkOp(expectedId), op);
    const f = actor(t);
    f.inv.setItem(3, new core.Item(expectedId, 1));
    await drink(f, 3);
    assert.equal(slotId(f, 3), NOTHING, "the bottle is drunk with nothing left");
    assert.equal(f.inv.getAmount(I.BEER_GLASS), 0);
    // rsprox rec 4287 at 99/99: Attack 95, Strength 104.
    assert.equal(level(f, "ATTACK"), 95);
    assert.equal(level(f, "STRENGTH"), 104);
    assert.equal(f.p.getHitpoints(), 85);
    assert.deepEqual(f.spam, [`You drink the ${drinkName}. You feel slightly reinvigorated...`, "...and slightly dizzy too."]);
    assert.deepEqual(f.game, []);
    assert.deepEqual(f.animations, [829]);
  });
}

test("a spirit at low levels: Strength +1 at base 10, Attack -3 at 10, healing stops at max", async t => {
  const f = actor(t, { attack: 10, strength: 10, hitpoints: 10, hitpointsCurrent: 8 });
  f.inv.setItem(0, new core.Item(I.VODKA, 1));
  await drink(f, 0);
  assert.equal(level(f, "STRENGTH"), 11);
  assert.equal(level(f, "ATTACK"), 7);
  assert.equal(f.p.getHitpoints(), 10);
});

test("Asgarnian ale: heals 1, Strength +2, Attack -2 - 5%, leaves a beer glass", async t => {
  assert.equal(I.ASGARNIAN_ALE, 1905);
  assert.equal(drinkOp(I.ASGARNIAN_ALE), 2);
  const f = actor(t, { attack: 60, strength: 70 });
  f.inv.setItem(5, new core.Item(I.ASGARNIAN_ALE, 1));
  await drink(f, 5);
  assert.equal(slotId(f, 5), I.BEER_GLASS);
  assert.equal(f.inv.getAmount(I.ASGARNIAN_ALE), 0);
  assert.equal(level(f, "STRENGTH"), 72);
  // Wiki table: 60-79 Attack loses 5.
  assert.equal(level(f, "ATTACK"), 55);
  assert.equal(f.p.getHitpoints(), 81);
  assert.deepEqual(f.spam, ["You drink the ale. You feel slightly reinvigorated...", "...and slightly dizzy too."]);
  assert.deepEqual(f.game, []);
  assert.deepEqual(f.animations, [829]);
});

test("a second drink waits for the drink delay, as beer does", async t => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.KARAMJAN_RUM, 1));
  f.inv.setItem(1, new core.Item(I.KARAMJAN_RUM, 1));
  await drink(f, 0);
  await drink(f, 1);
  assert.equal(slotId(f, 0), NOTHING);
  assert.equal(slotId(f, 1), I.KARAMJAN_RUM, "the second rum is refused while the timer runs");
  assert.equal(level(f, "STRENGTH"), 104);
});
