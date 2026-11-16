const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

// Issue #3851: a Horror from the Deep completed without playing it through (a Leagues quest
// pack, a league's start quests) left the strange wall shut. A completed account's login sends
// every HFTD varbit as 1 (rsprox_transcripts/224/01512.txt, 226/01636.txt), the wall's horrordoor
// (35) and its six offerings included.

let core;
let quest;
const hooks = { objects: [], custom: new Map(), login: [], canSpawn: [], spawned: [], removed: [], logout: [] };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2508, 3643);
  const api = new Proxy({
    core,
    persistAttribute() {},
    onObjectInteraction(handler) { hooks.objects.push(handler); },
    onPlayerLogin(handler) { hooks.login.push(handler); },
    onPlayerLogout(handler) { hooks.logout.push(handler); },
    onCanSpawnNpc(handler) { hooks.canSpawn.push(handler); },
    spawnNpc(definition) {
      const npc = { definition, isRegistered: () => true, getId: () => definition.id, getOwner: () => definition.owner };
      hooks.spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { hooks.removed.push(npc); },
    onCustomEvent(name, handler) {
      const list = hooks.custom.get(name) ?? [];
      list.push(handler);
      hooks.custom.set(name, list);
    },
    emitCustomEvent(name, event) { for (const handler of hooks.custom.get(name) ?? []) handler(event); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  require("../plugins/quests/quests/HorrorFromTheDeep.Quest")(api);
  quest = QuestRuntime.getRegisteredQuests().find(({ key }) => key === "horror_from_the_deep");
  assert.ok(quest, "Horror from the Deep is registered with QuestRuntime");
});

function playerFixture() {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null);
  const varbits = new Map();
  const messages = [];
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit"
    ? (id, value) => { varbits.set(id, value); return sender; }
    : () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = (message) => messages.push(message);
  // West of the far wall (4545 at 2516,10003), in the strange-wall room.
  player.setLocation(new core.Location(2515, 10003, 0));
  return { player, varbits, messages };
}

function clickFarWall(player) {
  const event = { player, objectId: core.ObjectIdentifiers.STRANGE_WALL_3,
    location: new core.Location(2516, 10003, 0), handled: false };
  for (const handler of hooks.objects) handler(event);
  return event;
}

test("a quest pack's completion opens the strange wall and sends the completed varbits", () => {
  const { player, varbits, messages } = playerFixture();
  // Unlocks.LeagueMode's completeQuest: the runtime completion with no experience or scroll.
  quest.complete(player, { experience: false, scroll: false });
  assert.equal(quest.isComplete(player), true);
  for (const id of [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]) {
    assert.equal(varbits.get(id), 1, `varbit ${id} reads as a completed account's`);
  }
  const event = clickFarWall(player);
  assert.equal(event.handled, true);
  assert.ok(!messages.includes("You cannot see any way to move this part of the wall..."));
  assert.ok(messages.includes("You pass through the opening in the strange wall."));
  assert.equal(player.getLocation().getX(), 2517, "crosses to the far side");
});

test("a save completed before the fix opens the wall and replays the varbits on login", () => {
  const { player, varbits, messages } = playerFixture();
  // Completed with no offerings recorded: only the stage, as an earlier auto-completion saved it.
  player.setAttribute("quest.horror_from_the_deep.stage", 10);
  for (const handler of hooks.login) handler({ player });
  assert.equal(varbits.get(35), 1);
  assert.equal(varbits.get(40), 1);
  clickFarWall(player);
  assert.ok(messages.includes("You pass through the opening in the strange wall."));
});

test("an unfinished quest still keeps the wall shut until all six offerings are in", () => {
  const { player, varbits, messages } = playerFixture();
  player.setAttribute("quest.horror_from_the_deep.stage", 4);
  for (const handler of hooks.login) handler({ player });
  assert.equal(varbits.get(35), 0);
  clickFarWall(player);
  assert.ok(messages.includes("You cannot see any way to move this part of the wall..."));
  assert.equal(player.getLocation().getX(), 2515);
});

test("unlocking the lighthouse front door sends horrorlighthouseentrance (39)", () => {
  const { player, varbits, messages } = playerFixture();
  player.setAttribute("quest.horror_from_the_deep.stage", 1);
  for (const handler of hooks.login) handler({ player });
  assert.equal(varbits.get(39), 0);
  player.setLocation(new core.Location(2509, 3635, 0));
  player.getInventory().adds(core.ItemIdentifiers.LIGHTHOUSE_KEY, 1);
  const event = { player, objectId: core.ObjectIdentifiers.DOORWAY_6,
    location: { x: 2509, y: 3636, z: 0 }, handled: false };
  for (const handler of hooks.objects) handler(event);
  assert.ok(messages.includes("You unlock the Lighthouse front door."));
  assert.equal(varbits.get(39), 1);
});

test("the lighthouse Jossik is world-vetoed and only a completed player gets him", () => {
  hooks.spawned.length = 0;
  hooks.removed.length = 0;
  assert.equal(hooks.canSpawn.length, 1, "the spawn veto is registered");
  const veto = { npcId: core.NpcIdentifiers.JOSSIK, allow: true };
  hooks.canSpawn[0](veto);
  assert.equal(veto.allow, false, "the map spawn never appears");

  const { player } = playerFixture();
  for (const handler of hooks.login) handler({ player, username: player.getUsername() });
  assert.equal(hooks.spawned.length, 0, "a questing player finds the lighthouse empty");

  player.setAttribute("quest.horror_from_the_deep.stage", 10);
  assert.equal(quest.isComplete(player), true, "stage 10 reads as complete");
  for (const handler of hooks.login) handler({ player, username: player.getUsername() });
  assert.equal(hooks.spawned.length, 1, "a completed player gets Jossik");
  const spawned = hooks.spawned[0];
  assert.equal(spawned.definition.id, core.NpcIdentifiers.JOSSIK);
  assert.deepEqual(
    [spawned.definition.x, spawned.definition.y, spawned.definition.z],
    [2509, 3639, 1],
    "upstairs at the post-quest spot",
  );
  assert.equal(spawned.definition.ownerOnly, true);
  assert.equal(spawned.definition.owner, player);

  for (const handler of hooks.login) handler({ player, username: player.getUsername() });
  assert.equal(hooks.spawned.length, 1, "a second login does not stack copies");

  for (const logout of hooks.logout) logout({ player });
  assert.equal(hooks.removed.length, 1, "the copy is removed on logout");
});

test("the quest mother does not drop a second rusty casket", () => {
  const plugin = require("../plugins/quests/quests/HorrorFromTheDeep.Quest");
  const { filterQuestMotherDrops, motherPhasesByPlayer } = plugin._test;
  const player = {};
  const mother = { getId: () => core.NpcIdentifiers.DAGANNOTH_MOTHER_9, getOwner: () => player };
  motherPhasesByPlayer.set(player, { npc: mother });
  const questMother = { player, npc: mother, drops: [{ itemId: 3849 }, { itemId: 526 }] };
  filterQuestMotherDrops(questMother);
  assert.deepEqual(questMother.drops.map((drop) => drop.itemId), [526], "bones stay, the reward casket goes");

  const ordinary = { player, npc: { getOwner: () => null }, drops: [{ itemId: 3849 }] };
  filterQuestMotherDrops(ordinary);
  assert.deepEqual(ordinary.drops.map((drop) => drop.itemId), [3849], "a normal kill keeps its table");
  motherPhasesByPlayer.delete(player);
});

test("the basement ladder lands on a walkable ground-floor tile", () => {
  const { LIGHTHOUSE_LANDING } = require("../plugins/quests/quests/HorrorFromTheDeep.Quest")._test;
  assert.deepEqual(
    [LIGHTHOUSE_LANDING.getX(), LIGHTHOUSE_LANDING.getY(), LIGHTHOUSE_LANDING.getZ()],
    [2508, 3643, 0],
    "the tile in front of the ground-floor ladder, not the wall behind it",
  );
  assert.equal(core.RegionManager.blocked(LIGHTHOUSE_LANDING, null), false, "the landing is walkable");
});
