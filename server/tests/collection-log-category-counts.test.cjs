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
const CastleWars = require("../plugins/minigames/castlewars/Scoreboard.CastleWars");
const SoulWars = require("../plugins/minigames/soulwars/Scoreboard.SoulWars");
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
  return query.count;
};

test("a boss page counts the monster's Combat Achievement kills", () => {
  const p = player({ [Kills.KILLS_ATTRIBUTE]: { Zulrah: 7, "Vorkath": 2 } });
  assert.equal(count({ player: p, category: "Zulrah", count: null }), 7);
  assert.equal(count({ player: p, category: "Vorkath", count: null }), 2);
});

test("shared pages sum their monsters, and the article may be on either side", () => {
  const p = player({
    [Kills.KILLS_ATTRIBUTE]: {
      "Nightmare, The": 2,
      "Phosani's Nightmare": 3,
      "Crystalline Hunllef": 4,
      "Corrupted Hunllef": 5,
      "Whisperer, The": 6,
    },
  });
  assert.equal(count({ player: p, category: "The Nightmare", count: null }), 5);
  assert.equal(count({ player: p, category: "The Gauntlet", count: null }), 9);
  assert.equal(count({ player: p, category: "The Whisperer", count: null }), 6);
});

test("a category whose content keeps its own count is left alone", () => {
  const p = player({ [Kills.KILLS_ATTRIBUTE]: { Zulrah: 7 } });
  assert.equal(count({ player: p, category: "Zulrah", count: 41 }), 41);
});

test("a page with no Combat Achievement monster is not answered", () => {
  const p = player({ [Kills.KILLS_ATTRIBUTE]: {} });
  assert.equal(count({ player: p, category: "Dagannoth Kings", count: null }), null);
});

test("minigame pages count their own games played", () => {
  const castle = player({ "castlewars:games-played": 12 });
  const castleRequest = { player: castle, category: "Castle Wars", count: null };
  CastleWars.collectionLogCount(castleRequest);
  assert.equal(castleRequest.count, 12);

  const soul = player({ "soul-wars:total-games": 6 });
  const soulRequest = { player: soul, category: "Soul Wars", count: null };
  SoulWars.collectionLogCount(soulRequest);
  assert.equal(soulRequest.count, 6);

  const lms = player({ "last-man-standing:games": 3 });
  const lmsRequest = { player: lms, category: "Last Man Standing", count: null };
  LMS.collectionLogCount(lmsRequest);
  assert.equal(lmsRequest.count, 3);
});

test("a minigame page another plugin already answered is left alone", () => {
  const request = { player: player({ "castlewars:games-played": 12 }), category: "Castle Wars", count: 4 };
  CastleWars.collectionLogCount(request);
  assert.equal(request.count, 4);
});
