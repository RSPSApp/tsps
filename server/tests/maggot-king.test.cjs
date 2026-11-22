// Run after `yarn build`: node --test tests/maggot-king.test.cjs
// Access, solo-instance setup and the cache-backed lair entrance/exit for the Maggot King.
const assert = require("node:assert/strict");
const { test, before, mock } = require("node:test");
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
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
const { PluginManager } = require("../dist/plugins/PluginManager");
const MaggotKing = require("../plugins/bosses/MaggotKing.plugin");
const Common = require("../plugins/bosses/maggotking/Common.MaggotKing");
const Instance = require("../plugins/bosses/maggotking/Instance.MaggotKing");
const Rewards = require("../plugins/bosses/maggotking/Rewards.MaggotKing");
const Entrance = require("../plugins/bosses/maggotking/Entrance.MaggotKing");
const Resupply = require("../plugins/bosses/maggotking/Resupply.MaggotKing");

const core = PluginManager.getCoreApi();
const handlers = new Map();
const interactions = new Map();
const ground = [];
const rollRequests = [];
const beforeObjectHandlers = [];
const loginHandlers = [];
const deathHandlers = [];
const shutdownHandlers = [];
const spawned = [];
const removed = [];
const persisted = [];

const api = {
  core,
  persistAttribute: (...args) => persisted.push(args),
  onObjectInteraction: (name, actions) => handlers.set(name, actions),
  onNpcInteraction: (name, actions) => interactions.set(name, actions),
  getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args) }),
  onBeforeObjectInteraction: handler => beforeObjectHandlers.push(handler),
  onPlayerLogin: handler => loginHandlers.push(handler),
  onNpcDeath: handler => deathHandlers.push(handler),
  onPlayerLogout() {}, onPlayerDisconnect() {}, onPlayerBeforeDeath() {},
  onPlayerDeath() {}, onServerShutdown: handler => shutdownHandlers.push(handler), onCustomEvent() {}, onNpcAttackOption() {}, onItemAction() {},
  onAttackTiming() {}, onCombatAttackDistance() {}, onPlayerHitModify() {}, onCombatHitDamage() {}, onCombatHitResolved() {},
  registerCombatMethodResolver() {},
  emitCustomEvent(name, event) {
    if (name === "quest:is-complete" && event.key === Common.data.questKey) {
      event.complete = event.player.questComplete === true;
    }
    if (name === "npc-drops:roll-table") {
      rollRequests.push(event);
      if (event.drops.length === 0) event.drops.push({ itemId: core.ItemIdentifiers.MAGGOT_EGG, amount: 1 });
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
      isRegistered() { return false; },
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
  // This legacy hybrid fixture tests setup/respawn only; native combat lives in maggot-king-combat.test.cjs.
  mock.method(require("../plugins/bosses/maggotking/Fight.MaggotKing").Fight.prototype, "start", () => {});
  MaggotKing.register(api);
});

function player(index, questComplete = false) {
  const attributes = new Map();
  const messages = [];
  let location = new core.Location(2677, 7851, 0);
  let area = null;
  const items = [];
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
    getInventory: () => ({
      contains: (id) => items.some((item) => item.id === id),
      getFreeSlots: () => 28 - items.length,
      getAddableAmount: (item) => {
        const held = items.filter((entry) => entry.id === item.getId()).reduce((sum, entry) => sum + entry.amount, 0);
        return Math.max(0, Math.min(item.getAmount(), MAX_STACK_AMOUNT - held));
      },
      adds: (id, amount) => {
        const held = items.find((entry) => entry.id === id);
        if (held) held.amount += amount;
        else items.push({ id, amount });
      },
      refreshItems() {},
    }),
    items,
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
  assert.equal(escape, undefined, "correct lair cache has no static escape; the instance owns its dynamic recovery prop");
  const escapeDefinition = ObjectDefinition.forId(escapeId);
  assert.equal(escapeDefinition.getName(), "Cave");
  assert.deepEqual(escapeDefinition.getActions().filter(Boolean), ["Escape", "Quick-escape"]);
});

test("Blood Moon access opens a private solo lair and cleans it up on escape and logout", () => {
  assert.deepEqual(persisted, [["maggot-king:kills", 0], [Instance._test.INSTANCE_ATTRIBUTE, false], [Resupply.BUILT_ATTRIBUTE, 0]]);
  assert.deepEqual(beforeObjectHandlers.map(handler => handler.name), ["refuseStaleBuild"],
    "the hybrid API retains the required production before-object registration");
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
  const exitObject = firstSession.exit;
  assert.ok(exitObject.getLocation().equals(exitTile));
  assert.ok(exitObject, "the configured escape is present in the instance scene");
  assert.equal(firstSession.area.contains(firstSession.tile(Common.data.arrival)), true);
  const [spawnX, spawnY, plane] = Common.data.bossSpawn;
  for (let x = spawnX; x < spawnX + 5; x++) {
    for (let y = spawnY; y < spawnY + 5; y++) {
      const clip = firstSession.area.getClip(firstSession.tile([x, y, plane]));
      assert.equal(clip & RegionManager.BLOCKED_MASK, 0, `Maggot King footprint tile ${x},${y} is clear`);
    }
  }

  assert.equal(handlers.get("Cave").Escape({ player: first, object: firstSession.exit, objectId: Entrance.EXIT_CAVE_ID }), true);
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

test("a killed Maggot King leaves a corpse, respawns after it is used, and closing the session cancels the next respawn", t => {
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
  const corpseHandler = interactions.get("Maggot King Corpse");

  deathHandlers.find(handler => handler === Instance.onBossDeath)({ npc: firstBoss, killer: owner });
  assert.equal(session.boss, null);
  assert.equal(firstBoss.__skipDefaultRespawn, true);
  assert.ok(session.corpse, "the corpse waits for Open-stomach or Take-eggs");
  assert.equal(session.corpse.getId(), core.NpcIdentifiers.MAGGOT_KING_CORPSE);
  assert.equal(session.corpse.definition.owner, owner);
  assert.equal(session.corpse.definition.ownerOnly, true);
  assert.ok(!session.respawnTask, "the boss does not respawn while the corpse is waiting");
  new NPCDeathTask(firstBoss).remove();
  const removeQueue = World.getRemoveNPCQueue();
  const firstRemoveIndex = removeQueue.indexOf(firstBoss);
  assert.notEqual(firstRemoveIndex, -1, "the native death removal queues the old boss");
  removeQueue.splice(firstRemoveIndex, 1);
  assert.equal(submitted.some(task => task instanceof NPCRespawnTask), false, "the engine default respawn remains suppressed");

  TaskManager.process();
  TaskManager.process();
  assert.equal(session.boss, null, "the lair stays empty until the corpse is used");
  assert.equal(corpseHandler["Take-eggs"]({ player: owner, npc: session.corpse }), true);
  assert.equal(session.corpse, null);
  assert.equal(owner.items.some((item) => item.id === core.ItemIdentifiers.MAGGOT_EGG), true, "take-eggs gives its roll");
  assert.equal(session.respawnTask.getDelay(), 3);

  TaskManager.process();
  TaskManager.process();
  assert.equal(session.boss, null, "the respawn delay is still running");
  TaskManager.process();
  const replacement = session.boss;
  assert.notEqual(replacement, firstBoss);
  assert.equal(replacement.getArea(), area);
  assert.equal(replacement.getLocation().equals(session.tile(Common.data.bossSpawn)), true);
  assert.equal(replacement.definition.owner, owner);
  assert.equal(replacement.definition.ownerOnly, true);
  assert.equal(replacement.__skipDefaultRespawn, true);
  assert.equal(area.entities.includes(replacement), true);

  deathHandlers.find(handler => handler === Instance.onBossDeath)({ npc: replacement, killer: owner });
  assert.equal(session.boss, null);
  new NPCDeathTask(replacement).remove();
  const replacementRemoveIndex = removeQueue.indexOf(replacement);
  assert.notEqual(replacementRemoveIndex, -1, "the native death removal queues the replacement");
  removeQueue.splice(replacementRemoveIndex, 1);
  const spawnCountBeforeClose = spawned.length;
  assert.ok(session.corpse, "the replacement leaves its own corpse");
  const waitingCorpse = session.corpse;
  assert.ok(!session.respawnTask);

  area.leave(owner, false);
  assert.equal(session.ended, true);
  assert.equal(removed.includes(waitingCorpse), true, "leaving removes the waiting corpse");
  for (let tick = 0; tick < 4; tick++) TaskManager.process();
  assert.equal(spawned.length, spawnCountBeforeClose, "a closed instance does not receive a queued boss");
  assert.equal(area.isDestroyed(), true);
});

test("Camping callback negatives preserve death cleanup for wrong and missing killers", t => {
  const awards = [];
  const emit = api.emitCustomEvent.bind(api);
  t.mock.method(api, "emitCustomEvent", (name, event) => {
    if (name === "combat-achievements:complete") awards.push(event);
    return emit(name, event);
  });
  for (const [index, mode] of [[6, "wrong"], [7, "missing"]]) {
    const owner = player(index, true);
    assert.equal(Instance.enter(owner), true);
    const session = Instance.sessionOf(owner), boss = session.boss, fight = session.fight;
    try {
      session.campingKills = 11; // supplied boundary; these are callback-only robustness negatives
      const impostor = { __maggotKingSession: session };
      Instance.onBossDeath({ npc: impostor, killer: owner });
      assert.equal(session.boss, boss, "foreign/stale/larva-like identity cannot retire the current boss");
      assert.equal(session.campingKills, 11);
      const event = mode === "missing" ? { npc: boss } : { npc: boss, killer: player(8, true) };
      // NPCDeathTask emits only when killer!=null: missing-killer cleanup is NOT native-path proof.
      Instance.onBossDeath(event);
      assert.equal(fight.stopped, true);
      assert.equal(session.fight, null);
      assert.equal(session.boss, null);
      assert.equal(boss.__maggotKingSession, null);
      assert.equal(boss.__skipDefaultRespawn, true);
      assert.ok(session.corpse, "the corpse is left waiting");
      assert.ok(!session.respawnTask, "no respawn is scheduled before the corpse is used");
      assert.equal(session.campingKills, 11, `${mode} killer does not count`);
      Instance.onBossDeath({ npc: boss, killer: owner });
      assert.equal(session.campingKills, 11, "consumed callback cannot count later");
      assert.deepEqual(awards, []);
    } finally { session.area.leave(owner, false); }
  }
});

test("the corpse chooses one table once and then starts the respawn", () => {
  const owner = player(11, true);
  assert.equal(Instance.enter(owner), true);
  const session = Instance.sessionOf(owner);
  const boss = session.boss;
  const corpseHandler = interactions.get("Maggot King Corpse");
  Instance.onBossDeath({ npc: boss, killer: owner });
  const corpse = session.corpse;
  assert.ok(corpse);
  const before = rollRequests.length;
  assert.equal(corpseHandler["Open-stomach"]({ player: owner, npc: corpse }), true);
  assert.equal(rollRequests[before].npcId, core.NpcIdentifiers.MAGGOT_KING_CORPSE, "Open-stomach rolls the corpse's open-stomach table");
  assert.equal(rollRequests[before].boss, true, "the corpse's uniques take the boss multiplier");
  assert.equal(session.corpse, null);
  assert.equal(corpseHandler["Take-eggs"]({ player: owner, npc: corpse }), false, "the same corpse cannot be used twice");
  assert.equal(session.respawnTask.getDelay(), 3);
  session.area.leave(owner, false);
});

test("Take-eggs rolls the take-eggs table and an empty roll says the eggs pop", () => {
  const owner = player(12, true);
  assert.equal(Instance.enter(owner), true);
  const session = Instance.sessionOf(owner);
  Instance.onBossDeath({ npc: session.boss, killer: owner });
  const corpse = session.corpse;
  const corpseHandler = interactions.get("Maggot King Corpse");
  const before = rollRequests.length;
  const emit = api.emitCustomEvent;
  api.emitCustomEvent = (name, event) => {
    if (name === "npc-drops:roll-table") {
      rollRequests.push(event);
      return; // the empty take-eggs outcome
    }
    return emit(name, event);
  };
  try {
    assert.equal(corpseHandler["Take-eggs"]({ player: owner, npc: corpse }), true);
    assert.equal(rollRequests[before].npcId, core.NpcIdentifiers.MAGGOT_KING, "Take-eggs rolls the boss's take-eggs table");
    assert.equal(owner.messages.at(-1), "The eggs pop as you try to take them.");
  } finally {
    api.emitCustomEvent = emit;
    session.area.leave(owner, false);
  }
});

test("a full stack receives only the room left and sends the excess to the floor", () => {
  const owner = player(14, true);
  const noteId = core.ItemDefinition.forId(core.ItemIdentifiers.UNCUT_RUBY).getNoteId();
  assert.ok(noteId > 0, "uncut ruby has a noted form");
  owner.items.push({ id: noteId, amount: MAX_STACK_AMOUNT - 2 });
  const before = ground.length;
  Rewards._test.give(owner, [{ itemId: core.ItemIdentifiers.UNCUT_RUBY, amount: 11, noted: true }],
    new core.Location(2677, 7851, 0));
  assert.equal(owner.items.find((item) => item.id === noteId).amount, MAX_STACK_AMOUNT, "the stack stops at the cap");
  const [, placed] = ground[before];
  assert.equal(placed.getId(), noteId);
  assert.equal(placed.getAmount(), 9, "the nine that did not fit reach the corpse tile");
});

test("Camping completion failure occurs after authoritative death retirement and scheduled respawn", t => {
  const owner = player(9, true);
  assert.equal(Instance.enter(owner), true);
  const session = Instance.sessionOf(owner), boss = session.boss, fight = session.fight;
  session.campingKills = 11; // supplied callback-only final-kill checkpoint
  const failure = new Error("injected Camping completion failure");
  const emit = api.emitCustomEvent.bind(api);
  t.mock.method(api, "emitCustomEvent", (name, event) => {
    if (name === "combat-achievements:complete" && event.task === "Camping the King") throw failure;
    return emit(name, event);
  });
  try {
    assert.throws(() => Instance.onBossDeath({ npc: boss, killer: owner }), error => error === failure);
    assert.equal(fight.stopped, true);
    assert.equal(session.fight, null);
    assert.equal(session.boss, null);
    assert.equal(boss.__maggotKingSession, null);
    assert.equal(boss.__skipDefaultRespawn, true);
    assert.ok(session.corpse, "the corpse is left waiting");
    assert.ok(!session.respawnTask, "no respawn is scheduled before the corpse is used");
    assert.equal(session.campingKills, 12, "accepted kill is committed before optional notification");
    Instance.onBossDeath({ npc: boss, killer: owner });
    assert.equal(session.campingKills, 12, "duplicate callback cannot replay failed notification");
  } finally { session.area.leave(owner, false); }
});

test("Camping shutdown callback retires the run instead of saving it for a new entry", () => {
  const owner = player(10, true);
  assert.equal(Instance.enter(owner), true);
  const session = Instance.sessionOf(owner);
  try {
    session.campingKills = 11; // supplied callback-only shutdown checkpoint
    for (const handler of shutdownHandlers) handler();
    assert.equal(session.ended, true);
    assert.equal(session.area.isDestroyed(), true);
    assert.equal(Instance.sessionOf(owner), null);
    assert.equal(Instance.enter(owner), true);
    assert.equal(Instance.sessionOf(owner).campingKills, 0);
    assert.deepEqual(persisted, [["maggot-king:kills", 0], [Instance._test.INSTANCE_ATTRIBUTE, false], [Resupply.BUILT_ATTRIBUTE, 0]],
      "no persisted Camping counter or login catch-up");
  } finally { Instance.sessionOf(owner)?.area.leave(owner, false); }
});
