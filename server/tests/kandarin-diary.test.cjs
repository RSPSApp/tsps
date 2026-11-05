// Run after `yarn build`: node --test tests/kandarin-diary.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ItemIds: Items } = require("../dist/util/IdEnums");
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Kandarin = require("../plugins/achievements/diaries/KandarinDiary.plugin");
const FletchingDiaries = require("../plugins/skills/fletching/Diaries.Fletching");
const FletchingShared = require("../plugins/skills/fletching/Shared.Fletching");

let index = 2000;

function actor(x, y, z = 0, privateArea = null) {
  const player = new Player(null, new (require("../dist/game/model/Location").Location)(x, y, z));
  player.setIndex(index++);
  player.setUsername("kandarin-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.getPrivateArea = () => privateArea;
  return player;
}

function fakeNpc(name, x, y, z = 0, privateArea = null, id = NpcIdentifiers.EARTH_ELEMENTAL) {
  return {
    getId: () => id,
    getPrivateArea: () => privateArea,
    getCurrentDefinition: () => ({ getName: () => name }),
    getLocation: () => new (require("../dist/game/model/Location").Location)(x, y, z),
  };
}

async function setup() {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const api = {
    ...PluginManager.createApi("KandarinDiaryTest"),
    core: { ...core, TaskManager: { submit(task) { task.setRunning(true); } } },
    getTaskManager: () => ({ submit(task) { task.setRunning(true); } }),
  };
  Diaries.register(api);
  Kandarin.register(api);
  return api;
}

const diary = Data.BY_KEY.get("kandarin");
const done = (player, task) => Progress.doneTasks(player, diary).has(task);

test("fishing: Catherby mackerel and Otto's Grotto sturgeon only", async () => {
  await setup();
  const player = actor(2836, 3435);
  Kandarin._test.fishingSuccess({ player, itemId: Items.RAW_MACKEREL });
  assert.equal(done(player, "catch-a-mackerel-at-catherby"), true);

  const wrongFish = actor(2836, 3435);
  Kandarin._test.fishingSuccess({ player: wrongFish, itemId: Items.RAW_BASS });
  assert.equal(done(wrongFish, "catch-a-mackerel-at-catherby"), false);

  const wrongPlace = actor(2550, 3550);
  Kandarin._test.fishingSuccess({ player: wrongPlace, itemId: Items.RAW_MACKEREL });
  assert.equal(done(wrongPlace, "catch-a-mackerel-at-catherby"), false);

  const instance = actor(2836, 3435, 0, {});
  Kandarin._test.fishingSuccess({ player: instance, itemId: Items.RAW_MACKEREL });
  assert.equal(done(instance, "catch-a-mackerel-at-catherby"), false);

  const otto = actor(2500, 3506);
  Kandarin._test.fishingSuccess({ player: otto, itemId: Items.LEAPING_STURGEON });
  assert.equal(done(otto, "catch-a-leaping-sturgeon"), true);

  const notOtto = actor(2836, 3435);
  Kandarin._test.fishingSuccess({ player: notOtto, itemId: Items.LEAPING_STURGEON });
  assert.equal(done(notOtto, "catch-a-leaping-sturgeon"), false);
});

test("smithing: the Otto's Grotto anvil, not Barbarian Village", async () => {
  await setup();
  const otto = actor(2502, 3486);
  Kandarin._test.smithingSuccess({ player: otto, itemId: Items.ADAMANT_SPEAR });
  assert.equal(done(otto, "smith-an-adamant-spear-at-otto-s-grotto"), true);
  Kandarin._test.smithingSuccess({ player: otto, itemId: Items.RUNE_HASTA });
  assert.equal(done(otto, "smith-a-rune-hasta-at-otto-s-grotto"), true);

  const village = actor(3082, 3412);
  Kandarin._test.smithingSuccess({ player: village, itemId: Items.ADAMANT_SPEAR });
  Kandarin._test.smithingSuccess({ player: village, itemId: Items.RUNE_HASTA });
  assert.equal(done(village, "smith-an-adamant-spear-at-otto-s-grotto"), false);
  assert.equal(done(village, "smith-a-rune-hasta-at-otto-s-grotto"), false);
});

test("fletching data: a Maple shortbow counts only inside the Seers' bank box", async () => {
  const api = await setup();
  FletchingShared.init(api);
  FletchingDiaries.init(api);
  FletchingDiaries.attach(api);
  const inside = actor(2725, 3492);
  api.emitCustomEvent("fletching:made", { player: inside, itemId: Items.MAPLE_SHORTBOW });
  assert.equal(done(inside, "string-a-maple-shortbow-in-seers-village-bank"), true);

  const outside = actor(2690, 3460);
  api.emitCustomEvent("fletching:made", { player: outside, itemId: Items.MAPLE_SHORTBOW });
  assert.equal(done(outside, "string-a-maple-shortbow-in-seers-village-bank"), false);
});

test("teleports, fairy ring, agility shortcut and water orb use their own success events", async () => {
  const api = await setup();
  const camelot = actor(2757, 3478);
  Kandarin._test.teleportArrival({ player: camelot, name: "Camelot Teleport" });
  assert.equal(done(camelot, "teleport-to-camelot"), true);
  Kandarin._test.teleportArrival({ player: camelot, name: "Ardougne Teleport" });
  assert.equal(done(camelot, "teleport-to-camelot"), true, "a second teleport is not the task again");

  for (const name of ["Catherby Teleport", "Tele Group Catherby"]) {
    const catherby = actor(2802, 3449);
    api.emitCustomEvent("spell:teleport-arrival", { player: catherby, name });
    assert.equal(done(catherby, "teleport-to-catherby"), true);
  }
  const portalUser = actor(2802, 3449);
  api.emitCustomEvent("teleport:landed", { player: portalUser, to: portalUser.getLocation() });
  assert.equal(done(portalUser, "teleport-to-catherby"), false, "a portal or recall landing is not a spell cast");

  const ring = actor(2658, 3409);
  Kandarin._test.fairyRingTravelled({ player: ring, code: "ALS" });
  assert.equal(done(ring, "travel-to-mcgrubor-s-wood-by-fairy-ring"), true);
  const otherRing = actor(2658, 3409);
  Kandarin._test.fairyRingTravelled({ player: otherRing, code: "AJS" });
  assert.equal(done(otherRing, "travel-to-mcgrubor-s-wood-by-fairy-ring"), false);

  const log = actor(2600, 3477);
  Kandarin._test.agilityObstacle({ player: log, shortcut: "Log balance (Coal Trucks)" });
  assert.equal(done(log, "cross-the-coal-truck-log-shortcut"), true);
  const wrongShortcut = actor(2600, 3477);
  Kandarin._test.agilityObstacle({ player: wrongShortcut, shortcut: "Rocks (Catherby)" });
  assert.equal(done(wrongShortcut, "cross-the-coal-truck-log-shortcut"), false);

  const orb = actor(2842, 3429);
  Kandarin._test.craftingMade({ player: orb, itemId: Items.WATER_ORB });
  assert.equal(done(orb, "charge-a-water-orb"), true);
});

test("kills: waterfall fire giant, shadow dungeon hound, mithril dragon, all four workshop elementals", async () => {
  await setup();
  const killer = actor(2560, 9890);
  Kandarin._test.npcDeath({ killer, npc: fakeNpc("Fire giant", 2562, 9886) });
  assert.equal(done(killer, "kill-a-fire-giant-inside-baxtorian-waterfall"), true);
  const outsideKiller = actor(2116, 9320);
  Kandarin._test.npcDeath({ killer: outsideKiller, npc: fakeNpc("Fire giant", 2116, 9320) });
  assert.equal(done(outsideKiller, "kill-a-fire-giant-inside-baxtorian-waterfall"), false);

  const shadow = actor(2700, 5070);
  Kandarin._test.npcDeath({ killer: shadow, npc: fakeNpc("Shadow Hound", 2694, 5067) });
  assert.equal(done(shadow, "kill-a-shadow-hound-in-the-shadow-dungeon"), true);

  const dragon = actor(1755, 5326);
  Kandarin._test.npcDeath({ killer: dragon, npc: fakeNpc("Mithril dragon", 1755, 5326) });
  assert.equal(done(dragon, "kill-a-mithril-dragon"), true);
  const questDragon = actor(1755, 5326, 0, {});
  Kandarin._test.npcDeath({ killer: questDragon, npc: fakeNpc("Mithril dragon", 1755, 5326) });
  assert.equal(done(questDragon, "kill-a-mithril-dragon"), false);

  const elementalKiller = actor(2700, 9880);
  for (const name of ["Earth elemental", "Water elemental", "Air elemental"]) {
    Kandarin._test.npcDeath({ killer: elementalKiller, npc: fakeNpc(name, 2700, 9880) });
    assert.equal(done(elementalKiller, "defeat-one-of-each-elemental-in-the-workshop"), false,
      `not yet with only ${name}`);
  }
  Kandarin._test.npcDeath({ killer: elementalKiller, npc: fakeNpc("Fire elemental", 2715, 9877) });
  assert.equal(done(elementalKiller, "defeat-one-of-each-elemental-in-the-workshop"), true);
});

test("the Seers' church organ and Sherlock only credit their own actions", async () => {
  await setup();
  const organLocation = new (require("../dist/game/model/Location").Location)(2691, 3461, 0);
  const organ = actor(2695, 3463);
  Kandarin._test.playOrgan({ player: organ, object: { getLocation: () => organLocation } });
  assert.equal(done(organ, "play-the-organ-in-seers-church"), true);

  const otherOrgan = actor(3127, 3105, 1);
  Kandarin._test.playOrgan({ player: otherOrgan, object: { getLocation: () => new (require("../dist/game/model/Location").Location)(3127, 3105, 1) } });
  assert.equal(done(otherOrgan, "play-the-organ-in-seers-church"), false);

  const talker = actor(2733, 3415);
  Kandarin._test.talkToSherlock({ player: talker });
  assert.equal(done(talker, "speak-to-sherlock"), true);
});

test("five Seers' flax picks and entering the Ranging Guild", async () => {
  const api = await setup();
  const picker = actor(2740, 3440);
  for (let i = 0; i < 4; i++) {
    Kandarin._test.picked({ player: picker, itemId: Items.FLAX, plant: "Flax" });
    assert.equal(done(picker, "collect-five-flax-from-the-seers-flax-fields"), false, `pick ${i + 1} is not five`);
  }
  Kandarin._test.picked({ player: picker, itemId: Items.FLAX, plant: "Flax" });
  assert.equal(done(picker, "collect-five-flax-from-the-seers-flax-fields"), true);

  const elsewhere = actor(2690, 3460);
  for (let i = 0; i < 5; i++) Kandarin._test.picked({ player: elsewhere, itemId: Items.FLAX, plant: "Flax" });
  assert.equal(done(elsewhere, "collect-five-flax-from-the-seers-flax-fields"), false);

  const RangingArea = require("../plugins/minigames/archerycompetition/Area.ArcheryCompetition");
  let guildArea;
  const register = api.registerArea;
  api.registerArea = (area) => { guildArea = area; register?.(area); };
  RangingArea(api);
  const entrant = actor(2660, 3425);
  guildArea.postEnter(entrant);
  assert.equal(done(entrant, "enter-the-ranging-guild"), true);
});

test("coal mined beside the coal trucks counts; any other coal does not", async () => {
  await setup();
  const atTrucks = actor(2578, 3483);
  Kandarin._test.miningSuccess({ player: atTrucks, itemId: Items.COAL });
  assert.equal(done(atTrucks, "mine-some-coal-near-the-coal-trucks"), true);
  const elsewhere = actor(3000, 3400);
  Kandarin._test.miningSuccess({ player: elsewhere, itemId: Items.COAL });
  assert.equal(done(elsewhere, "mine-some-coal-near-the-coal-trucks"), false);
});

test("Kandarin farming diary tasks follow the planted crop and patch", async () => {
  await setup();
  const jute = actor(2666, 3530);
  Kandarin._test.farmingPlanted({ player: jute, crop: "JUTE", patch: { getX: () => 2666, getY: () => 3525, getZ: () => 0 } });
  assert.equal(done(jute, "plant-some-jute-seeds-in-the-patch-north-of-mcgr"), true);
  const wrongPatch = actor(2666, 3530);
  Kandarin._test.farmingPlanted({ player: wrongPatch, crop: "JUTE", patch: { getX: () => 2809, getY: () => 3335, getZ: () => 0 } });
  assert.equal(done(wrongPatch, "plant-some-jute-seeds-in-the-patch-north-of-mcgr"), false);

  const limpwurt = actor(2809, 3464);
  Kandarin._test.farmingHarvested({ player: limpwurt, crop: "LIMPWURT", patch: { getX: () => 2809, getY: () => 3463, getZ: () => 0 } });
  assert.equal(done(limpwurt, "pick-some-limpwurt-root-from-the-farming-patch-i"), true);

  const dwarf = actor(2813, 3464);
  Kandarin._test.farmingHarvested({ player: dwarf, crop: "DWARF_WEED", patch: { getX: () => 2813, getY: () => 3463, getZ: () => 0 } });
  assert.equal(done(dwarf, "pick-some-dwarf-weed-from-the-herb-patch-at-cath"), true);
  const wrongCrop = actor(2813, 3464);
  Kandarin._test.farmingHarvested({ player: wrongCrop, crop: "GUAM", patch: { getX: () => 2813, getY: () => 3463, getZ: () => 0 } });
  assert.equal(done(wrongCrop, "pick-some-dwarf-weed-from-the-herb-patch-at-cath"), false);
});

test("a completed Barbarian Assault wave credits its diary task", async () => {
  await setup();
  const player = actor(1900, 5450);
  Kandarin._test.barbarianAssaultWave({ player, wave: 1, queen: false });
  assert.equal(done(player, "complete-a-wave-of-barbarian-assault"), true);
});

test("only the roaming earth elemental counts, not the one raised by mining", async () => {
  const api = await setup();
  const player = actor(2700, 9880);
  for (const name of ["Water elemental", "Air elemental", "Fire elemental"]) {
    Kandarin._test.npcDeath({ killer: player, npc: fakeNpc(name, 2700, 9880) });
  }
  const ids = api.core.NpcIdentifiers;
  Kandarin._test.npcDeath({ killer: player, npc: fakeNpc("Earth elemental", 2700, 9880, 0, null, ids.EARTH_ELEMENTAL_2) });
  assert.equal(done(player, "defeat-one-of-each-elemental-in-the-workshop"), false);
  Kandarin._test.npcDeath({ killer: player, npc: fakeNpc("Earth elemental", 2700, 9880, 0, null, ids.EARTH_ELEMENTAL) });
  assert.equal(done(player, "defeat-one-of-each-elemental-in-the-workshop"), true);
});
