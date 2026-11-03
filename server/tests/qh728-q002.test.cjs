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
const { CombatSpecial } = require('../dist/game/content/combat/CombatSpecial');
const runtime = require('../plugins/quests/QuestRuntime');

// The quest identifies the ancient mace special from the hit's retained combat method, so the
// registry must hold the real special exactly as the combat plugin registers it.
require('../plugins/combat/specials/AncientMace.SpecialAttack')({
  core: PluginManager.getCoreApi(),
  registerCombatSpecial: (definition) => CombatSpecial.register(definition),
  onCombatHitRoll: () => {},
});

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
    itemOnObject: [], itemOnNpc: [], itemAction: [], namedItemActions: new Map(), itemDrop: [],
    login: [], logout: [], zoneEnter: [],
    hitModify: [], npcDeath: [], interfaceButtons: [],
  };
  const spawned = [], removed = [], tasks = [], attacks = [];
  let tick = 0;
  const attrs = new Map(), inventory = new Map(), varbits = new Map(), messages = [];
  const persisted = new Map(); // persistAttribute key -> default, as PlayerSave keeps them
  const xp = [];
  let location = new core.Location(2955, 3507, 0);
  let hitpoints = 100;
  let movementBlocked = false;
  let specialActive = false;
  let combatSpecial = null;
  let weapon = null;

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
    getEquipment: () => ({
      get: (slot) => slot === core.Equipment.WEAPON_SLOT ? weapon : null,
      contains: () => false,
    }),
    isSpecialActivated: () => specialActive,
    setSpecialActivated(value) { specialActive = value; },
    getCombatSpecial: () => combatSpecial,
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
    persistAttribute(key, defaultValue) { persisted.set(key, defaultValue); },
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
    onItemAction(name, actions) {
      if (typeof name === 'function') hooks.itemAction.push(name);
      else hooks.namedItemActions.set(name, actions);
    },
    onItemDropPolicy(fn) { hooks.itemDrop.push(fn); },
    onZoneEnter(zone, fn) { hooks.zoneEnter.push({ zone, fn }); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout(fn) { hooks.logout.push(fn); },
    onNpcHitModify(fn) { hooks.hitModify.push(fn); },
    onNpcDeath(fn) { hooks.npcDeath.push(fn); },
    onInterfaceActionButton(ids, fn) { hooks.interfaceButtons.push({ ids, fn }); },
    spawnNpc(definition) {
      if (options.realNpcs) {
        const npc = new core.NPC(definition.id, new core.Location(definition.x, definition.y, definition.z));
        npc.setOwner(definition.owner);
        npc.setOwnerOnly(true);
        npc.setRegistered(true);
        spawned.push(npc);
        return npc;
      }
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
    removeNpc(npc) {
      removed.push(npc);
      if (options.realNpcs) {
        npc.getCombat().reset();
        npc.setRegistered(false);
      }
    },
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
    player, emit, talk, answer, enterZone, lastVariant, advance, dispatchObject, persisted,
    /** A save/load round trip: quest attributes that are not persisted are lost, defaults fill gaps. */
    relog() {
      for (const key of [...attrs.keys()]) {
        if (key.startsWith('quest.another_slice_of_ham.') && !persisted.has(key)) attrs.delete(key);
      }
      for (const [key, value] of persisted) {
        if (value !== undefined && attrs.get(key) === undefined) attrs.set(key, value);
      }
      varbits.clear();
      for (const login of hooks.login) login({ player });
    },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getLocation() { return location; },
    setWeapon(id) { weapon = id === null ? null : { getId: () => id }; },
    setSpecial(active, id = 'ancient_mace') {
      specialActive = active;
      combatSpecial = active ? { getId: () => id } : null;
    },
    hitSigmund(options = {}) {
      let damage = options.damage ?? 10;
      const hit = {
        getAttacker: () => player,
        getCombatType: () => options.combatType ?? core.CombatType.MELEE,
        isAccurate: () => options.accurate !== false,
        // The launched special's combat method; the armed flag clears as soon as the swing
        // queues the hit, so an armed-but-cleared launch still carries it here.
        getCombatMethod: () => options.combatMethod ?? (
          specialActive && weapon?.getId?.() === I.ANCIENT_MACE
            ? CombatSpecial.getForWeaponId(I.ANCIENT_MACE)?.getCombatMethod?.() ?? null
            : null
        ),
        getTotalDamage: () => damage,
        setTotalDamage(value) { damage = value; },
      };
      for (const fn of hooks.hitModify) fn({ npc: { getId: () => N.SIGMUND_8 }, hit });
      return damage;
    },
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
  assert.equal(h.quest.getStage(h.player), 6, 'the ambush cutscene is live stage 6');
  assert.ok(h.spawned.some((npc) => npc.getId() === N.H_A_M_ARCHER));
  assert.ok(h.spawned.some((npc) => npc.getId() === N.H_A_M_MAGE));

  h.emit('ladders:climb', { objectId: 23531, handled: false });
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2443, 5417, 2]);

  // Stage 6: killing both snipers spawns the outpost generals.
  for (const npcId of [N.H_A_M_ARCHER, N.H_A_M_MAGE]) {
    for (const fn of h.hooks.npcDeath) fn({ killer: h.player, npcId, npc: { getId: () => npcId } });
  }
  assert.equal(h.quest.getStage(h.player), 7, 'both snipers dead is live stage 7');
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
  assert.equal(h.quest.getStage(h.player), 9, 'the descent stays at live stage 9');
  assert.equal(h.lastVariant(), 'climbing-down-to-the-railway');
  assert.ok(h.spawned.some((npc) => npc.getId() === N.SIGMUND_8));

  // Stage 9 in the railway: only the ancient mace special breaks Sigmund's prayer,
  // and landing it is what starts live stage 10.
  h.setWeapon(h.I.ANCIENT_MACE);
  h.setSpecial(false);
  assert.equal(h.hitSigmund(), 0, 'ordinary hits are absorbed by the prayer');
  assert.equal(h.quest.getStage(h.player), 9);
  h.setSpecial(true);
  assert.equal(h.hitSigmund(), 10, 'the ancient mace special lands');
  assert.equal(h.quest.getStage(h.player), 10, 'the special starts live stage 10');
  h.advance();
  assert.equal(h.lastVariant(), 'attacking-him-with-the-ancient-mace-special');
  for (const fn of h.hooks.npcDeath) fn({ killer: h.player, npcId: N.SIGMUND_8, npc: { getId: () => N.SIGMUND_8 } });
  assert.equal(h.lastVariant(), 'defeating-sigmund');
  h.hooks.objects[0]({ player: h.player, objectId: 23284, location: { x: 2542, y: 5512, z: 0 } });
  assert.equal(h.lastVariant(), 'defeating-sigmund');

  // The completion action waits for the untie and the train-line opening.
  h.emit('npc-dialogue:action', { npcId: N.SIGMUND_8, stepId: 'jiiizC' });
  assert.equal(h.quest.getStage(h.player), 10);
  h.emit('npc-dialogue:action', { npcId: N.SIGMUND_8, stepId: 'VcaIcO' });
  h.emit('npc-dialogue:action', { npcId: N.SIGMUND_8, stepId: '09Lek1' });
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

test('Another Slice of H.A.M.: stage 7 generals work outside the outpost', () => {
  const h = setup();
  h.quest.setStage(h.player, 7);
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
  h.quest.setStage(h.player, 7);
  for (let id = 1000; id < 1028; id++) h.inventory.set(id, 1);
  assert.equal(h.player.getInventory().isFull(), true);

  h.talk('General Wartface', h.N.GENERAL_WARTFACE);
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'oG2C9L' });
  assert.equal(h.quest.getStage(h.player), 7, 'no stage advance without the mace');
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
  assert.equal(h.quest.getStage(h.player), 9, 'engaged distraction opens the final ladder at stage 9');
});

test('Another Slice of H.A.M.: real inventory reclaims atomically with the last coin slot, without free replays', () => {
  const h = setup();
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const inventory = new Inventory(h.player);
  h.player.getInventory = () => inventory;
  h.quest.setStage(h.player, 8);
  for (let slot = 0; slot < 27; slot++) inventory.setItem(slot, new h.core.Item(h.I.SHARK, 1));
  inventory.setItem(27, new h.core.Item(h.I.COINS, 1000));
  assert.equal(inventory.isFull(), true);
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'DXR-dR' });
  assert.equal(inventory.getAmount(h.I.ANCIENT_MACE), 0, 'a receive action alone is not payment');
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'iF8XSH' });
  assert.equal(inventory.getAmount(h.I.COINS), 0);
  assert.equal(inventory.getAmount(h.I.ANCIENT_MACE), 1, 'spending the exact price frees its slot');
  for (const stepId of ['iF8XSH', 'DXR-dR', 'DXR-dR']) h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId });
  assert.equal(inventory.getAmount(h.I.ANCIENT_MACE), 1, 'repeating dialogue cannot duplicate the mace');
  inventory.deleteNumber(h.I.ANCIENT_MACE, 1);
  h.emit('npc-dialogue:action', { npcId: h.N.GENERAL_WARTFACE, stepId: 'DXR-dR' });
  assert.equal(inventory.getAmount(h.I.ANCIENT_MACE), 0, 'a past payment is not reusable after losing its mace');
});

test('Another Slice of H.A.M.: following sergeants cannot bypass the crate or an unfinished patrol', () => {
  for (const hide of [false, true]) {
    const h = setup();
    h.quest.setStage(h.player, 9);
    h.setLocation(3172, 9569, 0);
    h.enterZone(0);
    h.emit('npc-dialogue:choice', { npcId: h.N.SERGEANT_MOSSFISTS, option: 'Both of you follow me' });
    if (hide) {
      h.dispatchObject({ objectId: 23283, x: 2408, y: 5538 });
      h.advance();
    }
    h.setLocation(2412, 5537, 0);
    h.enterZone(1);
    assert.equal(h.quest.getStage(h.player), 9);
    assert.deepEqual([h.getLocation().getX(), h.getLocation().getY()], [3172, 9569]);
    assert.equal(h.attacks.length, 0);
    h.advance();
    h.advance();
    assert.notEqual(h.attrs.get('another-slice-of-ham:patrol-passed'), true, 'a cancelled patrol cannot finish after ejection');
  }
});

test('Another Slice of H.A.M.: walking from the entry to the marked crate does not cross guard detection', () => {
  const h = setup();
  h.quest.setStage(h.player, 9);
  h.setLocation(3172, 9569, 0);
  h.enterZone(0);
  // The real native object route follows the west corridor before approaching the crate.
  for (const [x, y] of [[2396, 5543], [2396, 5538], [2407, 5538]]) {
    h.setLocation(x, y);
    for (const { zone, fn } of h.hooks.zoneEnter) {
      if (x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY) fn({ player: h.player });
    }
    assert.deepEqual([h.getLocation().getX(), h.getLocation().getY()], [x, y], 'the approach must not eject the player before Hide-behind resolves');
  }
  h.dispatchObject({ objectId: 23283, x: 2408, y: 5538 });
  assert.equal(h.varbits.get(3558), 1);
});

test('Another Slice of H.A.M.: logout cancels the patrol and restores only fresh owned tunnel actors', () => {
  const h = setup();
  h.quest.setStage(h.player, 9);
  h.setLocation(3172, 9569, 0);
  h.enterZone(0);
  const oldActors = [...h.spawned];
  h.dispatchObject({ objectId: 23283, x: 2408, y: 5538 });
  h.advance();
  for (const logout of h.hooks.logout) logout({ player: h.player });
  assert.ok(oldActors.every((npc) => h.removed.includes(npc)));
  h.advance();
  assert.notEqual(h.attrs.get('another-slice-of-ham:patrol-passed'), true);
  const start = h.spawned.length;
  for (const login of h.hooks.login) login({ player: h.player });
  const restored = h.spawned.slice(start);
  assert.equal(restored.filter((npc) => npc.getId() === h.N.GUARD_86).length, 3);
  assert.ok(restored.every((npc) => npc.getOwner() === h.player && !oldActors.includes(npc)));
  h.advance();
  h.advance();
  assert.equal(h.attrs.get('another-slice-of-ham:patrol-passed'), true, 'the restored hiding checkpoint can complete');
});

test('Another Slice of H.A.M.: real NPC combat targets and permission survive distraction recovery', () => {
  const h = setup({ realNpcs: true });
  try {
    h.quest.setStage(h.player, 9);
    h.setLocation(2396, 5553, 0);
    for (const login of h.hooks.login) login({ player: h.player });
    h.dispatchObject({ objectId: 23283, x: 2408, y: 5538 });
    h.advance(); h.advance();
    h.setLocation(2412, 5537, 0);
    h.enterZone(1);
    const guard = h.spawned.find((npc) => npc.getId() === h.N.GUARD_86 && npc.getLocation().getX() === 2412);
    const sergeant = h.spawned.find((npc) => npc.getCombat().getTarget() === guard);
    assert.ok(sergeant, 'the real sergeant Combat accepted its guard target');
    assert.equal(guard.getCombat().getTarget(), sergeant);
    guard.setNeedsPlacement(false); sergeant.setNeedsPlacement(false);
    for (const [attacker, target] of [[guard, sergeant], [sergeant, guard]]) {
      assert.equal(h.core.CombatFactory.canAttackPermission(attacker, target), h.core.CanAttackResponse.CAN_ATTACK);
    }
    for (const login of h.hooks.login) login({ player: h.player });
    assert.equal(guard.getCombat().getTarget(), sergeant, 'login restores the same owned combat pair');
    for (const death of h.hooks.npcDeath) death({ npcId: h.N.GUARD_86, npc: guard, killer: h.player });
    assert.notEqual(h.attrs.get('another-slice-of-ham:guard-defeated'), true, 'a player kill is not the sergeant distraction');
    for (const death of h.hooks.npcDeath) death({ npcId: h.N.GUARD_86, npc: guard, killer: sergeant });
    assert.equal(h.attrs.get('another-slice-of-ham:guard-defeated'), true);
    h.emit('ladders:climb', { objectId: 23376, handled: false });
    assert.equal(h.quest.getStage(h.player), 9, 'the descent keeps stage 9');
  } finally {
    for (const logout of h.hooks.logout) logout({ player: h.player });
    for (const npc of h.spawned) h.core.World.markNpcCombatActive(npc, false);
  }
});

test('Another Slice of H.A.M.: objectives stay ordered and the mace special gates the showdown', () => {
  const h = setup();
  h.quest.setStage(h.player, 10);
  h.attrs.set('quest.another_slice_of_ham.train-agreement', true);
  h.attrs.set('quest.another_slice_of_ham.sigmund-exposed', true);
  h.setWeapon(h.I.ANCIENT_MACE);
  h.setSpecial(false);

  // Ordinary attacks cannot progress the showdown.
  assert.equal(h.hitSigmund(), 0, 'ordinary hits are absorbed');
  assert.equal(h.lastVariant(), 'climbing-down-to-the-railway-if-sigmund-is-attacked-with-melee');
  for (const fn of h.hooks.npcDeath) fn({ killer: h.player, npcId: h.N.SIGMUND_8, npc: { getId: () => h.N.SIGMUND_8 } });
  assert.equal(h.quest.getStage(h.player), 10, 'death before the special does not advance');
  assert.ok(h.messages.some((text) => text.includes("prayer protects")));
  assert.ok(h.spawned.some((npc) => npc.getId() === h.N.SIGMUND_8), 'Sigmund is restored for a retry');
  h.emit('npc-dialogue:action', { npcId: h.N.SIGMUND_8, stepId: 'jiiizC' });
  assert.equal(h.quest.getStage(h.player), 10, 'completion is blocked before the special');

  // A special from anything but the equipped mace does not count.
  h.setSpecial(true);
  h.setWeapon(null);
  assert.equal(h.hitSigmund(), 0, 'the special needs the mace equipped');
  h.setWeapon(h.I.ANCIENT_MACE);
  assert.equal(h.hitSigmund(), 10, 'the mace special lands');
  h.advance();
  assert.equal(h.lastVariant(), 'attacking-him-with-the-ancient-mace-special');

  for (const fn of h.hooks.npcDeath) fn({ killer: h.player, npcId: h.N.SIGMUND_8, npc: { getId: () => h.N.SIGMUND_8 } });
  assert.equal(h.lastVariant(), 'defeating-sigmund');

  // Untie and the train-line opening are separate, ordered actions.
  h.emit('npc-dialogue:action', { npcId: h.N.SIGMUND_8, stepId: 'jiiizC' });
  assert.equal(h.quest.getStage(h.player), 10);
  h.emit('npc-dialogue:action', { npcId: h.N.SIGMUND_8, stepId: 'VcaIcO' });
  h.emit('npc-dialogue:action', { npcId: h.N.SIGMUND_8, stepId: 'jiiizC' });
  assert.equal(h.quest.getStage(h.player), 10, 'the train opening is required before completion');
  h.emit('npc-dialogue:action', { npcId: h.N.SIGMUND_8, stepId: '09Lek1' });
  h.emit('npc-dialogue:action', { npcId: h.N.SIGMUND_8, stepId: 'jiiizC' });
  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.quest.isComplete(h.player), true);
});

test('Another Slice of H.A.M.: the queued ancient mace special lands after the armed flag clears', () => {
  const h = setup();
  h.quest.setStage(h.player, 10);
  h.attrs.set('quest.another_slice_of_ham.train-agreement', true);
  h.attrs.set('quest.another_slice_of_ham.sigmund-exposed', true);
  h.attrs.delete('quest.another_slice_of_ham.mace-special-used');
  h.setWeapon(h.I.ANCIENT_MACE);
  h.setSpecial(true);

  // Combat.executeAttack clears the armed flag as soon as it has queued the special's hit;
  // the impact runs the hit queue with that flag already cleared, so the delivered hit is the
  // launched special even though the player no longer reads as armed.
  const launchedMethod = CombatSpecial.getForWeaponId(h.I.ANCIENT_MACE)?.getCombatMethod?.() ?? null;
  assert.ok(launchedMethod, 'the ancient mace special is registered');
  h.setSpecial(false);
  assert.equal(h.hitSigmund({ combatMethod: launchedMethod }), 10,
    'the queued ancient mace special is not rejected once the armed flag cleared');
  assert.equal(h.attrs.get('quest.another_slice_of_ham.mace-special-used'), true,
    'the landed ancient mace special marks the showdown objective used');

  for (const fn of h.hooks.npcDeath) fn({ killer: h.player, npcId: h.N.SIGMUND_8, npc: { getId: () => h.N.SIGMUND_8 } });
  assert.equal(h.lastVariant(), 'defeating-sigmund');
  h.emit('npc-dialogue:action', { npcId: h.N.SIGMUND_8, stepId: 'jiiizC' });
  assert.equal(h.quest.getStage(h.player), 10);
  h.emit('npc-dialogue:action', { npcId: h.N.SIGMUND_8, stepId: 'VcaIcO' });
  h.emit('npc-dialogue:action', { npcId: h.N.SIGMUND_8, stepId: '09Lek1' });
  h.emit('npc-dialogue:action', { npcId: h.N.SIGMUND_8, stepId: 'jiiizC' });
  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.quest.isComplete(h.player), true);
});

test('Another Slice of H.A.M.: Sigmund and the H.A.M. members are named interactions', () => {
  const h = setup();
  h.quest.setStage(h.player, 10);

  const sigmund = h.hooks.npcNamed.get('Sigmund');
  assert.ok(sigmund?.['Talk-to'], 'Sigmund has a Talk-to interaction');
  sigmund['Talk-to']({ player: h.player, npcId: h.N.SIGMUND_8 });
  assert.equal(h.lastVariant(), 'climbing-down-to-the-railway', 'the confrontation exposes Sigmund');
  sigmund['Talk-to']({ player: h.player, npcId: h.N.SIGMUND_8 });
  assert.ok(h.messages.some((text) => text.includes("ancient mace's special attack")));

  h.quest.setStage(h.player, 6);
  for (const [name, npcId] of [['H.A.M. Archer', h.N.H_A_M_ARCHER], ['H.A.M. Mage', h.N.H_A_M_MAGE]]) {
    const member = h.hooks.npcNamed.get(name);
    assert.ok(member?.['Talk-to'], `${name} has a Talk-to interaction`);
    member['Talk-to']({ player: h.player, npcId });
  }
  assert.ok(h.messages.some((text) => text.includes('too busy fighting the goblins')));
});

test('Another Slice of H.A.M.: quest items expose their checks and route use', () => {
  const h = setup();
  h.quest.setStage(h.player, 10);

  const mace = h.hooks.namedItemActions.get('Ancient mace');
  assert.ok(mace?.Wield, 'the ancient mace has a Wield action');
  assert.equal(mace.Wield({ player: h.player, itemId: h.I.ANCIENT_MACE, handled: false }), false,
    'the quest never swallows the equip action');
  assert.ok(h.messages.some((text) => text.includes("special attack")));

  h.quest.setStage(h.player, 4);
  h.inventory.set(h.I.GOBLIN_VILLAGE_SPHERE, 1);
  const sphere = h.hooks.namedItemActions.get('Goblin village sphere');
  assert.ok(sphere?.Break, 'the route sphere has a Break action');
  assert.equal(sphere.Break({ player: h.player, itemId: h.I.GOBLIN_VILLAGE_SPHERE, handled: false }), true);
  assert.equal(h.inventory.get(h.I.GOBLIN_VILLAGE_SPHERE) ?? 0, 0, 'breaking consumes the route item');
  assert.equal(h.quest.getStage(h.player), 5, 'breaking the sphere is the Goblin Village teleport');
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY()], [2955, 3507]);
});

test('Another Slice of H.A.M.: the journal lists the three objectives in order', () => {
  const h = setup();
  h.quest.setStage(h.player, 10);
  h.attrs.set('quest.another_slice_of_ham.sigmund-exposed', true);
  const lines = h.quest.buildJournal(h.player, h.quest);
  assert.ok(lines[0].includes('train agreement'), 'objective 1: the train agreement');
  assert.ok(lines[1].includes('Expose and fight Sigmund'), 'objective 2: expose and fight Sigmund');
  assert.ok(lines[2].includes("ancient mace's special attack"), 'objective 3: the mace special');
  assert.ok(lines[0].startsWith('<str>'), 'the agreement is already complete');
  assert.ok(lines[1].startsWith('<str>'), 'the fight is underway');
  assert.ok(!lines[2].startsWith('<str>'), 'the special is still outstanding');
});

test('Another Slice of H.A.M.: a dropped cleaned artefact goes back into its dig spot', () => {
  const h = setup();
  h.quest.setStage(h.player, 2);
  h.inventory.set(h.I.SPECIMEN_BRUSH, 1);
  const spot = SPOTS[0];

  h.hooks.itemOnObject[0]({ player: h.player, itemId: h.I.TROWEL, objectId: spot.objectId, handled: false });
  assert.equal(h.varbits.get(3551), 1);
  h.hooks.itemOnObject[0]({ player: h.player, itemId: h.I[spot.dirty], objectId: 23526, handled: false });
  assert.equal(h.inventory.get(h.I[spot.clean]), 1);

  const drop = { player: h.player, itemId: h.I[spot.clean], handled: false, dropToGround: true };
  h.hooks.itemDrop[0](drop);
  assert.equal(drop.handled, true);
  assert.equal(drop.dropToGround, false, 'the artefact never becomes a ground item');
  assert.equal(h.inventory.get(h.I[spot.clean]) ?? 0, 0);
  assert.equal(h.varbits.get(3551), 0, 'the spot can be dug again');

  h.hooks.itemOnObject[0]({ player: h.player, itemId: h.I.TROWEL, objectId: spot.objectId, handled: false });
  assert.equal(h.inventory.get(h.I[spot.dirty]), 1, 're-digging recovers the artefact');
});

test('Another Slice of H.A.M.: the city doorway enters the dig floor during the quest and the captured platform after it', () => {
  const h = setup({ locTeleports: true });

  // Stage 2 (digging): the captured 2488,5536 landing (recorded on a finished account) is
  // the train platform, with no walkable link to the dig tunnel, so the quest uses the dig floor.
  h.quest.setStage(h.player, 2);
  h.setLocation(2695, 5277, 1);
  const digging = h.dispatchObject({ objectId: 23052, x: 2695, y: 5277, z: 1 });
  assert.equal(digging.handled, true, 'the quest claims the doorway before LocTeleports');
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2513, 5556, 0]);

  // Stage 8-10: the staircase is closed; the message must not move the player and
  // LocTeleports must not run on the same click.
  h.quest.setStage(h.player, 8);
  h.setLocation(2695, 5277, 1);
  const kidnapped = h.dispatchObject({ objectId: 23052, x: 2695, y: 5277, z: 1 });
  assert.equal(kidnapped.handled, true);
  assert.equal(h.lastVariant(), 'upon-defeating-the-two-h-a-m-members-attempting-to-enter-the-rail-station-via-dorgesh-kaan');
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2695, 5277, 1]);

  // After completion the doorway is the captured station entrance again.
  h.quest.setStage(h.player, 11);
  h.setLocation(2695, 5277, 1);
  const complete = h.dispatchObject({ objectId: 23052, x: 2695, y: 5277, z: 1 });
  assert.equal(complete.handled, true, 'LocTeleports handles the completed doorway');
  h.advance();
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2488, 5536, 0]);
});

test('Another Slice of H.A.M.: the train ladder works from the stage-9 showdown and after the special', () => {
  for (const [stage, exposed] of [[9, true], [10, true]]) {
    const h = setup();
    h.quest.setStage(h.player, stage);
    h.attrs.set('quest.another_slice_of_ham.sigmund-exposed', exposed);
    h.setLocation(2544, 5509, 0);
    const event = { player: h.player, objectId: 23504, handled: false };
    for (const handler of h.hooks.custom.get('ladders:climb')) handler(event);
    assert.equal(event.handled, true, `stage ${stage} claims the train ladder`);
    assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2512, 5533, 0]);
  }
});

test('Another Slice of H.A.M.: leaving the stage-6 ambush can return to the tower', () => {
  const h = setup();
  const { N } = h;
  h.quest.setStage(h.player, 6);
  h.attrs.set('quest.another_slice_of_ham.snipers-dead', 1); // archer dead, mage alive

  // Died or teleported out: the generals in Goblin Village send the player back.
  h.setLocation(2955, 3507, 0);
  h.talk('General Wartface', N.GENERAL_WARTFACE);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2445, 5425, 0]);
  assert.ok(h.spawned.some((npc) => npc.getId() === N.H_A_M_MAGE), 'the surviving mage is back on the tower');
  assert.ok(!h.spawned.some((npc) => npc.getId() === N.H_A_M_ARCHER), 'the dead archer stays dead');
  assert.equal(h.quest.getStage(h.player), 6);

  // Oldak still offers the return teleport during the ambush.
  h.talk('Oldak', N.OLDAK_3);
  assert.equal(h.lastVariant(), 'talking-to-oldak-returning-to-oldak-again');
});

test('Another Slice of H.A.M.: an exposed stage-9 player returns to the railway without redoing the tunnel', () => {
  const h = setup();
  const { N } = h;
  h.quest.setStage(h.player, 9);
  h.attrs.set('quest.another_slice_of_ham.sigmund-exposed', true);
  h.attrs.set('quest.another_slice_of_ham.guards-engaged', false);
  h.attrs.set('another-slice-of-ham:guard-defeated', false);

  // Died to Sigmund before the special: back through the cave zone and tunnel.
  h.setLocation(3172, 9569, 0);
  h.enterZone(0);
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2396, 5553, 0]);
  assert.ok(!h.spawned.some((npc) => npc.getId() === N.GUARD_86), 'no tunnel guards after exposure');
  h.setLocation(2412, 5537, 0);
  h.enterZone(1);
  assert.notEqual(h.lastVariant(), 'the-distraction-if-the-guards-spot-the-player');

  h.emit('ladders:climb', { objectId: 23376, handled: false });
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()], [2538, 5515, 0]);
  assert.ok(h.spawned.some((npc) => npc.getId() === N.SIGMUND_8));
  assert.equal(h.quest.getStage(h.player), 9);
});

test('Another Slice of H.A.M.: saves from the old stage order load on the live stages', () => {
  const old6 = setup();
  old6.quest.setStage(old6.player, 6);
  old6.attrs.set('quest.another_slice_of_ham.snipers-dead', 3);
  old6.relog();
  assert.equal(old6.quest.getStage(old6.player), 7, 'old 6 with both snipers dead is live 7');
  assert.ok(!old6.spawned.some((npc) => npc.getId() === old6.N.H_A_M_MAGE), 'no snipers respawn');

  const old10 = setup();
  old10.quest.setStage(old10.player, 10);
  old10.attrs.set('quest.another_slice_of_ham.sigmund-exposed', true);
  old10.relog();
  assert.equal(old10.quest.getStage(old10.player), 9, 'old 10 before the special is live 9');
  assert.ok(old10.spawned.some((npc) => npc.getId() === old10.N.SIGMUND_8), 'the showdown resumes');

  const live10 = setup();
  live10.quest.setStage(live10.player, 10);
  live10.attrs.set('quest.another_slice_of_ham.sigmund-exposed', true);
  live10.attrs.set('quest.another_slice_of_ham.mace-special-used', true);
  live10.relog();
  assert.equal(live10.quest.getStage(live10.player), 10, 'live 10 after the special is kept');
});

test('Another Slice of H.A.M.: handed-in artefacts keep their varbit at 2 through a relog', () => {
  const h = setup();
  h.quest.setStage(h.player, 2);
  h.inventory.set(h.I.SPECIMEN_BRUSH, 1);

  // Hand in the fifth dig spot; Quest Helper reads slice_artifact_5 == 2.
  handInArtefact(h, SPOTS[4]);
  assert.equal(h.varbits.get(3555), 2, 'hand-in sets the delivered value');

  // Dig (not hand in) another spot; that one stays at the dug value.
  h.hooks.itemOnObject[0]({ player: h.player, itemId: h.I.TROWEL, objectId: SPOTS[0].objectId, handled: false });
  assert.equal(h.varbits.get(3551), 1);

  // A save/load round trip re-sends every artifact varbit; the delivered one must not fall back to 1.
  h.relog();
  assert.equal(h.varbits.get(3555), 2, 'relog keeps the handed-in spot at 2');
  assert.equal(h.varbits.get(3551), 1, 'dug-but-not-handed-in stays at 1');
  assert.equal(h.varbits.get(3552), 0, 'undug stays at 0');
});

test('Another Slice of H.A.M.: saves with only the hand-in count recover a delivered mask', () => {
  const h = setup();
  h.quest.setStage(h.player, 2);
  h.attrs.set('quest.another_slice_of_ham.spots', 0b111);
  h.attrs.set('quest.another_slice_of_ham.handed-in', 2);
  h.relog();
  assert.equal(h.varbits.get(3551), 2);
  assert.equal(h.varbits.get(3552), 2);
  assert.equal(h.varbits.get(3553), 1, 'the third dug spot is not counted as delivered');
});

test('Another Slice of H.A.M.: live stage values put the ambush at 6, the deaths at 7 and the special at 10', () => {
  const h = setup();
  const { N } = h;

  // Varbit 3550 on the OSRS Wiki: 6 is the Goblin Village ambush cutscene, 7 is
  // after both H.A.M. members are dead, and 10 starts when the mace special lands.
  h.quest.setStage(h.player, 5);
  h.talk('General Wartface', N.GENERAL_WARTFACE);
  h.emit('npc-dialogue:action', { npcId: N.GENERAL_WARTFACE, stepId: '0MCjvB' });
  assert.equal(h.quest.getStage(h.player), 6, 'the ambush cutscene sets stage 6');

  assert.notEqual(h.answer(N.GENERAL_WARTFACE, 'oG2C9L'), true, 'generals do not hand over the mace at 6');
  for (const npcId of [N.H_A_M_ARCHER, N.H_A_M_MAGE]) {
    for (const fn of h.hooks.npcDeath) fn({ killer: h.player, npcId, npc: { getId: () => npcId } });
  }
  assert.equal(h.quest.getStage(h.player), 7, 'the second sniper death sets stage 7');

  // The descent leaves the fight at 9; the ancient mace special starts 10.
  h.quest.setStage(h.player, 9);
  h.attrs.set('quest.another_slice_of_ham.sigmund-exposed', true);
  h.setWeapon(h.I.ANCIENT_MACE);
  h.setSpecial(true);
  assert.equal(h.hitSigmund(), 10, 'the mace special lands at stage 9');
  assert.equal(h.quest.getStage(h.player), 10, 'the landed special sets stage 10');
});
