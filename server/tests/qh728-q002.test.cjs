// From server/: node --test tests/qh728-q002.test.cjs
// Another Slice of H.A.M. (q002) contract: the full stage-0-to-completion route
// through the plugin's registered handlers, plus the sixth-artefact gate and
// recovery after leaving the outpost/railway.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

const transcripts = [];
runtime.startTranscript = (api, player, npcId, page, variant, select) => {
  transcripts.push({ player, npcId, page, variant, select });
  return true;
};

const PREREQS = new Set(['death_to_the_dorgeshuun', 'giant_dwarf', 'the_dig_site']);
// One row per cache dig hotspot 01..06; the dirty/clean item pairs are the
// cache's slice_artifact_N_{dirty,clean} (the dig order is not the item suffix).
const SPOTS = [
  { objectId: 23290, dirty: 'ARTEFACT', clean: 'ARMOUR_SHARD', outer: 'MN6jwN', sixth: 'VUBFDh' },
  { objectId: 23293, dirty: 'ARTEFACT_4', clean: 'SHIELD_FRAGMENT', outer: 'BbDvSB', sixth: 'mehvOR' },
  { objectId: 23296, dirty: 'ARTEFACT_3', clean: 'HELMET_FRAGMENT', outer: 'X2Dw2s', sixth: 'wIvaR9' },
  { objectId: 23534, dirty: 'ARTEFACT_5', clean: 'SWORD_FRAGMENT', outer: 'KX4iC8', sixth: 'thmn78' },
  { objectId: 23301, dirty: 'ARTEFACT_2', clean: 'AXE_HEAD', outer: 'AaJqrV', sixth: 'RshbWX' },
  { objectId: 23304, dirty: 'ARTEFACT_6', clean: 'MACE', outer: '-jSaii', sixth: 'qizxJZ' },
];

function setup(options = {}) {
  transcripts.length = 0;
  const core = PluginManager.getCoreApi();
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  const hooks = {
    custom: new Map(), conditions: [], npcNamed: new Map(), objects: [],
    itemOnObject: [], itemOnNpc: [], itemDrop: [], login: [], zoneEnter: [],
    hitModify: [], npcDeath: [], interfaceButtons: [],
  };
  const spawned = [], removed = [], tasks = [], attacks = [];
  let tick = 0;
  const attrs = new Map(), inventory = new Map(), varbits = new Map(), messages = [];
  const xp = [];
  let location = new core.Location(2955, 3507, 0);
  let hitpoints = 100;
  let movementBlocked = false;

  const inventoryApi = {
    getAmount: (id) => inventory.get(id) ?? 0,
    adds(id, amount = 1) {
      const current = inventory.get(id) ?? 0;
      if (current === 0 && inventoryApi.getFreeSlots() <= 0) return false;
      inventory.set(id, current + amount);
      return true;
    },
    deleteNumber(id, amount = 1) {
      inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - amount));
      return true;
    },
    contains(id) { return (inventory.get(id) ?? 0) > 0; },
    isFull() { return inventoryApi.getFreeSlots() <= 0; },
    getFreeSlots() { return 28 - [...inventory.values()].filter((amount) => amount > 0).length; },
    getItems() { return [...inventory].filter(([, amount]) => amount > 0).map(([id]) => ({ getId: () => id })); },
  };
  const movement = {
    isMovementBlocked: () => movementBlocked,
    setBlockMovement(value) { movementBlocked = value; return movement; },
    reset() { return movement; },
  };
  const TaskManager = { submit(task) { tasks.push(task); } };
  const Task = class {
    constructor() { this.stopped = false; }
    stop() { this.stopped = true; }
  };
  const CountdownTask = class {
    constructor(playerArg, ticks, run) { Object.assign(this, { player: playerArg, remaining: ticks, run, stopped: false }); }
    stop() { this.stopped = true; }
  };

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig() { return sender; },
    sendQuestList() { return sender; },
    sendInterfaceFlagsRange() { return sender; },
    sendJingle() { return sender; },
    sendInterface() { return sender; },
    sendInterfaceRemoval() { return sender; },
    sendString() { return sender; },
    sendItemOnInterfaces() { return sender; },
    sendInterfaceScript() { return sender; },
    sendSubInterface() { return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });

  const player = {
    getUsername: () => 'q002-test',
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    sendMessage(message) { messages.push(message); },
    getInventory: () => inventoryApi,
    getEquipment: () => ({ get: () => null, contains: () => false }),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getCurrentLevel: () => 99,
      getTotalLevel: () => 1500,
      addExperiences(skill, amount) { xp.push([skill, amount]); },
      addExperience(skill, amount) { xp.push([skill, amount]); },
    }),
    getLocation: () => location,
    moveTo(value) { location = value; },
    setHitpoints(value) { hitpoints = value; },
    getHitpoints: () => hitpoints,
    getMovementQueue: () => movement,
    performAnimation() {},
    getPrivateArea: () => null,
    getDialogueManager: () => ({ startDialogues() {}, isActive: () => false, getCurrent: () => null }),
    isRegistered: () => true,
    isPlayer: () => true,
    isPlayerBot: () => false,
  };

  const api = new Proxy({
    core: {
      ...core,
      Task,
      TaskManager,
      CountdownTask,
      Animation: class { constructor(id) { this.id = id; } },
      DialogueChainBuilder: class { add(part) { this.part = part; return this; } },
      StatementDialogue: class { constructor(index, text) { Object.assign(this, { index, text }); } },
      NpcDialogue: class { constructor(index, npc, text) { Object.assign(this, { index, npc, text }); } },
      MapObjects: { get: () => null },
      GameObject: class {
        constructor(id, loc, type, face, area) { Object.assign(this, { id, loc, type, face, area }); }
      },
      ObjectManager: { register() {}, deregister() {} },
    },
    persistAttribute() {},
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && PREREQS.has(event?.key)) event.complete = true;
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
    onNpcInteraction(name, actions) { hooks.npcNamed.set(name, actions); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onItemDropPolicy(fn) { hooks.itemDrop.push(fn); },
    onZoneEnter(zone, fn) { hooks.zoneEnter.push({ zone, fn }); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onNpcHitModify(fn) { hooks.hitModify.push(fn); },
    onNpcDeath(fn) { hooks.npcDeath.push(fn); },
    onInterfaceActionButton(ids, fn) { hooks.interfaceButtons.push({ ids, fn }); },
    spawnNpc(definition) {
      const npc = {
        definition,
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        moveTo(value) { definition.x = value.getX(); definition.y = value.getY(); definition.z = value.getZ(); return npc; },
        getHitpoints: () => 1,
        isRegistered: () => true,
        getOwner: () => definition.owner,
        setMultiCombat() { return npc; },
        getCombat: () => ({ attack(target) { attacks.push([npc, target]); } }),
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { removed.push(npc); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });

  require('../plugins/quests/quests/AnotherSliceOfHAM.Quest')(api);
  if (options.locTeleports) require('../plugins/world/LocTeleports.plugin').register(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const emit = (name, event) => api.emitCustomEvent(name, { player, ...event });
  const talk = (name, npcId) => {
    const actions = hooks.npcNamed.get(name);
    assert.ok(actions?.['Talk-to'], `${name} is a registered Talk-to NPC`);
    actions['Talk-to']({ player, npcId });
  };
  const answer = (npcId, stepId) => hooks.conditions[0]({ player, npcId, stepId });
  const enterZone = (index) => hooks.zoneEnter[index].fn({ player });
  const lastVariant = () => transcripts.at(-1)?.variant;
  const advance = () => {
    tick++;
    for (const task of [...tasks]) {
      if (task.stopped) continue;
      if (typeof task.execute === 'function') task.execute();
      if (typeof task.run === 'function' && task.remaining !== undefined) {
        if (--task.remaining <= 0) task.run();
      }
    }
  };
  const dispatchObject = ({ objectId, x, y, z = 0, clickType = 1 }) => {
    const object = {
      getId: () => objectId,
      getLocation: () => new core.Location(x, y, z),
      getType: () => 10,
      getFace: () => 0,
      getPrivateArea: () => null,
      getDefinition: () => ({ getName: () => '', getInteractions: () => ['Enter'] }),
    };
    const event = { player, objectId, object, location: { x, y, z }, clickType, handled: false };
    for (const handler of hooks.objects) {
      if (event.handled) break;
      handler(event);
    }
    return event;
  };

  return {
    core, I, N, hooks, quest, attrs, inventory, varbits, messages, xp, spawned, removed, attacks,
    player, emit, talk, answer, enterZone, lastVariant, advance, dispatchObject,
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getLocation() { return location; },
  };
}

function handInArtefact(h, spot) {
  const I = h.I;
  h.hooks.itemOnObject[0]({ player: h.player, itemId: I.TROWEL, objectId: spot.objectId, handled: false });
  assert.equal(h.inventory.get(I[spot.dirty]) ?? 0, 1, 'digging yields the cache dirty artefact');
  h.hooks.itemOnObject[0]({ player: h.player, itemId: I[spot.dirty], objectId: 23526, handled: false });
  assert.equal(h.inventory.get(I[spot.dirty]) ?? 0, 0, 'cleaning consumes the dirty artefact');
  assert.equal(h.inventory.get(I[spot.clean]) ?? 0, 1, 'cleaning yields the cleaned artefact');

  const delivered = Number(h.attrs.get('quest.another_slice_of_ham.handed-in')) || 0;
  h.talk('Tegdak', h.N.TEGDAK);
  h.emit('npc-dialogue:condition', { npcId: h.N.TEGDAK, stepId: spot.outer });
  assert.equal(h.inventory.get(I[spot.clean]) ?? 0, 0, 'Tegdak takes the cleaned artefact');
  assert.equal(Number(h.attrs.get('quest.another_slice_of_ham.handed-in')), delivered + 1);
  return delivered + 1;
}

test('Another Slice of H.A.M.: stage 0 to completion through registered handlers', () => {
  const h = setup();
  const { I, N } = h;

  // Stage 0: Ur-tag opens the canonical start transcript; only the Yes hook starts it.
  h.quest.setStage(h.player, 0);
  h.talk('Ur-tag', 2315);
  assert.equal(h.lastVariant(), 'starting-off-talking-to-ur-tag-or-ambassador-alivjar');
  h.emit('npc-dialogue:hook', { npcId: 2315, hook: 'quest:another-slice-of-h-a-m:start' });
  assert.equal(h.quest.getStage(h.player), 1);

  // Stage 1: Tegdak hands over the trowel/brush and starts the dig.
  h.talk('Tegdak', N.TEGDAK);
  assert.equal(h.lastVariant(), 'the-archaeological-dig-talking-to-tegdak');
  h.emit('npc-dialogue:line', { npcId: N.TEGDAK, text: 'Here, take this trowel and specimen brush.' });
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.inventory.get(I.TROWEL), 1);
  assert.equal(h.inventory.get(I.SPECIMEN_BRUSH), 1);

  // Stage 2: five artefacts are not the sixth hand-in; the sixth advances to the scribe leg.
  for (let index = 0; index < SPOTS.length; index++) {
    const spot = SPOTS[index];
    const delivered = handInArtefact(h, spot);
    if (index < SPOTS.length - 1) {
      assert.equal(h.answer(N.TEGDAK, spot.sixth), false, `hand-in ${delivered} is not the sixth`);
      assert.equal(h.quest.getStage(h.player), 2, `stage stays digging after hand-in ${delivered}`);
    } else {
      assert.equal(h.answer(N.TEGDAK, spot.sixth), true, 'sixth hand-in is recognised');
      h.emit('npc-dialogue:condition', { npcId: N.TEGDAK, stepId: spot.sixth });
      assert.equal(h.quest.getStage(h.player), 3, 'all six artefacts advance to the scribe');
    }
  }

  // Stage 3: Zanik then the scribe send the player to Oldak.
  h.talk('Zanik', N.ZANIK_16);
  assert.equal(h.lastVariant(), 'the-goblin-scribe-talking-to-zanik');
  h.talk('Goblin scribe', N.GOBLIN_SCRIBE);
  assert.equal(h.lastVariant(), 'the-goblin-scribe-talking-to-the-goblin-scribe-with-zanik');
  h.emit('npc-dialogue:line', {
    npcId: N.GOBLIN_SCRIBE,
    text: "I'd rather not travel all that way over the surface, though. I wonder if Oldak could use magic to help us get there?",
  });
  assert.equal(h.quest.getStage(h.player), 4);

  // Stage 4: Oldak gives the sphere and teleports the player to Goblin Village.
  h.talk('Oldak', N.OLDAK_3);
  assert.equal(h.lastVariant(), 'talking-to-oldak');
  h.emit('npc-dialogue:action', { npcId: N.OLDAK_3, stepId: 'swS9lx' });
  assert.equal(h.inventory.get(I.GOBLIN_VILLAGE_SPHERE), 1);
  h.emit('npc-dialogue:action', { npcId: N.OLDAK_3, stepId: 'Tp-DHz' });
  assert.equal(h.inventory.get(I.GOBLIN_VILLAGE_SPHERE) ?? 0, 0, 'the broken sphere is consumed');
  assert.equal(h.quest.getStage(h.player), 5);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2955, 3507, 0]);
  assert.equal(h.varbits.get(3557), 0, 'Zanik is no longer at the dig');

  // Stage 5: the generals' cutscene spawns the tower snipers.
  h.talk('General Wartface', N.GENERAL_WARTFACE);
  assert.equal(h.lastVariant(), 'the-goblin-generals');
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2445, 5425, 0]);
  h.emit('npc-dialogue:action', { npcId: N.GENERAL_WARTFACE, stepId: '0MCjvB' });
  assert.ok(h.spawned.some((npc) => npc.getId() === N.H_A_M_ARCHER));
  assert.ok(h.spawned.some((npc) => npc.getId() === N.H_A_M_MAGE));

  h.emit('ladders:climb', { objectId: 23531, handled: false });
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2443, 5417, 2]);

  // Stage 6: killing both snipers spawns the outpost generals.
  for (const npcId of [N.H_A_M_ARCHER, N.H_A_M_MAGE]) {
    for (const fn of h.hooks.npcDeath) fn({ killer: h.player, npcId, npc: { getId: () => npcId } });
  }
  assert.equal(h.quest.getStage(h.player), 6);
  assert.ok(h.spawned.some((npc) => npc.getId() === N.GENERAL_WARTFACE));

  // Stage 8: the kidnap scene gives the ancient mace and sends the player to the swamp.
  h.talk('General Bentnoze', N.GENERAL_BENTNOZE);
  assert.equal(h.lastVariant(), 'upon-defeating-the-two-h-a-m-members');
  h.emit('npc-dialogue:action', { npcId: N.GENERAL_BENTNOZE, stepId: 'oG2C9L' });
  assert.equal(h.quest.getStage(h.player), 8);
  assert.equal(h.inventory.get(I.ANCIENT_MACE), 1);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2955, 3507, 0]);

  // Stage 9: the sergeants send the player into the tunnel; the escort gates the ladder.
  h.talk('Sergeant Slimetoes', N.SERGEANT_SLIMETOES);
  assert.equal(h.lastVariant(), 'talking-to-the-sergeants-in-the-lumbridge-swamp');
  h.emit('npc-dialogue:line', {
    npcId: N.SERGEANT_SLIMETOES,
    text: 'Grubfoot say pink robe man take Chosen Commander down this hole into new tunnel.',
  });
  assert.equal(h.quest.getStage(h.player), 9);

  h.setLocation(3172, 9569, 0);
  h.enterZone(0);
  assert.equal(h.lastVariant(), 'the-under-underground');
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2396, 5553, 0]);

  // Luring before hiding is caught and ejected; stage 9 re-entry works.
  h.setLocation(2412, 5537, 0);
  h.enterZone(1);
  assert.equal(h.lastVariant(), 'the-distraction-if-the-guards-spot-the-player');
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [3172, 9569, 0]);
  assert.equal(h.quest.getStage(h.player), 9);
  assert.equal(h.attacks.length, 0, 'no sergeant/guard attack before the crate');
  h.setLocation(3172, 9569, 0);
  h.enterZone(0);
  h.enterZone(0);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2396, 5553, 0]);

  // The final ladder also refuses before the lure has engaged a sergeant.
  h.emit('ladders:climb', { objectId: 23376, handled: false });
  assert.equal(h.lastVariant(), 'the-distraction-if-the-guard-at-the-end-spots-the-player');
  assert.equal(h.quest.getStage(h.player), 9);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [3172, 9569, 0]);
  h.setLocation(3172, 9569, 0);
  h.enterZone(0);
  h.enterZone(0);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2396, 5553, 0]);

  h.talk('Sergeant Mossfists', N.SERGEANT_MOSSFISTS);
  assert.equal(h.lastVariant(), 'the-under-underground-coordinating-with-the-sergeants-with-both-sergeants');
  h.emit('npc-dialogue:choice', { npcId: N.SERGEANT_MOSSFISTS, option: 'Both of you follow me' });

  // QH stage 9.3: hide behind the marked crate, wait for the patrol, then lure.
  h.dispatchObject({ objectId: 23283, x: 2408, y: 5538 });
  assert.equal(h.varbits.get(3558), 1, 'slice_hiding is set by Hide-behind');
  h.advance();
  h.advance();
  assert.ok(h.spawned.some((npc) => npc.getId() === N.GUARD_86
    && npc.getLocation().getX() === 2397 && npc.getLocation().getY() === 5551), 'patrol guard reaches the passed tile');
  h.setLocation(2412, 5537, 0);
  h.enterZone(1);
  assert.equal(h.lastVariant(), 'the-distraction-guards-engaging-in-combat-with-the-sergeants');
  assert.ok(h.attacks.some(([attacker, target]) => attacker.getId() === N.SERGEANT_MOSSFISTS
    && target.getId() === N.GUARD_86), 'sergeant attacks the final guard');
  assert.ok(h.attacks.some(([attacker, target]) => attacker.getId() === N.GUARD_86
    && target.getId() === N.SERGEANT_MOSSFISTS), 'guard fights the sergeant');

  // The guard may die to the sergeant (NPC-vs-NPC death, not a player kill).
  const finalGuard = h.spawned.find((npc) => npc.getId() === N.GUARD_86
    && npc.getLocation().getX() === 2412 && npc.getLocation().getY() === 5536);
  for (const fn of h.hooks.npcDeath) fn({ killer: h.spawned.find((npc) => npc.getId() === N.SERGEANT_MOSSFISTS),
    npcId: N.GUARD_86, npc: finalGuard });
  assert.equal(h.quest.getStage(h.player), 9);

  h.emit('ladders:climb', { objectId: 23376, handled: false });
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(h.lastVariant(), 'climbing-down-to-the-railway');
  assert.ok(h.spawned.some((npc) => npc.getId() === N.SIGMUND_8));

  // Stage 10: the mace hit line, the death transcript, untie, and completion action.
  h.hooks.hitModify[0]({ npc: { getId: () => N.SIGMUND_8 }, hit: { getAttacker: () => h.player } });
  h.advance();
  assert.equal(h.lastVariant(), 'attacking-him-with-the-ancient-mace-special');
  for (const fn of h.hooks.npcDeath) fn({ killer: h.player, npcId: N.SIGMUND_8, npc: { getId: () => N.SIGMUND_8 } });
  assert.equal(h.lastVariant(), 'defeating-sigmund');
  h.hooks.objects[0]({ player: h.player, objectId: 23284, location: { x: 2542, y: 5512, z: 0 } });
  assert.equal(h.lastVariant(), 'defeating-sigmund');
  h.emit('npc-dialogue:action', { npcId: N.SIGMUND_8, stepId: 'jiiizC' });
  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.attrs.get('quest.points'), 1);
  assert.deepEqual(h.xp, [[h.core.Skill.MINING, 3000], [h.core.Skill.PRAYER, 3000]]);
  assert.ok(h.messages.some((text) => text.includes('Another Slice of H.A.M.')));
});

test('Another Slice of H.A.M.: lost ancient mace is reclaimed from the generals for 1,000 coins', () => {
  const h = setup();
  h.quest.setStage(h.player, 8);
  h.inventory.set(h.I.COINS, 1500);
  h.talk('General Wartface', h.N.GENERAL_WARTFACE);
  assert.equal(h.lastVariant(), 'upon-defeating-the-two-h-a-m-members-talking-to-the-generals');
  assert.equal(h.answer(h.N.GENERAL_WARTFACE, 'XUDGNK'), true, 'missing mace branch is selected');
  assert.equal(h.answer(h.N.GENERAL_WARTFACE, 'j-3x-s'), false, 'enough coins is not the no-coins branch');
  assert.equal(h.answer(h.N.GENERAL_WARTFACE, 'F1JORu'), true, 'enough coins branch is selected');
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'iF8XSH' });
  assert.equal(h.inventory.get(h.I.COINS), 500);
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'DXR-dR' });
  assert.equal(h.inventory.get(h.I.ANCIENT_MACE), 1);
});

test('Another Slice of H.A.M.: stage 6 generals work outside the outpost', () => {
  const h = setup();
  h.quest.setStage(h.player, 6);
  h.setLocation(2955, 3507, 0);
  h.talk('General Wartface', h.N.GENERAL_WARTFACE);
  assert.equal(h.lastVariant(), 'upon-defeating-the-two-h-a-m-members');
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'oG2C9L' });
  assert.equal(h.quest.getStage(h.player), 8);
  assert.equal(h.inventory.get(h.I.ANCIENT_MACE), 1);
});

test('Another Slice of H.A.M.: the swamp hole and ladder return to the railway after stage 10', () => {
  const h = setup();
  h.quest.setStage(h.player, 10);
  h.setLocation(3172, 9569, 0);
  h.enterZone(0);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2396, 5553, 0]);
  h.emit('ladders:climb', { objectId: 23376, handled: false });
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2538, 5515, 0]);
  assert.equal(h.quest.getStage(h.player), 10);
  assert.ok(h.spawned.some((npc) => npc.getId() === h.N.SIGMUND_8));
});

test('Another Slice of H.A.M.: stage-3 railway exits use the captured doorway destinations', () => {
  const h = setup({ locTeleports: true });
  h.quest.setStage(h.player, 3);

  // The railway-side 23285 placement has no LocTeleports capture; the plugin
  // must choose the city landing from the player's side, not the object's x.
  h.setLocation(2520, 5607, 0);
  const railwayExit = h.dispatchObject({ objectId: 23285, x: 2521, y: 5607 });
  assert.equal(railwayExit.handled, true);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2696, 5277, 1]);

  // The captured station-side 23285 exit is owned by LocTeleports.
  h.setLocation(2488, 5536, 0);
  const stationExit = h.dispatchObject({ objectId: 23285, x: 2489, y: 5536 });
  assert.equal(stationExit.handled, true, 'LocTeleports claims the captured station-side exit');
  h.advance();
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2696, 5277, 1]);

  // The dwarf-side doorway 23286 is also LocTeleports' captured exit.
  h.setLocation(2435, 5535, 0);
  const dwarfExit = h.dispatchObject({ objectId: 23286, x: 2434, y: 5535 });
  assert.equal(dwarfExit.handled, true, 'LocTeleports claims the dwarf-side exit');
  h.advance();
  h.advance();
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2941, 10179, 0]);
});

test('Another Slice of H.A.M.: full bag keeps the kidnap stage retryable until the mace fits', () => {
  const h = setup();
  h.quest.setStage(h.player, 6);
  for (let id = 1000; id < 1028; id++) h.inventory.set(id, 1);
  assert.equal(h.player.getInventory().isFull(), true);

  h.talk('General Wartface', h.N.GENERAL_WARTFACE);
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'oG2C9L' });
  assert.equal(h.quest.getStage(h.player), 6, 'no stage advance without the mace');
  assert.equal(h.inventory.get(h.I.ANCIENT_MACE) ?? 0, 0);
  assert.ok(h.messages.some((text) => text.includes('free inventory space')));

  h.inventory.delete(1000);
  h.talk('General Wartface', h.N.GENERAL_WARTFACE);
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'oG2C9L' });
  assert.equal(h.quest.getStage(h.player), 8);
  assert.equal(h.inventory.get(h.I.ANCIENT_MACE), 1);
});

test('Another Slice of H.A.M.: full bag does not consume reclaim coins until the mace fits', () => {
  const h = setup();
  h.quest.setStage(h.player, 8);
  for (let id = 1000; id < 1027; id++) h.inventory.set(id, 1);
  h.inventory.set(h.I.COINS, 1500);
  assert.equal(h.player.getInventory().isFull(), true);

  h.talk('General Wartface', h.N.GENERAL_WARTFACE);
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'iF8XSH' });
  assert.equal(h.inventory.get(h.I.COINS), 1500, 'coins stay when the mace cannot be granted');
  assert.equal(h.inventory.get(h.I.ANCIENT_MACE) ?? 0, 0);
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'DXR-dR' });
  assert.equal(h.inventory.get(h.I.COINS), 1500);
  assert.equal(h.inventory.get(h.I.ANCIENT_MACE) ?? 0, 0);
  assert.ok(h.messages.some((text) => text.includes('free inventory space')));

  h.inventory.delete(1000);
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'iF8XSH' });
  assert.equal(h.inventory.get(h.I.COINS), 500);
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'DXR-dR' });
  assert.equal(h.inventory.get(h.I.ANCIENT_MACE), 1);
});

test('Another Slice of H.A.M.: stage 9 login/re-entry restores crate, lure and tunnel NPCs', () => {
  const h = setup();
  h.quest.setStage(h.player, 9);
  h.setLocation(2396, 5553, 0);
  for (const login of h.hooks.login) login({ player: h.player });

  const count = (id) => h.spawned.filter((npc) => npc.getId() === id).length;
  assert.equal(count(h.N.SERGEANT_MOSSFISTS), 1);
  assert.equal(count(h.N.SERGEANT_SLIMETOES), 1);
  assert.equal(count(h.N.GUARD_86), 3);

  h.dispatchObject({ objectId: 23283, x: 2408, y: 5538 });
  h.advance();
  h.advance();
  h.setLocation(2412, 5537, 0);
  h.enterZone(1);
  assert.ok(h.attacks.length >= 2, 'the sergeant/guard combat was started');

  // Relog/restart: login re-spawns or reuses the tracked NPCs and re-applies
  // the persisted engagement before the final ladder.
  const before = h.spawned.length;
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(h.spawned.length, before, 'login reuses the tracked tunnel NPCs');
  assert.equal(count(h.N.SERGEANT_MOSSFISTS), 1);
  assert.equal(count(h.N.SERGEANT_SLIMETOES), 1);
  assert.equal(count(h.N.GUARD_86), 3);
  assert.ok(h.attacks.length >= 4, 'login re-applies the sergeant/guard attack');

  h.setLocation(3172, 9569, 0);
  h.enterZone(0);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2396, 5553, 0]);
  assert.equal(h.lastVariant(), 'the-under-underground');
  h.emit('ladders:climb', { objectId: 23376, handled: false });
  assert.equal(h.quest.getStage(h.player), 10, 'engaged distraction opens the final ladder');
});
