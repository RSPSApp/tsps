// Run after `yarn build`: node --test tests/league-tasks.test.cjs
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
const npc = (name) => ({ getCurrentDefinition: () => ({ getName: () => name }), getMaxHitpoints: () => 10 });
const kill = (player, name) => hooks.onNpcDeath({ killer: player, npc: npc(name), npcId: 0, location: { x: 0, y: 0, z: 0 } });
function setLevel(player, skill, level) {
  const skills = player.getSkillManager();
  const previous = skills.getMaxLevel(skill);
  skills.setExperiences(skill, SkillManager.getExperienceForLevel(level), false);
  skills.setMaxLevels(skill, level, false);
  skills.setCurrentLevels(skill, level, false);
  return previous;
}
const levelUp = (player, skill, level) => hooks.onPlayerLevelUp({ player, skill, oldLevel: setLevel(player, skill, level), newLevel: level });

test("the catalog is sound: the Wiki's counts and points, unique ids, verified triggers", () => {
  const expected = {
    4: { tiers: [269, 390, 385, 390, 46], medium: 40, total: 145490 },
    5: { tiers: [224, 536, 437, 345, 47], medium: 30, total: 141080 },
    // Demonic Pacts: the cache's own list less its one row not in the league (Equip a Dragon Crossbow).
    6: { tiers: [213, 513, 449, 371, 46], medium: 30, total: 146040, pacts: 79 },
  };
  const kinds = new Set(["kill", "level", "any-level", "level-up", "total-level", "base-level", "combat-level", "quest", "equip", "equip-all", "produce", "hunt", "pickpocket", "clue", "experience", "diary", "ca-tier", "ca-count", "ca-bosses", "ca-boss", "agility-laps", "eat", "drink", "eat-heal", "burn", "burn-food", "bury", "cast", "steal", "pick", "pick-each", "collection-log", "check-health", "equip-any-set", "slayer-tasks", "superior-kills", "temple-trek", "pest-control", "prayer", "pet", "tempoross", "open-chest", "plant", "harvest", "foundry", "plunder-chest", "sepulchre-floor", "rumours", "random-event", "totem", "dummy", "gather-with", "enter", "teleport", "rifts", "tob", "emote", "take", "pickpocket-loot", "bird-nest", "buy", "alch", "kill-each", "bank", "npc-op", "shortcut", "deed"]);
  // The agility plugin's course keys (and Yama's stepping stones, the Leagues lair's own course).
  const courseDir = path.join(__dirname, "../plugins/skills/agility/courses");
  const courseKeys = new Set(["yama-stepping-stones", ...require("fs").readdirSync(courseDir)
    .flatMap((file) => [...require("fs").readFileSync(path.join(courseDir, file), "utf8").matchAll(/^\s*key: "([^"]+)"/gm)].map((match) => match[1]))]);
  const npcNames = new Set();
  const creditedNames = new Set();
  // The cache's own list (enum 5950's rows): a task it has by name takes its category.
  const cacheRows = new Map();
  const cacheByPosition = new Map();
  for (const [position, rowId] of CacheDefinitions.getEnumValues(5950)) {
    const row = CacheDefinitions.getDbRow(rowId);
    if (row) cacheRows.set(String(row.columns.get(0)?.[0]).toLowerCase(), row);
    if (row) cacheByPosition.set(position, row);
  }
  assert.ok(cacheRows.size > 1500, "the cache's task list");
  for (const [type, league] of Object.entries(catalog.leagues)) {
    const { tasks } = league;
    assert.deepEqual([1, 2, 3, 4, 5].map((tier) => tasks.filter((task) => task.tier === tier).length), expected[type].tiers, `Wiki: ${league.name}'s tasks per tier`);
    assert.equal(tasks.reduce((sum, task) => sum + task.points, 0), expected[type].total, `Wiki: ${league.name}'s total points`);
    assert.equal(tasks.find((task) => task.tier === 2).points, expected[type].medium);
    assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length, "ids are unique");
    assert.ok(tasks.length <= 1984, "within the client's completion bits");
    if (league.fromCache) {
      // The cache's own list, in its order: a task's position is its completion bit and its row.
      assert.equal(type, "6", "Demonic Pacts is the league this cache carries");
      for (let i = 1; i < tasks.length; i++) assert.ok(tasks[i - 1].position < tasks[i].position, "in the cache's order");
      for (const task of tasks) {
        const row = cacheByPosition.get(task.position);
        assert.equal(task.name, row.columns.get(0)?.[0], `${task.id}: the cache's name at ${task.position}`);
        // A row without a column reads the table's default, -1 (one row has no category).
        assert.deepEqual([task.tier, task.area, task.category], [32, 36, 35].map((column) => row.columns.get(column)?.[0] ?? -1), task.id);
        assert.equal(task.wikiId, task.position, `${task.id}: the Wiki's id is the cache position`);
      }
      assert.equal(tasks.filter((task) => task.pactTask).length, expected[type].pacts, "the Wiki's pact tasks");
    } else {
      for (let i = 1; i < tasks.length; i++) assert.ok(tasks[i - 1].tier <= tasks[i].tier, "sorted by tier");
    }
    for (const task of tasks) {
      assert.ok(([1, 2, 3, 4, 5, 6].includes(task.category) || (league.fromCache && task.category === -1)) && Object.values(catalog.areas).includes(task.area), task.id);
      const cached = cacheRows.get(task.name.toLowerCase());
      assert.equal(task.categorySource, cached ? "cache" : "rule", task.id);
      if (cached) assert.equal(task.category, cached.columns.get(35)?.[0] ?? -1, `${task.id}: the cache's category (the table's -1 without one)`);
      if (task.trigger) {
        assert.ok(kinds.has(task.trigger.kind), `${task.id}: ${task.trigger.kind}`);
        for (const course of task.trigger.courses ?? []) assert.ok(courseKeys.has(course), `${task.id}: course ${course}`);
        if (task.trigger.kind === "kill") {
          assert.ok(Array.isArray(task.trigger.npcs) && task.trigger.npcs.length > 0, task.id);
          // A credited completion is a name a plugin credits through combat-achievements:kill, not an NPC's.
          for (const npc of task.trigger.npcs) (task.trigger.credited ? creditedNames : npcNames).add(npc);
        }
        if (task.trigger.kind === "kill-each") for (const npc of Object.keys(task.trigger.npcs)) npcNames.add(npc);
        if (task.trigger.kind === "level") assert.ok(Skill[task.trigger.skill] instanceof Skill, task.id);
        // A named place: the catalog's own bounds, boxes of tiles.
        if (task.trigger.place !== undefined) assert.ok(catalog.places[task.trigger.place]?.rects.every((rect) => rect.length === 4 && rect[0] <= rect[2] && rect[1] <= rect[3]), `${task.id}: place ${task.trigger.place}`);
      }
    }
  }
  const cacheNames = new Set();
  for (let id = 0; cacheNames.size < 20000 && id < 20000; id++) {
    try { cacheNames.add(CacheDefinitions.getNpc(id)?.name); } catch { break; }
  }
  for (const name of npcNames) assert.ok(cacheNames.has(name), `a cache NPC is called "${name}"`);
  const crediting = ["minigames", "bosses"].flatMap((dir) => require("fs").readdirSync(path.join(__dirname, "../plugins", dir), { recursive: true })
    .filter((file) => String(file).endsWith(".js")).map((file) => require("fs").readFileSync(path.join(__dirname, "../plugins", dir, String(file)), "utf8")))
    .filter((text) => text.includes("combat-achievements:kill")).join("\n");
  for (const name of creditedNames) assert.ok(crediting.includes(`"${name}"`), `a minigame credits "${name}"`);
});

test("login sends the league's catalog as enum and DB row overrides, the completion varps and the saved filters", () => {
  const league = character("catalog");
  assert.equal(league.sent.content.length, 1, "one payload from LeagueMode's single sender");
  assert.deepEqual(league.sent.content[0].map((entry) => entry.key), ["structOverrides", "enumOverrides", "dbRowOverrides"], "the whole set, every dataset");
  const enums = dataset(league, "enumOverrides");
  const rows = dataset(league, "dbRowOverrides");
  const taskEnum = enums.find((row) => row.enumId === 5950);
  assert.equal(taskEnum.entries.length, 1480, "every Trailblazer Reloaded task, in order");
  assert.deepEqual(taskEnum.entries[35], [35, 340035], "position -> its row id");
  assert.deepEqual(enums.find((row) => row.enumId === 2671).entries, [[1, 10], [2, 40], [3, 80], [4, 200], [5, 400]], "Trailblazer Reloaded's tier points over the cache's Raging Echoes ones");
  assert.equal(rows.length, 1480);
  const goblin = rows.find((row) => row.rowId === 340000 + indexOf("defeat-a-goblin"));
  assert.equal(goblin.tableId, 118);
  assert.deepEqual(goblin.columns, { 0: ["Defeat a Goblin"], 1: ["Defeat a Goblin. After all, this still isn't the Goblin League."], 32: [1], 34: [1], 35: [2], 36: [0] });
  for (const varp of completionVarps()) assert.equal(league.sent.varps.get(varp), 0, `completion varp ${varp}`);
  assert.equal(completionVarps().length, 62);
  for (const filter of Object.values(list.filters)) assert.equal(league.sent.varbits.get(filter.varbit), 0, `filter varbit ${filter.varbit}`);
  assert.deepEqual(completed(league), [], "a new character has done nothing yet, Agility 10 included (its first-level tasks exclude the starting skills)");

  worldLeague = 5;
  const echoes = character("echoes");
  worldLeague = 4;
  assert.equal(dataset(echoes, "enumOverrides").find((row) => row.enumId === 5950).entries.length, 1589);
  assert.deepEqual(dataset(echoes, "enumOverrides").find((row) => row.enumId === 2671).entries[1], [2, 30]);
  assert.equal(dataset(echoes, "dbRowOverrides")[0].rowId, 350000, "a league's rows have their own ids");
});

test("Demonic Pacts, the cache's own league: no catalog overrides, and a task's bit is its cache position", () => {
  worldLeague = 6;
  const pacts = character("pacts");
  worldLeague = 4;
  assert.equal(dataset(pacts, "enumOverrides")?.find((row) => row.enumId === 5950), undefined, "the client's own task enum stands");
  assert.equal((dataset(pacts, "dbRowOverrides") ?? []).length, 0, "and its own rows");
  const giant = catalog.leagues["6"].tasks.find((task) => task.id === "defeat-a-hill-giant");
  const last = catalog.leagues["6"].tasks.at(-1);
  assert.deepEqual([last.position, catalog.leagues["6"].tasks.length], [1592, 1592], "past the one row the cache leaves out of the league, a task keeps its cache position");
  kill(pacts, "Hill Giant");
  assert.deepEqual(completed(pacts), ["defeat-a-hill-giant"]);
  assert.equal(pacts.sent.varps.get(bitVarp(giant.position)), 1 << (giant.position % 32), "the bit the client's script 9470 reads");
  assert.equal(pacts.sent.messages.at(-1), "Congratulations, you've completed an easy task: <col=FE206A>Defeat a Hill Giant</col>.", "in the league's colour");
});

test("View Tasks opens the list with the captured events; the dropdowns set and keep their filter varbits", () => {
  const league = character("viewer");
  assert.equal(hooks[`button:${uid(TASKS, 37)}`]({ player: league, slot: 3 }), false, "a dropdown click before View Tasks is ignored");
  const payloads = league.sent.content.length;
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 36)}`]({ player: league }), true);
  assert.equal(league.sent.content.length, payloads + 1, "the content payload again, in case the client reloaded");
  assert.equal(dataset(league, "dbRowOverrides").length, 1480);
  assert.equal(league.sent.removals, 1, "the main modal is closed first");
  assert.deepEqual(league.sent.subs.at(-1), [FLOATER, TASKS, 1], "league_tasks in the toplevel floater as an overlay");
  assert.deepEqual(league.sent.flags, [
    [uid(TASKS, 37), 1, 7, OP1], [uid(TASKS, 42), 1, 4, OP1], [uid(TASKS, 41), 1, 4, OP1], [uid(TASKS, 38), 1, 8, OP1], [uid(TASKS, 39), 1, 15, OP1], [uid(TASKS, 40), 1, 7, OP1],
    [uid(TASKS, 18), 0, 1480, OP1], [uid(TASKS, 6), 10, 18, OP1],
  ], "if_setevents as captured, in the Leagues VI order, on this cache's dropdown lists and rows (the rows up to the task count)");
  assert.equal(hooks[`button:${uid(TASKS, 37)}`]({ player: league, slot: 3 }), true);
  assert.equal(league.sent.varbits.get(10033), 2, "captured: dropdown slot 3 -> league_task_filter_tier 2");
  assert.equal(hooks[`button:${uid(TASKS, 38)}`]({ player: league, slot: 2 }), true);
  assert.equal(league.sent.varbits.get(11689), 1, "captured: slot 2 -> league_task_filter_type 1");
  assert.equal(hooks[`button:${uid(TASKS, 42)}`]({ player: league, slot: 2 }), true);
  assert.equal(league.sent.varbits.get(10034), 1, "Incomplete");
  assert.equal(hooks[`button:${uid(TASKS, 39)}`]({ player: league, slot: 14 }), true);
  assert.equal(league.sent.varbits.get(11692), 13, "Unlocked areas");
  assert.equal(hooks[`button:${uid(TASKS, 40)}`]({ player: league, slot: 9 }), false, "no such slot");
  assert.deepEqual(league.getAttribute("league:task-filters"), { tier: 2, type: 1, completed: 1, area: 13 });
  assert.equal(hooks[`button:${uid(TASKS, 18)}`]({ player: league, slot: 11 }), true, "a row click is the client's expand; nothing to send");
  assert.equal(hooks[`button:${uid(TASKS, 3)}`]({ player: league }), true);
  assert.deepEqual(league.sent.closed, [TASKS]);
  assert.equal(hooks[`button:${uid(TASKS, 37)}`]({ player: league, slot: 1 }), false, "closed again");

  league.sent.varbits.clear();
  hooks.onPlayerLogin({ player: league, username: "viewer", isNewAccount: false, profile: "league" });
  assert.equal(league.sent.varbits.get(10033), 2, "the filters come back at login, as captured");
  assert.equal(league.sent.varbits.get(11692), 13);
});

test("a kill awards its task once: the completion bit first, then the points, then the captured message", () => {
  const league = character("slayer");
  const index = indexOf("defeat-a-goblin");
  league.sent.order.length = 0;
  kill(league, "Goblin");
  assert.deepEqual(completed(league), ["defeat-a-goblin"]);
  assert.equal(points(league), 10);
  assert.equal(league.sent.varps.get(bitVarp(index)), 1 << (index % 32), "its bit in the completion varp");
  const kinds = league.sent.order.map(([kind, id]) => (kind === "varp" ? `varp ${id}` : kind));
  assert.ok(kinds.indexOf(`varp ${bitVarp(index)}`) < kinds.indexOf("varp 2614"), "the bit before the points varp that redraws the list");
  assert.equal(league.sent.messages.at(-1), "Congratulations, you've completed an easy task: <col=FF7700>Defeat a Goblin</col>.");
  kill(league, "Goblin");
  assert.deepEqual(completed(league), ["defeat-a-goblin"], "once");
  assert.equal(points(league), 10);

  // A kill-count task and its longer sibling for the same single NPC (Cerberus 50 and 150 times, say).
  const single = (task) => task.trigger?.kind === "kill" && task.trigger.npcs.length === 1;
  const fifty = TRL.find((task) => single(task) && task.trigger.count === 50 && TRL.some((other) => single(other) && other.trigger.npcs[0] === task.trigger.npcs[0] && other.trigger.count === 150));
  const hundredFifty = TRL.find((task) => single(task) && task.trigger.npcs[0] === fifty.trigger.npcs[0] && task.trigger.count === 150);
  const [boss] = fifty.trigger.npcs;
  for (let i = 0; i < 49; i++) kill(league, boss);
  assert.equal(league.getAttribute("league:task-kills")[fifty.id], 49, "progress kept per task");
  assert.ok(!completed(league).includes(fifty.id));
  kill(league, boss);
  assert.ok(completed(league).includes(fifty.id), "the 50th kill");
  assert.ok(!completed(league).includes(hundredFifty.id));
  assert.equal(league.getAttribute("league:task-kills")[hundredFifty.id], 50, "the longer task kept counting");
  assert.equal(league.sent.messages.at(-1), `Congratulations, you've completed a ${catalog.tiers[fifty.tier - 1].toLowerCase()} task: <col=FF7700>${fifty.name}</col>.`);
  const before = { ...league.getAttribute("league:task-kills") };
  kill(league, "Unicorn");
  assert.deepEqual(league.getAttribute("league:task-kills"), before, "a kill no task accepts counts for nothing");
});

test("Demonic Pacts' list as captured: the row events to the cache list's last key, the override wipe, the search and its close", () => {
  worldLeague = 6;
  const pacts = character("searcher");
  worldLeague = 4;
  assert.equal(hooks[`button:${uid(TASKS, 45)}`]({ player: pacts }), false, "the search bar of a closed list");
  pacts.sent.order.length = 0;
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 36)}`]({ player: pacts }), true);
  assert.deepEqual(pacts.sent.flags.find(([id]) => id === uid(TASKS, 18)), [uid(TASKS, 18), 0, 1592, OP1], "rev 237: tasks_background 0-1592");
  assert.deepEqual(pacts.sent.order.filter(([kind]) => kind === "script"), [["script", 9404]], "league_task_override_task_wipe after the events");

  pacts.sent.order.length = 0;
  assert.equal(hooks[`button:${uid(TASKS, 45)}`]({ player: pacts }), true);
  assert.deepEqual(pacts.sent.order, [["varbit", 17310, 1], ["varbit", 17311, 1], ["script", 2157]], "searching, the keyboard, chatdefault_stopinput");
  pacts.sent.order.length = 0;
  assert.equal(hooks[`button:${uid(TASKS, 3)}`]({ player: pacts }), true);
  assert.deepEqual(pacts.sent.order, [["varbit", 17310, 0], ["varbit", 17311, 0], ["close", TASKS], ["script", 2158], ["script", 9431]], "the captured close of a search");

  hooks[`button:${uid(SIDE_PANEL, 36)}`]({ player: pacts });
  pacts.sent.order.length = 0;
  hooks[`button:${uid(TASKS, 3)}`]({ player: pacts });
  assert.deepEqual(pacts.sent.order, [["close", TASKS], ["script", 9431]], "a close without a search");

  hooks[`button:${uid(SIDE_PANEL, 36)}`]({ player: pacts });
  assert.equal(hooks[`button:${uid(TASKS, 41)}`]({ player: pacts, slot: 2 }), true, "the pact-task dropdown");
  assert.equal(pacts.sent.varbits.get(20357), 1, "league_task_filter_mastery_point");
});

test("a league modal sets busy, closes the task list first and clears busy as it closes (rev 237 wire order)", () => {
  worldLeague = 6;
  const panel = character("modals");
  worldLeague = 4;
  hooks[`button:${uid(SIDE_PANEL, 36)}`]({ player: panel });
  panel.sent.order.length = 0;
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 7)}`]({ player: panel }), true, "the Summary");
  assert.deepEqual(panel.sent.order.slice(0, 3), [["varbit", 12393, 1], ["close", TASKS], ["script", 9431]], "busy, then the floater and its close script");
  assert.deepEqual(panel.sent.order.find(([kind, id]) => kind === "script" && id === 2524), ["script", 2524, -1, -1], "then 2524 before the modal");
  for (const handler of custom["interface:closed"]) handler({ player: panel, interfaceId: 529 });
  assert.equal(panel.sent.varbits.get(12393), 0, "closing it clears busy");
  panel.sent.varbits.delete(12393);
  for (const handler of custom["interface:closed"]) handler({ player: panel, interfaceId: 529 });
  assert.equal(panel.sent.varbits.has(12393), false, "once");
});

test("a kill with a league area counts only there: Defeat a Snake in Karamja", () => {
  worldLeague = 6;
  const hunter = character("areakiller");
  worldLeague = 4;
  const task = catalog.leagues["6"].tasks.find((entry) => entry.id === "defeat-a-snake-in-karamja");
  assert.deepEqual(task.trigger, { kind: "kill", npcs: ["Snake"], count: 1, area: 2 }, "Karamja, the areas plugin's 2");
  const areaAt = custom["league:area-at"];
  custom["league:area-at"] = [(query) => { query.area = query.x === 2850 ? 2 : 21; }];
  try {
    hooks.onNpcDeath({ killer: hunter, npc: npc("Snake"), npcId: 0, location: { x: 1700, y: 3100, z: 0 } });
    assert.ok(!completed(hunter).includes(task.id), "a snake in Varlamore is no Karamja snake");
    hooks.onNpcDeath({ killer: hunter, npc: npc("Snake"), npcId: 0, location: { x: 2850, y: 3000, z: 0 } });
    assert.ok(completed(hunter).includes(task.id));
  } finally {
    if (areaAt) custom["league:area-at"] = areaAt; else delete custom["league:area-at"];
  }
});

test("experience tasks: 25 million in a skill, and in 5 non-combat skills", () => {
  worldLeague = 6;
  const grinder = character("xpgrinder");
  worldLeague = 4;
  const tasks = catalog.leagues["6"].tasks;
  const agility = tasks.find((task) => task.id === "obtain-25-million-agility-xp");
  const five = tasks.find((task) => task.id === "obtain-25-million-xp-in-5-non-combat-skills");
  assert.deepEqual(agility.trigger, { kind: "experience", skills: ["AGILITY"], amount: 25000000, count: 1 });
  const skills = grinder.getSkillManager();
  const xp = (skill, amount) => { skills.setExperiences(skill, amount, false); hooks.onExperienceGained({ player: grinder, skill, experience: 1 }); };
  xp(Skill.AGILITY, 24999999);
  assert.ok(!completed(grinder).includes(agility.id));
  xp(Skill.AGILITY, 25000000);
  assert.ok(completed(grinder).includes(agility.id));
  for (const skill of [Skill.MINING, Skill.FISHING, Skill.COOKING]) xp(skill, 25000000);
  assert.ok(!completed(grinder).includes(five.id), "four of five");
  xp(Skill.ATTACK, 25000000);
  assert.ok(!completed(grinder).includes(five.id), "Attack is a combat skill");
  xp(Skill.HERBLORE, 25000000);
  assert.ok(completed(grinder).includes(five.id));
});

test("a diary tier task completes when the diaries plugin says the tier is done", () => {
  worldLeague = 6;
  const diarist = character("diarist");
  worldLeague = 4;
  const task = catalog.leagues["6"].tasks.find((entry) => entry.id === "complete-the-easy-karamja-diary");
  assert.deepEqual(task.trigger, { kind: "diary", diary: "karamja", tier: "easy" });
  const kourend = catalog.leagues["6"].tasks.find((entry) => entry.name === "Kourend and Kebos Easy Diary Tasks");
  assert.deepEqual(kourend.trigger, { kind: "diary", diary: "kourend", tier: "easy" });
  let done = false;
  custom["diary:is-complete"] = [(query) => { query.complete = done && query.diary === "karamja" && query.tier === "easy"; }];
  try {
    for (const handler of custom["diary:task"]) handler({ player: diarist, diary: "karamja", task: "x" });
    assert.ok(!completed(diarist).includes(task.id));
    done = true;
    for (const handler of custom["diary:task"]) handler({ player: diarist, diary: "karamja", task: "y" });
    assert.ok(completed(diarist).includes(task.id));
  } finally {
    delete custom["diary:is-complete"];
  }
});

test("Combat Achievement tasks: a tier, counts, speed tasks and a monster's every task", () => {
  worldLeague = 6;
  const warrior = character("caleague");
  worldLeague = 4;
  const tasks = catalog.leagues["6"].tasks;
  const byName = (name) => tasks.find((task) => task.name === name);
  assert.deepEqual(byName("Combat Achievements Easy Tier").trigger, { kind: "ca-tier", tier: "Easy" });
  assert.deepEqual(byName("50 Combat Achievements").trigger, { kind: "ca-count", count: 50 });
  assert.deepEqual(byName("Complete 5 Speed Tasks").trigger, { kind: "ca-count", count: 5, type: "speed" });
  assert.deepEqual(byName("Mole Combat Achievements").trigger, { kind: "ca-boss", monster: "Giant Mole" }, "enum 3970's name");
  assert.equal(byName("Hueycoatl Combat Achievements").trigger.monster, "Hueycoatl, The");
  const state = { completed: 49, speed: 4, monsters: ["Giant Mole"], easy: false };
  custom["combat-achievements:summary"] = [(query) => Object.assign(query, { completed: state.completed, speed: state.speed, monsters: state.monsters })];
  custom["combat-achievements:tier"] = [(query) => { query.unlocked = query.tier === "Easy" && state.easy; }];
  try {
    const fire = () => { for (const handler of custom["combat-achievements:completed"]) handler({ player: warrior }); };
    fire();
    assert.ok(completed(warrior).includes(byName("Mole Combat Achievements").id), "the Giant Mole's every task");
    assert.ok(!completed(warrior).includes(byName("50 Combat Achievements").id));
    Object.assign(state, { completed: 50, speed: 5, easy: true });
    fire();
    for (const name of ["50 Combat Achievements", "Complete 5 Speed Tasks", "Combat Achievements Easy Tier", "Complete all tasks for 1 boss"]) {
      assert.ok(completed(warrior).includes(byName(name).id), name);
    }
  } finally {
    delete custom["combat-achievements:summary"];
    delete custom["combat-achievements:tier"];
  }
});

/** The first cache item / NPC of that exact name. */
function itemId(name) {
  for (let id = 0; id < CacheDefinitions.getCounts().items; id++) if (CacheDefinitions.getItem(id)?.name === name) return id;
  throw new Error(`no item "${name}"`);
}
function npcId(name) {
  for (let id = 0; id < CacheDefinitions.getCounts().npcs; id++) if (CacheDefinitions.getNpc(id)?.name === name) return id;
  throw new Error(`no NPC "${name}"`);
}
const emit = (name, payload) => { for (const handler of custom[name] ?? []) handler(payload); };

test("deeds award Demonic Pacts tasks from the skills' own events: worn, made, gathered, hunted, stolen and casket kinds", () => {
  worldLeague = 6;
  const doer = character("doer");
  worldLeague = 4;
  const tasks = catalog.leagues["6"].tasks;
  const trigger = (id) => tasks.find((task) => task.id === id).trigger;
  assert.deepEqual(trigger("equip-a-tyras-helm"), { kind: "equip", items: ["Tyras helm"] });
  doer.getEquipment = () => ({ getItems: () => [{ getId: () => itemId("Tyras helm") }] });
  emit("equipment:changed", { player: doer });
  assert.ok(completed(doer).includes("equip-a-tyras-helm"), "worn: equipment:changed");
  assert.deepEqual(trigger("equip-full-oathplate"), { kind: "equip-all", items: ["Oathplate helm", "Oathplate chest", "Oathplate legs"] }, "the Wiki's link targets, not its labels");
  const worn = (...names) => (doer.getEquipment = () => ({ getItems: () => names.map((name) => ({ getId: () => itemId(name) })) }));
  worn("Oathplate helm", "Oathplate chest");
  emit("equipment:changed", { player: doer });
  assert.ok(completed(doer).includes("equip-any-oathplate-piece") && !completed(doer).includes("equip-full-oathplate"), "a piece is not the set");
  worn("Oathplate helm", "Oathplate chest", "Oathplate legs");
  emit("equipment:changed", { player: doer });
  assert.ok(completed(doer).includes("equip-full-oathplate"), "every piece at once");

  assert.deepEqual(trigger("mine-5-tin-ore"), { kind: "produce", items: ["Tin ore"], count: 5 });
  assert.deepEqual(trigger("guardians-of-the-rift-10-rifts-closed"), { kind: "rifts", count: 10 });
  assert.deepEqual(trigger("pickpocket-an-elite-clue-from-a-hero"), { kind: "pickpocket-loot", npcs: ["Hero"], items: ["Clue scroll (elite)", "Scroll box (elite)"], count: 1 });
  assert.deepEqual(trigger("purchase-a-celestial-ring"), { kind: "buy", items: ["Celestial ring (uncharged)"], shops: ["Dusuri's Star Shop"], count: 1 }, "the ring as the shop sells it");
  assert.deepEqual(trigger("convert-an-item-into-at-least-500-coins"), { kind: "alch", coins: 500, count: 1 });
  assert.deepEqual(trigger("use-the-bank-in-nardah"), { kind: "bank", place: "nardah-bank", count: 1 });
  assert.deepEqual(trigger("use-the-bank-on-lunar-isle"), { kind: "bank", place: "lunar-isle", count: 1 });
  assert.deepEqual(trigger("use-the-bank-chest-inside-fortis-colosseum"), { kind: "bank", place: "fortis-colosseum-lobby", count: 1 });
  // A subject the cache spells otherwise: the item or NPC its linked page's infobox names, every cache
  // entry of that name one of the page's ids (the Chompy bird hats, every rank's one name, are none).
  assert.deepEqual(trigger("catch-150-red-chinchompas-in-kandarin"), { kind: "hunt", npcs: ["Carnivorous chinchompa"], count: 150, area: 4 });
  assert.deepEqual(trigger("mine-30-chunks-of-granite"), { kind: "produce", items: ["Granite (500g)", "Granite (2kg)", "Granite (5kg)"], count: 30, area: 6 });
  assert.deepEqual(trigger("equip-the-webweaver"), { kind: "equip", items: ["Webweaver bow (u)", "Webweaver bow"] });
  assert.deepEqual(trigger("equip-an-enchanted-slayer-staff"), { kind: "equip", items: ["Slayer's staff (e)"] });
  assert.equal(trigger("equip-a-marksman-chompy-hat"), undefined);
  assert.equal(trigger("create-a-mithril-grapple"), undefined, "the unfinished grapple is a Mith grapple too");
  assert.deepEqual(trigger("chop-down-an-arctic-pine-tree"), { kind: "produce", items: ["Arctic pine logs"], count: 1 });
  assert.deepEqual(trigger("worship-the-ectofuntus"), { kind: "deed", event: "ectofuntus:worshipped", count: 1 });
  assert.deepEqual(trigger("load-a-blowpipe-with-dragon-darts"), { kind: "deed", event: "toxic-blowpipe:darts-loaded", count: 1, items: ["Dragon dart"] });
  assert.deepEqual(trigger("switch-to-the-lunar-spellbook"), { kind: "deed", event: "magic:spellbook-changed", count: 1, where: { spellbook: "lunar" } });
  assert.deepEqual(trigger("fill-a-giant-pouch"), { kind: "deed", event: "runecrafting:pouch-filled", count: 1, items: ["Giant pouch"] });
  assert.deepEqual(trigger("cross-a-pillar-shortcut-in-the-revenant-caves"), { kind: "shortcut", shortcuts: ["Pillar (Revenant Caves, easy)", "Pillar (Revenant Caves, medium)", "Pillar (Revenant Caves, hard)"], count: 1 });
  assert.deepEqual(trigger("take-a-shortcut-across-the-shilo-village-river"), { kind: "shortcut", shortcuts: ["Stepping stone (Shilo Village)"], count: 1 });
  assert.deepEqual(trigger("talk-to-a-gladiator"), { kind: "npc-op", npcs: ["Gladiator"], option: "talk-to", count: 1 });
  assert.deepEqual(trigger("talk-to-ilfeen-in-tirannwn"), { kind: "npc-op", npcs: ["Ilfeen"], option: "talk-to", count: 1, area: 7 });
  assert.deepEqual(trigger("talk-to-the-mysterious-old-man-in-falador"), { kind: "npc-op", npcs: ["Mysterious Old Man"], option: "talk-to", count: 1, place: "falador" });
  assert.deepEqual(trigger("obtain-a-bird-nest"), { kind: "bird-nest", count: 1 });
  assert.deepEqual(trigger("pick-up-snapegrass"), { kind: "take", items: ["Snape grass"], source: "pickup", count: 1, place: "lunar-isle" });
  assert.deepEqual(trigger("use-the-fortis-salute-emote"), { kind: "emote", slots: [53], count: 1 });
  assert.deepEqual(trigger("complete-the-theatre-of-blood-25-times"), { kind: "tob", modes: ["normal", "hard"], count: 25 });
  assert.deepEqual(trigger("cast-kourend-castle-teleport"), { kind: "teleport", spells: ["kourend castle teleport"], count: 1 });
  assert.ok(trigger("teleport-using-law-runes").spells.includes("paddewwa teleport"), "every teleport whose runes have a law rune");
  assert.deepEqual(trigger("make-an-extended-antifire-potion"), { kind: "produce", items: ["Extended antifire"], count: 1 }, "a potion's name has no 'potion' in it");
  assert.deepEqual(trigger("create-100-anti-venom-potions").items, ["Anti-venom"], "at any dosage");
  assert.deepEqual(trigger("successfully-cut-a-red-topaz"), { kind: "produce", items: ["Red topaz"], count: 1 });
  assert.deepEqual(trigger("spin-a-ball-of-wool"), { kind: "produce", items: ["Ball of wool"], count: 1 });
  assert.deepEqual(trigger("chop-75-magic-logs"), { kind: "produce", items: ["Magic logs"], count: 75 }, "from Magic Trees is where the logs come from");
  assert.deepEqual(trigger("pickpocket-a-master-farmer"), { kind: "pickpocket", npcs: ["Master Farmer"], count: 1 }, "pickpocket from a Master farmer");
  for (let i = 0; i < 4; i++) emit("mining:success", { player: doer, itemId: itemId("Tin ore") });
  assert.equal(doer.getAttribute("league:task-progress")["mine-5-tin-ore"], 4, "progress kept");
  assert.ok(!completed(doer).includes("mine-5-tin-ore"));
  emit("mining:success", { player: doer, itemId: itemId("Tin ore") });
  assert.ok(completed(doer).includes("mine-5-tin-ore"), "the fifth ore");
  assert.equal(doer.getAttribute("league:task-progress")["mine-5-tin-ore"], undefined, "a done task keeps no count");

  assert.deepEqual(trigger("clean-15-grimy-tarromin"), { kind: "produce", items: ["Tarromin"], count: 15 }, "a herb counts once clean");
  emit("skills:produced", { player: doer, itemId: itemId("Tarromin"), amount: 15 });
  assert.ok(completed(doer).includes("clean-15-grimy-tarromin"), "skills:produced, with its amount");
  emit("fishing:success", { player: doer, itemId: itemId("Raw cod") });
  assert.equal(doer.getAttribute("league:task-progress")["catch-10-cod"], 1, "a fish is caught raw");
  assert.equal(trigger("chop-some-logs"), undefined, "\"any kind of logs\" is no single item");
  emit("woodcutting:success", { player: doer, logId: itemId("Willow logs") });
  assert.equal(doer.getAttribute("league:task-progress")["chop-100-willow-logs"], 1, "woodcutting:success by its log");

  assert.deepEqual(trigger("pickpocket-a-citizen").npcs, ["Man", "Woman"], "the description's alternatives");
  emit("thieving:success", { player: doer, method: "stall", target: "Woman" });
  assert.ok(!completed(doer).includes("pickpocket-a-citizen"), "a stall is no pocket");
  emit("thieving:success", { player: doer, method: "pickpocket", target: "Woman" });
  assert.ok(completed(doer).includes("pickpocket-a-citizen"));

  emit("hunter:success", { player: doer, method: "net", npcId: npcId("Baby impling") });
  assert.ok(completed(doer).includes("catch-a-baby-impling"), "hunter:success by the creature");
  emit("treasure-trails:casket-opened", { player: doer, tier: "easy" });
  assert.ok(completed(doer).includes("1-easy-clue-scroll"));
  assert.equal(doer.getAttribute("league:task-progress")["25-easy-clue-scrolls"], 1);

  // Produce, as the descriptions say it: a restated "whilst fishing" or rune altar is no condition,
  // a potion has no dose, the description names the herb, a tree chopped is its logs, a trailing
  // league region is the task's area.
  assert.deepEqual(trigger("catch-a-herring"), { kind: "produce", items: ["Raw herring"], count: 1 });
  assert.deepEqual(trigger("catch-an-anchovy").items, ["Raw anchovies"], "the description's raw fish as written");
  assert.deepEqual(trigger("craft-a-fire-rune"), { kind: "produce", items: ["Fire rune"], count: 1 });
  assert.deepEqual(trigger("make-30-prayer-potions"), { kind: "produce", items: ["Prayer potion"], count: 30 });
  assert.deepEqual(trigger("clean-a-grimy-guam"), { kind: "produce", items: ["Guam leaf"], count: 1 });
  assert.deepEqual(trigger("chop-100-maples-in-tirannwn"), { kind: "produce", items: ["Maple logs"], count: 100, area: 7 });
  assert.deepEqual(trigger("catch-a-swamp-lizard-in-morytania"), { kind: "hunt", npcs: ["Swamp lizard"], count: 1, area: 5 });
  assert.equal(trigger("chop-some-logs"), undefined, "any logs is still no single item");
  emit("woodcutting:success", { player: doer, logId: itemId("Maple logs") });
  assert.equal(doer.getAttribute("league:task-progress")["chop-100-maples-in-tirannwn"], undefined, "not chopped in Tirannwn");

  // A boss in its own lair: the place only says where it lives (a Combat Achievements monster).
  assert.deepEqual(trigger("defeat-vorkath-50-times"), { kind: "kill", npcs: ["Vorkath"], count: 50 });
  assert.deepEqual(trigger("defeat-sarachnis-50-times"), { kind: "kill", npcs: ["Sarachnis"], count: 50 });
  assert.equal(trigger("defeat-vorkath-15-times-without-leaving"), undefined, "its condition still stands");
  // A monster the Wiki has in one place only: the place only says where it lives.
  assert.deepEqual(trigger("defeat-a-drake"), { kind: "kill", npcs: ["Drake"], count: 1 }, "every Drake the Wiki lists is in the Karuulm Slayer Dungeon");
  assert.equal(trigger("defeat-a-snake-in-karamja").area, 2, "a monster of many homes keeps its place");
  assert.deepEqual(trigger("defeat-a-moss-fire-and-hill-giant-in-kourend"), { kind: "kill-each", npcs: { "Moss giant": 1, "Fire giant": 1, "Hill Giant": 1 }, area: 20 });
  assert.deepEqual(trigger("defeat-the-grotesque-guardians-50-times"), { kind: "kill", npcs: ["Dusk"], count: 50 }, "the Combat Achievements plugin's NPC for the monster");
  assert.deepEqual(trigger("defeat-150-lizardmen-shaman"), { kind: "kill", npcs: ["Lizardman shaman"], count: 150 }, "helping the house is dealing with them");
  // A named place the server knows the bounds of.
  assert.deepEqual(trigger("enter-the-crafting-guild"), { kind: "enter", place: "crafting-guild" });
  assert.deepEqual(trigger("defeat-a-runite-golem"), { kind: "kill", npcs: ["Runite Golem"], count: 1, place: "resource-area" });
  assert.equal(catalog.places["wizards-guild"].source, "the Wiki's outline");
  assert.deepEqual(trigger("cook-20-sharks-in-darkmeyer"), { kind: "produce", items: ["Shark"], count: 20, place: "darkmeyer-city" });
  assert.deepEqual(trigger("steal-a-chisel"), { kind: "steal", stalls: ["Crafting Stall"], count: 1, items: ["Chisel"], place: "keldagrim" });
  assert.equal(trigger("craft-some-pottery-in-sophanem"), undefined, "pottery is a skill's products, no one item");
  assert.deepEqual(trigger("equip-amy-s-saw"), { kind: "equip", items: ["Amy's saw"] }, "from Mahogany Homes is where it comes from");
  assert.deepEqual(trigger("equip-a-golden-tench"), { kind: "equip", items: ["Golden tench"] }, "caught by aerial fishing, likewise");
  // A set the cache has no item set for: its Wiki page's table of pieces.
  assert.deepEqual(trigger("equip-a-full-armadyl-armour-set"), { kind: "equip-all", items: ["Armadyl helmet", "Armadyl chestplate", "Armadyl chainskirt"] });
  assert.equal(trigger("equip-a-full-void-knight-set").sets.length, 3, "one table per helm, sharing the rest");
  assert.equal(trigger("equip-a-full-crystal-armour-set"), undefined, "weapons, armour and tools are three things");

  // Fires, burnt food and bones: the logs or bones named, any bones for "Remains of any kind".
  assert.deepEqual(trigger("burn-100-willow-logs"), { kind: "burn", items: ["Willow logs"], count: 100 });
  assert.equal(trigger("burn-20-pyre-logs"), undefined, "pyre logs go on a funeral pyre");
  assert.deepEqual(trigger("burn-some-food"), { kind: "burn-food", count: 1 });
  assert.deepEqual(trigger("bury-6-bones"), { kind: "bury", any: true, count: 6 });
  assert.deepEqual(trigger("bury-some-wyvern-or-dragon-bones"), { kind: "bury", items: ["Wyvern bones", "Dragon bones"], count: 1 });
  assert.equal(trigger("bury-some-wyrm-bones-near-a-wyrm-skeleton"), undefined, "a place is no plain count");

  // Spells: combat spells and the alchemies by name, "any wave spell" the four; a teleport or a place is left out.
  assert.deepEqual(trigger("cast-ice-burst"), { kind: "cast", spells: ["Ice Burst"], count: 1 });
  assert.deepEqual(trigger("cast-a-wave-spell").spells, ["Wind Wave", "Water Wave", "Earth Wave", "Fire Wave"]);
  assert.equal(trigger("cast-claws-of-guthix"), undefined, "outside of the Mage Arena");
  assert.equal(trigger("cast-home-teleport"), undefined, "a teleport");

  // Stalls: the stall a cache loc names, the item if named, the league area if one follows.
  assert.deepEqual(trigger("steal-some-bread"), { kind: "steal", stalls: ["Bakery stall"], count: 1, items: ["Bread"] });
  assert.deepEqual(trigger("steal-from-a-fur-stall"), { kind: "steal", stalls: ["Fur stall"], count: 1, area: 4 });
  assert.equal(trigger("steal-from-the-fortis-spice-stall"), undefined, "no loc of that name");
  emit("thieving:success", { player: doer, method: "stall", stall: "Bakery stall", itemId: itemId("Cake") });
  assert.ok(!completed(doer).includes("steal-some-bread"), "another item from the stall");
  emit("thieving:success", { player: doer, method: "stall", stall: "Bakery stall", itemId: itemId("Bread") });
  assert.ok(completed(doer).includes("steal-some-bread"));

  // Fields: the plant picked; several crops each that many; a minigame's sq'irk is none, a ground item picked up is a take.
  assert.deepEqual(trigger("pick-6-flax"), { kind: "pick", plants: ["Flax"], count: 6 });
  assert.deepEqual(trigger("pick-6-wheat-6-cabbages-and-6-potatoes"), { kind: "pick-each", plants: { Wheat: 6, Cabbage: 6, Potato: 6 } });
  assert.equal(trigger("pick-a-winter-sq-irk"), undefined);
  assert.equal(trigger("pick-up-snapegrass").kind, "take");

  // The clue tiers' collection log slots: "Fill 15 slots" and "Gain 10 unique items from Reward casket".
  assert.deepEqual(trigger("fill-15-hard-clue-collection-log-slots"), { kind: "collection-log", category: "Hard Treasure Trails", count: 15 });
  assert.deepEqual(trigger("100-collection-log-slots"), { kind: "collection-log", count: 100 }, "the whole log's slots");
  assert.deepEqual(trigger("gain-a-unique-item-from-a-master-clue"), { kind: "collection-log", category: "Master Treasure Trails", count: 1 });

  // Health checks: the crop type, a cactus by its crop; a place other than its only one is left out.
  assert.deepEqual(trigger("check-a-grown-fruit-tree"), { kind: "check-health", types: ["FRUIT_TREE"], count: 1 });
  assert.deepEqual(trigger("check-a-grown-cactus"), { kind: "check-health", crops: ["CACTUS"], count: 1 });
  assert.deepEqual(trigger("check-the-health-of-5-crystal-trees"), { kind: "check-health", types: ["CRYSTAL_TREE"], count: 5 });

  // Sets: every piece at once, a slot taking either; names as the cache spells them.
  assert.deepEqual(trigger("equip-a-full-rune-set"), { kind: "equip-all", items: ["Rune platebody", "Rune full helm", ["Rune platelegs", "Rune plateskirt"]] });
  assert.deepEqual(trigger("equip-a-full-blue-dragonhide-set").items, ["Blue d'hide body", "Blue d'hide chaps", "Blue d'hide vambraces"]);
  assert.deepEqual(trigger("equip-a-seer-s-ring"), { kind: "equip", items: ["Seers ring"] });

  // The cache's item sets (enum 1034): every piece, any piece, or one whole Barrows set.
  assert.deepEqual(trigger("equip-full-dharoks-armour-set").items, ["Dharok's helm", "Dharok's platebody", "Dharok's platelegs", "Dharok's greataxe"]);
  assert.equal(trigger("equip-any-full-barrows-armour-set").sets.length, 6);
  assert.ok(!trigger("equip-a-piece-of-any-barrows-armour-set").items.includes("Ahrim's staff"), "a weapon is no armour");

  // Minigame completions: the monster their plugin credits, credited events only.
  assert.deepEqual(trigger("complete-the-inferno-5-times"), { kind: "kill", npcs: ["TzKal-Zuk"], count: 5, credited: true });
  assert.deepEqual(trigger("complete-tombs-of-amascut").npcs, ["Tombs of Amascut", "XM: Tombs of Amascut"]);
  assert.equal(trigger("complete-the-corrupted-gauntlet-in-4-30"), undefined, "a time is a condition");

  // "1 Time", "the Kraken Boss", Tempoross subdued, the Doom at any delve level.
  assert.deepEqual(trigger("defeat-amoxliatl-1-time"), { kind: "kill", npcs: ["Amoxliatl"], count: 1, area: 21 });
  assert.deepEqual(trigger("defeat-the-kraken-boss-50-times"), { kind: "kill", npcs: ["Kraken"], count: 50 });
  assert.deepEqual(trigger("defeat-tempoross-1-time"), { kind: "tempoross", count: 1 });
  assert.deepEqual(trigger("defeat-the-doom-of-mokhiatl"), { kind: "kill", npcs: ["Doom of Mokhaiotl"], count: 1, credited: true });

  // Key chests by the key chests plugin's names.
  assert.deepEqual(trigger("open-15-larran-s-chests"), { kind: "open-chest", chests: ["Larran's small chest", "Larran's big chest"], count: 15 });
  assert.deepEqual(trigger("open-the-enhanced-crystal-chest").chests, ["Elven Crystal Chest"]);

  // Farming, Giants' Foundry (a ruined sword is no successful one), snares, Barrows chests.
  assert.deepEqual(trigger("harvest-a-ranarr-weed"), { kind: "harvest", crops: ["RANARR"], count: 1 });
  assert.deepEqual(trigger("plant-an-anima-seed").crops, ["ATTAS", "IASOR", "KRONOS"]);
  assert.deepEqual(trigger("giants-foundry-50-quality-sword"), { kind: "foundry", quality: 50, count: 1 });
  assert.deepEqual(trigger("snare-5-crimson-swifts"), { kind: "hunt", npcs: ["Crimson swift"], count: 5 });
  assert.equal(trigger("snare-a-bird-20-times"), undefined, "any bird is no one creature");
  assert.deepEqual(trigger("loot-a-barrows-chest").npcs, ["Barrows"]);
  emit("giants-foundry:sword-handed-in", { player: doer, quality: 0, swords: 1 });
  assert.equal(doer.getAttribute("league:task-progress")["giants-foundry-10-handins"], undefined, "a ruined sword");
  emit("giants-foundry:sword-handed-in", { player: doer, quality: 60, swords: 2 });
  assert.ok(completed(doer).includes("giants-foundry-50-quality-sword"));
  assert.equal(doer.getAttribute("league:task-progress")["giants-foundry-10-handins"], 1);

  // Pyramid Plunder: a room's Grand Gold Chest.
  assert.deepEqual(trigger("room-8-of-pyramid-plunder-25-times"), { kind: "plunder-chest", room: 8, count: 25 });

  assert.deepEqual(trigger("complete-a-ribbiting-tale"), { kind: "quest", name: "The Ribbiting Tale of a Lily Pad Labour Dispute" }, "the description's full name");
  assert.deepEqual(trigger("complete-the-prison-pete-random-event"), { kind: "random-event", events: ["prison"], count: 1 });
  assert.equal(trigger("complete-the-postie-pete-random-event"), undefined, "its Wiki row describes the Evil twin");
  assert.deepEqual(trigger("fully-decorate-a-maple-totem-in-the-auburn-valley"), { kind: "totem", woods: ["maple"], count: 1 });
  emit("vale-totems:decorated", { player: doer, wood: "oak" });
  assert.ok(!completed(doer).includes("fully-decorate-a-maple-totem-in-the-auburn-valley"), "another wood's totem");
  emit("vale-totems:decorated", { player: doer, wood: "maple" });
  assert.ok(completed(doer).includes("fully-decorate-a-maple-totem-in-the-auburn-valley"));
  assert.deepEqual(trigger("mine-some-runite-ore-with-a-dragon-pickaxe"), { kind: "gather-with", skill: "mining", tools: ["Dragon pickaxe"], count: 1, items: ["Runite ore"], area: 11 });
  assert.deepEqual(trigger("complete-25-hunter-rumours"), { kind: "rumours", count: 25 });
  assert.deepEqual(trigger("floor-5-of-the-hallowed-sepulchre"), { kind: "sepulchre-floor", floor: 5, count: 1 });

  // Group encounters as their plugins credit them.
  assert.deepEqual(trigger("defeat-the-moons-of-peril-25-times"), { kind: "kill", npcs: ["Moons of Peril"], count: 25, credited: true });
  assert.equal(trigger("defeat-the-royal-titans-solo"), undefined, "without any other player joining is a condition");

  // Worn in a league area ("while inside" too).
  assert.deepEqual(trigger("equip-a-pair-of-dragon-boots-in-the-wilderness"), { kind: "equip", items: ["Dragon boots"], area: 11 });
  assert.deepEqual(trigger("equip-a-one-hand-leaf-bladed-weapon-in-tirannwn").items, ["Leaf-bladed sword", "Leaf-bladed battleaxe", "Leaf-bladed spear"]);

  // Prayers by PrayerHandler's names; one this server lacks is left out.
  assert.deepEqual(trigger("use-the-protect-from-melee-prayer"), { kind: "prayer", prayers: ["Protect from Melee"], count: 1 });
  assert.equal(trigger("activate-deadeye"), undefined, "not on this server");

  // Pets: a skilling pet's skill; a boss pet is not told apart from the others.
  assert.deepEqual(trigger("obtain-a-skilling-pet"), { kind: "pet", skilling: true, count: 1 });

  // Slayer, Temple Trekking and Pest Control completions.
  assert.deepEqual(trigger("complete-200-slayer-tasks"), { kind: "slayer-tasks", count: 200 });
  assert.deepEqual(trigger("defeat-25-superior-slayer-creatures"), { kind: "superior-kills", count: 25 });
  assert.deepEqual(trigger("complete-a-medium-temple-trek"), { kind: "temple-trek", difficulty: "medium", count: 1 });
  assert.deepEqual(trigger("complete-a-game-of-intermediate-pest-control").boats, ["intermediate", "veteran"]);

  // Laps: the agility plugin's course keys; a lap reward of several laps counts them all.
  assert.deepEqual(trigger("complete-10-laps-of-the-varlamore-agility-course"), { kind: "agility-laps", courses: ["wyrm-basic", "wyrm-advanced"], count: 10 }, "either Colossal Wyrm course");
  assert.deepEqual(trigger("complete-the-shayzien-basic-agility-course").courses, ["shayzien-basic"], "the name's course where the link's is both");
  assert.equal(trigger("complete-the-prifddinas-agility-course-in-1-10"), undefined, "a timed lap is no count");
  emit("agility:lap", { player: doer, course: "wyrm-basic", laps: 6, count: 6 });
  emit("agility:lap", { player: doer, course: "wyrm-advanced", laps: 3, count: 3 });
  assert.equal(doer.getAttribute("league:task-progress")["complete-10-laps-of-the-varlamore-agility-course"], 9);
  emit("agility:lap", { player: doer, course: "wyrm-advanced", laps: 4, count: 1 });
  assert.ok(completed(doer).includes("complete-10-laps-of-the-varlamore-agility-course"));
  // Yama's stepping stones: a stone is a lap.
  assert.deepEqual(trigger("jump-on-yama-s-stepping-stones-666-times"), { kind: "agility-laps", courses: ["yama-stepping-stones"], count: 666 });
  for (let stone = 1; stone < 666; stone++) emit("agility:lap", { player: doer, course: "yama-stepping-stones", laps: stone, count: 1 });
  assert.ok(!completed(doer).includes("jump-on-yama-s-stepping-stones-666-times"));
  emit("agility:lap", { player: doer, course: "yama-stepping-stones", laps: 666, count: 1 });
  assert.ok(completed(doer).includes("jump-on-yama-s-stepping-stones-666-times"), "the 666th stone");

  // Eating and drinking: the food's item, a potion by its name (any dose), a food's restore.
  assert.deepEqual(trigger("eat-an-onion"), { kind: "eat", items: ["Onion"], count: 1 });
  assert.deepEqual(trigger("eat-a-rabbit").items, ["Cooked rabbit"], "the description's cooked rabbit");
  assert.equal(trigger("drink-a-cup-of-tea-in-auburn-valley"), undefined, "a place is no item");
  emit("food:eaten", { player: doer, itemId: itemId("Onion"), heal: 0, restores: 1 });
  assert.ok(completed(doer).includes("eat-an-onion"), "food:eaten by the item");
  assert.ok(!completed(doer).includes("eat-a-piece-of-food-that-restores-at-least-6-hitpoints"), "an onion restores 1");
  emit("food:eaten", { player: doer, itemId: itemId("Trout"), heal: 0, restores: 7 });
  assert.ok(completed(doer).includes("eat-a-piece-of-food-that-restores-at-least-6-hitpoints"), "what it restores, at full health too");
  emit("potions:drunk", { player: doer, itemId: itemId("Strength potion(3)"), name: "Strength potion" });
  assert.ok(completed(doer).includes("drink-a-strength-potion"));

  const main = character("plain-doer", "main");
  emit("mining:success", { player: main, itemId: itemId("Tin ore") });
  assert.deepEqual(main.getAttribute("league:task-progress") ?? {}, {}, "a main character counts nothing");
});

/** A real cache NPC dying to `player` through the death hook. */
function killReal(player, npcId) {
  const npc = new core.NPC(npcId, new core.Location(3300, 3900, 0));
  hooks.onNpcDeath({ killer: player, npc, npcId, location: { x: 3300, y: 3900, z: 0 } });
}

const creditedKill = (player, monster) => {
  for (const handler of custom["combat-achievements:kill"]) handler({ player, monster });
};

test("a kill task counts every boss its description accepts: Callisto or Artio, combined", () => {
  const task = TRL.find((entry) => entry.id === "defeat-callisto-50-times");
  assert.equal(task.description, "Defeat Callisto or Artio 50 times.", "Wiki");
  assert.deepEqual(task.trigger, { kind: "kill", npcs: ["Callisto", "Artio"], count: 50 }, "both, from the description");
  assert.deepEqual(TRL.find((entry) => entry.id === "defeat-vet-ion-50-times").trigger.npcs, ["Vet'ion", "Calvar'ion"]);
  assert.deepEqual(TRL.find((entry) => entry.id === "defeat-venenatis-50-times").trigger.npcs, ["Venenatis", "Spindel"]);
  const league = character("wildyboss");
  for (let i = 0; i < 25; i++) killReal(league, core.NpcIdentifiers.ARTIO);
  for (let i = 0; i < 24; i++) killReal(league, core.NpcIdentifiers.CALLISTO);
  assert.equal(league.getAttribute("league:task-kills")[task.id], 49);
  assert.ok(!completed(league).includes(task.id));
  killReal(league, core.NpcIdentifiers.CALLISTO);
  assert.ok(completed(league).includes(task.id), "25 Artio and 25 Callisto make 50");
});

test("a kill reported both by the death and by the credited-kill event counts once", () => {
  // Artio dies as an NPC and its plugin credits the kill to its main boss, Callisto.
  const league = character("doublereport");
  for (let i = 0; i < 25; i++) {
    killReal(league, core.NpcIdentifiers.ARTIO);
    creditedKill(league, "Callisto");
  }
  assert.equal(league.getAttribute("league:task-kills")["defeat-callisto-50-times"], 25, "25 kills, not 50");
  assert.ok(!completed(league).includes("defeat-callisto-50-times"));
});

test("the Nightmare's real ending, which kills no NPC, credits her kill tasks for each rewarded player", () => {
  const NightmareCommon = require("../plugins/bosses/nightmare/Common.Nightmare");
  NightmareCommon.init(api);
  const { Fight } = require("../plugins/bosses/nightmare/Fight.Nightmare");
  const league = character("dreamer");
  const friend = character("dreamfriend");
  // won() rewards every player present and calls count() for each: the production credit producer
  // (its own kill count, varp, messages and the credited-kill event), here without the arena.
  const nightmare = { phosani: false };
  const phosani = { phosani: true };
  const count = (fight, player, team) => Fight.prototype.count.call(fight, player, 300, team);
  const task = TRL.find((entry) => entry.id === "defeat-the-nightmare-50-times");
  assert.deepEqual(task.trigger.npcs, ["The Nightmare", "Phosani's Nightmare"], "Wiki: 50 times combined");
  for (let i = 0; i < 25; i++) for (const player of [league, friend]) count(nightmare, player, 2);
  for (let i = 0; i < 24; i++) count(phosani, league, 1);
  assert.equal(league.getAttribute("nightmare:kills"), 25, "the encounter's own count");
  assert.equal(league.getAttribute("league:task-kills")[task.id], 49);
  assert.ok(!completed(league).includes(task.id));
  count(phosani, league, 1);
  assert.ok(completed(league).includes(task.id), "25 Nightmare and 25 Phosani's Nightmare make 50");
  assert.equal(friend.getAttribute("league:task-kills")[task.id], 25, "each rewarded player is credited");
});

test("level triggers fire on a level-up and are caught up at login", () => {
  const league = character("leveller");
  levelUp(league, Skill.ATTACK, 5);
  assert.ok(completed(league).includes("achieve-your-first-level-up"));
  assert.ok(completed(league).includes("achieve-your-first-level-5"), "Attack 5 counts; the starting Agility 10 did not");
  assert.ok(!completed(league).includes("achieve-your-first-level-10"));
  levelUp(league, Skill.ATTACK, 99);
  assert.ok(completed(league).includes("reach-level-99-attack"));
  assert.ok(completed(league).includes("achieve-your-first-level-95"));
  assert.ok(completed(league).includes("reach-combat-level-25"), "99 Attack is combat level 35");
  assert.ok(!completed(league).includes("reach-combat-level-50"));
  assert.ok(!completed(league).includes("reach-total-level-250"));
  for (const skill of Skill.values()) if (skill !== Skill.SAILING) setLevel(league, skill, 20);
  levelUp(league, Skill.COOKING, 21);
  assert.ok(completed(league).includes("reach-base-level-20"));
  assert.ok(completed(league).includes("reach-total-level-250"), "23 skills at 20 or more");

  const veteran = character("veteran", "league", { login: false });
  setLevel(veteran, Skill.MINING, 50);
  hooks.onPlayerLogin({ player: veteran, username: "veteran", isNewAccount: true, profile: "league" });
  assert.ok(completed(veteran).includes("achieve-your-first-level-50"), "already qualified at login");
  assert.ok(!completed(veteran).includes("achieve-your-first-level-up"), "a level-up itself is only ever an event");
});

test("a quest trigger fires on quest:completed by name and is caught up at login", () => {
  const league = character("quester");
  for (const handler of custom["quest:completed"]) handler({ player: league, key: "gertrudes-cat", quest: { name: "Gertrude's Cat" } });
  assert.deepEqual(completed(league), ["complete-gertrude-s-cat"]);
  completedQuests.add("Sheep Shearer");
  const shearer = character("shearer");
  completedQuests.clear();
  assert.deepEqual(completed(shearer), ["complete-sheep-shearer"]);
});

test("league:complete-task and ::leaguetask complete a catalog task once; a main character sees nothing", () => {
  const league = character("completer");
  const complete = (id) => { const request = { player: league, id }; for (const handler of custom["league:complete-task"]) handler(request); return request; };
  assert.deepEqual([complete("reach-total-level-100").found, complete("reach-total-level-100").completed], [true, false], "found, done once, then refused");
  assert.equal(complete("no-such-task").found, false);
  assert.equal(points(league), 10);
  hooks["command:leaguetask"]({ player: league, parts: ["leaguetask", "defeat-a-guard"] });
  assert.equal(league.sent.messages.at(-1), "Completed league task defeat-a-guard for completer.");
  hooks["command:leaguetask"]({ player: league, parts: ["leaguetask", "defeat-a-guard"] });
  assert.equal(league.sent.messages.at(-1), "completer already has league task defeat-a-guard.");
  assert.equal(league.sent.varps.get(bitVarp(indexOf("defeat-a-guard"))) & (1 << (indexOf("defeat-a-guard") % 32)), 1 << (indexOf("defeat-a-guard") % 32), "a points change re-syncs the bits");
  hooks["command:leaguetask"]({ player: league, parts: ["leaguetask", "adhoc", "25"] });
  assert.equal(league.sent.messages.at(-1), "Awarded league task adhoc (25 points) to completer.", "an id outside the catalog still takes points");
  assert.equal(points(league), 45);
  hooks["command:leaguetasks"]({ player: league, parts: ["leaguetasks", "guard"] });
  assert.ok(league.sent.messages.some((text) => text.startsWith("defeat-a-guard - Defeat a Guard (Easy, 10 points, done)")));

  const main = character("mainchar", "main");
  assert.equal(main.sent.content.length, 0, "no catalog");
  assert.equal(main.sent.varps.has(2616), false, "no completion varps");
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 36)}`]({ player: main }), false);
  kill(main, "Goblin");
  assert.equal(main.getAttribute("league:tasks"), undefined);
  const request = { player: main, id: "defeat-a-goblin" };
  for (const handler of custom["league:complete-task"]) handler(request);
  assert.deepEqual([request.found, request.completed], [false, false]);
});
