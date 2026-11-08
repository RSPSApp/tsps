// Run after `yarn build`: node --test tests/windmill-league-task.test.cjs
// League tasks (docs/leagues.md, Tasks): the catalog the client is sent, the task list's captured
// flow and filters, the award triggers (kills, levels, quests), the completion bits, the command,
// and that a main character sees none of it.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");

const catalog = require("../plugins/modes/data/league-tasks.json");
const list = require("../plugins/modes/data/league-task-list.json");

const TASKS = 657;
const SIDE_PANEL = 656;
const FLOATER = (161 << 16) | 18;
const OP1 = 1 << 1;
const uid = (group, child) => (group << 16) | child;
const TRL = catalog.leagues["4"].tasks;
const indexOf = (id) => TRL.findIndex((task) => task.id === id);
const bitVarp = (index) => completionVarps()[Math.floor(index / 32)];
function completionVarps() {
  const varps = [];
  for (const [first, last] of list.completionVarps) for (let id = first; id <= last; id++) varps.push(id);
  return varps;
}

let core;
let api;
const hooks = {};
const custom = {};
const emitted = [];
const completedQuests = new Set();
let worldLeague = 4; // the world's pluginConfig league:type (Trailblazer Reloaded)

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league"); // a league world
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
  api = new Proxy({
    core,
    persistAttribute() {},
    getSkillManager: () => SkillManager,
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  // Stands in for QuestRuntime's answer.
  custom["quest:is-complete"] = [(request) => { request.complete = completedQuests.has(request.name); }];
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueTasks.plugin").register(api);
});

/** A real player whose packets are recorded in order; logged in as a new character of `profile`. */
function character(name, profile = "league", { login = true } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  const sent = { messages: [], varbits: new Map(), varps: new Map(), order: [], subs: [], flags: [], content: [], removals: 0, closed: [] };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sent.order.push(["varbit", id, value]), sender);
        case "sendConfig": return (id, value) => (sent.varps.set(id, value), sent.order.push(["varp", id, value]), sender);
        case "sendSubInterface": return (...args) => (sent.subs.push(args), sender);
        case "sendInterface": return (group) => (sent.subs.push(["main", group]), sender);
        case "sendInterfaceFlagsRange": return (...args) => (sent.flags.push(args), sender);
        case "sendContentData": return (source, datasets) => (sent.content.push(datasets), sender);
        case "sendInterfaceRemoval": return () => (sent.removals++, sender);
        case "closeInterface": return (group) => (sent.closed.push(group), sent.order.push(["close", group]), sender);
        case "sendInterfaceScript": return (id, args = []) => (sent.order.push(["script", id, ...args]), sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => (sent.messages.push(text), sent.order.push(["message", text]));
  if (login) hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  return Object.assign(player, { sent });
}

const dataset = (player, key) => player.sent.content.flatMap((datasets) => datasets).filter((entry) => entry.key === key).at(-1)?.rows;
const completed = (player) => Object.keys(player.getAttribute("league:tasks") ?? {});
const points = (player) => { const query = { player, points: 0, tasks: 0 }; for (const handler of custom["league:points"]) handler(query); return query.points; };

test("collecting wheat flour from a windmill completes the league task", () => {
  core.ObjectDefinition.init();
  const windmillApi = PluginManager.createApi("WindmillLeagueTest");
  windmillApi.emitCustomEvent = (name, payload) => api.emitCustomEvent(name, payload);
  require("../plugins/objects/Windmill.plugin").register(windmillApi);
  const items = core.ItemIdentifiers;
  const hopper = core.CacheDefinitions.getLocId("hopper1");
  const controls = core.CacheDefinitions.getLocId("hopperlevers1");
  const bin = core.CacheDefinitions.getLocId("millbase_flour");
  assert.equal(hopper, core.ObjectIdentifiers.HOPPER_24);
  assert.equal(controls, core.ObjectIdentifiers.HOPPER_CONTROLS_2);
  assert.equal(bin, core.ObjectIdentifiers.FLOUR_BIN);
  for (const [id, name, action] of [[hopper, "Hopper", "Fill"], [controls, "Hopper controls", "Operate"], [bin, "Flour bin", "Empty"]]) {
    const definition = new core.GameObject(id, new core.Location(3166, 3307, 2), 10, 0).getDefinition();
    assert.equal(definition.getName(), name);
    assert.equal(definition.getInteractions()[0], action);
  }
  const click = (player, id) => {
    const object = new core.GameObject(id, new core.Location(3166, 3307, 2), 10, 0);
    return PluginManager.emitObjectInteraction({ player, object, objectId: id,
      location: { x: 3166, y: 3307, z: 2 }, clickType: 1, handled: false });
  };
  const previousLeague = worldLeague;
  try {
    for (const league of [4, 5, 6]) {
      worldLeague = league;
      const player = character(`miller${league}`);
      const initialPoints = points(player);
      const task = catalog.leagues[String(league)].tasks.find((row) => row.id === "make-some-flour");
      assert.ok(task);
      const inv = player.getInventory();
      inv.resetItems();
      inv.adds(items.GRAIN, 1);
      assert.equal(click(player, hopper), true);
      assert.equal(click(player, controls), true);
      assert.equal(completed(player).includes("make-some-flour"), false, "milling alone is not collection");
      assert.equal(click(player, bin), true);
      assert.equal(completed(player).includes("make-some-flour"), false, "collection without a pot is refused");
      assert.equal(player.getAttribute("windmill:flour"), 1);
      inv.adds(items.POT, 1);
      assert.equal(click(player, bin), true);
      assert.equal(inv.getAmount(items.POT), 0);
      assert.equal(inv.getAmount(items.POT_OF_FLOUR), 1);
      assert.equal(completed(player).includes("make-some-flour"), true);
      const awarded = points(player);
      assert.equal(awarded, initialPoints + task.points);
      click(player, bin);
      assert.equal(points(player), awarded, "an empty bin cannot award points twice");
    }
    const corn = character("cornmiller");
    const inv = corn.getInventory();
    inv.resetItems();
    inv.adds(items.SWEETCORN, 1);
    inv.adds(items.POT, 1);
    const object = new core.GameObject(hopper, new core.Location(3166, 3307, 2), 10, 0);
    const slot = inv.getSlotForItemId(items.SWEETCORN);
    assert.ok(slot >= 0);
    assert.equal(PluginManager.emitItemOnObject({ player: corn, object, objectId: hopper,
      location: { x: 3166, y: 3307, z: 2 }, itemId: items.SWEETCORN,
      item: inv.getItems()[slot], itemSlot: slot, handled: false }), true);
    assert.equal(click(corn, controls), true);
    assert.equal(click(corn, bin), true);
    assert.equal(inv.getAmount(items.POT_OF_CORNFLOUR), 1);
    assert.equal(inv.getAmount(items.POT), 0);
    assert.equal(completed(corn).includes("make-some-flour"), false);

    const main = character("mainmiller", "main");
    main.getInventory().resetItems();
    main.getInventory().adds(items.GRAIN, 1);
    main.getInventory().adds(items.POT, 1);
    click(main, hopper);
    click(main, controls);
    click(main, bin);
    assert.equal(main.getInventory().getAmount(items.POT_OF_FLOUR), 1);
    assert.equal(completed(main).includes("make-some-flour"), false);
  } finally {
    worldLeague = previousLeague;
  }
});
