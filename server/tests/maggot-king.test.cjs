// Run after `yarn build`: node --test tests/maggot-king.test.cjs
// Access, solo-instance setup and the cache-backed lair entrance/exit for the Maggot King.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { readTemplateRegion, templateChunkKey } = require("../dist/game/collision/TemplateRegionData");
const { World } = require("../dist/game/World");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
const { NPCRespawnTask } = require("../dist/game/task/impl/NPCRespawnTask");
const { PluginManager } = require("../dist/plugins/PluginManager");
const MaggotKing = require("../plugins/bosses/MaggotKing.plugin");
const Common = require("../plugins/bosses/maggotking/Common.MaggotKing");
const Instance = require("../plugins/bosses/maggotking/Instance.MaggotKing");
const Entrance = require("../plugins/bosses/maggotking/Entrance.MaggotKing");

const core = PluginManager.getCoreApi();
const handlers = new Map();
const loginHandlers = [];
const deathHandlers = [];
const spawned = [];
const removed = [];
const persisted = [];

const api = {
  core,
  persistAttribute: (...args) => persisted.push(args),
  onObjectInteraction: (name, actions) => handlers.set(name, actions),
  onPlayerLogin: handler => loginHandlers.push(handler),
  onNpcDeath: handler => deathHandlers.push(handler),
  emitCustomEvent(name, event) {
    if (name === "quest:is-complete" && event.key === Common.data.questKey) {
      event.complete = event.player.questComplete === true;
    }
  },
  spawnNpc(definition) {
    const npc = {
      definition,
      id: definition.id,
      index: spawned.length,
      location: new core.Location(definition.x, definition.y, definition.z),
      area: null,
      getId() { return this.id; },
      getLocation() { return this.location; },
      getSize() { return 5; },
      getIndex() { return this.index; },
      isPlayer() { return false; },
      isNpc() { return true; },
      getAsNpc() { return this; },
      setArea(area) { this.area = area; },
      getArea() { return this.area; },
      getPrivateArea() { return this.area; },
      getOwner() { return definition.owner ?? null; },
      getDefinition() { return { getRespawn: () => 3 }; },
      setDying(value) { this.dying = value; },
      setNpcTransformationId(value) { this.transformationId = value; },
    };
    spawned.push(npc);
    return npc;
  },
  removeNpc(npc) { removed.push(npc); },
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  MaggotKing.register(api);
});

function player(index, questComplete = false) {
  const attributes = new Map();
  const messages = [];
  let location = new core.Location(2677, 7851, 0);
  let area = null;
  const instance = {
    index,
    questComplete,
    messages,
    getIndex: () => index,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getArea: () => area,
    setArea(value) { area = value; },
    getLocation: () => location,
    moveTo(value) { location = value; },
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: value => messages.push(value),
    getPrivateArea: () => area,
  };
  return instance;
}

function sourceObjectsAt([x, y, z = 0]) {
  const regionId = RegionManager.regionIdForTile(x, y);
  const region = readTemplateRegion(regionId);
  assert.ok(region, `cache region ${regionId} exists`);
  const key = templateChunkKey(z, (x >> 3) & 7, (y >> 3) & 7);
  return region.chunks[key].filter(loc => loc.localX === (x & 63) && loc.localY === (y & 63));
}

test("the entrance, exit and exact options match the live cache", () => {
  const entranceId = core.ObjectIdentifiers.DARKWOOD_TREES_4;
  const entrance = sourceObjectsAt(Common.data.entrance).find(loc => loc.id === entranceId);
  assert.ok(entrance, "Darkwood trees are placed on the configured entrance tile");
  const entranceDefinition = ObjectDefinition.forId(entranceId);
  assert.equal(entranceDefinition.getName(), "Darkwood trees");
  assert.ok(entranceDefinition.getActions().includes("Enter"));

  const escapeId = Entrance.EXIT_CAVE_ID;
  const escape = sourceObjectsAt(Common.data.exit.tile).find(loc => loc.id === escapeId);
  assert.ok(escape, "the cave escape is placed on the configured lair tile");
  const escapeDefinition = ObjectDefinition.forId(escapeId);
  assert.equal(escapeDefinition.getName(), "Cave");
  assert.deepEqual(escapeDefinition.getActions().filter(Boolean), ["Escape", "Quick-escape"]);
});

test("Blood Moon access opens a private solo lair and cleans it up on escape and logout", () => {
  assert.deepEqual(persisted, [[Instance._test.INSTANCE_ATTRIBUTE, false]]);
  const enter = handlers.get("Darkwood trees").Enter;
  const locked = player(1, false);
  assert.equal(enter({ player: locked, objectId: core.ObjectIdentifiers.DARKWOOD_TREES_4 }), true);
  assert.equal(Instance.sessionOf(locked), null);
  assert.match(locked.messages[0], /complete The Blood Moon Rises/);
  assert.equal(spawned.length, 0);

  const first = player(2, true);
  const second = player(3, true);
  assert.equal(enter({ player: first, objectId: core.ObjectIdentifiers.DARKWOOD_TREES_4 }), true);
  assert.equal(enter({ player: second, objectId: core.ObjectIdentifiers.DARKWOOD_TREES_4 }), true);
  const firstSession = Instance.sessionOf(first);
  const secondSession = Instance.sessionOf(second);
  assert.ok(firstSession && secondSession);
  assert.notEqual(firstSession.area, secondSession.area);
  assert.equal(first.getAttribute(Instance._test.INSTANCE_ATTRIBUTE), true);
  assert.equal(firstSession.area.isMulti(), false);
  assert.equal(first.getLocation().equals(firstSession.tile(Common.data.arrival)), true);

  const boss = firstSession.boss;
  assert.equal(boss.getId(), core.NpcIdentifiers.MAGGOT_KING);
  assert.equal(boss.definition.owner, first);
  assert.equal(boss.definition.ownerOnly, true);
  assert.equal(boss.getLocation().equals(firstSession.tile(Common.data.bossSpawn)), true);
  assert.equal(firstSession.area.canAttack(first, boss), true);
  assert.equal(firstSession.area.canAttack(second, boss), false);
  assert.equal(firstSession.area.canAttack(first, secondSession.boss), false);

  const exitTile = firstSession.tile(Common.data.exit.tile);
  const exitObject = firstSession.area.getTemplateObjects(exitTile).find(object => object.getId() === Entrance.EXIT_CAVE_ID);
  assert.ok(exitObject, "the configured escape is present in the instance scene");
  assert.equal(firstSession.area.contains(firstSession.tile(Common.data.arrival)), true);
  const [spawnX, spawnY, plane] = Common.data.bossSpawn;
  for (let x = spawnX; x < spawnX + 5; x++) {
    for (let y = spawnY; y < spawnY + 5; y++) {
      const clip = firstSession.area.getClip(firstSession.tile([x, y, plane]));
      assert.equal(clip & RegionManager.BLOCKED_MASK, 0, `Maggot King footprint tile ${x},${y} is clear`);
    }
  }

  assert.equal(handlers.get("Cave").Escape({ player: first, objectId: Entrance.EXIT_CAVE_ID }), true);
  assert.equal(first.getLocation().equals(Common.loc(Common.data.outside)), true);
  assert.equal(Instance.sessionOf(first), null);
  assert.equal(firstSession.area.isDestroyed(), true);
  assert.ok(removed.includes(boss));
  assert.equal(Instance.sessionOf(second), secondSession, "another player's lair stays active");

  secondSession.area.leave(second, true);
  assert.equal(second.getLocation().equals(Common.loc(Common.data.outside)), true);
  assert.equal(Instance.sessionOf(second), null);
  assert.equal(secondSession.area.isDestroyed(), true);

  const recovered = player(4, true);
  recovered.setAttribute(Instance._test.INSTANCE_ATTRIBUTE, true);
  recovered.moveTo(new core.Location(9000, 2000, 0));
  loginHandlers[0]({ player: recovered });
  assert.equal(recovered.getLocation().equals(Common.loc(Common.data.outside)), true);
  assert.equal(recovered.getAttribute(Instance._test.INSTANCE_ATTRIBUTE), null);
});

test("a killed Maggot King respawns in its private lair and closing the session cancels the next respawn", t => {
  const submitted = [];
  const submit = TaskManager.submit.bind(TaskManager);
  t.mock.method(TaskManager, "submit", task => {
    submitted.push(task);
    return submit(task);
  });
  const owner = player(5, true);
  const firstSpawnIndex = spawned.length;
  assert.equal(Instance.enter(owner), true);
  const session = Instance.sessionOf(owner);
  const firstBoss = session.boss;
  const area = session.area;

  deathHandlers[0]({ npc: firstBoss, killer: owner });
  assert.equal(session.boss, null);
  assert.equal(firstBoss.__skipDefaultRespawn, true);
  assert.equal(session.respawnTask.getDelay(), 3);
  new NPCDeathTask(firstBoss).remove();
  const removeQueue = World.getRemoveNPCQueue();
  const firstRemoveIndex = removeQueue.indexOf(firstBoss);
  assert.notEqual(firstRemoveIndex, -1, "the native death removal queues the old boss");
  removeQueue.splice(firstRemoveIndex, 1);
  assert.equal(submitted.some(task => task instanceof NPCRespawnTask), false, "the engine default respawn remains suppressed");

  TaskManager.process();
  TaskManager.process();
  assert.equal(spawned.length, firstSpawnIndex + 1, "the lair stays empty until the respawn delay expires");
  TaskManager.process();
  const replacement = session.boss;
  assert.equal(spawned.length, firstSpawnIndex + 2);
  assert.notEqual(replacement, firstBoss);
  assert.equal(replacement.getArea(), area);
  assert.equal(replacement.getLocation().equals(session.tile(Common.data.bossSpawn)), true);
  assert.equal(replacement.definition.owner, owner);
  assert.equal(replacement.definition.ownerOnly, true);
  assert.equal(replacement.__skipDefaultRespawn, true);
  assert.equal(area.entities.includes(replacement), true);

  deathHandlers[0]({ npc: replacement, killer: owner });
  assert.equal(session.boss, null);
  new NPCDeathTask(replacement).remove();
  const replacementRemoveIndex = removeQueue.indexOf(replacement);
  assert.notEqual(replacementRemoveIndex, -1, "the native death removal queues the replacement");
  removeQueue.splice(replacementRemoveIndex, 1);
  const spawnCountBeforeClose = spawned.length;
  const pendingRespawn = session.respawnTask;
  assert.equal(pendingRespawn.isRunning(), true);

  area.leave(owner, false);
  assert.equal(session.ended, true);
  assert.equal(pendingRespawn.isRunning(), false);
  for (let tick = 0; tick < 4; tick++) TaskManager.process();
  assert.equal(spawned.length, spawnCountBeforeClose, "a closed instance does not receive a queued boss");
  assert.equal(area.isDestroyed(), true);
});
