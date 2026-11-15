// Run after `yarn build`: node --test tests/league-fragments-minigames.test.cjs
// Shattered Relics' minigame fragments (docs/leagues.md "Shattered Relics"), with real players: a
// Shattered Relics character with the fragment equipped, the same character with it owned but not
// equipped, and a main character. The Mage Training Arena's own points and the Motherlode Mine's
// own ore roll run as they do in game; the other minigames' events are built in the shape they send.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { GameConstants } = require("../dist/game/GameConstants");

const uid = (group, child) => (group << 16) | child;
const CLASS = 737;
const FRAGMENTS = 735;
const F = { barbarianPestWars: 51, roguesChompyFarm: 52, mothersMagicFossils: 53 };

let core;
const hooks = {};
const custom = {};
let worldLeague = 3;
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (...args) => {
      let result;
      for (const attached of lists[name]) {
        const answer = attached(...args);
        if (answer !== undefined) result = answer;
      }
      return result;
    };
  };
  const api = new Proxy({
    core,
    persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value),
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getTaskManager: () => ({ submit() {} }),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) {
        const key = `button:${id}`;
        (lists[key] ??= []).push(handler);
        hooks[key] = (event) => {
          for (const attached of lists[key]) {
            if (attached(event) !== false) return (event.handled = true);
          }
          return false;
        };
      }
    },
    onItemAction() {},
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => emit(name, payload),
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/Base.LeagueMode").register(api);
  require("../plugins/modes/Points.LeagueMode").register(api);
});

afterEach(() => {
  Math.random = realRandom;
});

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

function character(name, { league = 3, profile = "league" } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  const previous = worldLeague;
  worldLeague = league;
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  worldLeague = previous;
  return player;
}

function shattered(name) {
  const player = character(name);
  player.setInterfaceId(CLASS);
  hooks[`button:${uid(CLASS, 6)}`]({ player, buttonId: uid(CLASS, 6) });
  hooks[`button:${uid(CLASS, 26)}`]({ player, buttonId: uid(CLASS, 26) });
  hooks["command:leaguetask"]({ player, parts: ["leaguetask", `points-${name}`, "15000"] });
  return player;
}

function own(player, ...ids) {
  for (const id of ids) emit("league:grant-fragment", { player, id });
}

function equip(player, ...ids) {
  const previousLocation = player.getLocation();
  player.setLocation(new core.Location(2809, 3440, 0)); // Catherby's bank, as fragment swapping requires.
  own(player, ...ids);
  player.setInterfaceId(FRAGMENTS);
  for (const id of ids) hooks[`button:${uid(FRAGMENTS, 18)}`]({ player, buttonId: uid(FRAGMENTS, 18), slot: 9 * (id - 1), opId: 2 });
  player.setInterfaceId(-1);
  player.setLocation(previousLocation);
}

/** Level 2 (2,000 fragment XP) or 3 (8,000), script 5789. */
function level(player, id, which) {
  player.setAttribute("league:fragments", { ...player.getAttribute("league:fragments"), [id]: which === 3 ? 8000 : 2000 });
}

function cases(id) {
  const owner = shattered(`owner${id}`);
  equip(owner, id);
  const unequipped = shattered(`unequipped${id}`);
  own(unequipped, id);
  return { owner, others: [unequipped, character(`main${id}`, { profile: "main" })] };
}

const points = (player, minigame, amount) => emit("minigame:points", { player, minigame, points: amount }).points;
const chance = (player, minigame, kind) => emit("minigame:chance", { player, minigame, kind, multiplier: 1 }).multiplier;

test("Barbarian Pest Wars: Pest Control's commendation points and Soul Wars' zeal tokens x2, x3 and x4", () => {
  const { owner, others } = cases(F.barbarianPestWars);
  assert.equal(points(owner, "pest-control", 4), 8);
  assert.equal(points(owner, "soul-wars", 5), 10);
  assert.equal(points(owner, "tithe-farm", 5), 5, "Rogues' Chompy Farm's");
  level(owner, F.barbarianPestWars, 3);
  assert.equal(points(owner, "pest-control", 4), 16);
  for (const player of others) assert.equal(points(player, "pest-control", 4), 4);
});

test("Rogues' Chompy Farm: the Tithe Farm's points x2-x4, a chompy kill counted 2-4 times", () => {
  const { owner, others } = cases(F.roguesChompyFarm);
  assert.equal(points(owner, "tithe-farm", 50), 100);
  assert.equal(emit("big-chompy-bird-hunting:kill-credit", { player: owner, kills: 1 }).kills, 2);
  level(owner, F.roguesChompyFarm, 2);
  assert.equal(emit("big-chompy-bird-hunting:kill-credit", { player: owner, kills: 1 }).kills, 3);
  for (const player of others) assert.equal(emit("big-chompy-bird-hunting:kill-credit", { player, kills: 1 }).kills, 1);
});

test("Mother's Magic Fossils: the Mage Training Arena's own points x2; the Motherlode Mine's own nugget roll and fossils twice as likely", () => {
  const { owner, others } = cases(F.mothersMagicFossils);
  const Arena = require("../plugins/minigames/magetrainingarena/Common.MageTrainingArena");
  Arena.init({ core, emitCustomEvent: (name, payload) => emit(name, payload) });
  assert.equal(Arena.awardPoints(owner, "alchemist", 10), 20, "earned in a room");
  assert.equal(Arena.addPoints(owner, "alchemist", 10), 10, "not raised when bought back or set");
  for (const player of others) assert.equal(Arena.awardPoints(player, "alchemist", 10), 10, player.getUsername());

  assert.equal(chance(owner, "motherlode-mine", "golden-nugget"), 2);
  assert.equal(chance(owner, "fossil-island", "fossil"), 2);
  assert.equal(chance(others[1], "motherlode-mine", "golden-nugget"), 1);
  const Mine = require("../plugins/areas/motherlode/State.MotherlodeMine");
  const nugget = Mine.successChance(7, 7, 60);
  const between = () => nugget * 1.5;
  assert.equal(Mine.rollOre(60, between).key !== "nugget", true, "past the usual nugget chance");
  assert.equal(Mine.rollOre(60, between, chance(owner, "motherlode-mine", "golden-nugget")).key, "nugget", "inside twice that chance");

  // Hunter's own drift-net fossil roll: the unidentified fossils twice as likely, numulite as usual.
  const DriftNets = require("../plugins/skills/hunter/DriftNets.Hunter");
  require("../plugins/skills/hunter/Context.Hunter").H.core = core;
  const numulite = (9 * 3) / 175;
  const fossils = 3 / 350 + 3 / 700 + 3 / 875 + 3 / 3500;
  Math.random = () => numulite + 1.5 * fossils;
  assert.equal(DriftNets.fossil(owner, 3, 14), null, "past every fossil's usual chance");
  assert.ok([core.ItemIdentifiers.UNIDENTIFIED_SMALL_FOSSIL, core.ItemIdentifiers.UNIDENTIFIED_MEDIUM_FOSSIL, core.ItemIdentifiers.UNIDENTIFIED_LARGE_FOSSIL,
    core.ItemIdentifiers.UNIDENTIFIED_RARE_FOSSIL].includes(DriftNets.fossil(owner, 3, 14, 2)?.[0]), "inside twice them");
  Math.random = () => numulite * 1.5;
  assert.equal(DriftNets.fossil(owner, 3, 14, 2), null, "numulite's chance is not raised");
});
