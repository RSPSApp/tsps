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

test("a minigame page another plugin already answered is left alone", () => {
  const request = { player: player({ "last-man-standing:games": 3 }), category: "Last Man Standing", count: 4 };
  LMS.collectionLogCount(request);
  assert.equal(request.count, 4);
});
