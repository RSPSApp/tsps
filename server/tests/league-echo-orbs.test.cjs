// Run after `yarn build`: node --test tests/league-echo-orbs.test.cjs
// Demonic Pacts League echo orbs (plugins/modes/league/EchoOrbs.LeagueMode.js): the nine
// regional bosses' orb drops with their guarantee, and the "Fight the Echo of ...?" menu their
// entrances open while the orb is carried.
const assert = require("node:assert/strict");
const path = require("path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");

let core;
const hooks = {};
const custom = {};
const prompts = [];
const realRandom = Math.random;
const DEMONIC_PACTS = 6;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league");
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
    getPluginConfig: (key, fallback) => (key === "league:type" ? DEMONIC_PACTS : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerRunEnergyDrainModifier() {},
    onInterfaceActionButton() {},
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: emit,
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      prompts.push({ player, title, options: pairs.filter((entry) => typeof entry === "string"), pairs });
      return true;
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/Base.LeagueMode").register(api);
  require("../plugins/modes/Points.LeagueMode").register(api);
  require("../plugins/modes/Relics.LeagueMode").register(api);
});

afterEach(() => {
  Math.random = realRandom;
  prompts.length = 0;
});

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

/** A logged-in player; a league character of `leagueType`, or a main character. */
function character(name, profile = "league", leagueType = DEMONIC_PACTS) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(3200, 3200, 0));
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.messages = [];
  player.sendMessage = (text) => player.messages.push(text);
  if (profile === "league") player.setAttribute("league:type", leagueType);
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  return player;
}

function npc(name, id = 1) {
  return { getId: () => id, getDefinition: () => ({ getName: () => name }) };
}

function kill(player, name, id) {
  return emit("npc-drops:add", { player, npc: npc(name, id), npcId: id, drops: [] }).drops;
}

const ORB = () => core.ItemIdentifiers;

test("each regional boss rolls its region's orb at the Wiki's rate, with the drop line", () => {
  const cases = [
    ["Cerberus", "ASGARNIA_ECHO_ORB"],
    ["Kalphite Queen", "DESERT_ECHO_ORB"],
    ["Dagannoth Rex", "FREMENNIK_ECHO_ORB"],
    ["Dagannoth Prime", "FREMENNIK_ECHO_ORB"],
    ["Dagannoth Supreme", "FREMENNIK_ECHO_ORB"],
    ["Thermonuclear smoke devil", "KANDARIN_ECHO_ORB"],
    ["Dusk", "MORYTANIA_ECHO_ORB"],
    ["King Black Dragon", "WILDERNESS_ECHO_ORB"],
  ];
  Math.random = () => 0; // the 1 in N lands
  for (const [name, orb] of cases) {
    const player = character(`k-${name}`);
    const drops = kill(player, name, 1);
    assert.deepEqual(drops.map((drop) => drop.itemId), [ORB()[orb]], name);
    assert.equal(drops[0].amount, 1);
    const item = core.ItemDefinition.forId(ORB()[orb]).getName();
    assert.deepEqual(player.messages, [`<col=005f00>${player.getDisplayName()} received a drop: ${item}</col>`], name);
  }
  Math.random = () => 0.99;
  assert.deepEqual(kill(character("miss"), "Cerberus", 1), [], "a miss drops nothing");
});

test("the orb is certain once the kills since the last one reach the rate (Cerberus: 50)", () => {
  Math.random = () => 0.99;
  const player = character("pity");
  for (let kills = 1; kills < 50; kills++) assert.deepEqual(kill(player, "Cerberus", 1), [], `kill ${kills}`);
  assert.equal(kill(player, "Cerberus", 1)[0].itemId, ORB().ASGARNIA_ECHO_ORB, "kill 50");
  assert.deepEqual(kill(player, "Cerberus", 1), [], "the count starts again");
  // The three kings share one count (30).
  const kings = character("kings");
  for (let kills = 1; kills < 30; kills++) kill(kings, ["Dagannoth Rex", "Dagannoth Prime", "Dagannoth Supreme"][kills % 3], 1);
  assert.equal(kill(kings, "Dagannoth Rex", 1)[0].itemId, ORB().FREMENNIK_ECHO_ORB);
});

test("Hespori's orb is every kill of the Farming Guild's Hespori, not the quest's", () => {
  Math.random = () => 0.99;
  const player = character("hespori");
  assert.equal(kill(player, "Hespori", core.NpcIdentifiers.HESPORI)[0].itemId, ORB().KOUREND_ECHO_ORB);
  assert.equal(kill(player, "Hespori", core.NpcIdentifiers.HESPORI)[0].itemId, ORB().KOUREND_ECHO_ORB);
  assert.deepEqual(kill(player, "Hespori", core.NpcIdentifiers.HESPORI_2), []);
});

test("Amoxliatl's orb comes from the regular boss, not the quest's guardian", () => {
  Math.random = () => 0;
  const player = character("amox");
  assert.equal(kill(player, "Amoxliatl", core.NpcIdentifiers.AMOXLIATL)[0].itemId, ORB().VARLAMORE_ECHO_ORB);
  assert.deepEqual(kill(player, "Amoxliatl", core.NpcIdentifiers.AMOXLIATL_2), []);
});

test("the Corrupted Gauntlet's chest rolls the Tirannwn orb (1/15); the normal Gauntlet's does not", () => {
  Math.random = () => 0;
  const player = character("hunllef");
  const chest = emit("npc-drops:roll", { player, drops: [], source: "Corrupted Hunllef" }).drops;
  assert.equal(chest[0].id, ORB().TIRANNWN_ECHO_ORB, "the chest's own drop shape");
  assert.deepEqual(emit("npc-drops:roll", { player, drops: [] }).drops, []);
  // An NPC kill's roll is left to npc-drops:add, so a kill is never rolled twice.
  assert.deepEqual(emit("npc-drops:roll", { player, npc: npc("Cerberus"), drops: [] }).drops, []);
});

test("no orbs for a main character, another league, or another NPC", () => {
  Math.random = () => 0;
  assert.deepEqual(kill(character("main", "main"), "Cerberus", 1), []);
  assert.deepEqual(kill(character("echoes", "league", 5), "Cerberus", 1), []);
  assert.deepEqual(kill(character("other"), "Hellhound", 1), []);
});

test("carrying the orb, the entrance asks first: No enters as usual, Yes is the placeholder", () => {
  const player = character("entry");
  player.getInventory().add(new Item(ORB().KANDARIN_ECHO_ORB, 1));
  let entered = 0;
  const entry = emit("echo-boss:entry", { player, boss: "thermonuclear-smoke-devil", enter: () => entered++, handled: false });
  assert.equal(entry.handled, true);
  assert.equal(entered, 0, "nothing until an answer");
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].title, "Fight the Echo of the Thermonuclear Smoke Devil?");
  assert.deepEqual(prompts[0].options, ["Yes.", "No."]);
  const [, yes, , no] = prompts[0].pairs;
  no();
  assert.equal(entered, 1, "No: the usual entry");
  yes();
  assert.equal(entered, 1, "Yes: not let in");
  assert.deepEqual(player.messages, ["Nothing interesting happens."]);
  assert.equal(player.getInventory().contains(ORB().KANDARIN_ECHO_ORB), true, "the orb is kept");
});

test("no prompt without the orb in the inventory, for another boss's orb, or off the league", () => {
  const player = character("noorb");
  const ask = (who, boss) => emit("echo-boss:entry", { player: who, boss, enter() {}, handled: false }).handled;
  assert.equal(ask(player, "cerberus"), false);
  player.getInventory().add(new Item(ORB().KANDARIN_ECHO_ORB, 1));
  assert.equal(ask(player, "cerberus"), false, "the smoke devil's orb is not Cerberus'");
  const main = character("mainorb", "main");
  main.getInventory().add(new Item(ORB().ASGARNIA_ECHO_ORB, 1));
  assert.equal(ask(main, "cerberus"), false);
  assert.equal(prompts.length, 0);
});

test("every boss's entrance has a menu title, the uncaptured ones in the captured pattern", () => {
  const data = require("../plugins/modes/data/league-echo-orbs.json");
  assert.equal(Object.keys(data.orbs).length, 9);
  for (const [boss, orb] of Object.entries(data.orbs)) {
    assert.match(orb.title, /^Fight the Echo of .+\?$/, boss);
    assert.ok(Number.isInteger(ORB()[orb.item]), `${boss}: ${orb.item}`);
  }
});

test("the boss entrances ask through echo-boss:entry and enter on no answer", () => {
  const seen = [];
  const fakeApi = (enterHandled) => ({ emitCustomEvent: (name, payload) => {
    if (name !== "echo-boss:entry") return;
    seen.push(payload.boss);
    payload.handled = enterHandled;
  } });
  // The smoke devil's crevice: in only, never on the way out.
  const Common = require("../plugins/bosses/thermonuclear/Common.ThermonuclearSmokeDevil");
  const Entrance = require("../plugins/bosses/thermonuclear/Entrance.ThermonuclearSmokeDevil");
  Common.init({ ...fakeApi(true), core });
  const moves = [];
  const outside = { getLocation: () => Common.location(Common.OUTSIDE_TILE), moveTo: (to) => moves.push(to) };
  const crevice = { x: Common.OUTSIDE_TILE[0] - 1, y: Common.OUTSIDE_TILE[1], z: 0 };
  assert.equal(Entrance.through({ player: outside, location: crevice, objectId: Common.CREVICE_OUTSIDE_ID }), true);
  assert.deepEqual(seen, ["thermonuclear-smoke-devil"]);
  assert.equal(moves.length, 0, "the menu answers for it");
  const inside = { getLocation: () => Common.location(Common.INSIDE_TILE), moveTo: (to) => moves.push(to) };
  Entrance.through({ player: inside, location: crevice, objectId: Common.CREVICE_INSIDE_ID });
  assert.equal(seen.length, 1, "leaving never asks");
  assert.equal(moves.length, 1);
  Common.init({ ...fakeApi(false), core });
  Entrance.through({ player: outside, location: crevice, objectId: Common.CREVICE_OUTSIDE_ID });
  assert.equal(moves.length, 2, "unanswered, the crevice lets the player through as before");
});
