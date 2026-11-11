// Run after `yarn build`: node --test tests/league-points.test.cjs
// League Points (docs/leagues.md): the sum of a league character's tasks, awarded once each, with
// the captured varbits, varps and popup; a main character can't hold any.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");

let core;
let worldLeague = 4; // the world's pluginConfig league:type (Trailblazer Reloaded)
const hooks = {};
const custom = {};
const emitted = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league"); // a league world
  // Several units attach to the same hook; run them all, as PluginManager does.
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      let result;
      for (const attached of lists[name]) {
        const answer = attached(event);
        if (answer !== undefined) result = answer;
      }
      return result;
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton() {},
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/Base.LeagueMode").register(api);
  require("../plugins/modes/Points.LeagueMode").register(api);
});

function character(name, profile = "main") {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  const varbits = new Map();
  const varps = new Map();
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === "sendVarbit") return (id, value) => (varbits.set(id, value), sender);
      if (key === "sendConfig") return (id, value) => (varps.set(id, value), sender);
      return () => sender;
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  return Object.assign(player, { varbits, varps });
}

function award(player, id, points, name) {
  const request = { player, id, points, name, awarded: false };
  custom["league:award-task"][0](request);
  return request.awarded;
}

function points(player) {
  const query = { player };
  custom["league:points"][0](query);
  return query;
}

test("an award credits once, raises the captured varbits and varps, and shows the popup", () => {
  const league = character("pointsy", "league");
  assert.deepEqual([league.varps.get(2614), league.varps.get(2615), league.varbits.get(10046)], [0, 0, 0], "login sends the totals");
  emitted.length = 0;
  assert.equal(award(league, "cerulean", 10, "Catch a Cerulean Twitch"), true);
  assert.deepEqual(points(league), { player: league, points: 10, tasks: 1 });
  assert.equal(league.varbits.get(10046), 1, "league_total_tasks_completed");
  assert.equal(league.varps.get(2614), 10, "league_points_completed");
  assert.equal(league.varps.get(2615), 10, "league_points_claimed");
  const popup = emitted.find(([name]) => name === "notification:show")[1];
  assert.deepEqual([popup.player, popup.title, popup.text, popup.colour, popup.jingle], [
    league,
    "League Task Complete!",
    "Task Completed: <col=ffffff>Catch a Cerulean Twitch</col><br><br>Points Earned: <col=ffffff>10</col>",
    16742144,
    { id: 283, length: 4500 },
  ], "as captured (227/00070), in the league's colour");
  const changed = emitted.find(([name]) => name === "league:points-changed")[1];
  assert.deepEqual([changed.points, changed.previous, changed.tasks], [10, 0, 1]);

  emitted.length = 0;
  assert.equal(award(league, "cerulean", 10, "Catch a Cerulean Twitch"), false, "the same task pays nothing twice");
  assert.deepEqual(points(league), { player: league, points: 10, tasks: 1 });
  assert.equal(emitted.filter(([name]) => name === "notification:show" || name === "league:points-changed").length, 0, "no popup, no change");

  assert.equal(award(league, "sapphire", 30), true);
  assert.deepEqual(points(league), { player: league, points: 40, tasks: 2 });
});

test("the total is the sum of the saved tasks, whatever a counter might have said", () => {
  const league = character("reloaded", "league");
  league.setAttribute("league:tasks", { a: 10, b: 40, c: 80 });
  for (const login of custom["league:login"]) login({ player: league, league: 4 });
  assert.deepEqual([league.varps.get(2614), league.varbits.get(10046)], [130, 3]);
  assert.deepEqual(points(league), { player: league, points: 130, tasks: 3 });
});

test("a main character can neither hold nor receive points, and bad awards write nothing", () => {
  const main = character("mainchar");
  assert.equal(award(main, "cerulean", 10), false);
  assert.equal(main.getAttribute("league:tasks"), undefined);
  assert.deepEqual(points(main), { player: main, points: 0, tasks: 0 });

  const league = character("careful", "league");
  assert.equal(award(league, "", 10), false, "no id");
  assert.equal(award(league, "x", -5), false, "negative points");
  assert.equal(award(league, "y", 2.5), false, "fractional points");
  assert.equal(league.getAttribute("league:tasks"), undefined);
});
