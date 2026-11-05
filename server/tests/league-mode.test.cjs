// Run after `yarn build`: node --test tests/league-mode.test.cjs
// League profiles (docs/leagues.md): the separate character chosen at login, its league, varbits,
// XP rate and journal tab, and that a main character sees none of it.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Skill } = require("../dist/game/model/Skill");
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
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) hooks[`button:${id}`] = handler;
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
});

/** A real player whose messages, varbits, varps and scripts are recorded. */
function character(name, profile = "main") {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  const messages = [];
  const varbits = new Map();
  const varps = new Map();
  const scripts = [];
  const subs = [];
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === "sendVarbit") return (id, value) => (varbits.set(id, value), sender);
      if (key === "sendConfig") return (id, value) => (varps.set(id, value), sender);
      if (key === "sendInterfaceScript") return (id, args) => (scripts.push([id, args]), sender);
      if (key === "sendSubInterface") return (uid, group) => (subs.push([uid, group]), sender);
      return () => sender;
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  return Object.assign(player, { messages, varbits, varps, scripts, subs });
}

function login(player, isNewAccount = false) {
  hooks.onPlayerLogin({ player, username: player.getUsername(), isNewAccount, profile: player.getProfile() });
}

test("a main character is untouched: no attribute, no varbits, the world's XP rate", () => {
  const main = character("mainchar");
  login(main, true);
  assert.equal(main.getAttribute("league:type"), undefined);
  assert.equal(main.varbits.size, 0);
  const gain = { player: main, skill: Skill.ATTACK, experience: 10, allow: null, multiplier: 1 };
  hooks.onCanGainExperience(gain);
  assert.equal(gain.multiplier, 1);
  const query = { player: main, league: 0 };
  custom["league:profile"][0](query);
  assert.equal(query.league, null);
  assert.equal(hooks["button:" + ((629 << 16) | 34)]({ player: main }), false, "the Leagues tab does nothing for a main character");
  assert.equal(main.subs.length, 0);
});

test("a new league character joins the configured league with its starting levels and varbits", () => {
  const league = character("leaguer", "league");
  login(league, true);
  assert.equal(league.getAttribute("league:type"), 4, "the world's league");
  assert.equal(league.varbits.get(10031), 1, "league_account");
  assert.equal(league.varbits.get(10032), 4, "league_type");
  assert.equal(league.varbits.get(10037), 0, "a new character starts the league tutorial (227/00196); league-tutorial.test.cjs covers the rest");
  const skills = league.getSkillManager();
  assert.deepEqual(
    [Skill.HERBLORE, Skill.RUNECRAFTING, Skill.AGILITY].map((skill) => skills.getMaxLevel(skill)),
    [3, 5, 10],
    "Wiki: Trailblazer Reloaded starts at Herblore 3, Runecraft 5, Agility 10",
  );
  assert.equal(skills.getMaxLevel(Skill.ATTACK), 1, "the rest start as usual");
  const gain = { player: league, skill: Skill.ATTACK, experience: 10, allow: null, multiplier: 1 };
  hooks.onCanGainExperience(gain);
  assert.equal(gain.multiplier, 5, "the league's base XP rate");
  const query = { player: league, league: null };
  custom["league:profile"][0](query);
  assert.equal(query.league, 4);
  assert.ok(emitted.some(([name, payload]) => name === "league:login" && payload.player === league && payload.league === 4));
});

test("the plugin config names the league and claims the world's profile; a character keeps the league it joined", () => {
  assert.equal(GameConstants.WORLD_PROFILE, "league", "LeagueMode claimed the world at startup");
  worldLeague = 5;
  const echoes = character("echoes", "league");
  login(echoes, true);
  assert.equal(echoes.getAttribute("league:type"), 5);
  assert.equal(echoes.varbits.get(10032), 5);
  assert.equal(echoes.getSkillManager().getMaxLevel(Skill.AGILITY), 1, "Raging Echoes lists no starting levels here");

  const returning = character("returning", "league");
  returning.setAttribute("league:type", 4);
  login(returning, false);
  assert.equal(returning.getAttribute("league:type"), 4, "an existing profile is not moved to the configured league");
  assert.equal(returning.varbits.get(10032), 4);
  worldLeague = 4;
});

test("the XP rate rises with the relic tiers reached (tier 2 to 8x, tier 5 to 12x, tier 7 to 16x)", () => {
  const league = character("tiers", "league");
  login(league, true);
  let highest = -1;
  custom["league:highest-tier"] = [(query) => { query.tier = highest; }];
  const rate = () => {
    const gain = { player: league, skill: Skill.MINING, experience: 10, allow: null, multiplier: 1 };
    hooks.onCanGainExperience(gain);
    return gain.multiplier;
  };
  assert.equal(rate(), 5);
  highest = 0;
  assert.equal(rate(), 5, "tier 1 keeps 5x");
  highest = 1;
  assert.equal(rate(), 8);
  highest = 4;
  assert.equal(rate(), 12);
  highest = 6;
  assert.equal(rate(), 16);
  delete custom["league:highest-tier"];
});

test("the journal's Leagues tab mounts the league side panel and fills its points bar", () => {
  const league = character("journal", "league");
  login(league, true);
  assert.equal(hooks["button:" + ((629 << 16) | 34)]({ player: league }), true);
  assert.deepEqual(league.subs.at(-1), [(629 << 16) | 43, 656]);
  assert.equal(league.varbits.get(8168), 4, "the journal's selected-tab varbit");
  assert.deepEqual(league.scripts.at(-1), [3226, [(656 << 16) | 23, 0]], "script 3226 fills 656:23 with the points, as captured");
  hooks["command:leaguetask"]({ player: league, parts: ["leaguetask", "cerulean", "10", "Catch", "a", "Cerulean", "Twitch"] });
  assert.deepEqual(league.scripts.at(-1), [3226, [(656 << 16) | 23, 10]], "refilled after an award while the panel is open");
  for (const handler of custom["journal:tab-mounted"]) handler({ player: league, groupId: 399, tabIndex: 1 });
  hooks["command:leaguetask"]({ player: league, parts: ["leaguetask", "sapphire", "10"] });
  assert.deepEqual(league.scripts.at(-1), [3226, [(656 << 16) | 23, 10]], "not refilled once the quest list replaced the panel");
});



test("::league reports a character's league and points", () => {
  const dev = character("dev");
  const league = character("reported", "league");
  login(league, true);
  core.World.getPlayerByName = (name) => (name === "reported" ? league : undefined);
  hooks["command:league"]({ player: dev, parts: ["league", "reported"] });
  assert.deepEqual(dev.messages, ["reported: Leagues IV - Trailblazer Reloaded, 0 League Points from 0 tasks."]);
  hooks["command:league"]({ player: dev, parts: ["league"] });
  assert.equal(dev.messages.at(-1), "dev is not a league character.");
});

test("persistence keys league saves apart from main ones, and from any real name", async () => {
  const { JsonPlayerPersistence } = require("../plugins/persistence/JsonPlayerPersistence.plugin");
  const { SqlitePlayerPersistence } = require("../plugins/persistence/SqlitePlayerPersistence.plugin");
  const { profileStorageKey } = require("../dist/game/entity/impl/player/persistence/PlayerProfile");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "league-saves-"));
  const previous = JsonPlayerPersistence.SAVE_DIRECTORY;
  JsonPlayerPersistence.SAVE_DIRECTORY = directory;
  try {
    const json = new JsonPlayerPersistence();
    assert.equal(json.resolveFilePath("Bob"), path.join(directory, "bob.json"));
    assert.equal(json.resolveFilePath("Bob", "league"), path.join(directory, "league", "bob.json"));
    fs.writeFileSync(path.join(directory, "bob.json"), "{}");
    assert.equal(json.exists("Bob"), true);
    assert.equal(json.exists("Bob", "league"), false, "a league login of an existing account starts a new character");
    assert.equal(json.load("Bob", "league"), null);
    const leaguer = character("Bob", "league");
    json.validateSerializedSave = () => {}; // the shape check reads skill tables this harness never loads
    require("../dist/game/entity/impl/player/persistence/PlayerSave").PlayerSave.persistAttribute("league:type"); // as LeagueMode's api.persistAttribute does
    leaguer.setAttribute("league:type", 4);
    json.save(leaguer);
    await json.flush();
    assert.equal(fs.existsSync(path.join(directory, "league", "bob.json")), true, "a league character's save lands in the league directory");
    assert.equal(json.exists("Bob", "league"), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "league", "bob.json"), "utf8")).attributes["league:type"], 4);
    assert.equal(fs.readFileSync(path.join(directory, "bob.json"), "utf8"), "{}", "the main save is untouched");
  } finally {
    JsonPlayerPersistence.SAVE_DIRECTORY = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const sqlite = SqlitePlayerPersistence.prototype;
  assert.equal(sqlite.saveKey.call(sqlite, "Bob"), "bob");
  assert.equal(sqlite.saveKey.call(sqlite, "Bob", "league"), "league:bob");
  assert.notEqual(sqlite.saveKey.call(sqlite, "league bob"), sqlite.saveKey.call(sqlite, "bob", "league"),
    "the prefix is added after normalisation, so no account name can produce it");
  assert.equal(profileStorageKey("bob", "main"), "bob");
});

test("a new Demonic Pacts character starts with the recorded kit and a Dramen staff, once; nobody else gets one", () => {
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const kit = require("../plugins/modes/data/leagues.json").leagues["6"].starterKit;
  for (const [name] of kit) assert.ok(CacheDefinitions.getObjId(name) !== null, `the cache names ${name}`);
  const held = (player) => player.getInventory().getItems().filter((item) => item && item.getId() > 0).map((item) => [item.getId(), item.getAmount()]);
  const expected = kit.map(([name, amount]) => [CacheDefinitions.getObjId(name), amount]);
  worldLeague = 6;
  try {
    const pacts = character("pactskit", "league");
    login(pacts, true);
    assert.deepEqual(held(pacts), expected, "237/01098's first inventory, in its slot order");
    assert.ok(held(pacts).some(([id]) => id === CacheDefinitions.getObjId("dramen_staff")), "the Dramen staff");
    assert.equal(pacts.getEquipment().getItems().filter((item) => item && item.getId() > 0).length, 0, "nothing worn");
    login(pacts);
    assert.equal(held(pacts).length, kit.length, "a later login adds nothing");
    const main = character("mainnokit");
    login(main, true);
    assert.equal(held(main).length, 0, "a main character on this world gets no league kit");
  } finally {
    worldLeague = 4;
  }
  const echoes = character("trailblazernokit", "league");
  login(echoes, true);
  assert.equal(held(echoes).length, 0, "Trailblazer Reloaded's start has no recorded kit");
});
