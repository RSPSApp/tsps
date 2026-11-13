// Run after `yarn build`: node --test tests/varlamore-drinks.test.cjs
//
// Varlamore wines, ales and liquor had a Drink op that did nothing. They drink like the other bar
// drinks through Potions.plugin.js, clicked as the inventory widget op the cache gives "Drink".
//
// rsprox capture (rsprox.net 4101, tick 1138, Blackbird red at 99s): human_eat, sound 2401, "You drink
// the Blackbird red." / "Rich flavours flutter across your tongue." (spam), nothing left, Attack 94,
// Slayer 98, Hunter 100. The other drinks' heals, boosts, drains and lines are their Wiki pages'.
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
let next = 7600;

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

function actor(t, { attack = 99, strength = 99, hitpoints = 99, hitpointsCurrent = 80, levels = {} } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("vwine" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const skills = p.getSkillManager();
  for (const [name, level] of [["ATTACK", attack], ["STRENGTH", strength], ["HITPOINTS", hitpoints], ...Object.entries(levels)]) {
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

const WINES = [
  // [name, id getter, expected id, boosted, drained, second line]
  ["Blackbird red", () => I.BLACKBIRD_RED, 29944, "HUNTER", "SLAYER", "Rich flavours flutter across your tongue."],
  ["Chilhuac red", () => I.CHILHUAC_RED, 29947, "FIREMAKING", "COOKING", "You feel a warmth spreading through you."],
  ["Eclipse red", () => I.ECLIPSE_RED, 29415, "WOODCUTTING", "FLETCHING", "It tastes great, but maybe not 1,000 coins great."],
  ["Ixcoztic white", () => I.IXCOZTIC_WHITE, 29952, "FARMING", "HERBLORE", "The citrusy profile perfectly energises your palate."],
  ["Metztonalli white", () => I.METZTONALLI_WHITE, 29955, "RUNECRAFTING", "FIREMAKING", "You find yourself feeling refreshed."],
  ["Chichilihui rosé", () => I.CHICHILIHUI_ROS, 29963, "HERBLORE", "FARMING", "A graceful calmness settles over you."],
  ["Imperial rosé", () => I.IMPERIAL_ROS, 29966, "SLAYER", "AGILITY", "You find yourself captivated by the complex flavours."],
];

for (const [name, id, expectedId, boosted, drained, line] of WINES) {
  test(`${name}: heals 16, ${boosted} +1, Attack -5, ${drained} -1, nothing left`, async t => {
    assert.equal(id(), expectedId);
    assert.equal(core.CacheDefinitions.getItem(expectedId).name, name);
    const f = actor(t, { hitpointsCurrent: 70, levels: { [boosted]: 99, [drained]: 99 } });
    f.inv.setItem(4, new core.Item(expectedId, 1));
    await drink(f, 4);
    assert.equal(slotId(f, 4), NOTHING, "the wine is drunk with nothing left");
    assert.equal(level(f, "ATTACK"), 94);
    assert.equal(level(f, boosted), 100);
    assert.equal(level(f, drained), 98);
    assert.equal(f.p.getHitpoints(), 86);
    assert.deepEqual(f.spam, [`You drink the ${name}.`, line]);
    assert.deepEqual(f.game, []);
    assert.deepEqual(f.animations, [829]);
  });
}

test("Blackbird red at full Hitpoints heals nothing past the base (rsprox.net 4101)", async t => {
  const f = actor(t, { hitpointsCurrent: 99, levels: { HUNTER: 99, SLAYER: 99 } });
  f.inv.setItem(0, new core.Item(I.BLACKBIRD_RED, 1));
  await drink(f, 0);
  assert.equal(f.p.getHitpoints(), 99);
  assert.equal(level(f, "HUNTER"), 100);
  assert.equal(level(f, "SLAYER"), 98);
  assert.equal(level(f, "ATTACK"), 94);
});

test("Tonameyo white restores 1 Prayer point up to the base, Attack -5, Thieving -1", async t => {
  assert.equal(I.TONAMEYO_WHITE, 29958);
  const f = actor(t, { hitpointsCurrent: 50, levels: { PRAYER: 70, THIEVING: 60 } });
  f.skills.setCurrentLevel(core.Skill.PRAYER, 40, false);
  f.inv.setItem(0, new core.Item(I.TONAMEYO_WHITE, 1));
  await drink(f, 0);
  assert.equal(level(f, "PRAYER"), 41);
  assert.equal(level(f, "THIEVING"), 59);
  assert.equal(level(f, "ATTACK"), 94);
  assert.equal(f.p.getHitpoints(), 66);
  assert.deepEqual(f.spam, ["You drink the Tonameyo white.", "You feel a divine warmth surround you."]);
});

test("Sunbeam ale: heals 1, Agility and Strength +1, Attack -(1 + 5%)", async t => {
  assert.equal(I.SUNBEAM_ALE, 29409);
  const f = actor(t, { attack: 60, strength: 70, levels: { AGILITY: 50 } });
  f.inv.setItem(2, new core.Item(I.SUNBEAM_ALE, 1));
  await drink(f, 2);
  assert.equal(slotId(f, 2), NOTHING);
  assert.equal(level(f, "AGILITY"), 51);
  assert.equal(level(f, "STRENGTH"), 71);
  assert.equal(level(f, "ATTACK"), 56);
  assert.equal(f.p.getHitpoints(), 81);
  assert.deepEqual(f.spam, ["You drink the Sunbeam ale.", "It tastes wonderful and leaves you feeling energised."]);
  assert.deepEqual(f.animations, [829]);
});

test("Steamforge brew: heals 1, Mining and Magic +1, Attack and Defence -(2 + 5%)", async t => {
  assert.equal(I.STEAMFORGE_BREW, 29412);
  const f = actor(t, { attack: 80, levels: { DEFENCE: 99, MINING: 40, MAGIC: 75 } });
  f.inv.setItem(0, new core.Item(I.STEAMFORGE_BREW, 1));
  await drink(f, 0);
  assert.equal(slotId(f, 0), NOTHING);
  assert.equal(level(f, "MINING"), 41);
  assert.equal(level(f, "MAGIC"), 76);
  assert.equal(level(f, "ATTACK"), 74);
  assert.equal(level(f, "DEFENCE"), 93);
  assert.equal(f.p.getHitpoints(), 81);
  assert.deepEqual(f.spam, ["You drink the Steamforge brew.", "It has an odd metallic taste to it."]);
});

test("Moon-lite: heals 5, Strength +(1 + 5%), Attack -(1 + 5%)", async t => {
  assert.equal(I.MOON_LITE, 29418);
  const f = actor(t, { attack: 70, strength: 80 });
  f.inv.setItem(0, new core.Item(I.MOON_LITE, 1));
  await drink(f, 0);
  assert.equal(slotId(f, 0), NOTHING);
  assert.equal(level(f, "STRENGTH"), 85);
  assert.equal(level(f, "ATTACK"), 66);
  assert.equal(f.p.getHitpoints(), 85);
  assert.deepEqual(f.spam, ["You drink the Moonlite.", "It's very strong and leaves you feeling a bit dizzy."]);
});

test("Tonameyo white at full Prayer, Attack 89 (rsprox.net 4101 tick 3413): Attack 84, Thieving 98", async t => {
  const f = actor(t, { attack: 99, levels: { PRAYER: 99, THIEVING: 99 } });
  f.skills.setCurrentLevel(core.Skill.ATTACK, 89, false);
  f.inv.setItem(0, new core.Item(I.TONAMEYO_WHITE, 1));
  await drink(f, 0);
  assert.equal(level(f, "ATTACK"), 84);
  assert.equal(level(f, "THIEVING"), 98);
  assert.equal(level(f, "PRAYER"), 99);
});

test("Sun-shine: heals 5, Strength +(1 + 5%), Attack -4", async t => {
  assert.equal(I.SUN_SHINE, 29421);
  const f = actor(t, { attack: 70, strength: 80 });
  f.inv.setItem(0, new core.Item(I.SUN_SHINE, 1));
  await drink(f, 0);
  assert.equal(slotId(f, 0), NOTHING);
  assert.equal(level(f, "STRENGTH"), 85);
  assert.equal(level(f, "ATTACK"), 66);
  assert.equal(f.p.getHitpoints(), 85);
  assert.deepEqual(f.spam, ["You drink the Sunshine.", "It's got quite the kick to it!"]);
});

test("a second wine waits for the drink delay", async t => {
  const f = actor(t, { levels: { HUNTER: 99, SLAYER: 99 } });
  f.inv.setItem(0, new core.Item(I.BLACKBIRD_RED, 1));
  f.inv.setItem(1, new core.Item(I.ECLIPSE_RED, 1));
  await drink(f, 0);
  await drink(f, 1);
  assert.equal(slotId(f, 0), NOTHING);
  assert.equal(slotId(f, 1), I.ECLIPSE_RED, "the second wine is refused while the timer runs");
});
