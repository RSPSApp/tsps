// Run after `yarn build`: node --test tests/darkmeyer-blood-pint.test.cjs
//
// Darkmeyer's blood pint had a Drink op that did nothing, and cooked mystery meat ate with the generic
// lines. rsprox.net rec 3056 (rev 231, 99s): the meat at full Hitpoints, tick 944, "You eat the meat." /
// "It tastes concerningly nice." (spam); the pint, tick 948, human_eat, sound 2401, "You drink the Blood
// Pint." / "It tastes unsurprisingly awful and makes you feel a bit sick." (spam), a beer glass left,
// Attack and Strength 104, Prayer and Magic 94. Rec 1864 (rev 227): Magic 103 -> 98, a drain of the base
// level. Wiki (Blood pint): Attack and Strength +(4% + 2), Magic and Prayer -(4% + 2); Wiki (Cooked
// mystery meat): heals 5, "It heals some health, and tastes concerningly nice.".
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
let next = 7700;

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
  p.setUsername("bpint" + p.getIndex());
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

function opFor(itemId, option) {
  for (const op of [2, 3, 4, 5, 6, 7]) {
    if (ItemActionPacketListener.resolveInventoryWidgetAction(itemId, op)?.option === option) return op;
  }
  assert.fail(`the cache gives item ${itemId} no ${option} op`);
}

async function click(f, slot, option) {
  const itemId = f.inv.getItems()[slot].getId();
  await f.c.dispatch([{ type: "widget_action", widgetId: 149 << 16, groupId: 149, childId: 0, buttonNum: opFor(itemId, option), slot, itemId }]);
  f.c.processTurnPackets();
}

const level = (f, name) => f.skills.getCurrentLevel(core.Skill[name]);
const slotId = (f, slot) => f.inv.getItems()[slot]?.getId() ?? NOTHING;

const BLOOD_PINT = 24774;
const BEER_GLASS = 1919;
const MYSTERY_MEAT = 24785;
const PINT_LINES = ["You drink the Blood Pint.", "It tastes unsurprisingly awful and makes you feel a bit sick."];

test("Blood pint at 99s: Attack and Strength 104, Prayer and Magic 94, a beer glass left (rec 3056)", async t => {
  assert.equal(core.CacheDefinitions.getItem(BLOOD_PINT).name, "Blood pint");
  assert.equal(I.BLOOD_PINT, BLOOD_PINT);
  const f = actor(t, { hitpointsCurrent: 99, levels: { PRAYER: 99, MAGIC: 99 } });
  const sounds = [];
  t.mock.method(core.Sounds, "sendSound", (player, sound) => { sounds.push(sound); });
  f.inv.setItem(22, new core.Item(BLOOD_PINT, 1));
  await click(f, 22, "Drink");
  assert.equal(slotId(f, 22), BEER_GLASS);
  assert.equal(level(f, "ATTACK"), 104);
  assert.equal(level(f, "STRENGTH"), 104);
  assert.equal(level(f, "PRAYER"), 94);
  assert.equal(level(f, "MAGIC"), 94);
  assert.equal(f.p.getHitpoints(), 99);
  assert.deepEqual(f.spam, PINT_LINES);
  assert.deepEqual(f.game, []);
  assert.deepEqual(f.animations, [829]);
  assert.ok(sounds.includes(core.Sound.DRINK), "the liquid sound (2401)");
});

test("Blood pint drains the base level: Magic 103 -> 98, a boosted Attack stays at its cap (rec 1864)", async t => {
  const f = actor(t, { attack: 98, strength: 98, hitpointsCurrent: 57, levels: { PRAYER: 99, MAGIC: 98 } });
  for (const name of ["ATTACK", "STRENGTH", "MAGIC"]) f.skills.setCurrentLevel(core.Skill[name], 103, false);
  f.inv.setItem(10, new core.Item(BLOOD_PINT, 1));
  await click(f, 10, "Drink");
  assert.equal(level(f, "MAGIC"), 98, "5 off, 4% of the base 98 + 2; 4% of the current 103 would take 6");
  assert.equal(level(f, "ATTACK"), 103, "98 + 3 + 2 is the cap");
  assert.equal(level(f, "STRENGTH"), 103);
  assert.equal(level(f, "PRAYER"), 94);
  assert.equal(f.p.getHitpoints(), 57, "it heals nothing");
});

test("Blood pint at low levels: +2 and -2 below 25", async t => {
  const f = actor(t, { attack: 20, strength: 1, levels: { PRAYER: 24, MAGIC: 1 } });
  f.inv.setItem(0, new core.Item(BLOOD_PINT, 1));
  await click(f, 0, "Drink");
  assert.equal(level(f, "ATTACK"), 22);
  assert.equal(level(f, "STRENGTH"), 3);
  assert.equal(level(f, "PRAYER"), 22);
  assert.equal(level(f, "MAGIC"), 0);
});

test("Cooked mystery meat at full Hitpoints: the meat and taste lines only (rec 3056 tick 944)", async t => {
  const f = actor(t, { hitpointsCurrent: 99 });
  f.inv.setItem(25, new core.Item(MYSTERY_MEAT, 1));
  await click(f, 25, "Eat");
  assert.equal(slotId(f, 25), NOTHING);
  assert.deepEqual(f.spam, ["You eat the meat.", "It tastes concerningly nice."]);
  assert.deepEqual(f.game, []);
  assert.deepEqual(f.animations, [829]);
});

test("Cooked mystery meat when hurt heals 5 with the Wiki's heal line", async t => {
  const f = actor(t, { hitpointsCurrent: 60 });
  f.inv.setItem(3, new core.Item(MYSTERY_MEAT, 1));
  await click(f, 3, "Eat");
  assert.equal(f.p.getHitpoints(), 65);
  assert.deepEqual(f.spam, ["You eat the meat.", "It heals some health, and tastes concerningly nice."]);
});
