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

// rsprox rec 20261111T225402-5ab63b4: one player (base Attack 64, Defence 61, Strength 58, Magic 70,
// Cooking 60, Herblore 50) drinks each in turn. Each case sets the levels the capture had just before
// the drink and checks the levels, lines and slot the server sent after it.
const BASE = { ATTACK: 64, DEFENCE: 61, STRENGTH: 58, MAGIC: 70, COOKING: 60, HERBLORE: 50, HITPOINTS: 69 };

function capturedActor(t, current) {
  const f = actor(t);
  for (const [name, base] of Object.entries(BASE)) {
    const skill = core.Skill[name];
    f.skills.setExperience(skill, core.SkillManager.getExperienceForLevel(base));
    f.skills.setMaxLevel(skill, base);
    f.skills.setCurrentLevel(skill, current[name] ?? base, false);
  }
  return f;
}

const levels = (f, names) => Object.fromEntries(names.map((name) => [name, level(f, name)]));

for (const { name, id, before, after, lines, left = () => I.BEER_GLASS, animation = 829 } of [
  { name: "Wizard's mind bomb (tick 9)", id: () => I.WIZARDS_MIND_BOMB, before: {},
    after: { ATTACK: 60, DEFENCE: 57, STRENGTH: 55, MAGIC: 73 }, lines: ["You drink the Wizard's Mind Bomb.", "You feel very strange."] },
  { name: "Greenman's ale (tick 48)", id: () => I.GREENMANS_ALE, before: { ATTACK: 57, DEFENCE: 57, STRENGTH: 55 },
    after: { ATTACK: 53, DEFENCE: 53, STRENGTH: 51, HERBLORE: 51 }, lines: ["You drink the Greenman's Ale.", "It has a strange taste."] },
  { name: "Dragon bitter (tick 59)", id: () => I.DRAGON_BITTER, before: { ATTACK: 54, STRENGTH: 52 },
    after: { ATTACK: 50, STRENGTH: 54 }, lines: ["You drink the Dragon Bitter. You feel slightly reinvigorated...", "...and slightly dizzy too."] },
  { name: "Grog (tick 69)", id: () => I.GROG, before: { ATTACK: 50, STRENGTH: 54 },
    after: { ATTACK: 45, STRENGTH: 57 }, lines: ["You drink the grog. You feel slightly reinvigorated...", "...and slightly dizzy too."] },
  { name: "Chef's delight (tick 81)", id: () => I.CHEFS_DELIGHT, before: { ATTACK: 45, STRENGTH: 57 },
    after: { ATTACK: 41, STRENGTH: 53, COOKING: 64 }, lines: ["You drink the ale. You feel slightly reinvigorated...", "...and slightly dizzy too."] },
  { name: "Vodka (tick 94)", id: () => I.VODKA, before: { ATTACK: 41, STRENGTH: 53 }, after: { ATTACK: 38, STRENGTH: 56 },
    lines: ["You drink the vodka. You feel slightly reinvigorated...", "...and slightly dizzy too."], left: () => NOTHING },
  { name: "Brandy (tick 111)", id: () => I.BRANDY, before: { ATTACK: 38, STRENGTH: 56 }, after: { ATTACK: 35, STRENGTH: 59 },
    lines: ["You drink the brandy. You feel slightly reinvigorated...", "...and slightly dizzy too."], left: () => NOTHING },
  { name: "Whisky (tick 121)", id: () => I.WHISKY, before: { ATTACK: 35, STRENGTH: 59 }, after: { ATTACK: 32, STRENGTH: 61 },
    lines: ["You drink the whisky. You feel slightly reinvigorated...", "...and slightly dizzy too."], left: () => NOTHING },
  { name: "Gin (tick 129)", id: () => I.GIN, before: { ATTACK: 32, STRENGTH: 61 }, after: { ATTACK: 29, STRENGTH: 61 },
    lines: ["You drink the gin. You feel slightly reinvigorated...", "...and slightly dizzy too."], left: () => NOTHING },
  { name: "Keg of beer (tick 139)", id: () => I.KEG_OF_BEER_2, before: { ATTACK: 29, STRENGTH: 61 }, after: { ATTACK: 10, STRENGTH: 65 },
    lines: ["You chug the keg. You feel reinvigorated...<br>... but extremely drunk too."], left: () => NOTHING, animation: 1330 },
]) {
  test(`captured drink: ${name}`, async t => {
    const f = capturedActor(t, before);
    const itemId = id();
    f.inv.setItem(12, new core.Item(itemId, 1));
    await drink(f, 12);
    assert.deepEqual(levels(f, Object.keys(after)), after);
    assert.equal(slotId(f, 12), left());
    assert.deepEqual(f.spam, lines);
    assert.deepEqual(f.game, []);
    assert.deepEqual(f.animations, [animation]);
  });
}

test("the house Greenman's ale and Dragon bitter send their stock lines and drain as captured at 99", async t => {
  // rsprox_transcripts/229/00264.txt: 99 -> 94 Attack, Defence and Strength; Dragon bitter 96 -> 90 Attack.
  const f = actor(t);
  f.skills.setExperience(core.Skill.DEFENCE, core.SkillManager.getExperienceForLevel(99));
  f.skills.setMaxLevel(core.Skill.DEFENCE, 99);
  f.skills.setCurrentLevel(core.Skill.DEFENCE, 99, false);
  f.inv.setItem(11, new core.Item(I.GREENMANS_ALE_3, 1));
  await drink(f, 11);
  assert.deepEqual(levels(f, ["ATTACK", "DEFENCE", "STRENGTH"]), { ATTACK: 94, DEFENCE: 94, STRENGTH: 94 });
  assert.equal(slotId(f, 11), I.BEER_GLASS_4);
  assert.deepEqual(f.spam, ["You drink the Greenman's Ale.", "It has a strange taste."]);

  const g = actor(t);
  g.skills.setCurrentLevel(core.Skill.ATTACK, 96, false);
  g.skills.setCurrentLevel(core.Skill.STRENGTH, 96, false);
  g.inv.setItem(12, new core.Item(I.DRAGON_BITTER_3, 1));
  await drink(g, 12);
  assert.deepEqual(levels(g, ["ATTACK", "STRENGTH"]), { ATTACK: 90, STRENGTH: 98 });
  assert.equal(slotId(g, 12), I.BEER_GLASS_4);
  assert.deepEqual(g.spam, ["You drink the Dragon Bitter. You feel slightly reinvigorated...", "...and slightly dizzy too."]);
});

test("Bottle of wine (tick 26): heals 14, Attack -3, two game lines, empty bottle, liquid sound", async t => {
  const f = capturedActor(t, { ATTACK: 60 });
  f.p.setHitpoints(50);
  assert.equal(I.BOTTLE_OF_WINE, 7919);
  const sounds = [];
  const send = core.Sounds.sendSound.bind(core.Sounds);
  t.mock.method(core.Sounds, "sendSound", (player, sound) => {
    sounds.push(sound.getId?.() ?? sound.id);
    return send(player, sound);
  });
  f.inv.setItem(13, new core.Item(I.BOTTLE_OF_WINE, 1));
  await drink(f, 13);
  assert.equal(level(f, "ATTACK"), 57);
  assert.equal(f.p.getHitpoints(), 64);
  assert.equal(slotId(f, 13), I.EMPTY_WINE_BOTTLE);
  assert.deepEqual(f.game, ["You drink the wine.", "It makes you feel a bit dizzy."]);
  assert.deepEqual(f.spam, []);
  assert.deepEqual(f.animations, [829]);
  assert.deepEqual(sounds, [2401]);
});
