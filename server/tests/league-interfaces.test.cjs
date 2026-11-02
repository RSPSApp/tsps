// Run after `yarn build`: node --test tests/league-interfaces.test.cjs
// The league side panel's Summary, Info and Rank screens (docs/leagues.md "Panels"): what each
// button sends as captured, the play time the summary reveals, the ranks per league and their
// rank-up notifications, the statistics the summary's rows read, every cache-known league's data,
// and the one content payload the league's screens share (Demonic Pacts' relics from the cache).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");

const SIDE_PANEL = 656;
const SUMMARY = 529;
const INFO = 654;
const RANK = 64;
const RANK_VARBIT = 17299;
const uid = (group, child) => (group << 16) | child;
const OP1 = 1 << 1;

let core;
const hooks = {};
const custom = {};
let pluginConfig = {};
let worldLeague = 5; // the world's pluginConfig league:type (Raging Echoes)
const tasks = [];

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
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : pluginConfig[key] ?? fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
});

/** A real player whose packets are recorded, logged in as a new character of `profile` on a world of `league`. */
function character(name, { profile = "league", league = 5, isNewAccount = true } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  const sent = { messages: [], varbits: new Map(), varps: new Map(), scripts: [], subs: [], flags: [], sounds: [], content: [], removals: 0 };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendConfig": return (id, value) => (sent.varps.set(id, value), sender);
        case "sendInterfaceScript": return (id, args) => (sent.scripts.push([id, args]), sender);
        case "sendSubInterface": return (target, group) => (sent.subs.push([target, group]), sender);
        case "sendInterface": return (group) => (player.setInterfaceId(group), sent.subs.push(["main", group]), sender);
        case "sendInterfaceFlagsRange": return (...args) => (sent.flags.push(args), sender);
        case "sendSound": return (...args) => (sent.sounds.push(args), sender);
        case "sendContentData": return (source, datasets) => (sent.content.push(datasets), sender);
        case "sendInterfaceRemoval": return () => (sent.removals++, sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  const previous = worldLeague;
  worldLeague = league;
  hooks.onPlayerLogin({ player, username: name, isNewAccount, profile });
  worldLeague = previous;
  return Object.assign(player, { sent });
}

function givePoints(player, points) {
  hooks["command:leaguetask"]({ player, parts: ["leaguetask", `task-${points}-${Math.random()}`, String(points)] });
}

const query = (name, payload) => {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
};

function dataset(player, key) {
  return player.sent.content.at(-1).find((entry) => entry.key === key).rows;
}

test("login sends the client's date and, when the world says so, the league's start", () => {
  const dated = character("dated");
  const runeday = dated.sent.varbits.get(9535);
  assert.ok(runeday > 8000 && runeday < 20000, `current_runeday is whole days since 27 February 2002, got ${runeday}`);
  assert.equal(dated.sent.varps.has(4523), false, "no league start without league:start");
  pluginConfig = { "league:start": "2024-11-27T12:00:00Z" };
  const started = character("started");
  pluginConfig = {};
  assert.equal(started.sent.varps.get(4523), Math.floor(Date.parse("2024-11-27T12:00:00Z") / 60000), "capture 227/00070: minutes since the epoch");
});

test("a league character adds the league-world bit to the client's cached world flags", () => {
  const league = character("flagged");
  assert.equal(query("world:map-flags", { player: league, flags: 4 }).flags, 4 | (1 << 30), "capture 227/00070: flags 1073741825 on a Leagues V world (script 206 reads bit 30)");
  assert.equal(query("world:map-flags", { player: character("flagged-main", { profile: "main" }), flags: 4 }).flags, 4, "a main character's world stays as it was");
});

test("Summary opens as captured and reveals the time played on its row's click", () => {
  const league = character("summary");
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 7)}`]({ player: league }), true);
  assert.deepEqual(league.sent.subs.at(-1), ["main", SUMMARY]);
  assert.deepEqual(league.sent.sounds.at(-1), [2266, 1, 0]);
  assert.deepEqual(league.sent.flags.at(-1), [uid(SUMMARY, 23), 2, 2, 129026], "if_setevents OP1 and the six target kinds on the Time Played row");
  assert.deepEqual(league.sent.scripts.at(-1), [7741, [uid(SUMMARY, 23), 2, "(Click to reveal)"]]);
  assert.equal(hooks[`button:${uid(SUMMARY, 23)}`]({ player: league, slot: 2 }), true);
  assert.equal(league.sent.removals, 1, "the modal closes and re-opens, as captured");
  assert.deepEqual(league.sent.subs.at(-1), ["main", SUMMARY]);
  const [script, args] = league.sent.scripts.at(-1);
  assert.equal(script, 7741);
  assert.match(args[2], /^\d+ minutes?$/, "a fresh character has only minutes");
  assert.equal(hooks[`button:${uid(SUMMARY, 23)}`]({ player: league, slot: 1 }), false, "other rows are not ours");
  const main = character("main-summary", { profile: "main" });
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 7)}`]({ player: main }), false, "a main character has no league summary");
});

test("the time played is shown in the captured shape: the two largest non-zero units", () => {
  const { formatPlayTime } = require("../plugins/modes/league/Panels.LeagueMode");
  const minute = 60000;
  assert.equal(formatPlayTime(17 * 24 * 60 * minute + 2 * 60 * minute + 30 * minute), "17 days, 2 hours");
  assert.equal(formatPlayTime(17 * 24 * 60 * minute + 58 * minute), "17 days, 58 minutes");
  assert.equal(formatPlayTime(19 * 60 * minute + 46 * minute), "19 hours, 46 minutes");
  assert.equal(formatPlayTime(1 * 60 * minute + 1 * minute), "1 hour, 1 minute");
  assert.equal(formatPlayTime(5000), "0 minutes");
});

test("Info and Rank open as captured, with the click events on their menu frames", () => {
  const league = character("panels");
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 2)}`]({ player: league }), true);
  assert.deepEqual(league.sent.subs.at(-1), ["main", INFO]);
  assert.deepEqual(league.sent.flags.at(-1), [uid(INFO, 17), 12, 18, OP1]);
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 10)}`]({ player: league }), true);
  assert.deepEqual(league.sent.subs.at(-1), ["main", RANK]);
  assert.deepEqual(league.sent.flags.at(-1), [uid(RANK, 16), 10, 18, OP1]);
  assert.equal(league.sent.sounds.length, 0, "only the summary plays a sound");
});

test("every cache-known league's thresholds: the Wiki's (League_trophy) for I-III, the cache's enums for IV-VI, which the Wiki matches", () => {
  const Rank = require("../plugins/modes/league/Rank.LeagueMode");
  const wiki = {
    1: [10, 80, 510, 1770, 5270, 10820, 20830],
    2: [100, 510, 2000, 6480, 18720, 35680, 56310],
    3: [100, 480, 1660, 5475, 15575, 31980, 52545],
    4: [2500, 5000, 10000, 18000, 28000, 42000, 56000],
    5: [2000, 4000, 10000, 20000, 30000, 45000, 60000],
    6: [2000, 4000, 10000, 22000, 32000, 47500, 65000],
  };
  const cacheEnums = { 4: [5237, 5238], 5: [5719, 5720], 6: [5979, 5976] };
  const Common = require("../plugins/modes/league/Common.LeagueMode");
  for (const type of [1, 2, 3, 4, 5, 6]) {
    assert.deepEqual(Rank.thresholds(type), wiki[type], `league ${type}: the Wiki's thresholds`);
    const trophies = Rank.trophies(type);
    assert.equal(trophies.length, 7, `league ${type} has a trophy a rank`);
    for (const item of trophies) assert.match(core.ItemDefinition.forId(item).getName(), /trophy$/i, `league ${type}: item ${item} is a trophy`);
    const params = core.CacheDefinitions.getStructParams(Common.league(type).struct);
    if (cacheEnums[type]) {
      assert.deepEqual([params.get(1857), params.get(2041)], cacheEnums[type], `league ${type}: the struct names the cited enums`);
    } else {
      assert.ok(!(params.get(1857) >= 0) && !(params.get(2041) >= 0), `league ${type}'s struct carries no rank enums (absent or -1), hence the overrides`);
    }
  }
  assert.equal(core.ItemDefinition.forId(Rank.trophies(1)[0]).getName(), "Twisted bronze trophy");
  assert.equal(core.ItemDefinition.forId(Rank.trophies(6)[6]).getName(), "Demonic pacts dragon trophy");
});

test("the time played survives a logout and the minute's save, and never counts a main character", () => {
  const Panels = require("../plugins/modes/league/Panels.LeagueMode");
  const league = character("clock");
  const task = tasks.filter((queued) => queued.player === league).at(-1);
  assert.ok(task, "a repeating save was submitted for the league character");
  assert.equal(league.getAttribute("league:play-time"), undefined, "nothing saved yet");
  task.execute();
  assert.ok(Number.isInteger(league.getAttribute("league:play-time")), "the minute's save wrote the session so far");
  league.setAttribute("league:play-time", 95 * 60000);
  hooks.onPlayerLogout({ player: league, username: "clock" });
  assert.ok(league.getAttribute("league:play-time") >= 95 * 60000, "the logout adds the session to the saved total");
  task.execute();
  assert.equal(task.isRunning(), false, "the save stops once the session is over");
  const relogged = character("clock", { isNewAccount: false });
  relogged.setAttribute("league:play-time", 95 * 60000);
  assert.equal(Panels.formatPlayTime(Panels.playTime(relogged)), "1 hour, 35 minutes");
  const before = tasks.length;
  character("clock-main", { profile: "main" });
  assert.equal(tasks.length, before, "no clock for a main character");
});

test("the content payload merges units' rows for one struct and goes out again on league:send-content", () => {
  const echoes = character("merged");
  custom["league:content-rows"].push((query) => {
    if (query.league === 5) query.structs.push({ structId: 6211, params: { 999: query.base } });
  });
  query("league:send-content", { player: echoes });
  custom["league:content-rows"].pop();
  const structs = new Map(dataset(echoes, "structOverrides").map((row) => [row.structId, row.params]));
  assert.deepEqual(structs.get(6211), { 870: 205000, 999: 205000 }, "the relics' tier enum and the extra param on one row, with the league's base");
  assert.equal(dataset(echoes, "structOverrides").filter((row) => row.structId === 6211).length, 1);
  hooks[`button:${uid(SIDE_PANEL, 10)}`]({ player: echoes });
  assert.ok(echoes.sent.content.length >= 3, "opening Rank asks for the payload again");
});

test("rank-ups: the varbit holds the ranks reached, with the captured message once per rank", () => {
  const league = character("ranks");
  assert.equal(league.sent.varbits.get(RANK_VARBIT), 0, "unranked at a fresh login");
  givePoints(league, 1999);
  assert.equal(league.sent.varbits.get(RANK_VARBIT), 0, "1,999 points are short of Bronze");
  assert.equal(league.sent.messages.filter((m) => m.includes("obtained")).length, 0);
  givePoints(league, 1);
  assert.equal(league.sent.varbits.get(RANK_VARBIT), 1, "Raging Echoes' Bronze at 2,000 points");
  assert.deepEqual(league.sent.messages.filter((m) => m.includes("obtained")), [
    "<col=229628>You've obtained Bronze rank! You can claim your trophy from the Leagues Tutor in the main game.",
  ]);
  givePoints(league, 8000);
  assert.equal(league.sent.varbits.get(RANK_VARBIT), 3, "two ranks at once: Iron at 4,000 and Steel at 10,000");
  assert.deepEqual(league.sent.messages.filter((m) => m.includes("obtained")).slice(1).map((m) => m.match(/obtained (\w+) rank/)[1]), ["Iron", "Steel"]);
  const answer = query("league:rank", { player: league });
  assert.equal(answer.rank, 3);
  assert.equal(answer.name, "Steel");
  assert.equal(answer.next, 20000);
  const relogged = character("ranks", { isNewAccount: false });
  relogged.setAttribute("league:tasks", league.getAttribute("league:tasks"));
  hooks.onPlayerLogin({ player: relogged, username: "ranks", isNewAccount: false, profile: "league" });
  assert.equal(relogged.sent.varbits.get(RANK_VARBIT), 3, "sent at every login");
  assert.equal(query("league:rank", { player: character("unranked-main", { profile: "main" }) }).rank, undefined);
});

test("Leagues I-III get their rank thresholds and trophies as overrides, in the one content payload with the relics", () => {
  const twisted = character("twisted", { league: 1 });
  assert.equal(twisted.getAttribute("league:type"), 1);
  const structs = new Map(dataset(twisted, "structOverrides").map((row) => [row.structId, row.params]));
  const enums = new Map(dataset(twisted, "enumOverrides").map((row) => [row.enumId, row]));
  assert.deepEqual(structs.get(723), { 1857: 201900, 2041: 201901 }, "the Twisted league struct's threshold and trophy enums");
  assert.deepEqual(enums.get(201900).entries.map(([, value]) => value), [10, 80, 510, 1770, 5270, 10820, 20830], "Wiki League_trophy: Twisted's brackets");
  assert.equal(enums.get(201900).valueType, "i");
  assert.equal(enums.get(201901).valueType, "O");
  assert.equal(enums.get(201901).entries[6][1], core.ItemIdentifiers.TWISTED_DRAGON_TROPHY);
  const reloaded = character("reloaded", { league: 4 });
  const reloadedStructs = new Map(dataset(reloaded, "structOverrides").map((row) => [row.structId, row.params]));
  assert.equal(reloadedStructs.get(4699)[870], 204000, "its relic catalog travels in the payload");
  assert.equal(reloadedStructs.get(4699)[1857], undefined, "Trailblazer Reloaded's ranks are the cache's");
  assert.ok(reloadedStructs.has(204010), "the relic catalog travels in the same payload");
});

test("Demonic Pacts' relics come from the cache: nothing is sent and the catalog is the structs'", () => {
  const pacts = character("pacts", { league: 6 });
  assert.deepEqual(dataset(pacts, "structOverrides"), [], "no overrides for the league the cache carries");
  assert.deepEqual(dataset(pacts, "enumOverrides"), [], "an empty payload still goes out, so another league's overrides never linger on the client");
  const Common = require("../plugins/modes/leaguerelics/Common.LeagueRelics");
  const catalog = Common.catalog(6);
  assert.equal(catalog.tiers.length, 8);
  assert.deepEqual(catalog.tiers.map((tier) => tier.cost), [0, 600, 1200, 2600, 5200, 8500, 16500, 28000], "Wiki Demonic_Pacts_League/Relics: the tier points");
  assert.ok(catalog.tiers.every((tier) => tier.relics.length >= 1 && tier.relics.length <= 3));
  assert.ok(catalog.tiers[1].passive.length > 0, "the tier's passive text");
  const first = catalog.tiers[0].relics[0];
  assert.ok(first.name.length > 0 && first.key.length > 0 && Number.isInteger(first.struct));
  assert.deepEqual(Common.structIds(6, 0, 1), { relicStruct: first.struct, passiveStruct: catalog.tiers[0].passiveStruct });
  assert.deepEqual(Common.structIds(5, 0, 1), { relicStruct: 205100, passiveStruct: 205020 }, "a data-driven league keeps its virtual ids");
  // The relic flow works on the cache's ids: a slot click, then the pick.
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player: pacts }), true);
  assert.equal(hooks[`button:${uid(655, 22)}`]({ player: pacts, slot: 0 }), true);
  assert.deepEqual(pacts.sent.scripts.at(-2)[1].slice(-4), [first.struct, catalog.tiers[0].passiveStruct, first.description, catalog.tiers[0].passive], "rev 237: the structs, then the relic's and the tier's texts");
  assert.equal(hooks[`button:${uid(655, 51)}`]({ player: pacts }), true, "confirm_button, the one with an op in this cache");
  assert.equal(pacts.sent.varbits.get(10049), 1, "tier 1's pick");
  assert.equal(query("league:has-relic", { player: pacts, relic: first.key }).active, true);
});

test("damage dealt and the highest hit count only what lands, through the real hit queue", (t) => {
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { Location } = require("../dist/game/model/Location");
  const { World } = require("../dist/game/World");
  const league = character("landing");
  const chicken = new NPC(core.NpcIdentifiers.CHICKEN ?? 1173, new Location(3235, 3295, 0));
  t.mock.method(chicken, "isRegistered", () => true);
  chicken.setHitpoints(3);
  const parts = [new HitDamage(8, HitMask.RED)];
  const melee = { getCombatType: () => core.CombatType.MELEE, isAccurate: () => true };
  const resolved = { ...melee, getTotalDamage: () => 8, getHits: () => parts };
  hooks.onCombatHitResolved({ attacker: league, target: chicken, hit: resolved });
  const counters = () => query("league:statistics", { player: league }).counters;
  assert.equal(counters().damageDealt, undefined, "nothing before the hitsplat lands");
  const queue = chicken.getCombat().getHitQueue();
  queue.addPendingDamage(parts);
  queue.process(World.getProcessCycle() + 1);
  assert.equal(chicken.getHitpoints(), 0);
  assert.equal(counters().damageDealt, 3, "only the 3 hitpoints the chicken had");
  assert.equal(counters().highestHit, 3);
  const cancelled = new HitDamage(8, HitMask.RED);
  hooks.onCombatHitResolved({ attacker: league, target: chicken, hit: { ...melee, getTotalDamage: () => 8, getHits: () => [cancelled] } });
  queue.addPendingDamage([cancelled]);
  queue.process(World.getProcessCycle() + 2);
  assert.equal(counters().damageDealt, 3, "a queue dropped with its dead owner counts nothing");
  // Other plugins may listen at launch (league relics do); a launch alone counts nothing.
  const launched = new HitDamage(8, HitMask.RED);
  hooks.onPlayerDealtDamage?.({ player: league, target: chicken, hit: { ...melee, getTotalDamage: () => 8, getHits: () => [launched] } });
  assert.equal(counters().damageDealt, 3, "nothing counts at launch");
});

test("the summary's statistics count what the hooks see and are sent as their varps", () => {
  const league = character("stats");
  const npc = { isPlayer: () => false, isNpc: () => true };
  const main = character("stats-main", { profile: "main" });
  const hit = (damage) => ({ getTotalDamage: () => damage, getCombatType: () => core.CombatType.MELEE, isAccurate: () => damage > 0 });
  /** A hit on the NPC that resolves and lands for all of its damage. */
  const landed = (damage) => {
    const part = new HitDamage(damage, HitMask.RED);
    hooks.onCombatHitResolved({ attacker: league, target: npc, hit: { ...hit(damage), getHits: () => [part] } });
    part.notifyApplied(damage);
  };
  hooks.onNpcDeath({ killer: league, npcId: core.NpcIdentifiers.CHICKEN ?? 1173, npc });
  hooks.onNpcDeath({ killer: league, npcId: core.NpcIdentifiers.ZULRAH, npc });
  hooks.onNpcDeath({ killer: main, npcId: core.NpcIdentifiers.ZULRAH, npc });
  landed(12);
  landed(30);
  landed(5);
  hooks.onCombatHitResolved({ attacker: npc, target: league, hit: hit(7) });
  hooks.onPlayerDeath({ player: league, killer: npc, handled: false });
  hooks.onPlayerDefeated({ killer: league, victim: main });
  query("food:eaten", { player: league, itemId: 379, heal: 12 });
  query("potions:drunk", { player: league, itemId: 2434, name: "Prayer potion" });
  query("fishing:success", { player: league });
  query("mining:success", { player: league });
  query("woodcutting:success", { player: league });
  query("woodcutting:success", { player: main });
  const expected = { npcsKilled: 2, bossesKilled: 1, damageDealt: 47, highestHit: 30, damageTaken: 7, deaths: 1, playersKilled: 1, foodEaten: 1, potionsSipped: 1, fishCaught: 1, oreMined: 1, logsChopped: 1 };
  assert.deepEqual(query("league:statistics", { player: league }).counters, expected);
  assert.equal(query("league:statistics", { player: main }).counters, undefined, "a main character keeps none");
  const varps = { npcsKilled: 4521, bossesKilled: 4510, damageDealt: 4514, damageTaken: 4516, deaths: 4517, playersKilled: 4522, foodEaten: 4518, potionsSipped: 4519, fishCaught: 4527, oreMined: 4526, logsChopped: 4525 };
  for (const [name, varp] of Object.entries(varps)) assert.equal(league.sent.varps.get(varp), expected[name], `${name} -> varp ${varp}`);
  assert.equal(league.sent.varbits.get(11561), 30, "tracking_highest_hit");
  const relogged = character("stats", { isNewAccount: false });
  relogged.setAttribute("league:statistics", league.getAttribute("league:statistics"));
  hooks.onPlayerLogin({ player: relogged, username: "stats", isNewAccount: false, profile: "league" });
  assert.equal(relogged.sent.varps.get(4514), 47, "sent at login");
  assert.equal(relogged.sent.varps.get(4512), 0, "rows with no source are sent as 0");
});

test("every cache-known league logs in with its data, and a league character's start matches the Wiki", () => {
  const { Skill } = require("../dist/game/model/Skill");
  const levels = (player) => [Skill.HERBLORE, Skill.RUNECRAFTING, Skill.AGILITY].map((skill) => player.getSkillManager().getMaxLevel(skill));
  assert.deepEqual(levels(character("lvl-twisted", { league: 1 })), [3, 1, 1], "Twisted: Herblore 3");
  assert.deepEqual(levels(character("lvl-trailblazer", { league: 2 })), [3, 5, 10]);
  assert.deepEqual(levels(character("lvl-shattered", { league: 3 })), [1, 1, 1], "Shattered Relics unlocks skills with Renown instead");
  assert.deepEqual(levels(character("lvl-echoes", { league: 5 })), [3, 5, 1], "Raging Echoes: Herblore 3, Runecraft 5");
  assert.deepEqual(levels(character("lvl-pacts", { league: 6 })), [3, 5, 1], "Demonic Pacts: Herblore 3, Runecraft 5");
  const Common = require("../plugins/modes/league/Common.LeagueMode");
  for (const type of [1, 2, 3, 4, 5, 6]) {
    const league = Common.league(type);
    const params = core.CacheDefinitions.getStructParams(league.struct);
    assert.equal(params.get(858), league.name, `league ${type}'s name is its struct's`);
    assert.equal(params.get(1021), league.unlockSpotanim, `league ${type}'s unlock graphic is its struct's`);
    assert.equal(parseInt(String(params.get(2050)).match(/col=([0-9a-fA-F]+)/)[1], 16), league.colour, `league ${type}'s colour is its struct's`);
  }
});
