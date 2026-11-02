// Run after `yarn build`: node --test tests/league-passives.test.cjs
// The relic tiers' passives (docs/leagues.md, "Tier passives"): each is on for a league character
// from its tier, off one tier below, off for a main character and off (or different) in the other
// league. Boosted drops are checked both as the rule the league answers and as NpcDrops applies it.
const assert = require("node:assert/strict");
const path = require("path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");

let core;
const hooks = {};
const custom = {};
const modifiers = {};
const realRandom = Math.random;

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
    getPluginConfig: (key, fallback) => (key === "league:type" ? 4 : fallback), // a Trailblazer Reloaded world
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerRunEnergyDrainModifier: (modifier) => (modifiers.runEnergyDrain = modifier),
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
  // NpcDrops with the roller alone: no tables loaded, its chance question forwarded to the league.
  NpcDrops.register({
    core,
    getPluginConfig: (key, fallback) => fallback,
    getItemOnGroundManager() {},
    onCustomEvent() {},
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
    onNpcDeath() {},
    registerCommand() {},
    log() {},
  });
});

afterEach(() => {
  Math.random = realRandom;
});

/** A real player of `profile`, logged in, with relics chosen up to `tier` (1-based; 0 none). */
function character(name, profile, tier = 0, leagueType = 4) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(3200, 3200, 0));
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  if (profile === "league") {
    player.setAttribute("league:type", leagueType);
    const picks = {};
    for (let index = 0; index < tier; index++) picks[index] = 1;
    player.setAttribute("league:relics", picks);
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  return player;
}

const TRAILBLAZER = 4;
const ECHOES = 5;

function ask(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

test("run energy: never drained from tier 1 of either league, drained for a main character", () => {
  const drain = (player) => modifiers.runEnergyDrain(player, 1);
  assert.equal(drain(character("tr1", "league", 1)), 0, "Trailblazer Reloaded tier 1");
  assert.equal(drain(character("re1", "league", 1, ECHOES)), 0, "Raging Echoes tier 1");
  assert.equal(drain(character("tr0", "league", 0)), 1, "a league character before its first relic");
  assert.equal(drain(character("main", "main")), 1, "a main character");
  assert.equal(drain({ isPlayer: () => false }), 1, "not a player");
});

test("combat XP: Raging Echoes tier 3 doubles the combat skills on top of the league rate; nobody else", () => {
  const gain = (player, skill) => {
    const event = { player, skill, experience: 10, allow: null, multiplier: 1 };
    hooks.onCanGainExperience(event);
    return event.multiplier;
  };
  const echoes = character("re3", "league", 3, ECHOES);
  assert.equal(gain(echoes, Skill.ATTACK), 8 * 2, "8x league rate (tier 2) x2 combat");
  assert.equal(gain(echoes, Skill.HITPOINTS), 16, "Hitpoints included");
  assert.equal(gain(echoes, Skill.PRAYER), 16, "Prayer included");
  assert.equal(gain(echoes, Skill.SLAYER), 8, "Slayer is not a combat skill here");
  assert.equal(gain(echoes, Skill.WOODCUTTING), 8);
  assert.equal(gain(character("re2", "league", 2, ECHOES), Skill.ATTACK), 8, "tier 2 is below the passive");
  assert.equal(gain(character("tr3", "league", 3, TRAILBLAZER), Skill.ATTACK), 8, "Trailblazer Reloaded has no combat XP passive");
  assert.equal(gain(character("main", "main"), Skill.ATTACK), 1);
});

test("minigame points: Trailblazer Reloaded 3x/5x/8x at tiers 2/5/7, Raging Echoes 4x/8x at tiers 1/4", () => {
  const points = (player, amount = 10) => ask("minigame:points", { player, minigame: "pest-control", points: amount }).points;
  assert.equal(points(character("tr1", "league", 1)), 10, "tier 1 is below Trailblazer's first boost");
  assert.equal(points(character("tr2", "league", 2)), 30);
  assert.equal(points(character("tr4", "league", 4)), 30, "tier 4 keeps 3x");
  assert.equal(points(character("tr5", "league", 5)), 50);
  assert.equal(points(character("tr7", "league", 7)), 80);
  assert.equal(points(character("tr8", "league", 8), 7), 56);
  assert.equal(points(character("re1", "league", 1, ECHOES)), 40);
  assert.equal(points(character("re3", "league", 3, ECHOES)), 40);
  assert.equal(points(character("re4", "league", 4, ECHOES)), 80);
  assert.equal(points(character("re0", "league", 0, ECHOES)), 10, "no relic yet");
  assert.equal(points(character("main", "main")), 10);
  assert.equal(points(character("tr2b", "league", 2), 0), 0, "nothing to multiply");
});

test("slayer: 5x task points from the first task, Bigger and Badder free and superiors 1/50, from TR tier 4 / RE tier 3", () => {
  const reward = (player) => ask("slayer:task-reward", { player, master: 7, freeTasks: 4, multiplier: 1 });
  const spawn = (player) => ask("slayer:superior-spawn", { player, npc: null, unlocked: false, chance: 200 });
  const tr4 = character("tr4", "league", 4);
  assert.deepEqual([reward(tr4).freeTasks, reward(tr4).multiplier], [0, 5]);
  assert.deepEqual([spawn(tr4).unlocked, spawn(tr4).chance], [true, 50]);
  const tr3 = character("tr3", "league", 3);
  assert.deepEqual([reward(tr3).freeTasks, reward(tr3).multiplier], [4, 1], "Trailblazer tier 3 is below");
  assert.deepEqual([spawn(tr3).unlocked, spawn(tr3).chance], [false, 200]);
  const re3 = character("re3", "league", 3, ECHOES);
  assert.deepEqual([reward(re3).freeTasks, reward(re3).multiplier], [0, 5], "Raging Echoes gets it a tier earlier");
  assert.deepEqual([spawn(re3).unlocked, spawn(re3).chance], [true, 50]);
  const re2 = character("re2", "league", 2, ECHOES);
  assert.deepEqual([reward(re2).freeTasks, reward(re2).multiplier], [4, 1]);
  const main = character("main", "main");
  assert.deepEqual([reward(main).freeTasks, reward(main).multiplier], [4, 1]);
  assert.deepEqual([spawn(main).unlocked, spawn(main).chance], [false, 200]);
  const already = ask("slayer:superior-spawn", { player: tr4, npc: null, unlocked: true, chance: 10 });
  assert.deepEqual([already.unlocked, already.chance], [true, 10], "a better chance from elsewhere stands");
});

test("scroll boxes: unlocked without a limit from tier 1; a main character keeps the quest's rule", () => {
  const boxes = (player) => ask("treasure-trails:scroll-boxes", { player, unlocked: false, capacity: null });
  const tr1 = boxes(character("tr1", "league", 1));
  assert.equal(tr1.unlocked, true);
  assert.equal(tr1.capacity, Number.POSITIVE_INFINITY);
  const re1 = boxes(character("re1", "league", 1, ECHOES));
  assert.equal(re1.unlocked, true);
  const none = boxes(character("tr0", "league", 0));
  assert.deepEqual([none.unlocked, none.capacity], [false, null], "no relic yet");
  const main = boxes(character("main", "main"));
  assert.deepEqual([main.unlocked, main.capacity], [false, null]);
});

test("boosted drops: the rule names the source's items at the tier's rate, for the character's league", () => {
  const rule = (player, source) => {
    const request = { player, npc: null, npcId: null, source, rules: [] };
    ask("npc-drops:chance", request);
    return request.rules[0] ?? null;
  };
  const whip = rule(character("tr1", "league", 1), "Abyssal demon");
  assert.equal(whip.multiplier, 2, "Trailblazer Reloaded tier 1: 2x");
  assert.equal(whip.pattern.test("Abyssal whip"), true);
  assert.equal(whip.pattern.test("Abyssal dagger"), true);
  assert.equal(whip.pattern.test("Coins"), false, "the commons are not boosted");
  assert.equal(whip.pattern.test("Clue scroll (hard)"), false);
  assert.equal(rule(character("tr1b", "league", 1), "Greater abyssal demon").pattern.test("Abyssal whip"), true, "the superior drops the same table");
  assert.equal(rule(character("tr4", "league", 4), "Abyssal demon").multiplier, 3);
  assert.equal(rule(character("tr6", "league", 6), "Abyssal demon").multiplier, 4);
  assert.equal(rule(character("tr8", "league", 8), "Abyssal demon").multiplier, 5);
  assert.equal(rule(character("re1", "league", 1, ECHOES), "Abyssal demon").multiplier, 2);
  assert.equal(rule(character("re4", "league", 4, ECHOES), "Abyssal demon").multiplier, 5, "Raging Echoes: 5x from tier 4");
  assert.equal(rule(character("re3", "league", 3, ECHOES), "Abyssal demon").multiplier, 2);
  assert.equal(rule(character("tr0", "league", 0), "Abyssal demon"), null, "no relic yet");
  assert.equal(rule(character("main", "main"), "Abyssal demon"), null, "a main character");
  assert.equal(rule(character("tr1c", "league", 1), "Goblin"), null, "an unlisted source");
  const kree = rule(character("tr1d", "league", 1), "Kree'arra");
  assert.equal(kree.pattern.test("Armadyl chestplate"), true, "a Wiki group row, expanded");
  assert.equal(kree.pattern.test("Godsword shard 2"), true);
  assert.equal(kree.pattern.test("Armadyl hilt"), true);
  assert.equal(kree.pattern.test("Rune longsword"), false);
  assert.equal(rule(character("re1b", "league", 1, ECHOES), "Araxxor").pattern.test("Amulet of rancour"), true, "a Raging Echoes source");
  assert.equal(rule(character("tr1e", "league", 1), "Araxxor"), null, "not on Trailblazer Reloaded's page");
  assert.equal(rule(character("re1c", "league", 1, ECHOES), "Skotizo"), null, "the page marks Skotizo's onyx N/A");
  const zulrah = rule(character("re1d", "league", 1, ECHOES), "Zulrah");
  assert.equal(zulrah.pattern.test("Uncut onyx"), true, "Zulrah's onyx drops uncut");
  assert.equal(zulrah.pattern.test("Uncharged toxic trident"), true, "a Raging Echoes row");
  assert.equal(rule(character("tr1f", "league", 1), "Zulrah").pattern.test("Uncharged toxic trident"), false, "not on Trailblazer Reloaded");
  const dkRex = rule(character("tr1g", "league", 1), "Dagannoth Rex");
  assert.equal(dkRex.pattern.test("Berserker ring"), true);
  assert.equal(dkRex.pattern.test("Dragon axe"), true);
});

test("boosted drops: Demonic Pacts' page, its own rows and the earlier leagues' rows it leaves out", () => {
  const PACTS = 6;
  const rule = (player, source) => {
    const request = { player, npc: null, npcId: null, source, rules: [] };
    ask("npc-drops:chance", request);
    return request.rules[0] ?? null;
  };
  const whip = rule(character("dp1", "league", 1, PACTS), "Abyssal demon");
  assert.equal(whip.multiplier, 2, "Demonic Pacts tier 1: 2x");
  assert.equal(whip.pattern.test("Abyssal whip"), true, "a row every league lists");
  assert.equal(rule(character("dp4", "league", 4, PACTS), "Abyssal demon").multiplier, 5, "5x from tier 4");
  assert.equal(rule(character("dp1b", "league", 1, PACTS), "Araxxor").pattern.test("Amulet of rancour"), true, "a Raging Echoes row the page keeps");
  assert.equal(rule(character("dp1c", "league", 1, PACTS), "Vardorvis").pattern.test("Leviathan's lure"), true, "every DT2 boss drops every axe piece");
  assert.equal(rule(character("dp1d", "league", 1, PACTS), "Yama").pattern.test("Oathplate chest"), true, "a Demonic Pacts row");
  assert.equal(rule(character("dp1e", "league", 1, PACTS), "Branda the Fire Queen").pattern.test("Giantsoul amulet"), true);
  assert.equal(rule(character("re1", "league", 1, ECHOES), "Yama"), null, "not on Raging Echoes' page");
  assert.equal(rule(character("dp1f", "league", 1, PACTS), "Obor"), null, "Misthalin is not in Demonic Pacts");
  assert.equal(rule(character("tr1", "league", 1), "Obor").pattern.test("Hill giant club"), true, "still Trailblazer Reloaded's");
  assert.equal(rule(character("dp1g", "league", 1, PACTS), "Scurrius"), null, "a Raging Echoes row the page leaves out");
});

test("boosted drops: the other rollers' uniques (superior Slayer monsters, Treasure Trails caskets)", () => {
  const rule = (player, source) => {
    const request = { player, source, rules: [] };
    ask("drops:chance", request);
    return request.rules[0] ?? null;
  };
  const superior = rule(character("tr1", "league", 1), "superior-slayer-monster");
  assert.equal(superior.multiplier, 2);
  assert.equal(superior.pattern.test("Imbued heart"), true, "every unique");
  assert.equal(rule(character("re4", "league", 4, ECHOES), "treasure-trails-casket").multiplier, 5);
  assert.equal(rule(character("main", "main"), "superior-slayer-monster"), null);
  assert.equal(rule(character("tr1b", "league", 1), "some-other-roller"), null);
});

/** Item ids one kill of `table` drops for `player`, every roll landing at `roll` (0..1). */
function dropsAt(table, player, roll, npcName = "Abyssal demon") {
  Math.random = () => roll;
  const npc = { getId: () => 415, getDefinition: () => ({ getName: () => npcName }) };
  try {
    return NpcDrops.__internals.rollTable(table, player, npc).map((drop) => drop.itemId);
  } finally {
    Math.random = realRandom;
  }
}

test("NpcDrops applies the rule to every form of roll, and only to the matching entries", () => {
  const table = {
    entries: [
      { item_id: 1, name: "Coins", weight: 120, out_of: 128 },
      { item_id: 2, name: "Abyssal dagger", weight: 1, out_of: 128 },
      { item_id: 3, name: "Abyssal whip", separate_roll: true, weight: 1, out_of: 512 },
      { item_id: 4, name: "Rune longsword", separate_roll: true, weight: 1, out_of: 512 },
      { item_id: 5, name: "Abyssal dagger", pre_roll: true, weight: 1, out_of: 100 },
    ],
    main_max_roll: 128,
    tertiary: [{ item_id: 6, name: "Abyssal whip", weight: 1, out_of: 400 }, { item_id: 7, name: "Clue scroll (hard)", weight: 1, out_of: 400 }],
  };
  const boosted = character("tr8", "league", 8); // 5x
  // Its tier 5 pick is Bloodthirsty, not Treasure Seeker, whose clue scrolls come at least 1 in 15.
  boosted.setAttribute("league:relics", { ...boosted.getAttribute("league:relics"), 4: 2 });
  const main = character("main", "main");
  // Independent rolls: a roll of 0.003 is 1.5/512, inside 5/512 but not 1/512; 1.2/400 for the tertiary
  // (and 0.3/100 for the pre-roll, which hits either way).
  const plain = dropsAt(table, main, 0.003);
  assert.deepEqual(plain.filter((id) => [3, 4, 6, 7].includes(id)), [], "unboosted: whip, longsword, tertiary whip and clue all miss");
  assert.ok(plain.includes(5), "the pre-roll's 1/100 hits at 0.3");
  const drops = dropsAt(table, boosted, 0.003);
  assert.ok(drops.includes(3), "the separate-roll whip hits at 5x");
  assert.ok(!drops.includes(4), "the unlisted longsword keeps its 1/512");
  assert.ok(drops.includes(6), "the tertiary whip hits at 5x");
  assert.ok(!drops.includes(7), "the clue scroll keeps its 1/400");
  // The pre-roll: 0.015 is 1.5/100, inside 5/100 only.
  assert.ok(!dropsAt(table, main, 0.015).includes(5));
  assert.ok(dropsAt(table, boosted, 0.015).includes(5), "the pre-roll dagger hits at 5x");
  // The main roll: the dagger's weight becomes 5 of 132; a roll landing at 0.925 is past the coins
  // (120/132 = 0.909) and inside the dagger, where unboosted it would be in the coins (120/128 = 0.9375).
  const atDagger = (player) => {
    Math.random = () => 0.925;
    try {
      return NpcDrops.__internals.rollOnce(table, table.entries, player, true, null, chanceRulesFor(player)).map((drop) => drop.itemId);
    } finally {
      Math.random = realRandom;
    }
  };
  function chanceRulesFor(player) {
    const request = { player, npc: null, npcId: null, source: "Abyssal demon", rules: [] };
    ask("npc-drops:chance", request);
    return request.rules;
  }
  assert.deepEqual(atDagger(main).filter((id) => id === 2 || id === 1), [1], "unboosted: the coins");
  assert.deepEqual(atDagger(boosted).filter((id) => id === 2 || id === 1), [2], "boosted: the dagger, five times as wide");
  // The commons keep their weights: a roll in the coins' part is coins for both.
  Math.random = () => 0.5;
  assert.ok(NpcDrops.__internals.rollOnce(table, table.entries, boosted, true, null, chanceRulesFor(boosted)).some((drop) => drop.itemId === 1));
  assert.ok(NpcDrops.__internals.rollOnce(table, table.entries, main, true, null, chanceRulesFor(main)).some((drop) => drop.itemId === 1));
});

test("weighted rolls without rules: the pool is the weights' sum when the table names none, and a group rolls its own", () => {
  const main = character("main", "main");
  const table = {
    entries: [
      { item_id: 1, name: "Coins", weight: 3 },
      { item_id: 2, name: "Abyssal whip", weight: 1 },
      { item_id: 3, name: "Left", separate_roll: true, roll_group: "pair", weight: 1, out_of: 10 },
      { item_id: 4, name: "Right", separate_roll: true, roll_group: "pair", weight: 1, out_of: 10 },
    ],
  };
  const at = (roll) => {
    Math.random = () => roll;
    try {
      return NpcDrops.__internals.rollOnce(table, table.entries, main, true, null, []).map((drop) => drop.itemId).sort();
    } finally {
      Math.random = realRandom;
    }
  };
  assert.deepEqual(at(0.74), [1], "2.96 of 4 is the coins; 7.4 of 10 misses the pair");
  assert.deepEqual(at(0.76), [2], "3.04 of 4 is the whip");
  assert.deepEqual(at(0.05), [1, 3], "0.5 of 10 is the group's first");
  assert.deepEqual(at(0.15), [1, 4], "1.5 of 10 is its second");
});

test("the world's boss rare multiplier stays out of the main roll for everyone", () => {
  const Drops = require("../plugins/npcs/NpcDrops.plugin");
  Drops.register({
    core,
    getPluginConfig: (key, fallback) => (key === "NpcDrops:bossRareMultiplier" ? 10 : fallback),
    getItemOnGroundManager() {}, onCustomEvent() {}, emitCustomEvent() {}, onNpcDeath() {}, registerCommand() {}, log() {},
  });
  const table = { boss: true, main_max_roll: 1000, entries: [{ item_id: 1, name: "Coins", weight: 998 }, { item_id: 2, name: "Bandos hilt", weight: 1, out_of: 1000 }] };
  Math.random = () => 0.9985;
  try {
    assert.deepEqual(Drops.__internals.rollOnce(table, table.entries, character("main", "main"), true, null, []).map((drop) => drop.itemId), [2]);
    Math.random = () => 0.99;
    assert.deepEqual(Drops.__internals.rollOnce(table, table.entries, character("main2", "main"), true, null, []).map((drop) => drop.itemId), [1], "990 of 1000 is still coins at 10x");
  } finally {
    Math.random = realRandom;
    Drops.register({
      core, getPluginConfig: (key, fallback) => fallback,
      getItemOnGroundManager() {}, onCustomEvent() {}, emitCustomEvent: (name, payload) => { for (const handler of custom[name] ?? []) handler(payload); },
      onNpcDeath() {}, registerCommand() {}, log() {},
    });
  }
});

test("an ordinary casket's roll boosts its uniques for a boosted league character, keeping Entrana's filter", () => {
  // The ordinary Open path's roller (Caskets.TreasureTrails), attached to this api so its
  // "drops:chance" reaches the league. Easy uniques are 8.8% of the pool, 32.6% at 5x: a roll
  // of 0.2 lands past them unboosted and inside them boosted.
  const Caskets = require("../plugins/treasuretrails/trails/Caskets.TreasureTrails");
  Caskets(new Proxy({ core, onItemAction() {}, emitCustomEvent: (name, payload) => ask(name, payload) }, { get: (target, key) => target[key] ?? (() => {}) }));
  const { byName } = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails");
  const TABLES = require("../data/definitions/clue-caskets.json").tables;
  const uniques = new Set(TABLES.easy.entries.filter((row) => /clue uniques$/i.test(row.section)).map((row) => row.item_id));
  const rolled = (player, entrana = false) => Caskets.roll(byName.get("easy"), { player, entrana, rolls: 2, random: () => 0.2 }).map((drop) => drop.itemId);
  const boosted = rolled(character("tr8", "league", 8));
  assert.equal(boosted.length, 2);
  assert.ok(boosted.every((id) => uniques.has(id)), "both rolls are easy clue uniques at 5x");
  assert.ok(rolled(character("main", "main")).every((id) => !uniques.has(id)), "a main character keeps the ordinary odds");
  assert.ok(rolled(character("tr0", "league", 0)).every((id) => !uniques.has(id)), "no relic yet");
  assert.ok(rolled(null).every((id) => !uniques.has(id)), "no player, no boost");
  const shared = new Set(TABLES.easy.entries.filter((row) => /shared/i.test(row.section)).map((row) => row.item_id));
  assert.ok(rolled(character("tr8b", "league", 8), true).every((id) => !uniques.has(id) || shared.has(id)), "Entrana still has no clue uniques");
});

test("the casket roller re-weights the uniques a rule names and leaves the rest", () => {
  const Rolls = require("../plugins/treasuretrails/Rolls.RewardCaskets");
  const table = {
    out_of: 100, rolls: [1, 1],
    entries: [
      { item_id: 1, name: "Coins", section: "Hard clue commons", weight: 99, quantity: [1, 1], noted: false },
      { item_id: 2, name: "Robin hood hat", section: "Hard clue uniques", weight: 1, quantity: [1, 1], noted: false },
    ],
  };
  const multiplier = (row) => (/uniques$/.test(row.section) ? 5 : 1);
  // 0.985 of 100 (98.5) is the coins; of 104 (99 + 5, so 102.4) it is the hat.
  assert.deepEqual(Rolls.rollTable(table, 1, () => 0.985).map((drop) => drop.itemId), [1]);
  assert.deepEqual(Rolls.rollTable(table, 1, () => 0.985, multiplier).map((drop) => drop.itemId), [2]);
  assert.deepEqual(Rolls.rollTable(table, 1, () => 0.5, multiplier).map((drop) => drop.itemId), [1], "the commons' part is unchanged");
});
