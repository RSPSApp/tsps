const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { Sailing } = require("../dist/game/content/sailing/Sailing");
const { BoatManager } = require("../dist/game/content/sailing/BoatManager");
const { normalizeSailingState } = require("../dist/game/content/sailing/SailingState");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const { ATTR_SKIP_PERSISTENCE } = require("../plugins/bots/runtime/PersistenceConstants.PlayerBots");

const LAGUNA = "laguna_aurorae";
const HOME = "the_pandemonium";
let core, codec, nextIndex = 1700;
const previousDisableBots = process.env.DISABLE_PLAYER_BOTS;
const originalError = console.error;
const caughtErrors = [];
let hunterStarted = false;

before(async () => {
  console.error = (...args) => { caughtErrors.push(args.map(String).join(" ")); originalError.apply(console, args); };
  process.env.DISABLE_PLAYER_BOTS = "1";
  const root = path.resolve(__dirname, "..");
  await CachePipeline.initialize(root);
  PM.loadFromDirectory(path.join(root, "plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  Sailing.initialize();
  for (const hook of PM.serverStartupHooks) {
    if (!["Hunter", "WarpedSceptre"].includes(hook.pluginName)) continue;
    if (hook.pluginName === "Hunter") hunterStarted = true;
    hook.handler({});
  }
  JsonPersistence.register({ getSkillManager: () => core.SkillManager, setPlayerPersistence: (backend) => { codec = backend; }, log() {} });
  assert.ok(QuestRuntime.questNamed("Pandemonium"));
  assert.ok(QuestRuntime.questNamed("Tree Gnome Village"));
  assert.equal(Sailing.getDock(LAGUNA).mooringPoint, true);
});

after(() => {
  try {
    if (hunterStarted) for (const hook of PM.serverShutdownHooks) if (hook.pluginName === "Hunter") hook.handler({});
    assert.deepEqual(caughtErrors, [], "no caught plugin or engine errors");
  } finally {
    console.error = originalError;
    if (previousDisableBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = previousDisableBots;
  }
});

function actor(t, qualified = true) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  t.after(() => {
    try {
      Sailing.onLogout(p);
      core.GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(p);
      core.TaskManager.cancelTasks(p);
      if (p.getIndex() >= 0) core.TaskManager.cancelTasks(p.getIndex());
      p.getMovementQueue().reset();
    } finally { p.setRegistered(false); }
  });
  p.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  p.setIndex(nextIndex++);
  p.setUsername("laguna" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  if (qualified) {
    const skill = p.getSkillManager();
    skill.setExperiences(core.Skill.SAILING, core.SkillManager.getExperienceForLevel(58), false);
    skill.setMaxLevels(core.Skill.SAILING, 58, false).setCurrentLevel(core.Skill.SAILING, 58, false);
    for (const name of ["Pandemonium", "Tree Gnome Village"]) {
      const quest = QuestRuntime.questNamed(name);
      quest.setStage(p, quest.completionValue);
      assert.equal(quest.isComplete(p), true, name);
    }
  }
  return p;
}

function destinations(player) {
  const query = { player, list: [] };
  PM.emitCustomEvent("spirit-trees:destinations", query);
  return query.list.map((entry) => entry.name);
}
function hasLaguna(player) { return destinations(player).includes("Laguna Aurorae"); }
function boardAtHome(player) {
  const home = Sailing.getDock(HOME);
  player.setLocation(new core.Location(home.landing.x, home.landing.y, home.landing.z));
  player.needsPlacement = false;
  assert.ok(Sailing.giveBoat(player, "raft", HOME), "real registered raft and home dock");
  assert.equal(Sailing.board(player, HOME), null);
  assert.ok(Sailing.instanceAboard(player));
}
function placeBoatAt(player, id) {
  const dock = Sailing.getDock(id), boat = Sailing.instanceAboard(player);
  assert.ok(dock && boat);
  // Fixture placement only: no voyage path, timing or client rendering is claimed.
  BoatManager.teleport(boat, dock.mooring);
}
function moor(player, id) {
  placeBoatAt(player, id);
  assert.equal(Sailing.dock(player, id), null);
}
function savedRoundTrip(t, p) {
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const result = actor(t, false);
  assert.equal(QuestRuntime.questNamed("Pandemonium").isComplete(result), false, "fresh actor is not already complete");
  assert.ok(result.getSkillManager().getMaxLevel(core.Skill.SAILING) < 58, "fresh actor starts below 58");
  codec.hydratePlayerSave(raw).applyToPlayer(result);
  result.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  result.setRegistered(true);
  for (const name of ["Pandemonium", "Tree Gnome Village"])
    assert.equal(QuestRuntime.questNamed(name).isComplete(result), true, `saved ${name}`);
  assert.equal(result.getSkillManager().getMaxLevel(core.Skill.SAILING), 58, "saved Sailing level");
  return result;
}


async function chooseLagunaFromGrandExchange(p) {
  const trees = require("../plugins/world/data/spirit-trees.json").trees;
  const from = trees.find((tree) => tree.name === "Grand Exchange");
  const slot = trees.findIndex((tree) => tree.name === "Laguna Aurorae");
  assert.ok(from && slot >= 0);
  core.RegionManager.loadMapFiles(from.tree[0], from.tree[1]);
  p.setLocation(new core.Location(...from.landing));
  p.needsPlacement = false;
  const baseId = core.CacheDefinitions.getLocId("spirittree_small");
  assert.equal(baseId, 1295, "pinned cache's nameless transformed tree base");
  // SpiritTrees.treeAt accepts map objects within six tiles of its authored tree site.
  let object, definition;
  for (let dx = -6; dx <= 6 && !object; dx++) {
    for (let dy = -6; dy <= 6 && !object; dy++) {
      const location = new core.Location(from.tree[0] + dx, from.tree[1] + dy, from.tree[2]);
      const candidate = core.MapObjects.get(baseId, location);
      const def = candidate && core.ObjectDefinition.forPlayer(candidate.getId(), p);
      if (def?.getName() === "Spirit tree" && def.getInteractions().includes("Travel")) {
        object = candidate; definition = def;
      }
    }
  }
  assert.ok(object && definition, "a quest-complete Grand Exchange map tree offers Travel");
  const clickType = definition.getInteractions().findIndex((option) => option === "Travel") + 1;
  assert.ok(clickType > 0, "actual Travel option slot");
  assert.equal(PM.emitObjectInteraction({ player: p, object, objectId: object.getId(), definition, clickType,
    location: { x: object.getLocation().getX(), y: object.getLocation().getY(), z: object.getLocation().getZ() }, handled: false }), true);
  const menu = p.getAttribute("spirit-trees:menu");
  assert.ok(menu && menu.choices[slot]?.tree.name === "Laguna Aurorae", "registered menu owns the selected slot");
  const offered = menu.choices[slot].to != null;
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const connection = new ClientConnection(channel);
  connection.player = p;
  await connection.dispatch([{ type: "dialogue_continue", widgetId: (187 << 16) | 3, childIndex: slot }]);
  connection.processTurnPackets();
  return offered;
}

test("the registered Spirit Tree menu refuses Laguna before mooring and allows it after", async (t) => {
  const p = actor(t);
  assert.equal(await chooseLagunaFromGrandExchange(p), false, "unvisited menu choice is greyed");
  assert.notEqual(p.getAttribute("spirit-trees:last-destination"), "Laguna Aurorae");
  p.getDialogueManager().reset();
  boardAtHome(p);
  moor(p, LAGUNA);
  assert.equal(Sailing.disembark(p, LAGUNA), null);
  assert.equal(await chooseLagunaFromGrandExchange(p), true, "visited menu choice is available");
  assert.equal(p.getAttribute("spirit-trees:last-destination"), "Laguna Aurorae", "decoded choice reaches the travel consumer");
  core.TaskManager.process();
  core.TaskManager.process();
  const expected = require("../plugins/world/data/spirit-trees.json").trees.find((tree) => tree.name === "Laguna Aurorae").landing;
  const actual = p.getLocation();
  assert.deepEqual([actual.getX(), actual.getY(), actual.getZ()], expected, "decoded selection completes the existing travel task");
});

test("qualified traveller needs a real prior Laguna moor; other trees remain available", (t) => {
  const p = actor(t);
  assert.ok(destinations(p).includes("Grand Exchange"), "registered ordinary destination control");
  assert.equal(hasLaguna(p), false, "quest and level alone do not unlock Laguna");
  boardAtHome(p);
  moor(p, LAGUNA);
  assert.equal(hasLaguna(p), true, "successful Sailing.dock unlocks the destination");
});

test("mooring remains recorded once after repeat, departure and real save/load", (t) => {
  const p = actor(t);
  boardAtHome(p);
  moor(p, LAGUNA);
  moor(p, LAGUNA);
  assert.deepEqual((p.getSailing().mooredDocks ?? []).filter((id) => id === LAGUNA), [LAGUNA]);
  moor(p, HOME);
  assert.equal(p.getSailing().lastDock, HOME);
  Sailing.onLogout(p);
  const reloaded = savedRoundTrip(t, p);
  assert.equal(reloaded.getSailing().lastDock, HOME);
  assert.equal(hasLaguna(reloaded), true, "historical visit survives a later port and PlayerSave reload");
});

test("recovering and boarding a boat at Laguna do not invent a mooring", (t) => {
  const p = actor(t);
  const boat = Sailing.giveBoat(p, "raft", HOME);
  assert.ok(boat);
  assert.equal(Sailing.recover(p, boat.slot, LAGUNA), null);
  assert.equal(hasLaguna(p), false, "recovery alone does not count");
  const landing = Sailing.getDock(LAGUNA).landing;
  p.setLocation(new core.Location(landing.x, landing.y, landing.z));
  assert.equal(Sailing.board(p, LAGUNA, boat.slot), null);
  assert.equal(p.getSailing().lastDock, LAGUNA, "boarding changes the last dock");
  assert.equal(hasLaguna(p), false, "boarding alone does not count");
  moor(p, LAGUNA);
  assert.equal(hasLaguna(p), true);
});

test("a successful disembark at Laguna also records the moor", (t) => {
  const p = actor(t);
  boardAtHome(p);
  placeBoatAt(p, LAGUNA);
  assert.equal(Sailing.disembark(p, LAGUNA), null);
  assert.equal(hasLaguna(p), true);
});

test("an old save with a last dock or a boat at Laguna does not invent history", (t) => {
  const p = actor(t);
  const boat = Sailing.giveBoat(p, "raft", HOME);
  assert.equal(Sailing.recover(p, boat.slot, LAGUNA), null);
  const legacy = JSON.parse(JSON.stringify(p.getSailing()));
  legacy.lastDock = LAGUNA;
  delete legacy.mooredDocks;
  p.setSailing(normalizeSailingState(legacy));
  assert.equal(hasLaguna(p), false);
  const reloaded = savedRoundTrip(t, p);
  assert.equal(hasLaguna(reloaded), false);
});

test("quest and Sailing requirements still apply after a qualifying moor", (t) => {
  const p = actor(t);
  boardAtHome(p);
  moor(p, LAGUNA);
  assert.equal(hasLaguna(p), true);
  const quest = QuestRuntime.questNamed("Pandemonium");
  quest.setStage(p, 0);
  assert.equal(hasLaguna(p), false, "real quest incomplete");
  quest.setStage(p, quest.completionValue);
  const skill = p.getSkillManager();
  skill.setExperiences(core.Skill.SAILING, core.SkillManager.getExperienceForLevel(57), false);
  skill.setMaxLevels(core.Skill.SAILING, 57, false).setCurrentLevel(core.Skill.SAILING, 57, false);
  assert.equal(skill.getMaxLevel(core.Skill.SAILING), 57, "the level read by the destination gate");
  assert.equal(hasLaguna(p), false, "Sailing below 58");
  skill.setExperiences(core.Skill.SAILING, core.SkillManager.getExperienceForLevel(58), false);
  skill.setMaxLevels(core.Skill.SAILING, 58, false).setCurrentLevel(core.Skill.SAILING, 58, false);
  assert.equal(skill.getMaxLevel(core.Skill.SAILING), 58);
  assert.equal(hasLaguna(p), true);
});


test("failed docking and another island do not unlock Laguna", (t) => {
  const p = actor(t);
  assert.notEqual(Sailing.dock(p, LAGUNA), null, "no boat aboard");
  assert.equal(hasLaguna(p), false);
  boardAtHome(p);
  moor(p, "last_light");
  assert.equal(hasLaguna(p), false, "another island is not Laguna");
  assert.equal(p.getSailing().lastStandardDock, HOME, "an island is not a standard port");
});

test("saved mooring history normalizes invalid and duplicate IDs", () => {
  const normalized = normalizeSailingState({ mooredDocks: [LAGUNA, LAGUNA, null, 7, "", HOME] });
  assert.deepEqual(normalized.mooredDocks, [LAGUNA, HOME]);
  assert.equal(normalizeSailingState({ mooredDocks: "laguna_aurorae" }).mooredDocks, undefined);
});
