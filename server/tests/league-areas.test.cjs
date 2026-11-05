// Run after `yarn build`: node --test tests/league-areas.test.cjs
// League areas (docs/leagues.md, Areas): the defaults a league character starts with, the map
// squares each area owns, a refused walk, teleport and respawn into a locked area, an unlock at
// the threshold (and not before, nor past the third pick), the area interface's captured flow,
// its teleport, and a reload.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { GameConstants } = require("../dist/game/GameConstants");

const AREAS = 512;
const SIDE_PANEL = 656;
const SELECTION = [10662, 10663, 10664, 10665, 10666, 10667];
const LAST_VIEWED = 11693;
const AVAILABLE = 11695;
const THRESHOLD_STRUCTS = [5971, 5972, 5973, 5974, 5975];
const MISTHALIN = 1, KARAMJA = 2, ASGARNIA = 3, KANDARIN = 4, MORYTANIA = 5, DESERT = 6, TIRANNWN = 7, FREMENNIK = 8, WILDERNESS = 11, KOUREND = 20, VARLAMORE = 21;
const uid = (group, child) => (group << 16) | child;

let core;
const hooks = {};
const custom = {};
const emitted = [];
let inCombat = false;
/** world.json pluginConfig "league:type": a Trailblazer Reloaded world, 5 while a Raging Echoes character is made. */
let worldLeague = 4;
/** The characters whose first grave's tutorial with Death is running. */
const inDeathTutorial = new Set();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league"); // a league world
  core.TeleportHandler.checkReqs = () => true;
  core.CombatFactory.inCombat = () => inCombat;
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
    persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value),
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onObjectFirstClick: (id, handler) => (hooks[`object:${id}`] = handler),
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
  require("../plugins/modes/LeagueAreaUnlocks.plugin").register(api);
  require("../plugins/areas/DeathsOffice.plugin").register(api);
  // The Gravestones plugin's answer, as far as Death's Office asks it here.
  api.onCustomEvent("gravestones:state", (state) => (state.inTutorial = inDeathTutorial.has(state.player)));
});

/** A real player whose packets are recorded; logged in as a new character of `profile`. */
function character(name, profile = "league", { login = true, restore = null } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  if (restore) restore.applyToPlayer(player);
  const sent = { messages: [], varbits: new Map(), scripts: [], subs: [], flags: [], sounds: [], content: [], removals: 0 };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendInterfaceScript": return (id, args) => (sent.scripts.push([id, args]), sender);
        case "sendSubInterface": return (target, group) => (sent.subs.push([target, group]), sender);
        case "sendInterface": return (group) => (sent.subs.push(["main", group]), sender);
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
  if (login) hooks.onPlayerLogin({ player, username: name, isNewAccount: !restore, profile });
  return Object.assign(player, { sent });
}

function completeTasks(player, count) {
  for (let i = 0; i < count; i++) {
    hooks["command:leaguetask"]({ player, parts: ["leaguetask", `task-${i}-${Math.random()}`, "10"] });
  }
}

const query = (name, payload) => {
  for (const handler of custom[name]) handler(payload);
  return payload;
};

const areaAt = (x, y, extra = {}) => query("league:area-at", { x, y, ...extra }).area;
const at = (x, y, z = 0) => new core.Location(x, y, z);
const popups = (title) => emitted.filter(([name, payload]) => name === "notification:show" && payload.title === title).map(([, payload]) => payload);
const thresholds = (player) => {
  const structs = new Map(player.sent.content.at(-1).find((entry) => entry.key === "structOverrides").rows.map((row) => [row.structId, row.params]));
  return THRESHOLD_STRUCTS.map((id) => structs.get(id)[1010]);
};

function openAreas(player) {
  return hooks[`button:${uid(SIDE_PANEL, 40)}`]({ player });
}

function viewArea(player, area) {
  const button = areaButton(area);
  return hooks[`button:${button}`]({ player, buttonId: button });
}

/** The shield component of an area, from the plugin's own data (the cache's region_data table). */
function areaButton(area) {
  return require("../plugins/modes/leagueareas/Common.LeagueAreaUnlocks").area(area).shield;
}

test("a new league character starts with Misthalin and Karamja; a main character has no areas", () => {
  const league = character("starter");
  assert.deepEqual(league.getAttribute("league:areas"), [MISTHALIN, KARAMJA]);
  assert.deepEqual(SELECTION.map((varbit) => league.sent.varbits.get(varbit)), [1, 2, 0, 0, 0, 0], "league_area_selection_0..5");
  assert.equal(league.sent.varbits.get(LAST_VIEWED), 0);
  assert.equal(league.sent.varbits.get(AVAILABLE), 0, "no pick affordable yet");
  assert.deepEqual(thresholds(league), [0, 0, 60, 140, 300], "Wiki: Trailblazer Reloaded's unlocks at 60, 140 and 300 tasks");
  const structs = league.sent.content.at(-1).find((entry) => entry.key === "structOverrides").rows.map((row) => row.structId);
  assert.ok(structs.includes(4699) && structs.includes(5971), "one packet carries the relic catalog and the area thresholds");
  assert.equal(areaAt(league.getLocation().getX(), league.getLocation().getY()), MISTHALIN, "a new character starts in Misthalin (this world's spawn is on the Wilderness ditch)");
  const areas = query("league:areas", { player: league });
  assert.deepEqual([areas.league, areas.unlocked, areas.next, areas.available], [4, [1, 2], { slot: 2, tasks: 60 }, false]);

  const main = character("mainstarter", "main");
  assert.equal(main.getAttribute("league:areas"), undefined);
  assert.equal(main.sent.varbits.has(SELECTION[0]), false);
  assert.deepEqual(query("league:areas", { player: main }).unlocked, []);

  worldLeague = 5;
  const echoes = character("echoesstarter");
  worldLeague = 4;
  assert.deepEqual(thresholds(echoes), [0, 0, 90, 200, 400], "Wiki: Raging Echoes' unlocks at 90, 200 and 400 tasks");
});

test("login leaves leagues without area rules untouched, including saved area state after reload", () => {
  for (const type of [1, 2, 3]) {
    for (const savedAreas of [null, [MISTHALIN, KARAMJA, ASGARNIA]]) {
      const name = `no-areas-${type}-${savedAreas ? "saved" : "new"}`;
      const player = character(name, "league", { login: false });
      player.setAttribute("league:type", type);
      if (savedAreas) player.setAttribute("league:areas", [...savedAreas]);
      const start = at(2662, 3305); // A supported area league would correct this locked location.
      player.setLocation(start.clone());
      const login = (target) => hooks.onPlayerLogin({ player: target, username: name, isNewAccount: false, profile: "league" });
      assert.doesNotThrow(() => login(player), `league ${type} has no configured area defaults`);
      for (const target of [player, character(name, "league", { login: false, restore: PlayerSave.fromPlayer(player) })]) {
        // PlayerSave restores the registered [] default even when the original attribute was absent.
        const expectedAreas = savedAreas ?? (target === player ? undefined : []);
        assert.deepEqual(target.getAttribute("league:areas"), expectedAreas);
        assert.doesNotThrow(() => login(target), `league ${type} remains safe after save/reload`);
        assert.deepEqual(target.getAttribute("league:areas"), expectedAreas, "area state is neither created nor erased");
        assert.ok(target.getLocation().equals(start), "login does not relocate a mode without area restrictions");
        for (const varbit of [...SELECTION, LAST_VIEWED, AVAILABLE]) {
          assert.equal(target.sent.varbits.has(varbit), false, `no area varbit ${varbit}`);
        }
        const areaState = query("league:areas", { player: target });
        assert.deepEqual([areaState.league, areaState.unlocked, areaState.next, areaState.available], [null, [], null, false]);
        const teleport = { player: target, destination: at(3290, 3180), allow: null };
        hooks.onCanTeleport(teleport);
        assert.equal(teleport.allow, null, "area enforcement stays inactive");
      }
    }
  }
});

test("both supported area leagues initialize defaults and restore saved unlocks through the real save API", () => {
  const previousLeague = worldLeague;
  try {
    for (const type of [4, 5]) {
      worldLeague = type;
      const player = character(`area-mode-${type}`);
      assert.deepEqual(player.getAttribute("league:areas"), [MISTHALIN, KARAMJA]);
      player.setAttribute("league:areas", [MISTHALIN, KARAMJA, MORYTANIA]);
      player.setLocation(at(3495, 3491));
      const restored = character(`area-mode-${type}`, "league", { restore: PlayerSave.fromPlayer(player) });
      assert.deepEqual(restored.getAttribute("league:areas"), [MISTHALIN, KARAMJA, MORYTANIA]);
      assert.ok(restored.getLocation().equals(at(3495, 3491)), "an unlocked region stays open after reload");
      assert.deepEqual(SELECTION.map((id) => restored.sent.varbits.get(id)), [1, 2, MORYTANIA, 0, 0, 0]);
      const teleport = { player: restored, destination: at(3290, 3180), allow: null };
      hooks.onCanTeleport(teleport);
      assert.equal(teleport.allow, false, "locked areas remain enforced");
    }
  } finally {
    worldLeague = previousLeague;
  }
});

test("the map squares follow the Wiki's areas; instances and the places open to everyone belong to none", () => {
  const landmarks = [
    ["Lumbridge Castle", 3222, 3218, MISTHALIN], ["Varrock", 3212, 3428, MISTHALIN], ["Edgeville", 3093, 3493, MISTHALIN],
    ["Fossil Island", 3740, 3800, MISTHALIN], ["Zanaris", 2412, 4434, MISTHALIN], ["Paterdomus", 3410, 3485, MISTHALIN],
    ["Brimhaven", 2777, 3173, KARAMJA], ["Crandor", 2840, 3260, KARAMJA], ["Mor Ul Rek", 2480, 5100, KARAMJA],
    ["Falador", 2965, 3380, ASGARNIA], ["Entrana", 2830, 3350, ASGARNIA], ["Port Sarim", 3025, 3215, ASGARNIA],
    ["Taverley Dungeon", 2900, 9800, ASGARNIA], ["Burthorpe", 2900, 3540, ASGARNIA], ["the Monastery", 3052, 3490, ASGARNIA],
    ["Ardougne", 2662, 3305, KANDARIN], ["Catherby", 2810, 3440, KANDARIN], ["Ape Atoll", 2760, 2760, KANDARIN],
    ["Castle Wars", 2440, 3090, KANDARIN], ["Piscatoris", 2340, 3690, KANDARIN], ["Yanille", 2600, 3090, KANDARIN],
    ["Canifis", 3495, 3491, MORYTANIA], ["Mos Le'Harmless", 3680, 2970, MORYTANIA], ["Burgh de Rott", 3500, 3180, MORYTANIA],
    ["Al Kharid", 3290, 3180, DESERT], ["Nardah", 3430, 2900, DESERT], ["the Duel Arena", 3360, 3230, DESERT],
    ["Lletya", 2340, 3160, TIRANNWN], ["Prifddinas", 3260, 6080, TIRANNWN], ["the Underground Pass", 2420, 9700, TIRANNWN],
    ["Rellekka", 2661, 3657, FREMENNIK], ["Lunar Isle", 2110, 3915, FREMENNIK], ["Keldagrim", 2880, 10200, FREMENNIK], ["Weiss", 2870, 3940, FREMENNIK],
    ["Ferox Enclave", 3140, 3630, WILDERNESS], ["north of the ditch", 3090, 3525, WILDERNESS], ["the Frozen Waste Plateau", 2970, 3930, WILDERNESS],
    ["Mudskipper Point", 2990, 3110, ASGARNIA], ["Musa Point's dock", 2956, 3146, KARAMJA], ["Ghorrock", 2920, 3900, FREMENNIK],
    ["the Varrock sewers", 3240, 9870, MISTHALIN], ["the Stronghold of Security's second floor", 2020, 5220, MISTHALIN],
    ["Kourend Castle", 1620, 3660, KOUREND], ["Mount Karuulm", 1310, 3830, KOUREND],
    ["Civitas illa Fortis", 1700, 3140, VARLAMORE], ["Aldarin", 1400, 2950, VARLAMORE],
    ["Death's Office", 3176, 5726, null], ["the rune essence mine", 2910, 4830, null], ["Tutorial Island", 3094, 3107, null],
  ];
  for (const [name, x, y, expected] of landmarks) {
    assert.equal(areaAt(x, y), expected, `${name} (${x}, ${y})`);
  }
  assert.equal(query("league:area-at", { x: 3222, y: 3218 }).name, "Misthalin");
  assert.equal(areaAt(1200, 3350), KOUREND, "the Stranglewood counts as Kourend in Trailblazer Reloaded");
  assert.equal(areaAt(1200, 3350, { league: 5 }), VARLAMORE, "and as Varlamore in Raging Echoes");
  assert.equal(areaAt(3000, 3000, { league: 99 }), null, "no league, no areas");
});

test("a locked area refuses a walk, a teleport and a respawn; open ground and a main character are untouched", () => {
  const league = character("walker");
  const lumbridgeSide = at(3263, 3220);
  const alKharidSide = at(3265, 3220);
  league.moveTo(alKharidSide);
  hooks.onPlayerMapSquareChange({ player: league, previous: lumbridgeSide, location: alKharidSide });
  assert.ok(league.getLocation().equals(lumbridgeSide), "the step into Al Kharid's square is undone");
  assert.equal(league.sent.messages.at(-1), "You haven't unlocked that area yet.");

  const teleport = { player: league, destination: at(3290, 3180), allow: null };
  hooks.onCanTeleport(teleport);
  assert.equal(teleport.allow, false, "a teleport to Al Kharid is refused");
  const open = { player: league, destination: at(3222, 3218), allow: null };
  hooks.onCanTeleport(open);
  assert.equal(open.allow, null, "a teleport to Lumbridge is nobody's business");

  const office = at(3176, 5726);
  league.moveTo(office);
  hooks.onPlayerMapSquareChange({ player: league, previous: lumbridgeSide, location: office });
  assert.ok(league.getLocation().equals(office), "Death's Office is open from everywhere");

  // A ladder, boat or dialogue into a locked area goes back to where it started.
  const ardougne = at(2662, 3305);
  league.moveTo(ardougne);
  hooks.onPlayerMapSquareChange({ player: league, previous: office, location: ardougne });
  assert.ok(league.getLocation().equals(office), "a jump into Kandarin returns to its start");

  // A respawn another plugin sent into a locked area goes to the league home instead.
  league.moveTo(ardougne);
  query("player:respawn", { player: league, killer: null, handled: true });
  const home = league.getLocation();
  assert.equal(areaAt(home.getX(), home.getY()), MISTHALIN, "the respawn lands in Misthalin");
  assert.notEqual(areaAt(core.WorldDefinition.WORLD_SPAWN.getX(), core.WorldDefinition.WORLD_SPAWN.getY()), MISTHALIN, "(this world's spawn is in another area, so the hub stands in)");

  // The default respawn into a locked spawn is handled the same way.
  const dead = { player: league, killer: null, handled: false };
  query("player:respawn", dead);
  assert.equal(dead.handled, true);
  assert.equal(areaAt(league.getLocation().getX(), league.getLocation().getY()), MISTHALIN);

  // A death flags the player: a respawn handler after ours that lands them in a locked area still goes home.
  hooks.onPlayerDeath({ player: league, killer: null, handled: false });
  league.moveTo(ardougne);
  hooks.onPlayerMapSquareChange({ player: league, previous: office, location: ardougne });
  assert.equal(areaAt(league.getLocation().getX(), league.getLocation().getY()), MISTHALIN, "home, not back to the death spot");
  // A death a minigame handled itself (no respawn event) leaves no flag behind after its tick.
  hooks.onPlayerDeath({ player: league, killer: null, handled: true });
  core.TaskManager.process();
  league.moveTo(ardougne);
  hooks.onPlayerMapSquareChange({ player: league, previous: office, location: ardougne });
  assert.ok(league.getLocation().equals(office), "back to the start, not home: the flag is gone");

  // A crossing that starts from a locked square (the data changed under a saved character) goes home, once.
  const stepper = character("stepper");
  let moves = 0;
  stepper.moveTo = function (destination) {
    const previous = this.getLocation().clone();
    Player.prototype.moveTo.call(this, destination);
    assert.ok(++moves < 10, "the correction must not chain");
    hooks.onPlayerMapSquareChange({ player: this, previous, location: this.getLocation() }); // as World.onPlayerMoved does
  };
  Player.prototype.moveTo.call(stepper, at(3290, 3180)); // Al Kharid, locked
  stepper.moveTo(at(3330, 3230)); // the Duel Arena's square, locked too
  assert.equal(areaAt(stepper.getLocation().getX(), stepper.getLocation().getY()), MISTHALIN, "home, since neither square is open");
  assert.equal(moves, 2, "the step and one correction");
  assert.equal(stepper.sent.messages.filter((text) => text === "You haven't unlocked that area yet.").length, 1);

  const main = character("mainwalker", "main");
  main.moveTo(alKharidSide);
  hooks.onPlayerMapSquareChange({ player: main, previous: lumbridgeSide, location: alKharidSide });
  assert.ok(main.getLocation().equals(alKharidSide), "a main character walks anywhere");
  const mainTeleport = { player: main, destination: at(3290, 3180), allow: null };
  hooks.onCanTeleport(mainTeleport);
  assert.equal(mainTeleport.allow, null);
});

test("View Areas opens the interface as captured; an area's details show its state", () => {
  const league = character("viewer");
  assert.equal(openAreas(league), true);
  assert.deepEqual(league.sent.subs.at(-1), ["main", AREAS], "opened as the main modal");
  assert.deepEqual(league.sent.flags.at(-1), [uid(AREAS, 7), 10, 18, 2], "if_setevents on league_menu_frame as captured");
  assert.equal(league.sent.content.length, 2, "the league's content is sent again before the interface opens");

  assert.equal(viewArea(league, MISTHALIN), true);
  assert.equal(league.sent.varbits.get(LAST_VIEWED), MISTHALIN);
  let [script, args] = league.sent.scripts.at(-1);
  assert.equal(script, 3668);
  assert.equal(args.length, 24);
  assert.equal(args[0], MISTHALIN);
  assert.deepEqual(args.slice(1, 4), [uid(AREAS, 14), uid(AREAS, 39), uid(AREAS, 38)]);
  assert.equal(args[11], 1, "unlocked: the details offer Teleport");
  assert.deepEqual(args.slice(12, 15), [uid(AREAS, 68), uid(AREAS, 67), uid(AREAS, 12)], "rev 237: league_tab_info_scrollbar, _content, confirm");
  assert.equal(args[23], "");

  viewArea(league, ASGARNIA);
  assert.equal(league.sent.scripts.at(-1)[1][11], 0, "locked: more tasks needed");
  viewArea(league, VARLAMORE);
  [, args] = league.sent.scripts.at(-1);
  assert.deepEqual([args[11], args[23]], [3, "That area is not part of this league."], "not this league's: a message");

  assert.equal(hooks[`button:${uid(AREAS, 44)}`]({ player: league }), true, "the name header shows the last viewed area again");
  assert.equal(league.sent.scripts.at(-1)[1][0], VARLAMORE);

  const main = character("mainviewer", "main");
  assert.equal(openAreas(main), false);
  assert.equal(main.sent.subs.length, 0);

  const forger = character("forger");
  completeTasks(forger, 60);
  assert.equal(viewArea(forger, ASGARNIA), false, "a shield click without View Areas is ignored");
  assert.equal(hooks[`button:${uid(AREAS, 62)}`]({ player: forger }), false, "so is a confirm");
  assert.deepEqual(forger.getAttribute("league:areas"), [1, 2]);
  openAreas(forger);
  assert.equal(hooks[`button:${uid(AREAS, 62)}`]({ player: forger }), true);
  assert.equal(forger.sent.messages.at(-1), "Select an area first.");
});

test("a pick needs the next slot's tasks, then plays the captured unlock; at most three picks, none outside the league", () => {
  const league = character("picker");
  openAreas(league);
  viewArea(league, ASGARNIA);
  const confirm = () => hooks[`button:${uid(AREAS, 62)}`]({ player: league });

  emitted.length = 0;
  completeTasks(league, 59);
  assert.equal(popups("New Area Available!").length, 0);
  assert.equal(league.sent.varbits.get(AVAILABLE), 0);
  confirm();
  assert.equal(league.sent.messages.at(-1), "You need to complete more tasks to unlock this area.");
  assert.deepEqual(league.getAttribute("league:areas"), [1, 2], "nothing written");

  completeTasks(league, 1);
  const available = popups("New Area Available!");
  assert.equal(available.length, 1, "the 60th task shows the popup");
  assert.deepEqual([available[0].text, available[0].colour, available[0].jingle], ["You've completed enough tasks to unlock a new area!", 16742144, { id: 283, length: 4500 }]);
  assert.equal(league.sent.varbits.get(AVAILABLE), 1, "league_area_available");
  completeTasks(league, 1);
  assert.equal(popups("New Area Available!").length, 1, "not again");
  viewArea(league, ASGARNIA);
  assert.equal(league.sent.scripts.at(-1)[1][11], 2, "available: the details offer Unlock");

  emitted.length = 0;
  league.sent.sounds.length = 0;
  league.sent.messages.length = 0;
  confirm();
  assert.deepEqual(league.getAttribute("league:areas"), [1, 2, ASGARNIA], "saved at once");
  assert.equal(league.getAnimation()?.getId(), 8792, "trailblazer_league_area_unlock_emote");
  assert.equal(league.getGraphic()?.getId(), 2624, "league_4_area_unlock_emote_spotanim_asgarnia");
  assert.equal(league.sent.removals, 1, "the modal closes");
  assert.deepEqual(league.sent.sounds, [[2353, 1, 24], [2344, 1, 116], [2330, 1, 241], [2331, 1, 273]]);
  assert.equal(league.sent.varbits.get(SELECTION[2]), 0, "the slot's varbit waits for the emote");
  assert.equal(league.sent.messages.length, 0);
  const event = emitted.find(([name]) => name === "league:area-unlocked")[1];
  assert.deepEqual([event.league, event.area, event.slot], [4, ASGARNIA, 2], "the event is immediate");

  for (let tick = 0; tick < 14; tick++) core.TaskManager.process();
  assert.equal(league.sent.varbits.get(SELECTION[2]), ASGARNIA, "league_area_selection_2 after fourteen ticks");
  assert.equal(league.sent.messages.at(-1), "Congratulations, you've unlocked a new area: <col=FF7700>Asgarnia</col>.");
  assert.deepEqual(league.sent.subs.at(-1), ["main", AREAS], "the interface opens again");
  const unlocked = popups("Area Unlocked!");
  assert.deepEqual([unlocked[0].text, unlocked[0].jingle], ["You have unlocked the <col=ffffff>Asgarnia</col> area.", { id: 281, length: 4500 }]);
  assert.equal(league.sent.varbits.get(AVAILABLE), 0, "the next slot needs 140 tasks");

  const falador = at(2965, 3380);
  league.moveTo(falador);
  hooks.onPlayerMapSquareChange({ player: league, previous: at(3060, 3380), location: falador });
  assert.ok(league.getLocation().equals(falador), "Asgarnia is open now");
  const teleport = { player: league, destination: at(2965, 3380), allow: null };
  hooks.onCanTeleport(teleport);
  assert.equal(teleport.allow, null);

  viewArea(league, ASGARNIA);
  confirm();
  assert.equal(league.sent.messages.at(-1), "You have already unlocked this area.");
  viewArea(league, KANDARIN);
  confirm();
  assert.equal(league.sent.messages.at(-1), "You need to complete more tasks to unlock this area.", "the second pick needs 140 tasks");
  completeTasks(league, 80);
  viewArea(league, VARLAMORE);
  confirm();
  assert.equal(league.sent.messages.at(-1), "That area is not part of this league.");
  hooks["command:areas"]({ player: league, parts: ["areas", "Kandarin"] });
  assert.deepEqual(league.getAttribute("league:areas"), [1, 2, ASGARNIA, KANDARIN], "::area by name");
  for (let tick = 0; tick < 14; tick++) core.TaskManager.process();
  completeTasks(league, 160);
  hooks["command:areas"]({ player: league, parts: ["areas", String(MORYTANIA)] });
  assert.deepEqual(league.getAttribute("league:areas"), [1, 2, ASGARNIA, KANDARIN, MORYTANIA], "::area by id");
  for (let tick = 0; tick < 14; tick++) core.TaskManager.process();
  assert.deepEqual(SELECTION.map((varbit) => league.sent.varbits.get(varbit)), [1, 2, 3, 4, 5, 0]);
  viewArea(league, DESERT);
  assert.equal(league.sent.scripts.at(-1)[1][11], 4, "no slot left");
  confirm();
  assert.equal(league.sent.messages.at(-1), "You cannot unlock any more areas.");
  assert.equal(query("league:areas", { player: league }).next, null);
  hooks["command:areas"]({ player: league, parts: ["areas"] });
  assert.match(league.sent.messages.at(-1), /^Trailblazer Reloaded: Misthalin, Karamja, Asgarnia, Kandarin, Morytania\. No unlocks left \(301 tasks done\)\. You are in Asgarnia\.$/);

  const main = character("mainpicker", "main");
  hooks["command:areas"]({ player: main, parts: ["areas", "Asgarnia"] });
  assert.equal(main.sent.messages.at(-1), "Only a league character can unlock areas.");
  assert.equal(main.getAttribute("league:areas"), undefined);
});

test("the details' Teleport casts to an unlocked area's hub (the cache's coord), never to a locked one", () => {
  const league = character("traveller");
  league.setRegistered(true);
  openAreas(league);
  viewArea(league, ASGARNIA);
  assert.equal(hooks[`button:${uid(AREAS, 84)}`]({ player: league }), false, "locked: nothing happens");
  viewArea(league, KARAMJA);
  const start = league.getLocation().clone();
  assert.equal(hooks[`button:${uid(AREAS, 84)}`]({ player: league }), true);
  assert.equal(league.sent.removals, 1, "the modal closes");
  for (let tick = 0; tick < 26; tick++) core.TaskManager.process();
  const landed = league.getLocation();
  assert.ok(!landed.equals(start), "the cast landed");
  assert.ok(Math.abs(landed.getX() - 2777) <= 2 && Math.abs(landed.getY() - 3173) <= 2, `Brimhaven, within two tiles of the table's hub: ${landed.getX()}, ${landed.getY()}`);

  inCombat = true;
  openAreas(league);
  viewArea(league, MISTHALIN);
  assert.equal(hooks[`button:${uid(AREAS, 84)}`]({ player: league }), false);
  assert.equal(league.sent.messages.at(-1), "You can't teleport while in combat.");
  assert.equal(league.sent.removals, 1, "a refusal in combat keeps the interface open");
  inCombat = false;
  league.setRegistered(false);

  // Raging Echoes plays its captured cast: the first echoes animation a tick in, landing at +21.
  worldLeague = 5;
  const echoes = character("echoestraveller");
  worldLeague = 4;
  echoes.setRegistered(true);
  openAreas(echoes);
  viewArea(echoes, KARAMJA);
  assert.equal(hooks[`button:${uid(AREAS, 84)}`]({ player: echoes }), true);
  const from = echoes.getLocation().clone();
  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(echoes.getAnimation()?.getId(), 11875, "home_teleport_human_echoes_1");
  assert.equal(echoes.getGraphic()?.getId(), 3180, "vfx_league_5_home_teleport_01");
  for (let tick = 2; tick < 21; tick++) core.TaskManager.process();
  assert.ok(echoes.getLocation().equals(from), "still casting at +20");
  core.TaskManager.process();
  assert.ok(!echoes.getLocation().equals(from), "landed at +21");
  echoes.setRegistered(false);
});

test("Demonic Pacts: Varlamore to start, Misthalin shut but Zanaris and the Abyss open, Karamja first at 80 tasks, its own cast", () => {
  worldLeague = 6;
  const pacts = character("pactsareas");
  worldLeague = 4;
  assert.deepEqual(pacts.getAttribute("league:areas"), [VARLAMORE], "Varlamore, the only default");
  assert.ok(pacts.getLocation().equals(at(1503, 5602)), "a new character begins in Yama's Lair, as recorded");
  assert.deepEqual(SELECTION.map((varbit) => pacts.sent.varbits.get(varbit)), [VARLAMORE, 0, 0, 0, 0, 0]);
  const open = (x, y) => query("league:area-at", { x, y, player: pacts });
  assert.equal(open(3222, 3218).area, MISTHALIN, "Lumbridge is Misthalin's");
  assert.equal(query("league:areas", { player: pacts }).next?.tasks, 80, "the cache's own thresholds");
  assert.equal(areaAt(2412, 4434, { league: 6 }), null, "Zanaris is open from everywhere");
  assert.equal(areaAt(3040, 4839, { league: 6 }), null, "and the Abyss");
  assert.equal(areaAt(2412, 4434, { league: 5 }), MISTHALIN, "Raging Echoes keeps them Misthalin's");
  assert.equal(areaAt(1150, 3420, { league: 6 }), VARLAMORE, "the Stranglewood counts as Varlamore");

  openAreas(pacts);
  completeTasks(pacts, 80);
  viewArea(pacts, ASGARNIA);
  let [, args] = pacts.sent.scripts.at(-1);
  assert.deepEqual([args[11], args[23]], [3, "Your first new area must be Karamja."], "the first pick is Karamja's");
  viewArea(pacts, MISTHALIN);
  assert.equal(pacts.sent.scripts.at(-1)[1][11], 3, "Misthalin is no area of this league");
  viewArea(pacts, KARAMJA);
  assert.equal(pacts.sent.scripts.at(-1)[1][11], 2, "Karamja can be unlocked");
  assert.equal(hooks[`button:${uid(AREAS, 62)}`]({ player: pacts }), true);
  assert.equal(pacts.getAnimation()?.getId(), 8792, "trailblazer_league_area_unlock_emote");
  assert.equal(pacts.getGraphic()?.getId(), core.CacheDefinitions.getSpotanimId("league_5_area_unlock_emote_spotanim_karamja"), "Raging Echoes' spotanim, as recorded");
  for (let tick = 0; tick < 14; tick++) core.TaskManager.process();
  assert.deepEqual(pacts.getAttribute("league:areas"), [VARLAMORE, KARAMJA]);
  assert.equal(pacts.sent.varbits.get(SELECTION[1]), KARAMJA);
  const startQuests = require("../plugins/modes/data/leagues.json").leagues["6"].startQuests;
  const all = (name) => emitted.filter(([event, payload]) => event === name && payload.player === pacts).map(([, payload]) => payload);
  // The league's automatic quests (Account's, every login) apart from the areas' own.
  const isStart = (payload) => String(payload.quests) === String(startQuests);
  const ours = (name) => all(name).filter((payload) => !isStart(payload));
  assert.ok(all("league:complete-quests").some((payload) => isStart(payload) && payload.quests.includes("Druidic Ritual")), "the Wiki's automatic quests");
  assert.ok(ours("combat-achievements:complete").some((payload) => payload.task === "Back to Our Roots"), "Varlamore's Combat Achievements at the start");
  assert.ok(ours("diary:task").some((payload) => payload.diary === "karamja" && payload.task === "travel-to-port-sarim-via-the-dock-east-of-musa-p"), "Karamja's diary tasks on its unlock");
  assert.deepEqual(ours("league:complete-quests").map((payload) => payload.quests[0]), ["Perilous Moons", "Shilo Village"], "Varlamore's quests at the start, then Karamja's");
  hooks.onPlayerLogin({ player: pacts, username: "pactsareas", isNewAccount: false, profile: "league" });
  assert.equal(ours("league:complete-quests").length, 2, "each area's content once, not again at the next login");
  pacts.setAttribute("league:area-content", []);
  hooks.onPlayerLogin({ player: pacts, username: "pactsareas", isNewAccount: false, profile: "league" });
  assert.deepEqual(ours("league:complete-quests").slice(2).map((payload) => payload.quests[0]), ["Perilous Moons", "Shilo Village"], "a character saved before it existed gets its areas' content at login");

  pacts.setRegistered(true);
  openAreas(pacts);
  viewArea(pacts, KARAMJA);
  assert.equal(hooks[`button:${uid(AREAS, 84)}`]({ player: pacts }), true, "select_button teleports");
  const from = pacts.getLocation().clone();
  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(pacts.getAnimation()?.getId(), 13764, "leagues_6_home_teleport_player_01 at +1");
  for (let tick = 2; tick < 23; tick++) core.TaskManager.process();
  assert.ok(pacts.getLocation().equals(from), "still casting at +22");
  core.TaskManager.process();
  assert.ok(!pacts.getLocation().equals(from), "landed at +23");
  pacts.setRegistered(false);
});

test("Yama's Lair's Glowing portal leads to Civitas through the recorded fade", () => {
  worldLeague = 6;
  const leaver = character("pactsleaver");
  worldLeague = 4;
  leaver.setRegistered(true);
  const YamaExit = require("../plugins/modes/leagueareas/YamaExit.LeagueAreaUnlocks");
  const portal = { getId: () => core.CacheDefinitions.getLocId("league_6_yama_exit") };
  assert.equal(YamaExit.leave({ player: leaver, object: { getId: () => portal.getId() + 1 } }), false, "another loc of the name is not ours");
  assert.equal(YamaExit.leave({ player: leaver, object: portal }), true);
  assert.equal(leaver.getAnimation()?.getId(), core.CacheDefinitions.getSeqId("mahjarrat_human_disappear_01_noheld_quick"));
  assert.equal(leaver.sent.varbits.get(12393), 1, "busy");
  for (let tick = 0; tick < 3; tick++) core.TaskManager.process();
  const there = leaver.getLocation();
  assert.ok(Math.abs(there.getX() - 1666) <= 1 && Math.abs(there.getY() - 3136) <= 1, `Civitas at +3: ${there.getX()}, ${there.getY()}`);
  for (let tick = 3; tick < 6; tick++) core.TaskManager.process();
  assert.equal(leaver.sent.varbits.get(12393), 0, "busy cleared at +6");
  const echoes = character("echoesleaver");
  assert.equal(YamaExit.leave({ player: echoes, object: portal }), false, "only a Demonic Pacts character's");
  leaver.setRegistered(false);
});

test("Yama's stepping stones: a jump a tick, the stone left on fire, a burn on a burning one, the count", () => {
  const ObstacleRunner = require("../plugins/skills/agility/ObstacleRunner.Agility");
  ObstacleRunner.init({ core, getTaskManager: () => core.TaskManager });
  const YamaStones = require("../plugins/modes/leagueareas/YamaStones.LeagueAreaUnlocks");
  // The map, as the server indexes it at start: the stones are the loc's placements in it.
  if (core.RegionManager.regions.size === 0) core.RegionManager.init();
  worldLeague = 6;
  const jumper = character("stonejumper");
  worldLeague = 4;
  jumper.setRegistered(true);
  const loc = core.CacheDefinitions.getLocId("league_6_yama_steppingstone");
  const stone = (x, y) => ({ player: jumper, objectId: loc, object: { getId: () => loc, getLocation: () => at(x, y) } });
  const ticks = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
  const agility = () => jumper.getSkillManager().getExperience(core.Skill.AGILITY);
  const laps = () => emitted.filter(([name, payload]) => name === "agility:lap" && payload.player === jumper).map(([, payload]) => payload);

  // From the shore, four tiles on (recorded from 1490, 5598).
  jumper.moveTo(at(1490, 5598));
  const route = { ...stone(1486, 5598), destination: { x: 1495, y: 5598, z: 0 } };
  YamaStones.route(route);
  assert.deepEqual(route.destination, { x: 1490, y: 5598, z: 0 }, "jumped to from where it stands");
  assert.equal(YamaStones.jump(stone(1486, 5598)), true);
  ticks(3);
  assert.ok(jumper.getLocation().equals(at(1486, 5598)), "on the first stone");
  const first = agility();
  assert.ok(first > 0, "experience for a jump");
  assert.equal(jumper.getAttribute("league:yama-stones"), 1);

  // Too far between stones (four tiles): the engine's refusal.
  assert.equal(YamaStones.jump(stone(1481, 5597)), true);
  assert.equal(jumper.sent.messages.at(-1), "I can't reach that!");
  assert.ok(jumper.getLocation().equals(at(1486, 5598)));

  // On, then straight back to the stone just left: it burns, no experience, still counted.
  YamaStones.jump(stone(1484, 5596));
  ticks(3);
  assert.ok(jumper.getLocation().equals(at(1484, 5596)));
  const before = agility();
  const queue = jumper.getCombat().getHitQueue();
  const burns = [];
  const addPending = queue.addPendingDamage.bind(queue);
  queue.addPendingDamage = (hits) => (burns.push(...hits.map((each) => each.getDamage())), addPending(hits));
  YamaStones.jump(stone(1486, 5598));
  ticks(3);
  assert.equal(jumper.sent.messages.at(-1), "The stone burns your feet as it was recently submurged in lava.");
  assert.equal(agility(), before, "no experience off a burning stone");
  assert.deepEqual(burns, [1], "the burn hits for 1, as recorded");
  assert.equal(jumper.getAttribute("league:yama-stones"), 3, "a burning stone still counts");

  // The fires go out after six ticks: back again is a clean jump.
  ticks(7);
  YamaStones.jump(stone(1484, 5596));
  ticks(3);
  assert.ok(agility() > before, "the fire has gone out");

  // A stone a tick, as live: a jump lands at the start of the next tick, before that tick's
  // click, so each click is from the stone just reached.
  ticks(7);
  jumper.sent.messages.length = 0;
  YamaStones.jump(stone(1486, 5598));
  const path = [[1484, 5596], [1481, 5597], [1479, 5599]];
  const landings = [];
  for (const [x, y] of path) {
    ticks(1);
    YamaStones.jump(stone(x, y));
    landings.push(`${jumper.getLocation().getX()},${jumper.getLocation().getY()}`);
  }
  ticks(4);
  assert.ok(!jumper.sent.messages.includes("I can't reach that!"), "each in reach of the stone just reached");
  assert.ok(jumper.getLocation().equals(at(1479, 5599)), `the run of stones, landing on each: ${landings}`);

  // Every tenth stone is announced; each is the course's lap for the tasks.
  jumper.setAttribute("league:yama-stones", 9);
  ticks(7);
  YamaStones.jump(stone(1478, 5602));
  ticks(3);
  assert.equal(jumper.sent.messages.at(-1), "Your Yama's stepping stone count is: <col=ff0000>10</col>.");
  assert.deepEqual({ course: laps().at(-1).course, laps: laps().at(-1).laps }, { course: "yama-stepping-stones", laps: 10 });

  // Every stone the cache places is one, not just those the recording jumped on: the south row.
  ticks(7);
  jumper.moveTo(at(1508, 5580));
  jumper.sent.messages.length = 0;
  assert.equal(YamaStones.jump(stone(1511, 5579)), true);
  ticks(3);
  assert.ok(!jumper.sent.messages.includes("I can't reach that!"), "a stone jumps on to the next");
  assert.ok(jumper.getLocation().equals(at(1511, 5579)), "on the south row's stone");

  // Clicked from further off, the walk is to the shore beside the stone clicked, not a fixed entry.
  const walkable = (x, y) => !core.RegionManager.blocked(at(x, y), null);
  for (const [from, [sx, sy]] of [[[1503, 5577], [1511, 5579]], [[1503, 5590], [1529, 5599]], [[1500, 5600], [1480, 5592]]]) {
    jumper.moveTo(at(...from));
    const far = { ...stone(sx, sy), destination: { x: sx, y: sy, z: 0 } };
    YamaStones.route(far);
    const { x, y } = far.destination;
    assert.ok(Math.max(Math.abs(x - sx), Math.abs(y - sy)) <= 4, `to ${x}, ${y}: in the shore's reach of ${sx}, ${sy}`);
    assert.ok(walkable(x, y), `to ${x}, ${y}: a tile to stand on`);
  }

  const echoes = character("echoesjumper");
  assert.equal(YamaStones.jump({ ...stone(1486, 5598), player: echoes }), false, "only a Demonic Pacts character's");
  jumper.setRegistered(false);
});

test("Demonic Pacts' League Home Teleport: Civitas with the league's cast and its map graphics, Yama's Lair through the portal", () => {
  worldLeague = 6;
  const homer = character("pactshome");
  worldLeague = 4;
  homer.setRegistered(true);
  const graphics = [];
  const sendLocal = core.World.sendLocalGraphics;
  core.World.sendLocalGraphics = (id, at) => graphics.push([id, at.getX(), at.getY()]);
  try {
    const cast = (opId) => hooks.onSpellCast({ player: homer, spellName: "League Home Teleport", spellWidget: uid(218, 5), spellItemId: -1, opId, handled: false });
    homer.moveTo(at(3222, 3218));
    cast(3);
    core.TaskManager.process();
    core.TaskManager.process();
    assert.equal(homer.getAnimation()?.getId(), 13764, "leagues_6_home_teleport_player_01 at +1");
    assert.deepEqual(graphics[0], [3755, 3222, 3218], "leagues_6_home_teleport_spotanim_01 on the tile");
    for (let tick = 2; tick < 24; tick++) core.TaskManager.process();
    const landed = homer.getLocation();
    assert.ok(Math.abs(landed.getX() - 1666) <= 1 && Math.abs(landed.getY() - 3136) <= 1, `Civitas: ${landed.getX()}, ${landed.getY()}`);

    graphics.length = 0;
    cast(2);
    assert.deepEqual(graphics[0].slice(0, 1), [3274], "the portal opens under the caster");
    assert.equal(homer.sent.varbits.get(12393), 1, "busy");
    for (let tick = 0; tick < 4; tick++) core.TaskManager.process();
    const lair = homer.getLocation();
    assert.ok(Math.abs(lair.getX() - 1502) <= 1 && Math.abs(lair.getY() - 5592) <= 1, `Yama's Lair: ${lair.getX()}, ${lair.getY()}`);
    assert.equal(homer.getAnimation()?.getId(), 12152, "human_yama_portal_fall_on_face");
    assert.equal(homer.sent.varbits.get(12393), 0);
  } finally {
    core.World.sendLocalGraphics = sendLocal;
    homer.setRegistered(false);
  }
  const echoes = character("echoeshome");
  const event = { player: echoes, spellName: "League Home Teleport", opId: 3, handled: false };
  hooks.onSpellCast(event);
  assert.equal(event.handled, false, "another league's character is not handled here");
});

/** A character in its copy of Death's Office, whose moves report their map square as World.onPlayerMoved does. */
function inDeathsOffice(name, profile, league = 4) {
  worldLeague = league;
  const player = character(name, profile);
  worldLeague = 4;
  player.moveTo = function (destination) {
    const previous = this.getLocation().clone();
    Player.prototype.moveTo.call(this, destination);
    const location = this.getLocation();
    if ((previous.getX() >> 6) !== (location.getX() >> 6) || (previous.getY() >> 6) !== (location.getY() >> 6)) {
      hooks.onPlayerMapSquareChange({ player: this, previous, location });
    }
    return this;
  };
  require("../plugins/areas/deathsoffice/Instance.DeathsOffice").enter(player, [3173, 5726, 0]);
  return player;
}

/** The exit portal's click, and the two ticks to the move. */
function leaveDeathsOffice(player) {
  const Instance = require("../plugins/areas/deathsoffice/Instance.DeathsOffice");
  assert.equal(Instance.inOffice(player), true, "in the office before the click");
  player.sent.messages.length = 0;
  assert.equal(hooks[`object:${core.CacheDefinitions.getLocId("death_office_exitportal")}`]({ player }), true);
  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(Instance.inOffice(player), false, "the copy is gone");
  assert.deepEqual(player.sent.messages, [], "the portal has nothing to refuse");
  return player.getLocation();
}

test("Death's Office's exit portal: a locked destination leads to the league home, an open one is unchanged", () => {
  const heardEverything = 31;
  const Enforcement = require("../plugins/modes/leagueareas/Enforcement.LeagueAreaUnlocks");
  const homeOf = (player, league) => Enforcement.home(league, player);
  const spawn = core.WorldDefinition.WORLD_SPAWN;
  assert.equal(areaAt(spawn.getX(), spawn.getY()), WILDERNESS, "(the tutorial's exit, the world's spawn, is locked for a new character)");

  // The first death's tutorial leads to the respawn point: the respawn rule's league home here.
  const tutorial = inDeathsOffice("tutorialexit");
  inDeathTutorial.add(tutorial);
  tutorial.setAttribute("deaths-office:tutorial-heard", heardEverything);
  const afterTutorial = leaveDeathsOffice(tutorial);
  inDeathTutorial.delete(tutorial);
  assert.ok(afterTutorial.equals(homeOf(tutorial, 4)), `Trailblazer's home, not the office: ${afterTutorial}`);
  assert.equal(areaAt(afterTutorial.getX(), afterTutorial.getY()), MISTHALIN);

  // No entrance on record falls back to Lumbridge, which Demonic Pacts never opens.
  const pacts = inDeathsOffice("pactsexit", "league", 6);
  const fromLumbridge = leaveDeathsOffice(pacts);
  assert.ok(fromLumbridge.equals(homeOf(pacts, 6)), `Demonic Pacts' home, not the office: ${fromLumbridge}`);
  assert.equal(areaAt(fromLumbridge.getX(), fromLumbridge.getY(), { league: 6 }), VARLAMORE);

  // Logged out inside: the new copy's portal behaves the same.
  const relogged = inDeathsOffice("pactsrelog", "league", 6);
  const Instance = require("../plugins/areas/deathsoffice/Instance.DeathsOffice");
  Instance.leave(relogged, at(1653, 3135));
  relogged.setAttribute("deaths-office:inside", true);
  hooks.onPlayerLogin({ player: relogged, username: "pactsrelog", isNewAccount: false, profile: "league" });
  assert.ok(leaveDeathsOffice(relogged).equals(homeOf(relogged, 6)), "home from the login's copy too");

  // An entrance whose outside is locked (a saved character's old visit), until its area is unlocked.
  const falador = [2976, 9737, 0];
  const stale = inDeathsOffice("staleexit");
  stale.setAttribute("deaths-office:entrance", "death_office_access_whitecoffin");
  assert.ok(leaveDeathsOffice(stale).equals(homeOf(stale, 4)), "Falador's entrance is locked: home");

  // Controls: an open destination is exactly what it was.
  const unlocked = inDeathsOffice("openfalador");
  unlocked.setAttribute("league:areas", [MISTHALIN, KARAMJA, ASGARNIA]);
  unlocked.setAttribute("deaths-office:entrance", "death_office_access_whitecoffin");
  assert.ok(leaveDeathsOffice(unlocked).equals(at(...falador)), "outside Falador's entrance once Asgarnia is unlocked");
  assert.equal(unlocked.getAttribute("deaths-office:entrance"), null);

  const lumbridge = inDeathsOffice("openlumbridge");
  assert.ok(leaveDeathsOffice(lumbridge).equals(at(3238, 3194)), "no entrance on record: Lumbridge, open to Trailblazer");

  const civitas = inDeathsOffice("opencivitas", "league", 6);
  civitas.setAttribute("deaths-office:entrance", "civitas_death_entrance");
  assert.ok(leaveDeathsOffice(civitas).equals(at(1653, 3135)), "Civitas's own entrance, as captured");

  const main = inDeathsOffice("mainexit", "main");
  inDeathTutorial.add(main);
  main.setAttribute("deaths-office:tutorial-heard", heardEverything);
  const mainExit = leaveDeathsOffice(main);
  inDeathTutorial.delete(main);
  assert.ok(mainExit.equals(spawn), "a main character's tutorial still leads to the world's spawn");
});

test("a reload restores the unlocks and their varbits", () => {
  const league = character("reloader");
  completeTasks(league, 60);
  hooks["command:areas"]({ player: league, parts: ["areas", "Morytania"] });
  for (let tick = 0; tick < 14; tick++) core.TaskManager.process();
  const again = character("reloader", "league", { login: false });
  again.setAttribute("league:type", league.getAttribute("league:type"));
  again.setAttribute("league:tasks", { ...league.getAttribute("league:tasks") });
  again.setAttribute("league:areas", [...league.getAttribute("league:areas")]);
  hooks.onPlayerLogin({ player: again, username: "reloader", isNewAccount: false, profile: "league" });
  assert.deepEqual(SELECTION.map((varbit) => again.sent.varbits.get(varbit)), [1, 2, MORYTANIA, 0, 0, 0]);
  assert.equal(again.sent.varbits.get(AVAILABLE), 0);
  assert.deepEqual(query("league:areas", { player: again }).unlocked, [1, 2, MORYTANIA]);
  const canifis = at(3495, 3491);
  again.moveTo(canifis);
  hooks.onPlayerMapSquareChange({ player: again, previous: at(3400, 3480), location: canifis });
  assert.ok(again.getLocation().equals(canifis), "Morytania stays open");

  // A saved character standing in a square it no longer may (the data changed) logs in at the league home.
  const stranded = character("stranded", "league", { login: false });
  stranded.setAttribute("league:type", league.getAttribute("league:type"));
  stranded.setAttribute("league:areas", [1, 2]);
  stranded.moveTo(at(2662, 3305)); // Ardougne
  hooks.onPlayerLogin({ player: stranded, username: "stranded", isNewAccount: false, profile: "league" });
  assert.equal(areaAt(stranded.getLocation().getX(), stranded.getLocation().getY()), MISTHALIN);
});
