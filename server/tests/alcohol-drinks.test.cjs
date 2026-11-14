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

test("Keg of beer sways the camera: shake (3, 0, 20, 2), two liquid sounds, reset 50 ticks on", async t => {
  const f = actor(t);
  const sender = f.p.getPacketSender();
  const shakes = [];
  const resets = [];
  t.mock.method(sender, "sendCameraShake", (...args) => { shakes.push(args); return sender; });
  t.mock.method(sender, "sendCameraReset", () => { resets.push(true); return sender; });
  const sounds = [];
  const send = core.Sounds.sendSound.bind(core.Sounds);
  t.mock.method(core.Sounds, "sendSound", (player, sound) => {
    sounds.push(sound.getId?.() ?? sound.id);
    return send(player, sound);
  });
  f.inv.setItem(0, new core.Item(I.KEG_OF_BEER_2, 1));
  await drink(f, 0);
  assert.deepEqual(shakes, [[3, 0, 20, 2]]);
  assert.deepEqual(sounds, [2401, 2401]);
  for (let tick = 0; tick < 49; tick++) core.TaskManager.process();
  assert.equal(resets.length, 0, "still swaying on tick 49");
  core.TaskManager.process();
  assert.equal(resets.length, 1, "rsprox: cam_reset 50 ticks after the keg");
});

test("a second keg restarts the sway; only its own reset ends it", async t => {
  const f = actor(t);
  const sender = f.p.getPacketSender();
  const resets = [];
  t.mock.method(sender, "sendCameraShake", () => sender);
  t.mock.method(sender, "sendCameraReset", () => { resets.push(true); return sender; });
  f.inv.setItem(0, new core.Item(I.KEG_OF_BEER_2, 1));
  f.inv.setItem(1, new core.Item(I.KEG_OF_BEER_2, 1));
  await drink(f, 0);
  for (let tick = 0; tick < 10; tick++) core.TaskManager.process();
  f.p.getTimers().process(); f.p.getTimers().process(); f.p.getTimers().process();
  await drink(f, 1);
  assert.equal(slotId(f, 1), NOTHING, "the second keg was drunk");
  for (let tick = 0; tick < 40; tick++) core.TaskManager.process();
  assert.equal(resets.length, 0, "the first keg's reset is dropped");
  for (let tick = 0; tick < 10; tick++) core.TaskManager.process();
  assert.equal(resets.length, 1);
});

test("the keg's reset survives TaskManager.cancelTasks(player) from other systems", async t => {
  const f = actor(t);
  const sender = f.p.getPacketSender();
  const resets = [];
  t.mock.method(sender, "sendCameraShake", () => sender);
  t.mock.method(sender, "sendCameraReset", () => { resets.push(true); return sender; });
  f.inv.setItem(0, new core.Item(I.KEG_OF_BEER_2, 1));
  await drink(f, 0);
  for (let tick = 0; tick < 10; tick++) core.TaskManager.process();
  core.TaskManager.cancelTasks(f.p);
  for (let tick = 0; tick < 40; tick++) core.TaskManager.process();
  assert.equal(resets.length, 1);
});

test("the house cider sends its captured line, two spaces after the first sentence", async t => {
  // rsprox_transcripts/229/00264.txt: poh_cider, "You drink the cider.  You feel slightly reinvigorated...".
  const f = actor(t);
  f.inv.setItem(10, new core.Item(I.CIDER_3, 1));
  await drink(f, 10);
  assert.equal(slotId(f, 10), I.BEER_GLASS_4);
  assert.deepEqual(f.spam, ["You drink the cider.  You feel slightly reinvigorated...", "...and slightly dizzy too."]);
});

// Sailing drinks, rsprox rec 237/04103 (human_eat, two spam lines, the glass left) and the Wiki pages.
function setLevels(f, levels) {
  for (const [name, value] of Object.entries(levels)) {
    const skill = core.Skill[name];
    f.skills.setMaxLevel(skill, value);
    f.skills.setCurrentLevel(skill, value, false);
  }
}
const ALL_99 = { DEFENCE: 99, SAILING: 99, FISHING: 99, SLAYER: 99, HUNTER: 99, COOKING: 99, AGILITY: 99,
  THIEVING: 99, RANGED: 99, MAGIC: 99 };
const SAILING_DRINKS = [
  ["BARNACLE_BLASTER", "COCKTAIL_GLASS", ["You drink the Barnacle blaster.", "It has a bit of a crunch to it."],
    { ATTACK: 96, DEFENCE: 96, STRENGTH: 96, SAILING: 96, FISHING: 100 }],
  ["KRAKEN_COLADA", "COCKTAIL_GLASS", ["You drink the Kraken colada.", "You find yourself feeling rather woozy."],
    { ATTACK: 96, DEFENCE: 96, STRENGTH: 96, SAILING: 96, SLAYER: 100 }],
  ["SAILORS_MIRAGE", "COCKTAIL_GLASS", ["You drink the Sailor's mirage.", "You feel something sharp in your mouth."],
    { ATTACK: 96, DEFENCE: 96, STRENGTH: 96, SAILING: 96, HUNTER: 100 }],
  ["WHIRLPOOL_SURPRISE", "BEER_GLASS", ["You drink the rum cocktail. It tastes great!", "You feel inspired to both cook and sail!"],
    { COOKING: 101, SAILING: 102, AGILITY: 97 }],
  ["HORIZONS_LURE", "BEER_GLASS", ["You drink the rich golden ale. It tastes like a fond memory.", "You feel optimistic about the future."],
    { SAILING: 103, THIEVING: 97 }],
  ["TRAWLERS_TRUST", "BEER_GLASS", ["You drink the refreshing beer. It tastes foamy and salty.", "You feel at one with the sea!"],
    { SAILING: 101, FISHING: 101, ATTACK: 97 }],
  ["PERILDANCE_BITTER", "BEER_GLASS", ["You drink the deep red bitter. It tastes paradoxically sweet!", "You feel your muscles bulge and your sight become sharp!"],
    { SAILING: 100, STRENGTH: 101, RANGED: 101, MAGIC: 97 }],
  ["KRAKEN_INK_STOUT", "BEER_GLASS", ["You drink the rich stout. It thickly coats the back of your throat.", "Somehow you feel more adept at magic."],
    { SAILING: 100, MAGIC: 101, ATTACK: 97 }],
];
for (const [item, glass, lines, expected] of SAILING_DRINKS) {
  test(`${item} drinks with its captured lines, boosts and drains, leaving a glass`, async t => {
    const f = actor(t);
    setLevels(f, ALL_99);
    f.inv.setItem(2, new core.Item(I[item], 1));
    await drink(f, 2);
    assert.equal(slotId(f, 2), I[glass]);
    assert.deepEqual(f.spam, lines);
    assert.deepEqual(f.game, []);
    assert.deepEqual(f.animations, [829]);
    assert.equal(f.p.getHitpoints(), 80, "no healing");
    const after = { ATTACK: 99, STRENGTH: 99, DEFENCE: 99, ...ALL_99, ...expected };
    for (const [name, value] of Object.entries(after)) assert.equal(level(f, name), value, name);
  });
}

// Wiki (Brewing): each mature brew heals 2, at 99 Attack/Strength/Defence and 50 in the boosted skill.
const ale = reinvigorated => [`You drink the ${reinvigorated}. You feel slightly reinvigorated...`, "...and slightly dizzy too."];
const MATURE_BREWS = [
  ["ASGARNIAN_ALE_M_", ale("ale"), { STRENGTH: 102, ATTACK: 92 }],
  ["GREENMANS_ALE_M_", ["You drink the Greenman's Ale.", "It has a strange taste."], { HERBLORE: 52, ATTACK: 93, STRENGTH: 93, DEFENCE: 93 }],
  ["DRAGON_BITTER_M_", ale("Dragon Bitter"), { STRENGTH: 102, ATTACK: 93 }],
  ["DWARVEN_STOUT_M_", ["You drink the Dwarven Stout. It tastes foul.", "It tastes pretty strong too."], { MINING: 52, SMITHING: 52, ATTACK: 93, STRENGTH: 93, DEFENCE: 93 }],
  ["AXEMANS_FOLLY_M_", null, { WOODCUTTING: 52, ATTACK: 95, STRENGTH: 95 }],
  ["CHEFS_DELIGHT_M_", ale("ale"), { COOKING: 54, ATTACK: 92, STRENGTH: 92 }],
  ["MATURE_WMB", ["You drink the Wizard's Mind Bomb.", "You feel very strange."], { MAGIC: 54, ATTACK: 93, STRENGTH: 93, DEFENCE: 93 }],
  ["MATURE_CIDER", ale("cider"), { FARMING: 52, ATTACK: 95, STRENGTH: 95 }],
];
for (const [item, lines, expected] of MATURE_BREWS) {
  test(`${item} drinks: heals 2 with the Wiki's mature boost and drain, leaving a beer glass`, async t => {
    const f = actor(t);
    setLevels(f, { DEFENCE: 99, HERBLORE: 50, MINING: 50, SMITHING: 50, WOODCUTTING: 50, COOKING: 50, MAGIC: 50, FARMING: 50 });
    f.inv.setItem(3, new core.Item(I[item], 1));
    await drink(f, 3);
    assert.equal(slotId(f, 3), I.BEER_GLASS);
    assert.equal(f.p.getHitpoints(), 82);
    if (lines) assert.deepEqual(f.spam, lines);
    assert.deepEqual(f.animations, [829]);
    const after = { ATTACK: 99, STRENGTH: 99, DEFENCE: 99, ...expected };
    for (const [name, value] of Object.entries(after)) assert.equal(level(f, name), value, name);
  });
}

// Gnome cocktails that make you dizzy (Wiki pages of each, and of the Blurberry Bar premades, which
// drink the same). rsprox captures at 99/99: short green guy (rec 3467 tick 20092) Attack 95,
// Strength 104; drunk dragon (rec 940 tick 10008) Attack 95, Strength 106; both leave a cocktail
// glass with the two spam lines, the first ending in a space. Drunk dragon's +7 at 99 is fitted as
// 2 + 6% (the Wiki's 2 + 5% gives 6); Choc saturday and Blurberry special keep the Wiki's 2 + 5%.
const DIZZY_LINES = ["You drink the cocktail. It tastes great, ", "although you feel slightly dizzy."];
const GNOME_COCKTAILS = [
  // name, cocktail id, premade id, heal, Strength at 99, Strength at 50
  ["Wizard blizzard", 2054, 2040, 5, 105, 54],
  ["Short green guy", 2080, 2038, 5, 104, 53],
  ["Drunk dragon", 2092, 2032, 5, 106, 55],
  ["Choc saturday", 2074, 2030, 5, 105, 54],
  ["Blurberry special", 2064, 2028, 7, 105, 54],
];

for (const [name, cocktail, premade, heals, strength99, strength50] of GNOME_COCKTAILS) {
  for (const id of [cocktail, premade]) {
    const itemName = core => core.CacheDefinitions.getItem(id).name;
    test(`${name} (${id}) drinks: heals ${heals}, Strength ${strength99} at 99, Attack 95, cocktail glass`, async t => {
      assert.match(itemName(core), id === cocktail ? new RegExp(`^${name}$`) : /^Premade /);
      const f = actor(t);
      const sounds = [];
      const send = core.Sounds.sendSound.bind(core.Sounds);
      t.mock.method(core.Sounds, "sendSound", (player, sound) => {
        sounds.push(sound.getId?.() ?? sound.id);
        return send(player, sound);
      });
      f.inv.setItem(4, new core.Item(id, 1));
      await drink(f, 4);
      assert.deepEqual(sounds, [2401], "the captured drink sound");
      assert.equal(slotId(f, 4), I.COCKTAIL_GLASS);
      assert.equal(level(f, "ATTACK"), 95);
      assert.equal(level(f, "STRENGTH"), strength99);
      assert.equal(f.p.getHitpoints(), 80 + heals);
      assert.deepEqual(f.spam, DIZZY_LINES);
      assert.deepEqual(f.game, []);
      assert.deepEqual(f.animations, [829]);
    });
  }

  test(`${name} at 50/50: Strength ${strength50}, Attack 46 (3 + 2% of current)`, async t => {
    const f = actor(t, { attack: 50, strength: 50, hitpoints: 50, hitpointsCurrent: 48 });
    f.inv.setItem(0, new core.Item(cocktail, 1));
    await drink(f, 0);
    assert.equal(level(f, "STRENGTH"), strength50);
    assert.equal(level(f, "ATTACK"), 46);
    assert.equal(f.p.getHitpoints(), 50, "healing stops at the Hitpoints level");
  });
}
