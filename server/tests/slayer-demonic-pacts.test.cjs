// Run after `yarn build`: node --test tests/slayer-demonic-pacts.test.cjs
// Demonic Pacts League (type 6) slayer, verified against the OSRS Wiki's task table
// (Demonic_Pacts_League/Guide/Slayer; local copy: the fixture's `source`, fetched 2026-11-26):
// - a task is offered exactly while an area its counting monsters spawn in is unlocked,
//   and a sealed location (a quest-sealed entrance, or no entrance in the world data)
//   counts only once its quest is done,
// - every task's counting monsters are placed in the world so the task can be completed
//   (the documented dumper-data gaps are asserted as a known list, not silently passed),
// - a completed kill pays Slayer XP of the monster's hitpoints at the world's experience
//   rate, read from the server's configuration, so the test holds at any multiplier.
// These tests run the world as a league world (setWorldProfile("league")) with Demonic
// Pacts characters (league:type 6 asserted); a main-profile character is never area-gated.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");

const FIXTURE = require("./data/demonic-pacts-slayer-tasks.json");
const SPAWNS = require("../data/definitions/npc-spawns.json");
const LEAGUE_AREAS_FILE = require("../plugins/modes/data/league-areas.json");
const REGIONS = require("../plugins/modes/leagueareas/Regions.LeagueAreaUnlocks");
const SEALED_LOCATIONS = require("../plugins/modes/leagueareas/Slayer.LeagueAreaUnlocks").sealedLocations;

const DP = 6;
/** The areas the Demonic Pacts league offers; a character's unlock set is drawn from these. */
const ALL_AREAS = LEAGUE_AREAS_FILE.leagues[DP].areas.slice();
const areaIdByKey = new Map(Object.entries(LEAGUE_AREAS_FILE.areas).map(([id, area]) => [area.key.toLowerCase(), Number(id)]));
const VARLAMORE = areaIdByKey.get("varlamore");
const WILDERNESS = areaIdByKey.get("wilderness");
const KANDARIN = areaIdByKey.get("kandarin");
assert.ok(VARLAMORE, "Varlamore has an area id in league-areas.json");
assert.ok(WILDERNESS, "Wilderness has an area id in league-areas.json");
assert.ok(KANDARIN, "Kandarin has an area id in league-areas.json");
/** The wilderness master (keys.slayer): her tasks only count monsters placed in the Wilderness. */
const KRYSTILIA = 7;
/** The balance master: his tasks carry Konar's areas (slayer_master_task.areas). */
const KONAR = masterIdOf("Konar quo Maten");
assert.ok(KONAR, "Konar quo Maten is a master in slayer-masters.json");
/**
 * Tasks the world currently has no counting spawns for (gap report §1.2: the Poison Waste
 * spawns do not exist in the dumper's data yet). Asserted as a known list: when the spawn
 * data gains them, remove the rows from here and the placement test starts covering them.
 */
const KNOWN_NO_PLACEMENT = new Set([
  "Chaeldar Warped creatures",
  "Duradel Warped creatures",
  "Konar quo Maten Warped creatures",
  "Steve Warped creatures",
]);

let core;
let Data;
let Tasks;
let rows;
const hooks = {};
const custom = {};
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    if (typeof handler !== "function") return;
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      for (const attached of lists[name]) attached(event);
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? DP : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    getAreaManager: () => ({ inMulti: () => false }),
    getItemOnGroundManager: () => ({}),
    registerCommand() {},
    registerMagicAttackAccuracyModifier() {},
    registerMagicDamageBonusModifier() {},
    registerMeleeAttackAccuracyModifier() {},
    registerMeleeDefenseModifier() {},
    registerMagicDefenseModifier() {},
    registerIncomingDamageModifier() {},
    registerWeaponProfile() {},
    registerRestingLevelModifier() {},
    registerRangedAmmoHandler() {},
    registerNpcCombatMethodProvider() {},
    spawnNpc: () => ({ getCombat: () => ({ attack() {} }) }),
    onItemAction() {},
    onInterfaceActionButton() {},
    sendMultiChatboxPrompt: (player, title, ...flat) => {
      const entries = [];
      for (let index = 0; index < flat.length; index += 2) entries.push([flat[index], flat[index + 1]]);
      return true;
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/Base.LeagueMode").register(api);
  require("../plugins/modes/Points.LeagueMode").register(api);
  require("../plugins/modes/Relics.LeagueMode").register(api);
  require("../plugins/modes/AreaUnlocks.LeagueMode").register(api);
  require("../plugins/skills/Slayer.plugin").register(api);
  /**
   * `quest:is-complete` (real server: QuestRuntime.answerIsComplete, the quest's stage
   * attribute reaching its completion value). The harness answers for the two quests the
   * slayer area gate can ask about: The Heart of Darkness (76, S.COMPLETE) and Watchtower
   * (13, STAGES.COMPLETE).
   */
  custom["quest:is-complete"] = (custom["quest:is-complete"] ?? []).concat((request) => {
    const completionStage = { the_heart_of_darkness: 76, watchtower: 13 }[request.key];
    if (completionStage === undefined) return;
    request.complete = Number(request.player.getAttribute(`quest.${request.key}.stage`) ?? 0) >= completionStage;
  });
  Data = require("../plugins/skills/slayer/Data.Slayer");
  Tasks = require("../plugins/skills/slayer/Tasks.Slayer");
  rows = buildRows();
});

afterEach(() => {
  Math.random = realRandom;
});

/** A real, logged-in character. League characters carry league:type 6 and the given
 * unlocked areas; `profile: "main"` makes a non-league character (never area-gated). */
function character(name, { areas = [VARLAMORE], slayer = 99, profile = "league" } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(1666, 3136, 0));
  player.setRegistered(true);
  const varbits = new Map();
  const varps = new Map();
  const record = {
    sendVarbit: (id, value) => varbits.set(id, value),
    sendConfig: (id, value) => varps.set(id, value),
  };
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === "getVarbit") return (id) => varbits.get(id) ?? 0;
      if (key === "getVarp") return (id) => varps.get(id) ?? 0;
      return key in record ? (...args) => (record[key](...args), sender) : () => sender;
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.getDialogueManager = () => ({ startDialogues: () => {}, getCurrent: () => null });
  for (const skill of core.Skill.values()) player.getSkillManager().setMaxLevels(skill, skill === Skill.SLAYER ? slayer : 99, false);
  if (profile === "league") {
    player.setAttribute("league:type", DP);
    player.setAttribute("league:relics", {});
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  if (profile === "league") player.setAttribute("league:areas", areas);
  return player;
}

const varp = (player, name) => {
  const id = core.CacheDefinitions.getVarpId(name);
  return player.getPacketSender().getVarp(id);
};
const varbit = (player, name) => {
  const id = core.CacheDefinitions.getVarbitId(name);
  return player.getPacketSender().getVarbit(id);
};

/** Set a task directly (the same varps the masters write), so a completion test needs no lucky roll. */
function giveTask(player, masterId, taskId, amount) {
  const sender = player.getPacketSender();
  sender.sendConfig(core.CacheDefinitions.getVarpId("slayer_target"), taskId);
  sender.sendConfig(core.CacheDefinitions.getVarpId("slayer_count"), amount);
  sender.sendConfig(core.CacheDefinitions.getVarpId("slayer_count_original"), amount);
  sender.sendVarbit(core.CacheDefinitions.getVarbitId("slayer_master"), masterId);
}

const slayerXp = (player) => player.getSkillManager().getSkills().getExperiences()[Skill.SLAYER.getIndex()];

/** The master id of the fixture's wiki master name (primary names of slayer-masters.json). */
function masterIdOf(name) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = norm(name);
  const masters = require("../plugins/skills/data/slayer-masters.json").masters;
  for (const [id, master] of Object.entries(masters)) {
    if (master.names.some((n) => norm(n) === wanted)) return Number(id);
  }
  return null;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Every fixture row resolved against the cache: its master entry, and the distinct world
 * squares (per counting npc id and 64-tile square) where the task's counting NPCs spawn,
 * with the league area of each square (null = open to everyone).
 */
function buildRows() {
  const countNpcs = core.CacheDefinitions.getCounts().npcs;
  const out = [];
  for (const fixture of FIXTURE.tasks) {
    const masterId = masterIdOf(fixture.master);
    assert.ok(masterId, `no master for "${fixture.master}"`);
    const master = Data.get().masters.get(masterId);
    const entry = master.tasks.find((e) => {
      const n = norm(e.task.displayName);
      const m = norm(fixture.monster);
      return n === m || n === m + "s" || n + "s" === m || n.replace(/s$/, "") === m;
    });
    assert.ok(entry, `no cache task for ${fixture.master} ${fixture.monster}`);
    const isBoss = entry.task.id === Data.BOSS_TASK_ID;
    const bossId = isBoss ? entry.bossId ?? null : null;
    const isCounting = (npcId, name) =>
      isBoss ? Data.isBossNpc(bossId, name) : Data.npcCountsFor(entry.task.id, npcId, name);
    const seen = new Set();
    const placed = [];
    for (const row of SPAWNS) {
      const id = Number.isInteger(row.id) ? row.id : core.NpcIdentifiers[row.key];
      if (!Number.isInteger(id) || id < 0 || id >= countNpcs || !Number.isInteger(row.x) || !Number.isInteger(row.y)) continue;
      const definition = core.NpcDefinition.forId(id);
      if (!definition) continue;
      if (!isCounting(id, definition.name ?? definition.getName?.() ?? "")) continue;
      const key = `${id}:${row.x >> 6}:${row.y >> 6}`;
      if (seen.has(key)) continue;
      seen.add(key);
      placed.push({
        id, x: row.x, y: row.y, areaId: areaIdOfTile(row.x, row.y),
        /** Squares the league names (incl. its `area: null` overrides); unnamed squares count for no one. */
        inIndex: REGIONS.indexFor(DP).has(REGIONS.squareOf(row.x, row.y)),
      });
    }
    out.push({ fixture, masterId, entry, isBoss, bossId, placed });
  }
  return out;
}

/** The league area id of a tile, or null when no area names it (open to everyone). */
function areaIdOfTile(x, y) {
  return REGIONS.areaAt(DP, x, y) ?? null;
}

const eligibleNames = (player, master) =>
  master.tasks.filter((entry) => Tasks.eligible(player, master, entry, new Set())).map((entry) => entry.task.displayName);

/** A character holding every named league area, so the area gate always passes for it: whether a
 * row is eligible for it isolates the non-area gates (levels, quests, task-unlock rows). */
let allAreasCharCached = null;
const allAreasChar = () => (allAreasCharCached ??= character("all-areas", { areas: ALL_AREAS }));
const nonAreaCache = new Map();
const nonArea = (row) => {
  if (!nonAreaCache.has(row)) {
    nonAreaCache.set(row, Tasks.eligible(allAreasChar(), Data.get().masters.get(row.masterId), row.entry, new Set()));
  }
  return nonAreaCache.get(row);
};
/** A counting tile grants reachability only inside a square the league names (incl. null overrides). */
const effective = (tile) => tile.areaId !== null || (tile.areaId === null && tile.inIndex);
/**
 * A counting tile the gate names but that sits in a sealed location (Slayer.LeagueAreaUnlocks
 * sealedLocations). The suite's characters have done no quests, so a sealed tile is never
 * reachable: a quest-sealed entrance stays sealed, and a pocket with no entrance in the world
 * data never opens.
 */
const sealed = (tile) => SEALED_LOCATIONS.some(
  (loc) => tile.x >= loc.minX && tile.x <= loc.maxX && tile.y >= loc.minY && tile.y <= loc.maxY);

test("the world is a league world and the characters are Demonic Pacts", () => {
  assert.equal(GameConstants.WORLD_PROFILE, "league");
  assert.ok(Number.isFinite(GameConstants.EXPERIENCE_MULTIPLIER) && GameConstants.EXPERIENCE_MULTIPLIER > 0,
    "the experience rate is read from the world's configuration, not hardcoded");
  const player = character("profile");
  assert.equal(player.getAttribute("league:type"), DP);
  assert.equal(rows.length, FIXTURE.taskCount);
});

test("a task is offered exactly when a counting tile is reachable and unsealed", () => {
  // The plugin (Slayer.LeagueAreaUnlocks.entered + sealOpen): a counting tile is reachable when
  // its square is named by the league and the character unlocked that area, or the league
  // opens the square to everyone (area: null override). A square no area names is reachable by
  // no one. A tile in a sealed location (a quest-sealed entrance, or no entrance in the world
  // data) is reachable only once the quest is done - and the suite's characters have done no
  // quests. A task with no counting tile at all is left to the master's own logic (always offered).
  let checked = 0;
  for (const row of rows) {
    if (row.isBoss) continue;
    const master = Data.get().masters.get(row.masterId);
    const name = row.entry.task.displayName;
    const effectiveTiles = row.placed.filter(effective);
    // Krystilia only counts her Wilderness placements: the plugin filters her tiles to the
    // Wilderness area before the reachability check, so her open-to-all tiles never help.
    const countingTiles = master.id === KRYSTILIA
      ? effectiveTiles.filter((t) => t.areaId === WILDERNESS)
      : effectiveTiles;
    // The suite's characters have done no quests, so a sealed tile is never reachable.
    const openTiles = countingTiles.filter((t) => !sealed(t));
    const named = [...new Set(openTiles.map((t) => t.areaId).filter((a) => a !== null))];
    const open = openTiles.some((t) => t.areaId === null);
    const holder = character(`holder-${checked}`, { areas: named.length ? named : [VARLAMORE] });
    const stranger = character(`stranger-${checked}`, { areas: ALL_AREAS.filter((a) => !named.includes(a)) });
    // nonArea(row): the task must first pass the gates the area gate does not control
    // (levels, stats, quests, task-unlock rows).
    const expectedHolder = nonArea(row) && (row.placed.length === 0 || openTiles.length > 0);
    const expectedStranger = nonArea(row) && (row.placed.length === 0 || open);
    const holderNames = eligibleNames(holder, master);
    const strangerNames = eligibleNames(stranger, master);
    assert.equal(holderNames.includes(name), expectedHolder,
      `holder of [${named.join(",")}] offered "${name}": expected ${expectedHolder}`);
    assert.equal(strangerNames.includes(name), expectedStranger,
      `stranger (holds none of [${named.join(",")}]) offered "${name}": expected ${expectedStranger}`);
    checked += 1;
  }
});

test("a fresh Demonic Pacts character is offered exactly the tasks reachable from Varlamore", () => {
  const fresh = character("fresh");
  const offered = new Set();
  const expected = new Set();
  for (const row of rows) {
    if (row.isBoss) continue;
    const master = Data.get().masters.get(row.masterId);
    const name = row.entry.task.displayName;
    if (Tasks.eligible(fresh, master, row.entry, new Set())) offered.add(name);
    // No counting tile: left to the master. Otherwise reachable iff a counting tile sits in
    // Varlamore or on a square the league opens to everyone - and is not sealed (the fresh
    // character has done no quests); for Krystilia only her Wilderness placements count.
    const countingTiles = master.id === KRYSTILIA
      ? row.placed.filter((t) => effective(t) && t.areaId === WILDERNESS)
      : row.placed.filter(effective);
    const reachable = row.placed.length === 0 || countingTiles.some(
      (t) => (t.areaId === VARLAMORE || t.areaId === null) && !sealed(t));
    if (nonArea(row) && reachable) expected.add(name);
  }
  assert.deepEqual([...offered].sort(), [...expected].sort());
});

/** The Blue Dragons row (a counting task, not a boss). */
const blueRow = () => rows.find((r) => !r.isBoss && norm(r.fixture.monster) === "bluedragon" && r.placed.length > 0);

test("Blue Dragons: not offered while every counted spawn sits in a sealed location", () => {
  const row = blueRow();
  const master = Data.get().masters.get(row.masterId);
  const name = row.entry.task.displayName;
  // A fresh character's only Varlamore counted spawns: the Ruins complex (sealed until The
  // Heart of Darkness) and the Dragon Nest pocket (no entrance in the world data).
  const fresh = character("sealed-fresh");
  assert.ok(!eligibleNames(fresh, master).includes(name), "fresh character: not offered");
  // Unlocking Kandarin adds the Ogre Enclave - sealed until Watchtower.
  const enclave = character("sealed-enclave", { areas: [VARLAMORE, KANDARIN] });
  assert.ok(!eligibleNames(enclave, master).includes(name), "Kandarin without Watchtower: not offered");
});

test("Blue Dragons: The Heart of Darkness lifts the Ruins' seal", () => {
  const row = blueRow();
  const master = Data.get().masters.get(row.masterId);
  const name = row.entry.task.displayName;
  const done = character("hod-done");
  done.setAttribute("quest.the_heart_of_darkness.stage", 76); // S.COMPLETE
  assert.ok(eligibleNames(done, master).includes(name), "quest complete: offered");
  const mid = character("hod-mid");
  mid.setAttribute("quest.the_heart_of_darkness.stage", 72); // FIGHT: Amoxliatl, before the banish
  assert.ok(!eligibleNames(mid, master).includes(name), "mid-quest: still sealed");
});

test("Blue Dragons: Watchtower lifts the Ogre Enclave's seal (Kandarin unlocked)", () => {
  const row = blueRow();
  const master = Data.get().masters.get(row.masterId);
  const name = row.entry.task.displayName;
  const done = character("watch-done", { areas: [VARLAMORE, KANDARIN] });
  done.setAttribute("quest.watchtower.stage", 13); // STAGES.COMPLETE
  assert.ok(eligibleNames(done, master).includes(name), "Watchtower complete: offered via the Ogre Enclave");
});

test("Konar's sealed areas stay closed until their quest completes", () => {
  // Konar's Blue Dragons task carries the Tapoyauik and Ogre Enclave areas (slayer_area); the
  // area gate must not open them (or hand them out through pickArea) while the location's
  // entrance is still quest-sealed. The plugin's contract, as Tasks.Slayer.available asks it:
  // the area must be entered by the same rule the counting tiles use.
  const row = rows.find((r) => !r.isBoss && r.masterId === KONAR && /^bluedragon(s)?$/.test(norm(r.fixture.monster)));
  assert.ok(row, "Konar has a Blue Dragons row");
  const konar = Data.get().masters.get(KONAR);
  const areaOf = (name) => {
    const area = row.entry.areaRows.map((id) => Data.get().areas.get(id)).find((a) => a?.name === name);
    assert.ok(area, `Konar's Blue Dragons row carries the ${name} area`);
    return area;
  };
  const askArea = (player, area) => {
    const request = {
      player, master: konar.id, task: row.entry.task, bossId: null, area, wilderness: false,
      counts: (npcId, name) => Data.npcCountsFor(row.entry.task.id, npcId, name),
      available: true,
    };
    for (const handler of custom["slayer:task-available"] ?? []) handler(request);
    return request.available !== false;
  };
  const tapoyauik = areaOf("Tapoyauik");
  const enclave = areaOf("Ogre Enclave");
  assert.ok(!askArea(character("area-fresh"), tapoyauik), "fresh character (no HoD): Tapoyauik stays closed");
  const hod = character("area-hod");
  hod.setAttribute("quest.the_heart_of_darkness.stage", 76); // S.COMPLETE
  assert.ok(askArea(hod, tapoyauik), "HoD complete: Tapoyauik opens");
  const kandarin = character("area-kandarin", { areas: [VARLAMORE, KANDARIN] });
  assert.ok(!askArea(kandarin, enclave), "Kandarin without Watchtower: the Enclave stays closed");
  const watch = character("area-watch", { areas: [VARLAMORE, KANDARIN] });
  watch.setAttribute("quest.watchtower.stage", 13); // STAGES.COMPLETE
  assert.ok(askArea(watch, enclave), "Watchtower complete: the Enclave opens");
});

test("every task's counting monsters are placed in the world (known gaps asserted as a list)", () => {
  const withoutPlacement = [];
  for (const row of rows) {
    if (row.isBoss) continue;
    if (row.placed.length === 0) withoutPlacement.push(`${row.fixture.master} ${row.fixture.monster}`);
  }
  // Exactly the documented dumper-data gaps, nothing more.
  assert.deepEqual(withoutPlacement.sort(), [...KNOWN_NO_PLACEMENT].sort(),
    "the no-placement list must match the documented gaps exactly");
});

test("the culling-spree boss areas all resolve to cache bosses in valid league areas", () => {
  const relics = require("../plugins/modes/data/league-relics.json");
  const bosses = relics.effects.cullingSpree.bossAreas;
  const cacheBosses = new Map([...Data.get().bosses.entries()].map(([id, task]) => [task.displayName.toLowerCase(), id]));
  const validAreas = new Set(Object.values(LEAGUE_AREAS_FILE.areas).map((a) => a.key));
  for (const [name, areaKey] of Object.entries(bosses)) {
    assert.ok(validAreas.has(areaKey), `${name}: unknown league area "${areaKey}"`);
    assert.ok(cacheBosses.has(name.toLowerCase()), `${name}: no slayer_task_subtable boss by that name`);
  }
});

test("Blue Dragons: a completed task pays Slayer XP of the monster's hitpoints at the world's rate", () => {
  const row = rows.find((r) => !r.isBoss && norm(r.fixture.monster) === "bluedragon" && r.placed.length > 0);
  assert.ok(row, "a Blue dragons task with placed monsters exists");
  const player = character("blue");
  giveTask(player, row.masterId, row.entry.task.id, 2);
  assert.equal(varp(player, "slayer_target"), row.entry.task.id);
  const placed = row.placed[0];
  const definition = core.NpcDefinition.forId(placed.id);
  assert.ok(definition && typeof definition.getHitpoints === "function",
    `a definition with hitpoints exists for the placed counting npc ${placed.id}`);
  const npc = {
    getId: () => placed.id,
    isNpc: () => true,
    getCurrentDefinition: () => definition,
    getDefinition: () => definition,
    getLocation: () => new Location(placed.x, placed.y, 2),
  };
  const before = slayerXp(player);
  const streakBefore = varbit(player, "slayer_tasks_completed");
  const messages = [];
  player.sendMessage = (text) => messages.push(text);
  const { npcKilled } = Tasks;
  npcKilled({ killer: player, npc, npcId: npc.getId() });
  assert.equal(varp(player, "slayer_count"), 1, "one kill counted");
  assert.equal(slayerXp(player) - before, definition.getHitpoints() * GameConstants.EXPERIENCE_MULTIPLIER);
  npcKilled({ killer: player, npc, npcId: npc.getId() });
  assert.equal(varp(player, "slayer_count"), 0, "task complete");
  assert.equal(varbit(player, "slayer_tasks_completed"), streakBefore + 1);
  // complete() always leads with the "You have completed your task! You killed N <name>." message.
  assert.ok(messages.length >= 2 && /You have completed your task! You killed<\/col> 2 /.test(messages[0]) &&
    messages[0].includes(row.entry.task.displayName),
    `completion message names the task (got: ${messages.join(" | ")})`);
});

test("a main-profile character is never area-gated", () => {
  const main = character("main", { profile: "main" });
  assert.equal(main.getAttribute("league:type"), undefined);
  const row = rows.find((r) => !r.isBoss && r.placed.some((p) => p.areaId !== null && p.areaId !== VARLAMORE));
  assert.ok(row, "a task with placements outside Varlamore exists");
  const master = Data.get().masters.get(row.masterId);
  assert.ok(Tasks.eligible(main, master, row.entry, new Set()),
    `a main character is offered ${row.fixture.monster} despite the area being locked in leagues`);
});
