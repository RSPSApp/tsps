// Run after `yarn build`: node --test tests/collection-log-category-counts.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const Data = require("../plugins/achievements/combatachievements/Data.CombatAchievements");
const Kills = require("../plugins/achievements/combatachievements/Kills.CombatAchievements");
const Wilderness = require("../plugins/bosses/wildernessbosses/Common.WildernessBosses");
const LMS = require("../plugins/minigames/lms/Profile.LastManStanding");
const BarbarianAssault = require("../plugins/minigames/barbarianassault/Points.BarbarianAssault");
const GnomeRestaurant = require("../plugins/minigames/gnomerestaurant/Orders.GnomeRestaurant");
const HallowedSepulchre = require("../plugins/minigames/hallowedsepulchre/Coffins.HallowedSepulchre");
const HallowedCommon = require("../plugins/minigames/hallowedsepulchre/Common.HallowedSepulchre");
const Mixology = require("../plugins/minigames/mixology/Orders.Mixology");
const SoulWars = require("../plugins/minigames/soulwars/Rewards.SoulWars");
const Tempoross = require("../plugins/minigames/tempoross/Records.Tempoross");
const Wintertodt = require("../plugins/minigames/wintertodt/Round.Wintertodt");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Data({ core: { CacheDefinitions } });
});

function player(attributes = {}) {
  const values = new Map(Object.entries(attributes));
  return {
    getAttribute: (key) => values.get(key),
    setAttribute: (key, value) => values.set(key, value),
  };
}

const count = (request) => {
  const query = { ...request };
  Kills.onCollectionLogCount(query);
  return query;
};

test("a boss page counts the monster's Combat Achievement kills", () => {
  const p = player({ [Kills.KILLS_ATTRIBUTE]: { Zulrah: 7, "Vorkath": 2 } });
  assert.equal(count({ player: p, category: "Zulrah", count: null }).count, 7);
  assert.equal(count({ player: p, category: "Vorkath", count: null }).count, 2);
});

test("shared pages put each monster on its own line, in the cache script's order", () => {
  const p = player({
    [Kills.KILLS_ATTRIBUTE]: {
      "Nightmare, The": 2,
      "Phosani's Nightmare": 3,
      "Crystalline Hunllef": 4,
      "Corrupted Hunllef": 5,
      "DK: Supreme": 6,
      "DK: Prime": 7,
      "DK: Rex": 8,
    },
  });

  const nightmare = count({ player: p, category: "The Nightmare", count: null });
  assert.equal(nightmare.count, 2, "Nightmare kills, not the sum");
  assert.deepEqual(nightmare.extraCounts, [3], "Phosani's Nightmare kills");

  const gauntlet = count({ player: p, category: "The Gauntlet", count: null });
  assert.equal(gauntlet.count, 5, "Corrupted Gauntlet completion count");
  assert.deepEqual(gauntlet.extraCounts, [4], "Gauntlet completion count");

  const kings = count({ player: p, category: "Dagannoth Kings", count: null });
  assert.equal(kings.count, 6, "Dagannoth Supreme");
  assert.deepEqual(kings.extraCounts, [7, 8], "Dagannoth Prime and Rex");
});

test("the article may be on either side of the monster's name", () => {
  const p = player({ [Kills.KILLS_ATTRIBUTE]: { "Whisperer, The": 6 } });
  assert.equal(count({ player: p, category: "The Whisperer", count: null }).count, 6);
});

test("a page with a Combat Achievement monster under another name is answered", () => {
  const p = player({ [Kills.KILLS_ATTRIBUTE]: { "Mad Angel, The": 2 } });
  assert.equal(count({ player: p, category: "The Mad Angel", count: null }).count, 2);
});

test("the Wilderness pairs put the singles boss first and the main boss second", () => {
  const p = player({
    [Kills.KILLS_ATTRIBUTE]: { Callisto: 9, Venenatis: 5 },
    [Wilderness.KILLS_ATTRIBUTE]: { artio: 4, spindel: 2 },
  });

  const callisto = count({ player: p, category: "Callisto and Artio", count: null });
  assert.equal(callisto.count, 4, "Artio's own kills");
  assert.deepEqual(callisto.extraCounts, [9], "Callisto's Combat Achievement kills");

  const venenatis = count({ player: p, category: "Venenatis and Spindel", count: null });
  assert.equal(venenatis.count, 2, "Spindel's own kills");
  assert.deepEqual(venenatis.extraCounts, [5], "Venenatis' Combat Achievement kills");
});

test("a category whose content keeps its own count is left alone", () => {
  const p = player({ [Kills.KILLS_ATTRIBUTE]: { Zulrah: 7 } });
  assert.equal(count({ player: p, category: "Zulrah", count: 41 }).count, 41);
});

test("a page with no Combat Achievement monster is not answered", () => {
  const p = player({ [Kills.KILLS_ATTRIBUTE]: {} });
  const request = count({ player: p, category: "Castle Wars", count: null });
  assert.equal(request.count, null);
  assert.equal(request.extraCounts, undefined);
});

test("Last Man Standing counts its games played, wins and kills", () => {
  const lms = player({
    "last-man-standing:games": 3,
    "last-man-standing:wins": 2,
    "last-man-standing:kills": 5,
  });
  const request = { player: lms, category: "Last Man Standing", count: null };
  LMS.collectionLogCount(request);
  assert.equal(request.count, 3);
  assert.deepEqual(request.extraCounts, [2, 5]);
});

test("Barbarian Assault counts high-level gambles", () => {
  const p = player({ [BarbarianAssault.HIGH_GAMBLE_COUNT_ATTRIBUTE]: 9 });
  const request = { player: p, category: "Barbarian Assault", count: null };
  BarbarianAssault.collectionLogCount(request);
  assert.equal(request.count, 9);
});

test("Gnome Restaurant puts hard deliveries first and easy second", () => {
  const p = player({
    "gnome-restaurant:hard-deliveries": 4,
    "gnome-restaurant:easy-deliveries": 7,
  });
  const request = { player: p, category: "Gnome Restaurant", count: null };
  GnomeRestaurant.collectionLogCount(request);
  assert.equal(request.count, 4, "hard deliveries");
  assert.deepEqual(request.extraCounts, [7], "easy deliveries");
});

test("Hallowed Sepulchre counts Grand Hallowed Coffins, not normal ones", () => {
  HallowedCommon.init({ core: {} });
  const p = player({
    [HallowedCommon.data.attributes.grandChests]: 3,
    [HallowedCommon.data.attributes.chests]: 40,
  });
  const request = { player: p, category: "Hallowed Sepulchre", count: null };
  HallowedSepulchre.collectionLogCount(request);
  assert.equal(request.count, 3);
});

test("Mastering Mixology counts orders fulfilled", () => {
  const p = player({ "mastering-mixology:orders": 21 });
  const request = { player: p, category: "Mastering Mixology", count: null };
  Mixology.collectionLogCount(request);
  assert.equal(request.count, 21);
});

test("Soul Wars counts Spoils of War opened", () => {
  const p = player({ [SoulWars.SPOILS_OPENED_ATTRIBUTE]: 5 });
  const request = { player: p, category: "Soul Wars", count: null };
  SoulWars.collectionLogCount(request);
  assert.equal(request.count, 5);
});

test("Tempoross counts kills then reward permits claimed", () => {
  const p = player({ "tempoross:kills": 12, "tempoross:permits-claimed": 31 });
  const request = { player: p, category: "Tempoross", count: null };
  Tempoross.collectionLogCount(request);
  assert.equal(request.count, 12, "Tempoross kills");
  assert.deepEqual(request.extraCounts, [31], "reward permits claimed");
});

test("Wintertodt and Tempoross replace the combat fallback on their own pages", () => {
  const p = player({
    "wintertodt:kills": 4, "wintertodt:rewards-claimed": 9,
    "tempoross:kills": 6, "tempoross:permits-claimed": 2,
  });
  const wintertodt = { player: p, category: "Wintertodt", count: 123, extraCounts: [] };
  Wintertodt.collectionLogCount(wintertodt);
  assert.equal(wintertodt.count, 4);
  assert.deepEqual(wintertodt.extraCounts, [9]);
  const tempoross = { player: p, category: "Tempoross", count: 123, extraCounts: [] };
  Tempoross.collectionLogCount(tempoross);
  assert.equal(tempoross.count, 6);
  assert.deepEqual(tempoross.extraCounts, [2]);
});

test("Gnome Restaurant sends its dedicated delivery varbits", () => {
  const sent = new Map();
  const p = player({
    "gnome-restaurant:hard-deliveries": 4,
    "gnome-restaurant:easy-deliveries": 7,
  });
  p.getPacketSender = () => ({ sendVarbit: (id, value) => sent.set(id, value) });
  GnomeRestaurant._test.init({
    core: {
      CacheDefinitions,
      ItemIdentifiers: { ALUFT_ALOFT_BOX: 0, REWARD_TOKEN_4: 0 },
    },
  });
  GnomeRestaurant.sendDeliveries(p);
  assert.equal(sent.get(11961), 4, "collection_aluft_hard_deliveries");
  assert.equal(sent.get(11960), 7, "collection_aluft_easy_deliveries");
});

test("Wintertodt counts kills then rewards claimed", () => {
  const p = player({ "wintertodt:kills": 8, "wintertodt:rewards-claimed": 19 });
  const request = { player: p, category: "Wintertodt", count: null };
  Wintertodt.collectionLogCount(request);
  assert.equal(request.count, 8, "Wintertodt kills");
  assert.deepEqual(request.extraCounts, [19], "rewards claimed");
});

test("a minigame page another plugin already answered is left alone", () => {
  const request = { player: player({ "last-man-standing:games": 3 }), category: "Last Man Standing", count: 4 };
  LMS.collectionLogCount(request);
  assert.equal(request.count, 4);
});
