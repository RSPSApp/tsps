// Cabin Fever (q009) route contract. From server/: node --test tests/qh728-q009.test.cjs
// Fixture start: every skill meets the quest levels; completed quests are set explicitly.
// The transcript runner is captured (not animated) and its action steps are dispatched
// through the same npc-dialogue:action hook the dialogue runtime uses.
const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.BROWSER_HOST = '1';
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const { HitQueue } = require('../dist/game/content/combat/hit/HitQueue');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const groundItemDefinitions = require('../data/definitions/ground-items.json');

test('Cabin Fever ordinary logout releases real session-owned lockers and swing ropes', async t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  core.RegionManager.init();
  require('../plugins/quests/quests/CabinFever.Quest')(PluginManager.createApi('CabinLogoutRegression'));
  const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === 'cabin_fever');
  const actors = [];
  let cycle = 0;
  t.mock.method(core.World, 'getProcessCycle', () => cycle);
  function login(name) {
    let connected = true;
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => connected,
      send: () => true, close() { connected = false; }, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel), p = new Player(session);
    session.setPlayer(p);
    p.setUsername(name);
    p.setAttribute('bot-skip-persistence', true);
    p.setLocation(new core.Location(1814, 4831, 0));
    // Isolate account loading; registration, logout hooks and global removal stay real.
    t.mock.method(p, 'onAdd', () => {});
    core.World.getPlayers().add(p);
    for (const skill of core.Skill.values()) {
      p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
    }
    p.setHitpoints(99);
    quest.setStage(p, 3);
    actors.push(p);
    return p;
  }
  function ticks(count) {
    for (let i = 0; i < count; i++) { cycle++; core.TaskManager.process(); }
  }
  const owned = p => core.World.getObjects().filter(object => object.getOwner() === p);
  function open(p, id) {
    const object = new core.GameObject(id, new core.Location(1814, 4832, 0), 10, 3, null);
    assert.equal(PluginManager.emitObjectInteraction({ player: p, object, objectId: id,
      clickType: 1, option: 'Open', handled: false }), true);
  }
  function logout(p) {
    const index = p.getIndex();
    p.requestLogout();
    core.World.process();
    assert.equal(p.isRegistered(), false, 'ordinary logout completed');
    assert.equal(core.World.getPlayers().get(index), null, 'old session detached globally');
  }
  t.after(() => {
    for (const p of actors) {
      if (p.isRegistered()) logout(p);
      for (const object of owned(p)) core.ObjectManager.deregister(object, true);
      core.TaskManager.cancelTasks(p);
      core.TaskManager.cancelTasks(p.getIndex());
      core.World.unregisterPlayerPosition(p);
    }
  });
  await t.test('a pending locker open is cancelled before its object appears', () => {
    const p = login('cabinlogoutpending');
    const index = p.getIndex();
    // Submit the open after this tick's task admission, before normal logout removal.
    core.TaskManager.submit(new core.CountdownTask(p, 1, () => {
      open(p, 11246);
      assert.equal(owned(p).length, 0);
      p.requestLogout();
    }));
    core.World.process();
    assert.equal(p.isRegistered(), false);
    assert.equal(core.World.getPlayers().get(index), null);
    ticks(3);
    assert.equal(owned(p).length, 0);
  });
  await t.test('same-name new sessions release both open locker forms without restoring map packets', () => {
    const sessions = [], objects = [];
    for (const [closedId, openId] of [[11246, 11247], [11248, 11249]]) {
      const p = login('cabinlogoutrepeat');
      assert.ok(sessions.every(previous => previous !== p), 'new Player identity each session');
      sessions.push(p);
      open(p, closedId);
      ticks(2);
      const [object] = owned(p);
      assert.equal(object.getId(), openId);
      assert.ok(core.ObjectManager.objectsAt(object.getLocation()).includes(object));
      objects.push(object);
      const mapRestores = t.mock.method(p.getPacketSender(), 'sendObject', () => {});
      logout(p);
      assert.equal(mapRestores.mock.callCount(), 0, 'logout cleanup is quiet');
    }
    assert.equal(sessions.flatMap(owned).length, 0, 'no old Player remains rooted by an owned locker');
    for (const object of objects) {
      assert.equal(core.ObjectManager.objectsAt(object.getLocation()).includes(object), false);
    }
  });
  await t.test('spawned swing rope is removed while saved landing still recovers a new Player', () => {
    const p = login('cabinlogoutrope');
    p.setLocation(new core.Location(1816, 4830, 2));
    p.getInventory().adds(core.ItemIdentifiers.ROPE, 1);
    t.mock.method(Math, 'random', () => 0.99);
    assert.equal(PluginManager.emitItemOnObject({ player: p, itemId: core.ItemIdentifiers.ROPE,
      objectId: 11292, object: new core.GameObject(11292, p.getLocation().clone(), 10, 0, null),
      handled: false }), true);
    ticks(8);
    const [rope] = owned(p);
    assert.equal(rope.getId(), 11311, 'actual scheduled swing rope appeared');
    const landing = [1822, 4830, 1];
    assert.deepEqual(p.getAttribute('quest.cabin_fever.swing_landing'), landing);
    logout(p);
    assert.deepEqual(p.getAttribute('quest.cabin_fever.swing_landing'), landing, 'logout retains durable recovery');
    const save = PlayerSave.fromPlayer(p), next = login(p.getUsername());
    save.applyToPlayer(next);
    PluginManager.emitCustomEvent('player:bootstrap-complete', { player: next });
    next.setNeedsPlacement(false);
    assert.deepEqual([next.getLocation().getX(), next.getLocation().getY(), next.getLocation().getZ()], landing);
    assert.equal(next.getAttribute('quest.cabin_fever.swing_landing'), null);
    assert.equal(next.getPacketSender().getVarbit(1740), 0);
    assert.equal(next.getMovementQueue().getMobility().canMove(), true);
    ticks(30);
    assert.equal(owned(p).length, 0, 'cancelled swing leaves no old-session rope');
    assert.equal(core.ObjectManager.objectsAt(rope.getLocation()).includes(rope), false);
    logout(next);
  });
});

const transcripts = [];
runtime.startTranscript = (_api, player, npcId, page, variant, select) => {
  transcripts.push({ player, npcId, page, variant, select });
  return true;
};

function setup(completed = []) {
  transcripts.length = 0;
  const completedQuests = new Set(completed);
  const custom = new Map();
  const hooks = {
    conditions: [],
    variants: [],
    npcActions: new Map(),
    object: [],
    objectRoute: [],
    namedObjects: new Map(),
    itemOnObject: [],
    namedItemOnObject: [],
    itemActions: new Map(),
    npcDeath: [],
    serverStartup: [],
    regionLoaded: [],
    activeRegions: [],
    removedNpcs: [],
    spawnedNpcs: [],
    groundItemPickup: [],
    buttons: new Map(),
  };
  const ownedLocs = [];
  const messages = [];
  const animations = [];
  let tick = 0;
  const tasks = [];
  const worldNpcs = [];
  const api = new Proxy({
    core: {
      ...core,
      World: {
        getNpcs: () => ({
          [Symbol.iterator]: () => worldNpcs[Symbol.iterator](),
          search: (predicate) => worldNpcs.find(predicate),
        }),
        getProcessCycle: () => tick,
      },
      CountdownTask: class {
        constructor(player, ticks, run) { Object.assign(this, { player, ticks, run }); }
      },
      TaskManager: {
        submit(task) { task.due = tick + task.ticks; tasks.push(task); },
        cancelTasks() {},
      },
      MultiChatboxPrompt: { getPending: () => null },
      // The battle's owned locs (open lockers, the swing rope) are recorded, not put on a map.
      ObjectManager: {
        register(loc) { ownedLocs.push(loc); },
        deregister(loc) {
          const index = ownedLocs.indexOf(loc);
          if (index >= 0) ownedLocs.splice(index, 1);
        },
      },
    },
    onInterfaceActionButton(ids, handler) {
      for (const id of [].concat(ids)) hooks.buttons.set(id, handler);
    },
    persistAttribute() {},
    onNpcDialogueVariant(handler) { hooks.variants.push(handler); },
    onNpcDialogueCondition(handler) { hooks.conditions.push(handler); },
    onNpcInteraction(names, actions) {
      for (const name of [].concat(names)) hooks.npcActions.set(name, actions);
    },
    onObjectRoute(handler) { hooks.objectRoute.push(handler); },
    onObjectInteraction(nameOrHandler, actions) {
      if (typeof nameOrHandler === 'function') hooks.object.push(nameOrHandler);
      else hooks.namedObjects.set(nameOrHandler, actions);
    },
    onItemOnObject(...args) {
      if (typeof args[0] === 'function') hooks.itemOnObject.push(args[0]);
      else hooks.namedItemOnObject.push({ item: args[0], object: args[1], handler: args[2] });
    },
    onItemAction(name, actions) { hooks.itemActions.set(name, actions); },
    onNpcDeath(handler) { hooks.npcDeath.push(handler); },
    onServerStartup(handler) { hooks.serverStartup.push(handler); },
    onRegionLoaded(handler) { hooks.regionLoaded.push(handler); },
    onActiveRegionsUpdated(handler) { hooks.activeRegions.push(handler); },
    removeNpc(npc) { hooks.removedNpcs.push(npc); },
    spawnNpc(definition) { hooks.spawnedNpcs.push(definition); },
    onGroundItemPickup(handler) { hooks.groundItemPickup.push(handler); },
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && completedQuests.has(event.key)) event.complete = true;
      for (const handler of custom.get(name) ?? []) handler(event);
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  require('../plugins/quests/quests/CabinFever.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'cabin_fever');

  const attributes = new Map();
  const inventory = new Map();
  let full = false;
  let packet;
  packet = new Proxy({
    varps: new Map(),
    varbits: new Map(),
    sendConfig(id, value) { packet.varps.set(id, value); return packet; },
    openInterface: -1,
    sendInterface(id) { packet.openInterface = id; return packet; },
    sendInterfaceRemoval() { packet.openInterface = -1; return packet; },
    getVarp(id) { return packet.varps.get(id) ?? 0; },
    // Varbits live in their base varp, as PacketSender keeps them, so a varp restore restores them.
    sendVarbit(id, value) {
      const { baseVar, startBit, endBit } = core.CacheDefinitions.getVarbit(id);
      const mask = (2 ** (endBit - startBit + 1) - 1) << startBit;
      packet.varps.set(baseVar, ((packet.varps.get(baseVar) ?? 0) & ~mask) | ((value << startBit) & mask));
      return packet;
    },
    getVarbit(id) {
      const { baseVar, startBit, endBit } = core.CacheDefinitions.getVarbit(id);
      return ((packet.varps.get(baseVar) ?? 0) >> startBit) & (2 ** (endBit - startBit + 1) - 1);
    },
  }, { get(target, key) { return key in target ? target[key] : () => packet; } });
  let location = new core.Location(3678, 3494, 0);
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => packet,
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      // A full inventory refuses a new stack (the real ItemContainer.adds sends
      // "You couldn't hold all those items." and adds nothing).
      adds: (id, amount) => {
        if (full && !inventory.has(id)) return false;
        inventory.set(id, (inventory.get(id) ?? 0) + amount);
        return true;
      },
      deleteNumber: (id, amount) => inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - amount)),
      isFull: () => full,
      getFreeSlots: () => (full ? 0 : 28),
    }),
    getSkillManager: () => ({
      getMaxLevel: (skill) =>
        skill === core.Skill.AGILITY ? 42
          : skill === core.Skill.CRAFTING ? 45
            : skill === core.Skill.SMITHING ? 50
              : skill === core.Skill.RANGED ? 40 : 0,
      addExperiences() {},
    }),
    getLocation: () => location,
    getInterfaceId: () => packet.openInterface,
    moveTo(next) { location = next; },
    getDialogueManager: () => ({ isActive: () => false }),
    isRegistered: () => true,
    sendMessage(message) { messages.push(message); },
    performAnimation(animation) { animations.push(animation.getId?.() ?? animation.id); },
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {}, addSteps() {} }),
    forceMovement: null,
    getForceMovement() { return this.forceMovement; },
    setForceMovement(movement) { this.forceMovement = movement; },
    runEnergy: 100,
    setRunEnergy(value) { this.runEnergy = value; },
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage() {} }) }),
    getUsername: () => 'qh728-q009',
  };
  const emit = (name, event) => {
    for (const handler of custom.get(name) ?? []) handler({ player, handled: false, ...event });
  };
  const choose = (option, npcId = core.NpcIdentifiers.BILL_TEACH) => emit('npc-dialogue:choice', { npcId, option });
  const action = (stepId) => emit('npc-dialogue:action', { stepId });
  const condition = (stepId) => hooks.conditions[0]({ player, stepId });
  const variant = (npcId = core.NpcIdentifiers.BILL_TEACH_3) => hooks.variants[0]({ player, npcId });
  const object = (objectId, option) => hooks.object[0]({
    player,
    objectId,
    clickType: 1,
    definition: { getActions: () => [option] },
    handled: false,
  });
  const itemOnObject = (itemId, objectId) => hooks.itemOnObject[0]({ player, itemId, objectId, handled: false });
  const pickup = (groundItemId, x, y, z) => {
    const event = { player, groundItem: {}, groundItemId, location: { x, y, z }, handled: false };
    hooks.groundItemPickup.forEach((handler) => handler(event));
    return event;
  };
  const npcTalk = (npcId, name = 'Bill Teach', location = undefined) => hooks.npcActions.get(name)?.['Talk-to']({
    player,
    npcId,
    clickType: 1,
    location,
    definition: { getName: () => name, getActions: () => ['Talk-to'] },
    handled: false,
  });
  const namedObject = (name, objectId, option) => {
    const event = {
      player,
      objectId,
      clickType: 1,
      definition: { getName: () => name, getActions: () => [option] },
      handled: false,
    };
    hooks.namedObjects.get(name)?.[option]?.(event);
    return event;
  };
  const itemAction = (name, option, itemId) => {
    const event = { player, itemId, option, clickType: 1, handled: false };
    hooks.itemActions.get(name)?.[option]?.(event);
    return event;
  };
  const npcDeath = (npcId, npc) => {
    const event = { player, killer: player, npc, npcId, location: npc?.getLocation?.(), remains: null };
    hooks.npcDeath.forEach((handler) => handler(event));
    return event;
  };
  const namedItemOnObject = (itemName, objectName, itemId, objectId) => {
    const entry = hooks.namedItemOnObject.find(
      (candidate) => candidate.item === itemName && candidate.object === objectName
    );
    const event = { player, itemId, objectId, handled: false };
    entry?.handler?.(event);
    return event;
  };
  const advance = (steps = 3) => {
    for (let step = 0; step < steps; step++) {
      tick++;
      for (const task of [...tasks]) {
        if (task.due <= tick && !task.done) { task.done = true; task.run(); }
      }
    }
  };
  const closeInterface = () => packet.sendInterfaceRemoval();
  const button = (id) => hooks.buttons.get(id)?.({ player, buttonId: id, action: 1 });
  /** Opens a locker, then searches the open one, as live's two clicks do. */
  const openLocker = (closedId, openId) => {
    object(closedId, 'Open');
    advance(1);
    object(openId, 'Search');
  };
  const count = (id) => inventory.get(id) ?? 0;
  const varbit = (id) => packet.getVarbit(id);
  const varp = (id) => packet.getVarp(id);
  const stage = () => quest.getStage(player);
  const lastTranscript = () => transcripts.at(-1);
  return {
    quest, player, choose, action, condition, variant, object, itemOnObject, pickup, npcTalk,
    namedObject, namedItemOnObject, itemAction, npcDeath, hooks, worldNpcs, advance,
    complete: (key) => completedQuests.add(key),
    bootstrap: () => {
      emit('player:bootstrap-complete', {});
      runtime.sendQuestVarps({ player });
    },
    /** Live order at login: the quest list's varps first (onPlayerLogin), then the bootstrap. */
    relog: () => {
      // A new session: the client has no varps until the server sends them.
      packet.varps.clear();
      runtime.sendQuestVarps({ player });
      emit('player:bootstrap-complete', {});
    },
    count, varbit, varp, stage, lastTranscript, button, openLocker, closeInterface, ownedLocs, messages, animations,
    setFullInventory: (value) => { full = value; },
    emitCustom: (name, event) => { for (const handler of custom.get(name) ?? []) handler(event); },
  };
}

test('Cabin Fever starts only after the final confirmation and requires Priest in Peril', () => {
  const h = setup(['pirates_treasure', 'rum_deal']);

  h.choose("Yes, I've always wanted to be a pirate!");
  assert.equal(h.stage(), 0, 'the first yes alone does not start the quest');
  assert.equal(h.condition('tOUrYm'), true, 'missing Priest in Peril fails the start requirement');

  h.choose('Yes, I am a man of my word.');
  assert.equal(h.stage(), 0, 'missing Priest in Peril cannot start the quest');

  h.complete('priest_in_peril');
  assert.equal(h.condition('tOUrYm'), false);
  h.choose('Yes, I am a man of my word.');
  assert.equal(h.stage(), 1, 'the final confirmation starts the quest');
});

test('declining the final confirmation leaves Cabin Fever unstarted', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);

  h.choose("Yes, I've always wanted to be a pirate!");
  h.choose('No, if it\'s so dangerous your crew left, count me out.');
  assert.equal(h.stage(), 0, 'declining Bill does not start the quest');

  h.choose("Yes, I've always wanted to be a pirate!");
  h.choose('Yes, I am a man of my word.');
  assert.equal(h.stage(), 1);
});

test('live\'s start prompt: "Start the Cabin Fever quest?" with Yes. and No., whose hook starts the quest', () => {
  const page = require('../data/definitions/npc-dialogues.json')['Cabin Fever'];
  const prompt = JSON.stringify(page.variants['starting-the-quest']);
  assert.match(prompt, /"prompt":"Start the Cabin Fever quest\?"/);
  assert.match(prompt, /"text":"Yes\.","steps":/);
  assert.match(prompt, /"hook":"quest:cabin-fever:start"/);
  assert.match(prompt, /I'm all ready te get underway/, 'capture tick 433');

  const h = setup(['pirates_treasure', 'rum_deal']);
  const emitHook = () => {
    const event = { player: h.player, npcId: core.NpcIdentifiers.BILL_TEACH, hook: 'quest:cabin-fever:start' };
    h.emitCustom('npc-dialogue:hook', event);
    return event;
  };
  const refused = emitHook();
  assert.equal(h.stage(), 0, 'missing Priest in Peril cannot start the quest');
  assert.equal(refused.end, true, 'the branch ends');
  h.complete('priest_in_peril');
  emitHook();
  assert.equal(h.stage(), 1, 'Yes. starts the quest');
  assert.equal(h.varp(655), 10);
  h.choose('Yes.');
  assert.equal(h.stage(), 1, 'the choice after the hook does not start it twice');
});

// Interface 501/502 buttons, (group << 16) | child, as capture CabinFever presses them.
const GUN = { BARREL: (501 << 16) | 8, FUSE: (501 << 16) | 9, RAMROD: (501 << 16) | 10, BALL: (501 << 16) | 11, CANISTER: (501 << 16) | 12 };
const REPAIR = { ROPE: (502 << 16) | 8, HAMMER: (502 << 16) | 9, TACKS: (502 << 16) | 10, PLANKS: (502 << 16) | 11, PASTE: (502 << 16) | 12 };
const REPAIR_LOCKER_OPEN = 11247;
const GUN_LOCKER_OPEN = 11249;

test('Cabin Fever completes from stage 0 through the real route handlers', () => {
  const originalRandom = Math.random;
  // Fixture: 0.35 lands every swing (fall chance 1/3) and hits every shot (Ranged 40: 0.41).
  Math.random = () => 0.35;
  try {
    const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
    const I = core.ItemIdentifiers;
    const N = core.NpcIdentifiers;
    const O = core.ObjectIdentifiers;
    // Object ids below are the cache's registered multi-loc parents/placements.
    const CANNON = 11213;
    const ENEMY_POWDER_BARREL = 11237;
    const FUSE_2 = 11242;
    const HOISTS = 11292;
    const CHEST = 11230;
    const CRATE = 11227;
    const BARREL = 11233;
    const HOLES = [11221, 11222, 11223];
    const swing = () => {
      h.object(O.CLIMBING_NET_2, 'Climb');
      h.advance(2);
      h.itemOnObject(I.ROPE, HOISTS);
      h.advance(25);
    };

    // Start (live's "Start the Cabin Fever quest?" prompt answers "Yes.") and set sail.
    h.choose("Yes, I've always wanted to be a pirate!");
    h.choose('Yes.');
    assert.equal(h.stage(), 1);
    assert.equal(h.varp(655), 10, 'started wire value');
    h.npcTalk(N.BILL_TEACH_3);
    h.choose("Let's go Cap'n!");
    h.advance();
    assert.equal(h.stage(), 2);
    assert.equal(h.varp(655), 20, 'sailing wire value');
    assert.equal(h.lastTranscript().variant, 'cutscene-on-the-ship');
    h.action('cabin-fever:arrive');
    assert.equal(h.stage(), 3);
    assert.equal(h.varp(655), 30, 'sabotage wire value');
    assert.equal(h.varbit(1741), 1, 'the cannon arrives broken/exploded');
    assert.equal(h.varbit(1746), 0, 'live sets nothing but the cannon on arrival');

    // The lockers open, then their Search shows the modal; each press gives one item.
    h.openLocker(O.REPAIR_LOCKER, REPAIR_LOCKER_OPEN);
    assert.ok(h.ownedLocs.some((loc) => loc.getId() === REPAIR_LOCKER_OPEN), 'the open locker is shown');
    for (let rope = 0; rope < 4; rope++) h.button(REPAIR.ROPE);
    assert.equal(h.count(I.ROPE), 4);
    assert.equal(h.messages.at(-1), 'You take a coil of rope.');
    h.openLocker(O.GUN_LOCKER, GUN_LOCKER_OPEN);
    h.button(GUN.FUSE);
    assert.equal(h.count(I.FUSE), 1);
    assert.equal(h.messages.at(-1), 'You take some fuse.');
    h.button(GUN.CANISTER);
    assert.equal(h.count(I.CANISTER_2), 0, 'no canister before the crew objective');
    const tinderbox = h.pickup(I.TINDERBOX_3, 1814, 4825, 0);
    assert.equal(tinderbox.handled, true);
    assert.equal(h.count(I.TINDERBOX), 1);

    // The chest and barrel refuse a search while the enemy cannon fires (capture ticks 929, 934).
    h.object(CHEST, 'Plunder');
    assert.equal(h.lastTranscript().variant,
      'dealing-with-the-cannon-trying-to-plunder-the-chest-or-ransack-the-barrel-before-dealing-with-the-cannon');

    swing();
    assert.equal(h.player.getLocation().getX(), 1822, 'swung onto the enemy deck');
    assert.equal(h.player.getLocation().getZ(), 1);
    assert.equal(h.count(I.ROPE), 3, 'one ordinary rope is used per swing');
    assert.equal(h.varbit(1740), 0, 'the rope falls off the mast after the swing');
    assert.equal(h.lastTranscript().variant, 'dealing-with-the-cannon-using-a-rope-swing');

    h.itemOnObject(I.FUSE, ENEMY_POWDER_BARREL);
    assert.equal(h.varbit(1756), 2, 'the barrel shows its fuse-attached transform');
    assert.equal(h.varbit(1761), 0, 'the fuse is laid out over the next ticks');
    h.advance(6);
    assert.equal(h.varbit(1761), 1, 'first fuse tile');
    h.advance(4);
    assert.equal(h.varbit(1762), 1, 'second fuse tile');
    h.itemOnObject(I.TINDERBOX, FUSE_2);
    h.advance(2);
    assert.equal(h.messages.at(-1), 'You light the fuse...');
    assert.equal(h.varbit(1762), 0, 'the fuse burns back');
    h.advance(4);
    assert.equal(h.varbit(1749), 1, 'enemy cannon destroyed');
    assert.equal(h.varbit(1756), 1, 'the barrel explodes');
    assert.equal(h.messages.at(-1), '...and destroy the barrel and the cannon.');
    assert.equal(h.varp(655), 40, 'the blast moves the varp before Bill is told');
    h.relog();
    assert.equal(h.varp(655), 40, 'a relog keeps the objective-done step');
    swing();
    assert.equal(h.count(I.ROPE), 2, 'the return swing uses a second rope');
    assert.equal(h.player.getLocation().getX(), 1817, 'back on the Adventurous');
    h.variant(N.BILL_TEACH_3);
    assert.equal(h.stage(), 4);
    assert.equal(h.varp(655), 50, 'repair-phase wire value');

    // Planks two to a press, six at most; tacks ten; one hammer and paste per press.
    h.openLocker(O.REPAIR_LOCKER, REPAIR_LOCKER_OPEN);
    for (let press = 0; press < 3; press++) h.button(REPAIR.TACKS);
    for (let press = 0; press < 4; press++) h.button(REPAIR.PLANKS);
    assert.equal(h.messages.at(-1), 'You already have enough Repair Planks.');
    h.button(REPAIR.HAMMER);
    for (let press = 0; press < 3; press++) h.button(REPAIR.PASTE);
    assert.equal(h.count(I.REPAIR_PLANK_2), 6);
    assert.equal(h.count(I.TACKS), 30);
    assert.equal(h.count(I.SWAMP_PASTE), 3);
    for (const hole of HOLES) {
      h.itemOnObject(I.REPAIR_PLANK_2, hole);
      h.itemOnObject(I.SWAMP_PASTE, hole);
    }
    assert.equal(h.varbit(1759), 3);
    assert.equal(h.varbit(1760), 3);
    assert.equal(h.varp(655), 50, 'live holds the last hole three ticks (1193 -> 1196)');
    h.advance(3);
    assert.equal(h.varp(655), 60, 'the last hole moves the varp before Bill is told');
    assert.equal(h.count(I.REPAIR_PLANK_2), 0);
    assert.equal(h.count(I.TACKS), 0);
    assert.equal(h.count(I.SWAMP_PASTE), 0);
    h.variant(N.BILL_TEACH_3);
    assert.equal(h.stage(), 5);
    assert.equal(h.varp(655), 70, 'plunder-phase wire value');

    // Loot 6, wait out the barrel and crate refills, loot 3 more, relog for the chest.
    swing();
    assert.equal(h.count(I.ROPE), 1, 'the looting trip uses a third rope');
    h.object(CHEST, 'Plunder');
    h.object(CRATE, 'Loot');
    h.object(BARREL, 'Ransack');
    assert.equal(h.count(I.PLUNDER), 6);
    h.object(BARREL, 'Ransack');
    assert.equal(h.count(I.PLUNDER), 6, 'a looted barrel is recently ransacked');
    h.advance(100);
    assert.equal(h.varbit(1755), 0, 'the barrel refills on its own after 100 ticks');
    assert.equal(h.varbit(1753), 1, 'the crate is still empty');
    h.advance(100);
    assert.equal(h.varbit(1753), 0, 'the crate refills after 200 ticks');
    assert.equal(h.varbit(1754), 1, 'the chest is still empty');
    h.object(CRATE, 'Loot');
    h.object(BARREL, 'Ransack');
    assert.equal(h.count(I.PLUNDER), 9);
    h.bootstrap();
    h.object(CHEST, 'Plunder');
    assert.equal(h.count(I.PLUNDER), 12);
    swing();
    assert.equal(h.count(I.ROPE), 0, 'the return swing uses the fourth rope');
    h.object(O.PLUNDER_STORAGE, 'Count-plunder');
    assert.equal(h.messages.at(-1), 'This chest is empty.');
    h.itemOnObject(I.PLUNDER, O.PLUNDER_STORAGE);
    assert.equal(h.varbit(1752), 10);
    assert.equal(h.messages.at(-1), 'You deposit as much plunder as you can.');
    assert.equal(h.count(I.PLUNDER), 2, 'surplus stays for Bill to confiscate');
    assert.equal(h.varp(655), 80, 'the tenth load moves the varp before Bill is told');
    h.variant(N.BILL_TEACH_3);
    assert.equal(h.stage(), 6);
    assert.equal(h.varp(655), 90, 'barrel-phase wire value');

    // Replace the cannon barrel: the broken one comes off, then the new one goes on.
    h.openLocker(O.GUN_LOCKER, GUN_LOCKER_OPEN);
    h.button(GUN.FUSE);
    assert.equal(h.messages.at(-1), 'You do not need any fuse right now.');
    h.button(GUN.BARREL);
    assert.equal(h.count(I.CANNON_BARREL), 1);
    h.object(CANNON, 'Repair');
    assert.equal(h.varbit(1741), 2, 'the broken barrel is off');
    assert.equal(h.count(7146), 1, 'the broken cannon barrel is in the inventory');
    h.advance(2);
    assert.equal(h.messages.at(-1), 'You remove the broken cannon barrel.');
    h.advance(2);
    assert.equal(h.varbit(1741), 0);
    assert.equal(h.count(I.CANNON_BARREL), 0);
    assert.equal(h.varp(655), 100, 'the new barrel moves the varp before Bill is told');
    h.variant(N.BILL_TEACH_3);
    assert.equal(h.stage(), 7);
    assert.equal(h.varp(655), 110, 'canister-phase wire value');

    // One canister hit is the objective; the shot leaves the barrel needing the ramrod.
    h.openLocker(O.GUN_LOCKER, GUN_LOCKER_OPEN);
    h.button(GUN.RAMROD);
    h.button(GUN.FUSE);
    h.button(GUN.CANISTER);
    assert.equal(h.count(I.RAMROD), 1);
    assert.equal(h.count(I.CANISTER_2), 1);
    h.object(O.POWDER_BARREL_2, 'Take-powder');
    h.itemOnObject(I.GUNPOWDER, CANNON);
    h.itemOnObject(I.RAMROD, CANNON);
    assert.equal(h.varbit(1743), 1, 'the powder is tamped');
    h.itemOnObject(I.CANISTER_2, CANNON);
    h.advance(1);
    assert.equal(h.varbit(1744), 2, 'the canister rolls in a tick later');
    h.itemOnObject(I.FUSE, CANNON);
    assert.equal(h.varbit(1741), 3, 'cannon armed');
    h.object(CANNON, 'Fire!');
    assert.equal(h.messages.at(-1), 'You fire the cannon at the crew!');
    assert.equal(h.varbit(1746), 1, 'the shot leaves the barrel needing the ramrod');
    h.advance(2);
    assert.equal(h.messages.at(-1), 'You hit them!');
    assert.equal(h.varp(655), 120, 'the canister hit moves the varp before Bill is told');
    h.variant(N.BILL_TEACH_3);
    assert.equal(h.stage(), 8);
    assert.equal(h.varp(655), 130, 'cannonball-phase wire value');

    // Three cannonballs, cleaning with the ramrod between shots.
    h.openLocker(O.GUN_LOCKER, GUN_LOCKER_OPEN);
    h.button(GUN.CANISTER);
    assert.equal(h.messages.at(-1), 'You do not need a canister round right now.');
    for (let shot = 1; shot <= 3; shot++) {
      h.button(GUN.BALL);
      h.button(GUN.FUSE);
      h.itemOnObject(I.RAMROD, CANNON);
      assert.equal(h.varbit(1746), 0, 'the ramrod cleans the barrel');
      h.object(O.POWDER_BARREL_2, 'Take-powder');
      h.itemOnObject(I.GUNPOWDER, CANNON);
      h.itemOnObject(I.RAMROD, CANNON);
      h.itemOnObject(I.CANNON_BALL_2, CANNON);
      h.advance(1);
      h.itemOnObject(I.FUSE, CANNON);
      h.object(CANNON, 'Fire!');
      h.advance(1);
      assert.equal(h.varbit(1750), shot);
    }
    assert.equal(h.lastTranscript().variant, 'sinking-the-enemy-ship-after-the-third-and-final-hit');

    // End cutscene and rewards.
    h.action('7Zv7QG');
    h.advance();
    assert.equal(h.lastTranscript().variant, 'end-of-quest-cutscene');
    h.action('V-4Bls');
    assert.equal(h.stage(), 9);
    assert.equal(h.varp(655), 140, 'canonical Cabin Fever completion varp');
    assert.equal(h.count(I.BOOK_O_PIRACY), 1);
    assert.equal(h.varbit(1763), 1, 'given the book');
    for (const varbit of [1746, 1750, 1751, 1757, 1758, 1752, 1756, 1759, 1760, 1749]) {
      assert.equal(h.varbit(varbit), 0, `completion clears varbit ${varbit} as live does`);
    }
    assert.equal(h.player.getLocation().getX(), 3665, 'arrived at Mos Le\'Harmless');
    assert.equal(h.count(I.ROPE), 0, 'the four ropes were used for the four swings');

    // Post-quest: claim the 10,000 coins once, then recover a lost Book o' Piracy.
    assert.equal(
      h.variant(N.BILL_TEACH_4),
      'end-of-quest-cutscene-claiming-the-loot-from-bill-teach-after-the-quest'
    );
    h.action('RMIMnr');
    assert.equal(h.count(I.COINS), 10000);
    assert.equal(
      h.variant(N.BILL_TEACH_4),
      'standard-dialogue-after-completing-cabin-fever-on-board-the-adventurous'
    );

    h.player.getInventory().deleteNumber(I.BOOK_O_PIRACY, 1);
    assert.equal(h.condition('hO36Ny'), true, 'lost book condition');
    h.action('5mdRTN');
    assert.equal(h.count(I.BOOK_O_PIRACY), 1, 'replacement book');

    // Repeat completion and relog must not duplicate the reward.
    h.action('V-4Bls');
    assert.equal(h.stage(), 9);
    assert.equal(h.count(I.BOOK_O_PIRACY), 1);
    assert.equal(h.count(I.COINS), 10000);
    h.bootstrap();
    assert.equal(h.stage(), 9);
    assert.equal(h.varp(655), 140, 'login re-sends the canonical completion varp');
    assert.equal(h.count(I.BOOK_O_PIRACY), 1);
    assert.equal(h.count(I.COINS), 10000);
  } finally {
    Math.random = originalRandom;
  }
});

test('locker buttons answer only while their modal is open, and the repair kit stops at what is needed', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  const O = core.ObjectIdentifiers;
  h.quest.setStage(h.player, 3);
  h.button(REPAIR.ROPE);
  h.button(GUN.FUSE);
  assert.equal(h.count(I.ROPE), 0, 'no modal, no rope');
  assert.equal(h.count(I.FUSE), 0, 'no modal, no fuse');
  h.openLocker(O.GUN_LOCKER, GUN_LOCKER_OPEN);
  h.button(REPAIR.ROPE);
  assert.equal(h.count(I.ROPE), 0, 'the gun locker\'s modal does not answer the repair locker\'s buttons');
  h.closeInterface();

  h.openLocker(O.REPAIR_LOCKER, REPAIR_LOCKER_OPEN);
  for (let press = 0; press < 6; press++) h.button(REPAIR.ROPE);
  assert.equal(h.count(I.ROPE), 4, 'four ropes, two per round trip (the Wiki)');
  assert.equal(h.messages.at(-1), 'You already have enough Rope.');
  h.quest.setStage(h.player, 4);
  for (let press = 0; press < 3; press++) h.button(REPAIR.HAMMER);
  for (let press = 0; press < 5; press++) h.button(REPAIR.TACKS);
  for (let press = 0; press < 5; press++) h.button(REPAIR.PASTE);
  assert.equal(h.count(I.HAMMER), 1);
  assert.equal(h.count(I.TACKS), 30, 'ten tacks for each of the three holes');
  assert.equal(h.count(I.SWAMP_PASTE), 3, 'one paste for each of the three holes');
  assert.equal(h.messages.at(-1), 'You already have enough Swamp Paste.');
  h.player.getPacketSender().sendVarbit(1751, 2); // one hole done
  h.player.getInventory().deleteNumber(I.TACKS, 30);
  h.player.getInventory().deleteNumber(I.SWAMP_PASTE, 3);
  for (let press = 0; press < 5; press++) h.button(REPAIR.TACKS);
  for (let press = 0; press < 5; press++) h.button(REPAIR.PASTE);
  assert.equal(h.count(I.TACKS), 20, 'only the open holes\' tacks');
  assert.equal(h.count(I.SWAMP_PASTE), 2, 'only the open holes\' paste');
});

test('a fall from the rope swing lands in the sea with no run energy, then on the other ship', () => {
  const originalRandom = Math.random;
  Math.random = () => 0; // below the fall chance
  try {
    const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
    const I = core.ItemIdentifiers;
    const O = core.ObjectIdentifiers;
    h.quest.setStage(h.player, 3);
    h.player.getInventory().adds(I.ROPE, 1);
    h.player.moveTo(new core.Location(1816, 4832, 1)); // beside the Adventurous' net
    h.object(O.CLIMBING_NET_2, 'Climb');
    h.advance(2);
    assert.equal(h.messages.at(-1), 'You climb up the net.');
    assert.equal(h.player.getLocation().getZ(), 2);
    h.itemOnObject(I.ROPE, 11292);
    assert.equal(h.varbit(1740), 1, 'the rope is tied');
    h.advance(4);
    assert.equal(h.messages.at(-1), 'You attach a rope to the sails.');
    h.advance(15);
    assert.equal(h.lastTranscript().variant, 'dealing-with-the-cannon-using-a-rope-swing-falling-on-a-rope-swing');
    assert.equal(h.varbit(1740), 0);
    assert.equal(h.player.runEnergy, 0, 'the swim drains the run energy');
    h.advance(2);
    assert.equal(h.player.getLocation().getZ(), 0, 'in the sea');
    h.advance(3);
    const landed = h.player.getLocation();
    assert.deepEqual([landed.getX(), landed.getY(), landed.getZ()], [1822, 4830, 1], 'climbs out on the enemy deck');
    assert.equal(h.ownedLocs.length, 0, 'the swing rope is gone');
  } finally {
    Math.random = originalRandom;
  }
});

test('Return-Home takes the player and Bill back to port, and the sail back resumes the stage', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  h.quest.setStage(h.player, 5);
  h.player.moveTo(new core.Location(1814, 4834, 1));
  h.player.getInventory().adds(I.PLUNDER, 3);
  const event = { player: h.player, npcId: N.BILL_TEACH_3, handled: false };
  h.hooks.npcActions.get('Bill Teach')['Return-Home'](event);
  assert.equal(event.handled, true);
  assert.equal(h.lastTranscript().variant, 'dealing-with-the-cannon-choosing-the-return-home-option');
  h.action('8EJUBr');
  h.advance(3);
  const port = h.player.getLocation();
  assert.deepEqual([port.getX(), port.getY(), port.getZ()], [3714, 3497, 1], 'back on the Adventurous at port');
  assert.equal(h.count(I.PLUNDER), 0, 'the Wiki: leaving the ship loses the plunder');

  h.npcTalk(N.BILL_TEACH, 'Bill Teach', { x: 3714, y: 3500, z: 1 });
  assert.equal(h.lastTranscript().variant,
    'dealing-with-the-cannon-talking-to-bill-teach-on-the-adventurous-after-running-away');
  const before = h.lastTranscript();
  h.choose("Let's go Cap'n!");
  h.advance(12);
  assert.equal(h.player.getLocation().getX(), 1815, 'sailed back to the battle');
  assert.equal(h.lastTranscript().variant, 'time-to-plunder-returning-to-plunder-from-the-port');
  assert.notEqual(h.lastTranscript(), before);
  assert.equal(h.stage(), 5, 'the stage is kept');

  // Back on the battle deck, Talk-to on Bill (4014, the port swap's id too) is the stage's talk.
  const talk = { player: h.player, npcId: N.BILL_TEACH_3, handled: false, location: { x: 1813, y: 4834, z: 1 } };
  assert.equal(h.hooks.npcActions.get('Bill Teach')['Talk-to'](talk), false, 'the variant selector owns the deck Bill');
});

test('completion removes quest supplies but leaves rope, hammer, tinderbox and swamp paste', () => {
  // Fixture start: the final cutscene stage, with one extra rope and leftover supplies.
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  h.quest.setStage(h.player, 8);
  h.player.getPacketSender().sendVarbit(1750, 3);
  const inventory = h.player.getInventory();
  inventory.adds(I.ROPE, 1);
  inventory.adds(I.FUSE, 1);
  inventory.adds(I.CANNON_BALL_2, 1);
  inventory.adds(I.HAMMER, 1);
  inventory.adds(I.TINDERBOX, 1);
  inventory.adds(I.SWAMP_PASTE, 1);

  h.action('V-4Bls');
  assert.equal(h.stage(), 9);
  assert.equal(h.count(I.ROPE), 1, 'rope is excluded from the cleanup');
  assert.equal(h.count(I.HAMMER), 1, 'hammer is excluded from the cleanup');
  assert.equal(h.count(I.TINDERBOX), 1, 'tinderbox is excluded from the cleanup');
  assert.equal(h.count(I.SWAMP_PASTE), 1, 'swamp paste is excluded from the cleanup');
  assert.equal(h.count(I.FUSE), 0);
  assert.equal(h.count(I.CANNON_BALL_2), 0);
});


test('old Cabin Fever saves restore the canonical completion varp on login', () => {
  // Fixture: a durable save written with the old internal stage 9 and no new wire mapping.
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  h.player.setAttribute('quest.cabin_fever.stage', 9);
  assert.equal(h.varp(655), 0, 'no wire value before the login bootstrap');

  h.bootstrap();
  assert.equal(h.stage(), 9, 'the internal durable stage is preserved');
  assert.equal(h.varp(655), 140, 'the login bootstrap sends the canonical completion value');
  assert.ok(h.varp(655) >= 140);
});

test('the once-only coin claim is not consumed when the coins cannot fit', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  h.quest.setStage(h.player, 9);
  h.setFullInventory(true);

  assert.equal(
    h.variant(N.BILL_TEACH_4),
    'end-of-quest-cutscene-claiming-the-loot-from-bill-teach-after-the-quest'
  );
  h.action('RMIMnr');
  assert.equal(h.count(I.COINS), 0, 'no coins were added to the full inventory');
  assert.equal(h.varbit(1765), 0, 'the claim is not consumed when the coins do not fit');
  assert.equal(
    h.variant(N.BILL_TEACH_4),
    'end-of-quest-cutscene-claiming-the-loot-from-bill-teach-after-the-quest',
    'the claim stays available for a retry'
  );

  h.setFullInventory(false);
  h.action('RMIMnr');
  assert.equal(h.count(I.COINS), 10000, 'the coins are granted once the bag has room');
  assert.equal(h.varbit(1765), 1, 'the claim is consumed once the coins landed');
  assert.equal(
    h.variant(N.BILL_TEACH_4),
    'standard-dialogue-after-completing-cabin-fever-on-board-the-adventurous'
  );
});

test('permanent Cabin Fever floor piles return ordinary rope and tinderbox and retry when full', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  const ropePile = groundItemDefinitions.find(({ id, location }) => id === I.ROPE_5
    && location.x === 1822 && location.y === 4827 && location.z === 1);
  const tinderPile = groundItemDefinitions.find(({ id, location }) => id === I.TINDERBOX_3
    && location.x === 1814 && location.y === 4825 && location.z === 0);
  assert.equal(ropePile?.respawn, 0, 'the canonical enemy-deck rope is permanent');
  assert.equal(tinderPile?.respawn, 0, 'the canonical hold tinderbox is permanent');

  h.setFullInventory(true);
  assert.equal(h.pickup(I.ROPE_5, 1822, 4827, 1).handled, true);
  assert.equal(h.count(I.ROPE), 0, 'a full bag leaves the rope pile available');
  assert.equal(h.pickup(I.TINDERBOX_3, 1814, 4825, 0).handled, true);
  assert.equal(h.count(I.TINDERBOX), 0, 'a full bag leaves the tinderbox pile available');

  h.setFullInventory(false);
  assert.equal(h.pickup(I.ROPE_5, 1822, 4827, 1).handled, true);
  assert.equal(h.count(I.ROPE), 1, 'the quest display variant gives an ordinary rope');
  assert.equal(h.pickup(I.ROPE_5, 1822, 4827, 1).handled, true);
  assert.equal(h.count(I.ROPE), 2, 'the permanent pile supports later loss recovery');
  assert.equal(h.pickup(I.TINDERBOX_3, 1814, 4825, 0).handled, true);
  assert.equal(h.count(I.TINDERBOX), 1, 'the hold pile gives an ordinary tinderbox');
});

test('Cabin Fever objectives cannot advance out of order', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  const O = core.ObjectIdentifiers;
  const CANNON = 11213;
  const CHEST = 11230;
  const HOLES = [11221, 11222, 11223];

  // Stage 0: no cutscene action, fuse blast or completion can be forced.
  h.action('cabin-fever:arrive');
  assert.equal(h.stage(), 0);
  h.action('jL6Wr9');
  assert.equal(h.varbit(1749), 0);
  h.action('7Zv7QG');
  assert.equal(transcripts.length, 0);
  h.action('V-4Bls');
  assert.equal(h.stage(), 0);
  assert.equal(h.quest.isComplete(h.player), false);

  // Sailing only reaches the battle at stage 2.
  h.quest.setStage(h.player, 2);
  h.action('cabin-fever:arrive');
  assert.equal(h.stage(), 3);

  // Stage 3: the enemy cannon needs a lit fuse, and hull repairs wait for stage 4.
  h.action('V-4Bls');
  assert.equal(h.stage(), 3);
  h.action('jL6Wr9');
  assert.equal(h.varbit(1749), 0, 'the cannon cannot blow before the fuse is lit');
  h.player.getInventory().adds(I.REPAIR_PLANK, 2);
  h.player.getInventory().adds(I.TACKS, 10);
  h.player.getInventory().adds(I.HAMMER, 1);
  h.itemOnObject(I.REPAIR_PLANK, HOLES[0]);
  assert.equal(h.varbit(1751), 0, 'holes cannot be planked during the cannon objective');

  // Stage 4: no plunder and no cannon loading.
  h.quest.setStage(h.player, 4);
  h.object(CHEST, 'Plunder');
  assert.equal(h.count(I.PLUNDER), 0);
  h.player.getInventory().adds(I.PLUNDER, 1);
  h.player.getInventory().adds(I.CANNON_BARREL, 1);
  h.player.getPacketSender().sendVarbit(1741, 2);
  h.itemOnObject(I.CANNON_BARREL, CANNON);
  assert.equal(h.varbit(1741), 2, 'the barrel cannot be fitted before the cannon objective');
  h.itemOnObject(I.PLUNDER, O.PLUNDER_STORAGE);
  assert.equal(h.varbit(1752), 0, 'plunder cannot be stored before the plunder objective');

  // Stage 6: repair works, loading does not.
  h.quest.setStage(h.player, 6);
  h.itemOnObject(I.CANNON_BARREL, CANNON);
  assert.equal(h.varbit(1741), 0);
  h.player.getInventory().adds(I.CANISTER, 1);
  h.itemOnObject(I.CANISTER, CANNON);
  assert.equal(h.varbit(1744), 0, 'canister cannot be loaded before the crew objective');

  // Stage 7 uses canisters only; stage 8 uses cannonballs only.
  h.quest.setStage(h.player, 7);
  h.player.getInventory().adds(I.CANNON_BALL_2, 1);
  h.itemOnObject(I.CANNON_BALL_2, CANNON);
  assert.equal(h.varbit(1744), 0, 'cannonballs are not the crew objective');
  h.itemOnObject(I.CANISTER, CANNON);
  h.advance(1); // the canister rolls in a tick after the load animation
  assert.equal(h.varbit(1744), 2);
  h.quest.setStage(h.player, 8);
  h.player.getInventory().adds(I.CANISTER, 1);
  h.itemOnObject(I.CANISTER, CANNON);
  assert.equal(h.varbit(1744), 2, 'canisters are not the hull objective');

  // Completion still needs the three hull holes.
  h.action('V-4Bls');
  assert.equal(h.stage(), 8);
  h.player.getPacketSender().sendVarbit(1750, 3);
  h.action('V-4Bls');
  assert.equal(h.stage(), 9);
  assert.equal(h.quest.isComplete(h.player), true);
});

test('only ordinary plunder in the enemy hold routes to the reachable side of its chest', () => {
  const h = setup();
  let mobile = true;
  let privateArea = null;
  h.player.getMovementQueue = () => ({ getMobility: () => ({ canMove: () => mobile }) });
  h.player.getPrivateArea = () => privateArea;
  const location = new core.Location(1823, 4840, 0);
  const chest = { getLocation: () => location, getPrivateArea: () => null };
  const atChest = { x: 1824, y: 4840, z: 0 };
  const route = (extra = {}) => {
    const event = {
      player: h.player,
      object: chest,
      objectId: 11230,
      clickType: 1,
      definition: { getInteractions: () => ['Plunder', 'Inspect'] },
      sourceLocation: atChest,
      destination: null,
      ...extra,
    };
    for (const handler of h.hooks.objectRoute) handler(event);
    return event.destination;
  };

  h.quest.setStage(h.player, 4);
  assert.equal(route(), null);
  h.quest.setStage(h.player, 5);
  assert.deepEqual(route(), atChest);
  assert.deepEqual(route({ sourceLocation: { x: 1824, y: 4838, z: 0 } }), atChest);
  assert.equal(route({ clickType: 0 }), null, 'item use stays on its normal route');
  assert.equal(route({ clickType: 2 }), null, 'other object actions stay on their normal route');
  assert.equal(route({ objectId: 11227 }), null, 'other containers stay on their normal route');
  assert.equal(route({ object: { ...chest, getLocation: () => new core.Location(1823, 4839, 0) } }), null);
  assert.equal(route({ sourceLocation: { ...atChest, z: 1 } }), null, 'deck clicks stay on their normal route');
  assert.equal(route({ sourceLocation: { ...atChest, x: 1818 } }), null);
  privateArea = {};
  assert.equal(route(), null, 'a player in a private area keeps normal routing');
  privateArea = null;
  mobile = false;
  assert.equal(route(), null, 'movement locks keep normal routing');
  mobile = true;
  h.quest.setStage(h.player, 6);
  assert.equal(route(), null);
});

test('Cabin Fever named NPC, object, item and death handlers are wired', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  const O = core.ObjectIdentifiers;

  for (const name of ['Bill Teach', 'Pirate', 'Mama']) {
    assert.ok(h.hooks.npcActions.has(name), `registered NPC ${name}`);
  }
  for (const name of ['Repair Locker', 'Gun Locker', 'Powder Barrel', 'Barrel', 'Cannon',
    'Broken Cannon', 'Crate', 'Closed chest', 'Open chest', 'Plunder Storage',
    'Climbing net', 'Climbing Net']) {
    assert.ok(h.hooks.namedObjects.has(name), `registered object ${name}`);
  }
  assert.ok(h.hooks.namedItemOnObject.some((entry) => entry.item === 'Fuse' && entry.object === 'Powder Barrel'));
  assert.ok(h.hooks.namedItemOnObject.some((entry) => entry.item === 'Rope' && entry.object === 'Hoisted sail'));
  assert.ok(h.hooks.itemActions.has("Book o' Piracy"));
  assert.equal(h.hooks.npcDeath.length, 1);

  // Mama's page is selected by whether the Book o' Piracy is carried.
  h.npcTalk(N.MAMA, 'Mama');
  assert.equal(h.lastTranscript().page, 'Mama');
  assert.equal(h.lastTranscript().variant, 'standard-dialogue-without-book-o-piracy');

  // Pirates only speak while the battle chain is live.
  const before = h.lastTranscript();
  h.npcTalk(N.PIRATE_27, 'Pirate');
  assert.equal(h.lastTranscript(), before, 'stage 0 pirates fall through to the shared dialogue runtime');
  h.quest.setStage(h.player, 3);
  h.npcTalk(N.PIRATE_27, 'Pirate');
  assert.equal(h.lastTranscript().page, 'Cabin Fever');

  // A 4013 spawn row that resolves to 4011 is still the port-ship Bill.
  h.quest.setStage(h.player, 1);
  h.npcTalk(N.BILL_TEACH, 'Bill Teach', { x: 3714, y: 3497, z: 1 });
  assert.equal(h.lastTranscript().variant, 'speaking-to-bill-teach-on-the-ship');
  h.quest.setStage(h.player, 3);

  // Named object and item-on-object handlers delegate to the id-based route.
  const locker = h.namedObject('Repair Locker', O.REPAIR_LOCKER, 'Open');
  assert.equal(locker.handled, true);
  h.advance(1);
  const search = h.namedObject('Repair Locker', REPAIR_LOCKER_OPEN, 'Search');
  assert.equal(search.handled, true, 'the open locker\'s Search is claimed');
  h.button(REPAIR.PLANKS);
  // 7148 is the quest plank the Repair Locker gives in live; 7121 is the animation dummy
  // the client wields while repairing, and Quest Helper's requirement is 7148 x6.
  assert.equal(h.count(I.REPAIR_PLANK_2), 2, 'the locker hands out the real quest plank');
  assert.equal(h.count(I.REPAIR_PLANK), 0, 'the animation dummy is never handed out');
  const close = h.namedObject('Repair Locker', REPAIR_LOCKER_OPEN, 'Close');
  assert.equal(close.handled, true);
  assert.equal(h.ownedLocs.length, 0, 'Close puts the shut locker back');
  h.player.getInventory().adds(I.FUSE, 1);
  const fuse = h.namedItemOnObject('Fuse', 'Powder Barrel', I.FUSE, 11237);
  assert.equal(fuse.handled, true);
  assert.equal(h.varbit(1756), 2, 'named fuse use attaches to the barrel');
});

test('the gun locker hands out the real quest canister, not the animation dummy', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  const O = core.ObjectIdentifiers;
  h.quest.setStage(h.player, 7);
  h.openLocker(O.GUN_LOCKER, GUN_LOCKER_OPEN);
  h.button(GUN.CANISTER);
  // 7149 is the quest canister the locker gives in live; 7118 is the animation dummy the client
  // wields while loading the cannon, and Quest Helper's requirement is 7149.
  assert.equal(h.count(I.CANISTER_2), 1, 'the locker hands out the real quest canister');
  assert.equal(h.count(I.CANISTER), 0, 'the animation dummy is never handed out');
  assert.equal(h.messages.at(-1), 'You take a canister round.');

  // The real canister still loads the cannon and is consumed.
  h.itemOnObject(I.CANISTER_2, 11213);
  h.advance(1);
  assert.equal(h.varbit(1744), 2, 'the canister is loaded');
  assert.equal(h.count(I.CANISTER_2), 0, 'the canister is consumed');

  // A save from before the fix holds the animation dummy; login swaps it for the real one.
  h.player.getInventory().adds(I.CANISTER, 1);
  h.bootstrap();
  assert.equal(h.count(I.CANISTER_2), 1, 'the dummy is swapped for the real canister');
  assert.equal(h.count(I.CANISTER), 0, 'the animation dummy is gone');
});

test('the hull\'s own Fill and Waterproof options repair the hole, as a plain click does in live', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  const HOLES = [11221, 11222, 11223];
  h.quest.setStage(h.player, 4);
  h.player.getInventory().adds(I.REPAIR_PLANK_2, 6);
  h.player.getInventory().adds(I.TACKS, 30);
  h.player.getInventory().adds(I.HAMMER, 1);
  h.player.getInventory().adds(I.SWAMP_PASTE, 3);

  // Fill planks the hole with no item used on it: the visible transform's own option.
  assert.equal(h.object(HOLES[0], 'Fill'), true, 'the Fill option is claimed');
  assert.equal(h.varbit(1751), 1, 'the hole is planked');
  assert.equal(h.count(I.REPAIR_PLANK_2), 4, 'two planks are used');
  assert.equal(h.count(I.TACKS), 20, 'ten tacks are used');

  // Waterproof pastes it.
  assert.equal(h.object(HOLES[0], 'Waterproof'), true, 'the Waterproof option is claimed');
  assert.equal(h.varbit(1751), 2, 'the hole is waterproofed');
  assert.equal(h.count(I.SWAMP_PASTE), 2, 'one paste is used');
  assert.equal(h.varbit(1759), 1, 'one hole patched');
  assert.equal(h.varbit(1760), 1, 'one hole proofed');

  // A second Fill on a finished hole answers instead of consuming anything.
  assert.equal(h.object(HOLES[0], 'Fill'), true);
  assert.equal(h.count(I.REPAIR_PLANK_2), 4, 'nothing is consumed on a finished hole');
});

test('the Book o\' Piracy is readable, recoverable once and cleaned up with the quest supplies', () => {
  const originalOpenBook = runtime.openBook;
  let opened = null;
  runtime.openBook = (player, title, pages) => { opened = { player, title, pages }; };
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  try {
    h.quest.setStage(h.player, 9);
    h.action('5mdRTN');
    assert.equal(h.count(I.BOOK_O_PIRACY), 1, 'Bill replaces a lost book');
    h.action('5mdRTN');
    assert.equal(h.count(I.BOOK_O_PIRACY), 1, 'the replacement never stacks');

    const read = h.itemAction("Book o' Piracy", 'Read', I.BOOK_O_PIRACY);
    assert.equal(read.handled, true);
    assert.equal(opened?.title, "The Little Book o' Piracy");
    assert.ok(opened?.pages?.length > 0);

    h.player.getInventory().deleteNumber(I.BOOK_O_PIRACY, 1);
    h.setFullInventory(true);
    h.action('5mdRTN');
    assert.equal(h.count(I.BOOK_O_PIRACY), 0, 'a full bag leaves the replacement available');
    h.setFullInventory(false);
    h.action('5mdRTN');
    assert.equal(h.count(I.BOOK_O_PIRACY), 1);
  } finally {
    runtime.openBook = originalOpenBook;
  }

  // Completion removes supplies but keeps the reward book.
  const done = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  done.quest.setStage(done.player, 8);
  done.player.getPacketSender().sendVarbit(1750, 3);
  done.player.getInventory().adds(I.FUSE, 1);
  done.player.getInventory().adds(I.GUNPOWDER, 1);
  done.player.getInventory().adds(I.CANNON_BALL_2, 1);
  done.player.getInventory().adds(I.PLUNDER, 1);
  done.action('V-4Bls');
  assert.equal(done.stage(), 9);
  assert.equal(done.count(I.FUSE), 0);
  assert.equal(done.count(I.GUNPOWDER), 0);
  assert.equal(done.count(I.CANNON_BALL_2), 0);
  assert.equal(done.count(I.PLUNDER), 0);
  assert.equal(done.count(I.BOOK_O_PIRACY), 1);
});

test('a canister hit credits the crew before the death animation can be interrupted', () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
    const I = core.ItemIdentifiers;
    const N = core.NpcIdentifiers;
    const CANNON = 11213;
    const CREW_HITS = 'cabin-fever:crew-hits';
    let queue;
    const pirate = {
      hp: 52,
      getId: () => N.PIRATE_27,
      getRealId: () => N.PIRATE_27,
      getLocation: () => new core.Location(1823, 4831, 0),
      getHitpoints() { return this.hp; },
      isRegistered: () => true,
      isPlayer: () => false,
      isNpc: () => true,
      isUntargetable: () => false,
      decrementHealth(hit) {
        const lost = this.hp;
        this.hp = 0;
        hit.setHealthLost(lost);
        return hit;
      },
      addTickHit() {},
      getCombat: () => ({ addDamage() {}, getHitQueue: () => queue }),
    };
    queue = new HitQueue(pirate);
    h.worldNpcs.push(pirate);
    h.quest.setStage(h.player, 7);
    h.player.getPacketSender().sendVarbit(1741, 0);
    h.player.getPacketSender().sendVarbit(1746, 0); // clean: nothing has been fired yet
    h.player.setAttribute('quest.cabin_fever.flags', 2); // a save already on live's clean flag
    h.player.getInventory().adds(I.RAMROD, 1);
    h.player.getInventory().adds(I.GUNPOWDER, 1);
    h.itemOnObject(I.GUNPOWDER, CANNON);
    h.itemOnObject(I.RAMROD, CANNON);
    h.player.getInventory().adds(I.CANISTER, 1);
    h.itemOnObject(I.CANISTER, CANNON);
    h.advance(1);
    h.player.getInventory().adds(I.FUSE, 1);
    h.itemOnObject(I.FUSE, CANNON);
    h.object(CANNON, 'Fire!');
    assert.equal(h.player.getAttribute(CREW_HITS) ?? 0, 0, 'the shot is still in the air');

    // Live credits the crew with "You hit them!", a tick before the 52 hitsplat (ticks 1917-1918).
    h.advance(2);
    assert.equal(h.messages.at(-1), 'You hit them!');
    assert.equal(h.player.getAttribute(CREW_HITS), 1, 'credit is written with the hit message');
    assert.equal(pirate.hp, 52, 'the hitsplat is still queued');
    queue.process(1);

    // Logout saves here, before the two-tick death task emits the NPC death.
    h.player.isRegistered = () => false;
    h.npcDeath(N.PIRATE_27, pirate);
    assert.equal(pirate.hp, 0, 'the pirate still dies');
    assert.equal(h.player.getAttribute(CREW_HITS), 1, 'the death event does not add a second credit');
  } finally {
    Math.random = originalRandom;
  }
});

test('the port-ship Bill row is swapped to the talkable ship NPC', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const npc = {
    getRealId: () => 4013,
    getId: () => 4011,
    getLocation: () => new core.Location(3713, 3497, 1),
  };
  h.worldNpcs.push(npc);
  h.hooks.serverStartup.forEach((handler) => handler({ timestamp: Date.now() }));
  assert.equal(h.hooks.removedNpcs.includes(npc), true, 'the transforming 4013 row is removed');
  assert.ok(
    h.hooks.spawnedNpcs.some((definition) =>
      definition.id === 4014 && definition.x === 3713 && definition.y === 3497 && definition.z === 1
    ),
    'the 4014 ship Bill replaces it on the same tile'
  );
});

test('the port-ship Bill fix runs when the ship region is activated, once', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const broken = {
    getRealId: () => 4013,
    getId: () => 4011,
    getLocation: () => new core.Location(3713, 3497, 1),
  };
  const fixed = {
    getRealId: () => 4014,
    getId: () => 4014,
    getLocation: () => new core.Location(3714, 3497, 1),
  };
  h.worldNpcs.push(broken, fixed);
  h.hooks.regionLoaded.forEach((handler) => handler({ regionId: 14902 }));
  assert.equal(h.hooks.removedNpcs.includes(broken), true, 'the broken row is removed on region load');
  assert.equal(h.hooks.spawnedNpcs.length, 0, 'an existing 4014 nearby is reused');
});

test('a logout mid-swing leaves no rope tied to the sail', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  h.quest.setStage(h.player, 3);
  h.player.getPacketSender().sendVarbit(1740, 1);
  h.player.getPacketSender().sendVarbit(1764, 1);
  h.player.setAttribute('quest.cabin_fever.var657', h.player.getPacketSender().getVarp(657));
  h.relog();
  assert.equal(h.varbit(1740), 0);
  assert.equal(h.varbit(1764), 0);
});

test('a logout in the sea after a fallen swing logs back in on the ship the swing was heading for', () => {
  const originalRandom = Math.random;
  Math.random = () => 0; // below the fall chance
  try {
    const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
    const I = core.ItemIdentifiers;
    h.quest.setStage(h.player, 3);
    h.player.getInventory().adds(I.ROPE, 1);
    h.player.moveTo(new core.Location(1816, 4830, 2)); // the Adventurous' yardarm
    h.itemOnObject(I.ROPE, 11292);
    h.advance(21); // fallen, in the sea (plane 0), swim not finished
    assert.equal(h.player.getLocation().getZ(), 0, 'in the sea');
    // Logout: the player-keyed sequence stops and the sea tile is what gets saved.
    h.player.isRegistered = () => false;
    h.advance(5);
    assert.equal(h.player.getLocation().getZ(), 0, 'the cancelled swim never reached the ship');
    h.player.isRegistered = () => true;
    h.relog();
    const at = h.player.getLocation();
    assert.deepEqual([at.getX(), at.getY(), at.getZ()], [1822, 4830, 1], 'back on the enemy deck');
    assert.equal(h.player.getAttribute('quest.cabin_fever.swing_landing'), null);
    h.relog();
    assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getZ()], [1822, 1], 'only once');
  } finally {
    Math.random = originalRandom;
  }
});
