// From server/: node --test tests/qh728-q020.test.cjs (after yarn build).
// Focused Desert Treasure I contracts: canonical varbit 358 wire, the pot
// item-state chain, blood/ice hand-ins, smoke reclaim, pyramid descent and the
// Azzanadra completion action. These are registered-dispatch tests, not a live
// playthrough.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const noop = () => {};
let playerSeq = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer() {
  const username = `desert-test-${++playerSeq}`;
  const attrs = new Map();
  const items = new Map();
  const levels = new Map();
  const equipment = new Map();
  const messages = [];
  const moves = [];
  const log = [];
  const drops = [];
  let full = false;
  let location = new core.Location(0, 0, 0);
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd: (_player, item) => inventory.adds(item.getId(), item.getAmount()),
    addItem: item => inventory.adds(item.getId(), item.getAmount()),
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter(amount => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    full: () => messages.push('Not enough space in your inventory.'),
    getItems: () => [...items].filter(([, amount]) => amount > 0).map(([id, amount]) => new core.Item(id, amount)),
  };
  const sender = new Proxy({}, { get: (_target, prop) => (...args) => { log.push([String(prop), ...args]); return sender; } });
  return {
    attrs, items, levels, equipment, messages, moves, log, drops,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getSize: () => 1,
    getMovementQueue: () => ({ reset: noop }),
    getLastItemPickup: () => ({ reset: noop }),
    getEquipment: () => ({ get: slot => equipment.get(slot) ?? null }),
    getBanks: () => [],
    getSkillManager: () => ({
      getCurrentLevel: skill => levels.get(skill?.getIndex?.() ?? skill) ?? 99,
      getMaxLevel: skill => levels.get(skill?.getIndex?.() ?? skill) ?? 99,
      addExperiences: (skill, amount) => {
        const id = skill?.getIndex?.() ?? skill;
        levels.set(id, (levels.get(id) ?? 0) + amount);
      },
    }),
    getUsername: () => username,
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
    isPlayerBot: () => false,
  };
}

function harness() {
  const events = {}, variants = [], conditions = [], itemOnNpc = [], itemOnItem = [],
    itemOnObject = [], objectInteraction = [], npcDeaths = [], npcBeforeDeaths = [],
    login = [], startup = [], zoneEnters = [];
  const npcs = [];
  const spawned = [];
  const removedNpcs = [];
  const submittedTasks = [];
  const testCore = { ...core, TaskManager: { submit: task => submittedTasks.push(task) },
    World: { getNpcs: () => npcs } };
  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onItemOnNpc: handler => itemOnNpc.push(handler),
    onItemOnItem: handler => itemOnItem.push(handler),
    onItemOnObject: handler => itemOnObject.push(handler),
    onObjectInteraction: (target, actions) => {
      if (typeof target === 'function') objectInteraction.push(target);
      else objectInteraction.push(event => {
        if (core.ObjectDefinition.forId(event.objectId)?.getName() !== target) return;
        actions[event.option ?? core.ObjectDefinition.forId(event.objectId)?.getActions()[event.clickType - 1]]?.(event);
      });
    },
    onNpcDeath: handler => npcDeaths.push(handler),
    onNpcBeforeDeath: handler => npcBeforeDeaths.push(handler),
    onPlayerLogin: handler => login.push(handler),
    onServerStartup: handler => startup.push(handler),
    onZoneEnter: (zone, handler) => zoneEnters.push({ zone, handler }),
    getItemOnGroundManager: () => core.ItemOnGroundManager,
    onAnyNpcInteraction: handlers => { events['any-npc'] = handlers; },
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(handler => handler(event)),
    getWorld: () => ({ getNpcs: () => npcs }),
    spawnNpc: definition => { spawned.push(definition); return definition; },
    removeNpc: npc => {
      removedNpcs.push(npc);
      const index = npcs.indexOf(npc);
      if (index >= 0) npcs.splice(index, 1);
    },
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/DesertTreasureI.Quest')(api);
  return { events, variants, conditions, itemOnNpc, itemOnItem, itemOnObject,
    objectInteraction, npcDeaths, npcBeforeDeaths, login, startup, zoneEnters, npcs, spawned,
    removedNpcs, submittedTasks, quest: runtime.getRegisteredQuests().at(-1) };
}

const fire = (handlers, event) => handlers.forEach(handler => handler(event));
const variantOf = (h, p, npcId) => h.variants.at(-1)({ player: p, npcId });

test('stage is sent on canonical varbit 358, not whole varp 440, and replays on login', () => {
  const h = harness();
  const p = makePlayer();
  const wire = id => p.log.filter(row => row[0] === 'sendVarbit' && row[1] === id).at(-1)?.[2];
  for (let stage = 0; stage <= 13; stage++) {
    h.quest.setStage(p, stage);
    assert.equal(wire(358), stage, `stage ${stage} is mirrored to varbit 358`);
  }
  assert.equal(p.log.some(row => row[0] === 'sendConfig' && row[1] === 440), false,
    'stage writes never clobber varp 440 sibling bits 15-31');
  h.quest.setStage(p, 15);
  assert.equal(wire(358), 15);
  p.log.length = 0;
  runtime.sendQuestVarps({ player: p });
  assert.equal(wire(358), 15, 'login replay sends completion as varbit 358 = 15');
});

test('Ruantun completion resolves to the flat dialogue page default', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 15);
  assert.deepEqual(variantOf(h, p, core.NpcIdentifiers.RUANTUN), { page: 'Ruantun' });
});

test('obelisk placement rejects the wrong diamond and duplicate hand-ins without consuming items', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 11);
  p.items.set(I.BLOOD_DIAMOND, 2);
  fire(h.itemOnObject, { player: p, objectId: 6485, itemId: I.BLOOD_DIAMOND });
  assert.equal(p.items.get(I.BLOOD_DIAMOND), 2);
  fire(h.itemOnObject, { player: p, objectId: 6482, itemId: I.BLOOD_DIAMOND });
  assert.equal(p.items.get(I.BLOOD_DIAMOND), 1);
  fire(h.itemOnObject, { player: p, objectId: 6482, itemId: I.BLOOD_DIAMOND });
  assert.equal(p.items.get(I.BLOOD_DIAMOND), 1);
  assert.equal(p.attrs.get('desert-treasure-i:placed'), 1);
  assert.equal(h.quest.getStage(p), 11);
});

test('legacy diamond counts retain progress and completed saves restore all four columns', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 11);
  p.attrs.set('desert-treasure-i:placed', 2);
  p.items.set(I.ICE_DIAMOND, 1);
  p.items.set(I.SHADOW_DIAMOND, 1);
  fire(h.itemOnObject, { player: p, objectId: 6488, itemId: I.ICE_DIAMOND });
  fire(h.itemOnObject, { player: p, objectId: 6491, itemId: I.SHADOW_DIAMOND });
  assert.equal(p.attrs.get('desert-treasure-i:placed'), 4);
  assert.equal(h.quest.getStage(p), 12);

  const completed = makePlayer();
  h.quest.setStage(completed, 13);
  completed.attrs.set('desert-treasure-i:placed', 4);
  completed.log.length = 0;
  fire(h.login, { player: completed });
  for (const id of [387, 388, 389, 390]) {
    assert.equal(completed.log.findLast(row => row[0] === 'sendVarbit' && row[1] === id)?.[2], 1);
  }
  assert.equal(h.quest.getStage(completed), 13);
});

test('blood-diamond pot chain keeps the real item ids and Malak hands in the diamond', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 11);
  p.items.set(I.SILVER_BAR, 1);

  fire(h.itemOnNpc, { player: p, npcId: core.NpcIdentifiers.RUANTUN, itemId: I.SILVER_BAR, handled: false });
  assert.equal(p.items.get(I.SILVER_POT_3), 1, 'Ruantun makes the empty silver pot (4658)');

  fire(h.itemOnNpc, { player: p, npcId: core.NpcIdentifiers.HIGH_PRIEST, itemId: I.SILVER_POT_3, handled: false });
  assert.equal(p.items.get(I.SILVER_POT_3) ?? 0, 0);
  assert.equal(p.items.get(I.BLESSED_POT), 1, 'High Priest blesses it to 4659, not the finished pot');

  fire(h.itemOnNpc, { player: p, npcId: core.NpcIdentifiers.MALAK, itemId: I.BLESSED_POT, handled: false });
  assert.equal(p.items.get(I.BLESSED_POT) ?? 0, 0);
  assert.equal(p.items.get(I.BLESSED_POT_2), 1, 'Malak fills the blessed pot with blood (4661)');

  p.items.set(I.GARLIC_POWDER, 1);
  fire(h.itemOnItem, { player: p, usedItemId: I.GARLIC_POWDER, usedWithItemId: I.BLESSED_POT_2, handled: false });
  assert.equal(p.items.get(I.BLESSED_POT_3), 1, 'garlic turns it into 4663');

  p.items.set(I.SPICE, 1);
  fire(h.itemOnItem, { player: p, usedItemId: I.SPICE, usedWithItemId: I.BLESSED_POT_3, handled: false });
  assert.equal(p.items.get(I.BLESSED_POT_4), 1, 'spice completes the pot as 4665');

  p.items.set(I.BLESSED_POT_3, 1);
  const empty = { player: p, objectId: 6437, itemId: I.BLESSED_POT_3, handled: false };
  fire(h.itemOnObject, empty);
  assert.equal(empty.handled, true);
  assert.equal(p.items.get(I.BLESSED_POT_3), 1, 'an incomplete pot is not poured');

  const tomb = { player: p, objectId: 6437, itemId: I.BLESSED_POT_4, handled: false };
  fire(h.itemOnObject, tomb);
  assert.equal(tomb.handled, true);
  assert.equal(p.items.get(I.BLESSED_POT_4) ?? 0, 0, 'the complete pot is consumed on the tomb');
  assert.equal(h.spawned.filter(npc => npc.id === core.NpcIdentifiers.DESSOUS).length, 1,
    'Dessous is spawned once');

  fire(h.npcDeaths, { player: p, killer: p, npcId: core.NpcIdentifiers.DESSOUS });
  assert.equal(p.items.get(I.BLOOD_DIAMOND) ?? 0, 0, 'Dessous death does not itself grant the diamond');

  const afterKill = variantOf(h, p, core.NpcIdentifiers.MALAK);
  assert.equal(afterKill, 'blood-diamond-talking-to-malak-after-defeating-dessous');
  assert.equal(p.items.get(I.BLOOD_DIAMOND), 1, 'Malak hands in the blood diamond');
  assert.equal(variantOf(h, p, core.NpcIdentifiers.MALAK), 'blood-diamond-talking-to-malak-after-obtaining-the-blood-diamond');

  p.items.delete(I.BLOOD_DIAMOND);
  assert.equal(variantOf(h, p, core.NpcIdentifiers.MALAK), 'blood-diamond-talking-to-malak-after-losing-the-blood-diamond');
  assert.equal(p.items.get(I.BLOOD_DIAMOND), 1, 'lost blood diamond is reclaimable from Malak');
  p.setFull(true);
  p.items.delete(I.BLOOD_DIAMOND);
  assert.equal(variantOf(h, p, core.NpcIdentifiers.MALAK), 'blood-diamond-talking-to-malak-after-losing-the-blood-diamond');
});

test('Kamil does not drop the ice diamond; freeing both troll parents earns it', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 11);
  fire(h.npcDeaths, { player: p, killer: p, npcId: core.NpcIdentifiers.KAMIL });
  assert.equal(p.items.get(I.ICE_DIAMOND) ?? 0, 0, 'Kamil leaves no ice diamond');

  const block1 = { getId: () => 1969, getLocation: () => new core.Location(2826, 3808, 2) };
  const block2 = { getId: () => 1970, getLocation: () => new core.Location(2826, 3812, 2) };
  h.npcs.push(block1, block2);
  h.events['any-npc']['Smash-ice']({ player: p, npc: block1, npcId: 1969 });
  assert.equal(p.items.get(I.ICE_DIAMOND) ?? 0, 0);
  h.events['any-npc']['Smash-ice']({ player: p, npc: block2, npcId: 1970 });
  assert.equal(h.spawned.some(npc => npc.id === core.NpcIdentifiers.TROLL_FATHER), true);
  assert.equal(h.spawned.some(npc => npc.id === core.NpcIdentifiers.TROLL_MOTHER), true);

  p.equipment.set(core.Equipment.FEET_SLOT, { getId: () => I.SPIKED_BOOTS });
  p.setLocation(2837, 3804, 0);
  fire(h.objectInteraction, { player: p, objectId: 6455, handled: false });
  assert.deepEqual(p.moves.at(-1), [2840, 3806, 1], 'spiked boots climb the ice ledge to the path');
  fire(h.objectInteraction, { player: p, objectId: 6462, handled: false });
  assert.deepEqual(p.moves.at(-1), [2854, 3810, 2], 'the small ice gate crosses onto the bridge');

  const parentVariant = variantOf(h, p, core.NpcIdentifiers.TROLL_FATHER);
  assert.equal(parentVariant, 'ice-diamond-talking-to-the-troll-parents-after-freeing-them');
  assert.equal(p.items.get(I.ICE_DIAMOND), 1, 'the freed parents hand over the ice diamond');
});

test('shadow ladder is the real 6560 object and is gated on the ring', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 11);
  const ladder = { player: p, objectId: 6560, location: { x: 2547, y: 3421, z: 0 }, handled: false };
  fire(h.objectInteraction, ladder);
  assert.equal(ladder.handled, true);
  assert.equal(p.moves.length, 0, 'without the ring there is no visible ladder');
  p.equipment.set(core.Equipment.RING_SLOT, { getId: () => I.RING_OF_VISIBILITY });
  fire(h.objectInteraction, ladder);
  assert.deepEqual(p.moves.at(-1), [2688, 5088, 0]);
  assert.equal(h.quest.getStage(p), 11);
});

test('shadow diamond drops as a real ground item at Damis and reappears on zone re-entry', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 11);
  p.setLocation(2740, 5110, 0);
  const damis = { getId: () => core.NpcIdentifiers.DAMIS_2, getLocation: () => new core.Location(2740, 5110, 0) };
  fire(h.npcDeaths, { player: p, killer: p, npcId: core.NpcIdentifiers.DAMIS_2, npc: damis });
  assert.equal(p.items.get(I.SHADOW_DIAMOND) ?? 0, 0, 'Damis does not hand the diamond to the inventory');
  const deathTile = new core.Location(2740, 5110, 0);
  const first = core.ItemOnGroundManager.getGroundItem(p.getUsername(), I.SHADOW_DIAMOND, deathTile, null);
  assert.ok(first, 'the shadow diamond is a real ground item at the death tile');

  p.setFull(true);
  core.ItemOnGroundManager.pickup(p, first);
  assert.equal(p.items.get(I.SHADOW_DIAMOND) ?? 0, 0, 'a full bag refuses the pickup');
  assert.ok(core.ItemOnGroundManager.getGroundItem(p.getUsername(), I.SHADOW_DIAMOND, deathTile, null),
    'the ground item remains for a retry');

  p.setFull(false);
  p.setLocation(2740, 5110, 0);
  core.ItemOnGroundManager.pickup(p, first);
  assert.equal(p.items.get(I.SHADOW_DIAMOND), 1, 'the retry picks the real item up');
  assert.equal(core.ItemOnGroundManager.getGroundItem(p.getUsername(), I.SHADOW_DIAMOND, deathTile, null), null);

  p.items.delete(I.SHADOW_DIAMOND);
  core.ItemOnGroundManager.deregister(first);
  p.setLocation(2700, 5080, 0);
  const zone = h.zoneEnters.find(entry => entry.zone.minX === 2700 && entry.zone.minY === 5080);
  assert.ok(zone, 'the shadow multi-combat zone is registered');
  zone.handler({ player: p });
  const recoveryTile = new core.Location(2745, 5115, 0);
  assert.ok(core.ItemOnGroundManager.getGroundItem(p.getUsername(), I.SHADOW_DIAMOND, recoveryTile, null),
    'crossing back into the zone recreates the diamond on the canonical ground tile');
  assert.equal(p.items.get(I.SHADOW_DIAMOND) ?? 0, 0, 'recovery is a ground item, not a direct grant');
});

test('smoke diamond drops into the inventory, then a lost one reappears as a real chamber ground item', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 11);
  p.items.set(I.TINDERBOX, 1);
  for (const objectId of [6405, 6407, 6409, 6411]) {
    fire(h.itemOnObject, { player: p, objectId, itemId: I.TINDERBOX, handled: false });
  }
  const chest = { player: p, objectId: core.ObjectIdentifiers.BURNT_CHEST, handled: false };
  fire(h.objectInteraction, chest);
  assert.equal(chest.handled, true);
  assert.equal(p.items.get(I.WARM_KEY), 1);

  fire(h.npcDeaths, { player: p, killer: p, npcId: core.NpcIdentifiers.FAREED });
  assert.equal(p.items.get(I.SMOKE_DIAMOND), 1, 'Wiki: the smoke diamond appears in the inventory on the kill');

  p.items.delete(I.SMOKE_DIAMOND);
  p.setLocation(3304, 9375, 0);
  const door = { player: p, objectId: 6452, handled: false };
  fire(h.events['door:toggle'], door);
  assert.equal(door.handled, true);
  const tile = new core.Location(3307, 9376, 0);
  const ground = core.ItemOnGroundManager.getGroundItem(p.getUsername(), I.SMOKE_DIAMOND, tile, null);
  assert.ok(ground, 're-entering the gate spawns the smoke diamond on the chamber floor');
  assert.equal(p.items.get(I.SMOKE_DIAMOND) ?? 0, 0, 'recovery is not a direct inventory grant');
  p.setLocation(3307, 9376, 0);
  core.ItemOnGroundManager.pickup(p, ground);
  assert.equal(p.items.get(I.SMOKE_DIAMOND), 1, 'the real ground item can be picked up normally');
});

test('pyramid ladder route and Azzanadra action complete on varbit 358 = 15', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 12);

  fire(h.objectInteraction, { player: p, objectId: 6497, location: { x: 3233, y: 2897, z: 0 }, handled: false });
  assert.deepEqual(p.moves.at(-1), [2912, 4953, 3]);
  assert.equal(h.quest.getStage(p), 13, 'entering the pyramid advances to helper finish stage 13');

  fire(h.objectInteraction, { player: p, objectId: 6498, location: { x: 2909, y: 4964, z: 3 }, handled: false });
  assert.deepEqual(p.moves.at(-1), [2844, 4964, 2]);
  fire(h.objectInteraction, { player: p, objectId: 6499, location: { x: 2846, y: 4973, z: 2 }, handled: false });
  assert.deepEqual(p.moves.at(-1), [2781, 4973, 1]);
  fire(h.objectInteraction, { player: p, objectId: 6500, location: { x: 2784, y: 4941, z: 1 }, handled: false });
  assert.deepEqual(p.moves.at(-1), [3231, 9293, 0]);
  fire(h.objectInteraction, { player: p, objectId: 6553, location: { x: 3234, y: 9324, z: 0 }, handled: false });
  assert.deepEqual(p.moves.at(-1), [3234, 9323, 0]);

  const complete = { player: p, npcId: core.NpcIdentifiers.AZZANADRA, stepId: 'y8-TJV', handled: false };
  fire(h.events['npc-dialogue:action'], complete);
  assert.equal(complete.handled, true);
  assert.equal(h.quest.getStage(p), 15);
  assert.equal(p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 358).at(-1)?.[2], 15);
  assert.equal(p.items.get(I.ANCIENT_STAFF), 1);
  assert.equal(p.levels.get(core.Skill.MAGIC.getIndex()), 20000);

  fire(h.events['npc-dialogue:action'], { player: p, npcId: core.NpcIdentifiers.AZZANADRA, stepId: 'y8-TJV', handled: false });
  assert.equal(p.items.get(I.ANCIENT_STAFF), 1, 'completion reward is granted once');

  p.log.length = 0;
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 358).at(-1)?.[2], 15);
});

test('registered-dispatch chain reaches completion from a fresh stage 0 (not a live route)', () => {
  const h = harness();
  const p = makePlayer();
  const A = core.NpcIdentifiers.ASGARNIA_SMITH;
  const E = core.NpcIdentifiers.EBLIS;
  const E_MIRRORS = 689;
  const B = core.NpcIdentifiers.BARTENDER;
  assert.equal(h.quest.getStage(p), 0);

  fire(h.events['npc-dialogue:hook'], { player: p, npcId: A, hook: 'quest:desert-treasure-i:start', handled: false });
  assert.equal(h.quest.getStage(p), 1);

  p.items.set(I.ETCHINGS, 1);
  fire(h.events['npc-dialogue:condition'], { player: p, npcId: core.NpcIdentifiers.TERRY_BALANDO, text: 'If the player has the etchings.' });
  assert.equal(p.items.get(I.ETCHINGS) ?? 0, 0, 'Terry takes the etchings');
  fire(h.events['npc-dialogue:action'], { player: p, npcId: core.NpcIdentifiers.TERRY_BALANDO, stepId: '4k_Mh4', handled: false });
  assert.equal(p.items.get(I.TRANSLATION), 1);
  assert.equal(h.quest.getStage(p), 2);

  fire(h.events['npc-dialogue:action'], { player: p, npcId: A, stepId: 'SV5eWc', handled: false });
  assert.equal(h.quest.getStage(p), 3);
  fire(h.events['npc-dialogue:choice'], { player: p, npcId: A, option: 'Help him' });
  assert.equal(h.quest.getStage(p), 4);

  p.items.set(I.COINS, 650);
  fire(h.events['npc-dialogue:action'], { player: p, npcId: B, stepId: 'vIMkMd', handled: false });
  fire(h.events['npc-dialogue:action'], { player: p, npcId: B, stepId: 'sRlaoo', handled: false });
  assert.equal(p.items.get(I.COINS) ?? 0, 0);
  assert.equal(p.items.get(I.BANDITS_BREW), 1);
  assert.equal(h.quest.getStage(p), 6);
  fire(h.events['npc-dialogue:choice'], { player: p, npcId: B, option: 'I heard about four diamonds...' });
  assert.equal(h.quest.getStage(p), 7);

  assert.equal(variantOf(h, p, E), 'enchanting-the-mirrors-talking-to-eblis-after-asking-the-bartender-about-the-diamonds');
  assert.equal(h.quest.getStage(p), 8);
  fire(h.events['npc-dialogue:choice'], { player: p, npcId: E, option: 'Yes, I will go get those for you.' });
  assert.equal(h.quest.getStage(p), 9);

  for (const [itemId, amount] of [[I.MAGIC_LOGS, 12], [I.STEEL_BAR, 6], [I.MOLTEN_GLASS, 6],
    [I.ASHES, 1], [I.CHARCOAL, 1], [I.BLOOD_RUNE, 1], [I.BONES, 1]]) p.items.set(itemId, amount);
  fire(h.itemOnNpc, { player: p, npcId: E, itemId: I.MAGIC_LOGS, handled: false });
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(variantOf(h, p, E_MIRRORS), 'enchanting-the-mirrors-talking-to-eblis-at-the-mirrors');
  assert.equal(h.quest.getStage(p), 11);

  fire(h.npcDeaths, { player: p, killer: p, npcId: core.NpcIdentifiers.FAREED });
  assert.equal(p.items.get(I.SMOKE_DIAMOND), 1);
  fire(h.npcBeforeDeaths, { player: p, npc: { getId: () => core.NpcIdentifiers.DAMIS, getLocation: () => new core.Location(2745, 5115, 0) } });
  const damis = { getId: () => core.NpcIdentifiers.DAMIS_2, getLocation: () => new core.Location(2745, 5115, 0) };
  fire(h.npcDeaths, { player: p, killer: p, npcId: core.NpcIdentifiers.DAMIS_2, npc: damis });
  const shadowGround = core.ItemOnGroundManager.getGroundItem(p.getUsername(), I.SHADOW_DIAMOND,
    new core.Location(2745, 5115, 0), null);
  assert.ok(shadowGround, 'Damis drops the shadow diamond on the ground');
  p.setLocation(2745, 5115, 0);
  core.ItemOnGroundManager.pickup(p, shadowGround);
  assert.equal(p.items.get(I.SHADOW_DIAMOND), 1, 'the natural ground pickup supplies the route');

  p.items.set(I.SILVER_BAR, 1);
  fire(h.itemOnNpc, { player: p, npcId: core.NpcIdentifiers.RUANTUN, itemId: I.SILVER_BAR, handled: false });
  fire(h.itemOnNpc, { player: p, npcId: core.NpcIdentifiers.HIGH_PRIEST, itemId: I.SILVER_POT_3, handled: false });
  fire(h.itemOnNpc, { player: p, npcId: core.NpcIdentifiers.MALAK, itemId: I.BLESSED_POT, handled: false });
  p.items.set(I.GARLIC_POWDER, 1);
  fire(h.itemOnItem, { player: p, usedItemId: I.GARLIC_POWDER, usedWithItemId: I.BLESSED_POT_2, handled: false });
  p.items.set(I.SPICE, 1);
  fire(h.itemOnItem, { player: p, usedItemId: I.SPICE, usedWithItemId: I.BLESSED_POT_3, handled: false });
  fire(h.itemOnObject, { player: p, objectId: 6437, itemId: I.BLESSED_POT_4, handled: false });
  fire(h.npcDeaths, { player: p, killer: p, npcId: core.NpcIdentifiers.DESSOUS });
  assert.equal(variantOf(h, p, core.NpcIdentifiers.MALAK), 'blood-diamond-talking-to-malak-after-defeating-dessous');
  assert.equal(p.items.get(I.BLOOD_DIAMOND), 1);

  p.items.set(I.CAKE, 1);
  fire(h.itemOnNpc, { player: p, npcId: core.NpcIdentifiers.TROLL_CHILD, itemId: I.CAKE, handled: false });
  fire(h.events['npc-dialogue:choice'], { player: p, npcId: core.NpcIdentifiers.TROLL_CHILD, option: 'Yes' });
  for (let i = 0; i < 5; i++) fire(h.npcDeaths, { player: p, killer: p, npcId: 699 });
  assert.equal(RegionManager.blocked(new core.Location(2868, 3718, 0), null), false,
    'five ice trolls thaw the real cave mouth');
  const block1 = { getId: () => 1969, getLocation: () => new core.Location(2826, 3808, 2) };
  const block2 = { getId: () => 1970, getLocation: () => new core.Location(2826, 3812, 2) };
  h.npcs.push(block1, block2);
  h.events['any-npc']['Smash-ice']({ player: p, npc: block1, npcId: 1969 });
  h.events['any-npc']['Smash-ice']({ player: p, npc: block2, npcId: 1970 });
  assert.equal(variantOf(h, p, core.NpcIdentifiers.TROLL_FATHER), 'ice-diamond-talking-to-the-troll-parents-after-freeing-them');
  assert.equal(p.items.get(I.ICE_DIAMOND), 1);

  const obelisks = [[I.BLOOD_DIAMOND, 6482], [I.SMOKE_DIAMOND, 6485], [I.ICE_DIAMOND, 6488], [I.SHADOW_DIAMOND, 6491]];
  for (const [itemId, objectId] of obelisks) {
    const use = { player: p, objectId, itemId, handled: false };
    fire(h.itemOnObject, use);
    assert.equal(use.handled, true);
    assert.equal(p.items.get(itemId) ?? 0, 0);
  }
  assert.equal(h.quest.getStage(p), 12);
  assert.equal(p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 387).length > 0, true,
    'the fire column varbit is set without writing the whole varp');

  fire(h.objectInteraction, { player: p, objectId: 6497, location: { x: 3233, y: 2897, z: 0 }, handled: false });
  fire(h.objectInteraction, { player: p, objectId: 6498, location: { x: 2909, y: 4964, z: 3 }, handled: false });
  fire(h.objectInteraction, { player: p, objectId: 6499, location: { x: 2846, y: 4973, z: 2 }, handled: false });
  fire(h.objectInteraction, { player: p, objectId: 6500, location: { x: 2784, y: 4941, z: 1 }, handled: false });
  fire(h.objectInteraction, { player: p, objectId: 6553, location: { x: 3234, y: 9324, z: 0 }, handled: false });
  assert.equal(h.quest.getStage(p), 13);

  const complete = { player: p, npcId: core.NpcIdentifiers.AZZANADRA, stepId: 'y8-TJV', handled: false };
  fire(h.events['npc-dialogue:action'], complete);
  assert.equal(complete.handled, true);
  assert.equal(h.quest.getStage(p), 15);
  assert.equal(p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 358).at(-1)?.[2], 15);
  assert.equal(p.items.get(I.ANCIENT_STAFF), 1);
});

test('native pyramid controls retain the diamond gate, exterior passage and paired floor ladders', async t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const climb = require('../plugins/objects/ClimbLinks');
  require('../plugins/objects/Ladders.plugin').register(PluginManager.createApi('pyramid-native-ladders'));
  require('../plugins/quests/quests/DesertTreasureI.Quest')(PluginManager.createApi('pyramid-native-quest'));
  const quest = runtime.getRegisteredQuests().find(q => q.key === 'desert_treasure_i');
  let index = 1900;
  function objectAt(id, [x, y, z]) {
    RegionManager.loadMapFiles(x, y);
    const object = core.MapObjects.mapObjects.get(core.MapObjects.getHash(x, y, z))?.find(o => o.getId() === id);
    assert.ok(object, `cache loc ${id} at ${x},${y},${z}`);
    return object;
  }
  function playerAt(stage, placed = 0) {
    const channel = { kind: 'test', isOpen: () => true, send: () => true, close() {}, onData() {}, onClose() {}, onError() {} };
    const session = new PlayerSession(channel), player = new Player(session); session.setPlayer(player);
    player.setIndex(index++); player.setUsername('pyramid' + player.getIndex()); player.setRegistered(true);
    const connection = new ClientConnection(channel); connection.player = player;
    const messages = []; player.sendMessage = text => messages.push(text);
    quest.setStage(player, stage);
    if (placed) {
      RegionManager.loadMapFiles(3233, 2897);
      player.getSkillManager().setMaxLevel(core.Skill.MAGIC, 50).setCurrentLevel(core.Skill.MAGIC, 50, false);
      const diamonds = [[6482, I.BLOOD_DIAMOND], [6485, I.SMOKE_DIAMOND], [6488, I.ICE_DIAMOND], [6491, I.SHADOW_DIAMOND]];
      for (const [objectId, itemId] of diamonds.slice(0, placed)) {
        const object = [...core.MapObjects.mapObjects.values()].flat().find(o => o.getId() === objectId);
        assert.ok(object); player.getInventory().add(new core.Item(itemId), false);
        assert.equal(PluginManager.emitItemOnObject({ player, object, objectId, itemId, handled: false }), true);
        assert.equal(player.getInventory().getAmount(itemId), 0);
      }
      if (placed === 4) {
        assert.equal(quest.getStage(player), 12);
        assert.equal(player.getAttribute('desert-treasure-i:placed-mask'), 15);
        assert.deepEqual([387, 388, 389, 390].map(id => player.getPacketSender().getVarbit(id)), [1, 1, 1, 1]);
      }
    }
    return { player, connection, messages };
  }
  const position = tile => [tile.getX(), tile.getY(), tile.getZ()];
  async function click(f, id, source) {
    const object = objectAt(id, source), definition = core.ObjectDefinition.forId(id);
    assert.equal(definition.getName(), 'Ladder');
    const start = climb.landingTile(object, { x: source[0], y: source[1] }, null);
    assert.ok(start); assert.equal(RegionManager.blocked(start), false);
    f.player.setLocation(start); f.player.needsPlacement = false;
    await f.connection.dispatch([{ type: 'object_option', id, x: source[0], y: source[1], clickType: 1, action: definition.getActions()[0] }]);
    f.connection.processTurnPackets();
    for (let tick = 0; tick < 4; tick++) {
      core.TaskManager.process(); core.TaskManager.processWalkTo(f.player.getIndex()); f.player.getMovementQueue().process();
    }
    return position(start);
  }
  function cleanup(test, f) {
    test.after(() => { f.player.setRegistered(false); core.TaskManager.cancelTasks(f.player.getIndex()); });
  }
  for (const [stage, placed] of [[0, 0], [11, 3]]) await t.test(`entry refuses stage ${stage} with ${placed} diamonds placed`, async test => {
    const f = playerAt(stage, placed); cleanup(test, f);
    const start = await click(f, 6497, [3233, 2897, 0]);
    assert.deepEqual(position(f.player.getLocation()), start);
    assert.equal(quest.getStage(f.player), stage);
    assert.match(f.messages.at(-1), /powerful force prevents/);
  });
  const routes = [
    [6497, [3233, 2897, 0], [2912, 4953, 3], 6504, [2913, 4953, 3]],
    [6498, [2909, 4964, 3], [2844, 4964, 2], 6503, [2845, 4964, 2]],
    [6499, [2846, 4973, 2], [2781, 4973, 1], 6502, [2782, 4973, 1]],
    [6500, [2784, 4941, 1], [3231, 9293, 0], 6501, [3232, 9293, 0]],
    [6504, [2913, 4953, 3], [3232, 2897, 0], 6497, [3233, 2897, 0]],
    [6503, [2845, 4964, 2], [2908, 4964, 3], 6498, [2909, 4964, 3]],
    [6502, [2782, 4973, 1], [2845, 4973, 2], 6499, [2846, 4973, 2]],
    [6501, [3232, 9293, 0], [2783, 4941, 1], 6500, [2784, 4941, 1]],
  ];
  for (const [id, source, destination, returnId, returnTile] of routes) await t.test(`cache ladder ${id} lands on a walkable tile beside its paired ladder`, async test => {
    const f = playerAt(id === 6497 ? 11 : 13, id === 6497 ? 4 : 0); cleanup(test, f);
    await click(f, id, source);
    assert.deepEqual(position(f.player.getLocation()), destination);
    assert.equal(quest.getStage(f.player), 13);
    const otherEnd = objectAt(returnId, returnTile), movement = f.player.getMovementQueue();
    assert.equal(RegionManager.blocked(f.player.getLocation()), false);
    assert.equal(movement.reachesObject(otherEnd, movement.buildObjectRouteSpec(otherEnd)), true, 'the return ladder remains usable from the landing');
  });
  await t.test('a player returning from an old invalid entry gains no quest stage', async test => {
    const f = playerAt(0); cleanup(test, f); await click(f, 6504, [2913, 4953, 3]);
    assert.deepEqual(position(f.player.getLocation()), [3232, 2897, 0]);
    assert.equal(quest.getStage(f.player), 0);
  });
  await t.test('completed entry retains completion', async test => {
    const f = playerAt(15); cleanup(test, f); await click(f, 6497, [3233, 2897, 0]);
    assert.deepEqual(position(f.player.getLocation()), [2912, 4953, 3]);
    assert.equal(quest.getStage(f.player), 15);
  });
  await t.test('descending after an old invalid entry cannot grant quest progress', async test => {
    const f = playerAt(0); cleanup(test, f);
    await click(f, 6501, [3232, 9293, 0]);
    assert.equal(quest.getStage(f.player), 0);
    await click(f, 6500, [2784, 4941, 1]);
    assert.equal(quest.getStage(f.player), 0);
  });
  await t.test('a ready interior checkpoint still advances to stage 13', async test => {
    const f = playerAt(11, 4); cleanup(test, f); await click(f, 6498, [2909, 4964, 3]);
    assert.equal(quest.getStage(f.player), 13);
    assert.deepEqual(position(f.player.getLocation()), [2844, 4964, 2]);
  });

  // RSProx3017 (rev231):6545->6546 and6547->6548, shape10/rotation1,
  // sound62 and two ticks on the entrance tile before stepping to the other side.
  const viewers = [];
  t.mock.method(core.World, 'forEachNetworkPlayer', visit => viewers.forEach(visit));
  function doorPlayer(test, stage = 11, placed = 4) {
    const f = playerAt(stage, placed); cleanup(test, f);
    f.packets = []; f.frames = [];
    test.mock.method(f.player.getSession(), 'sendClientPacket', frame => { f.frames.push(frame); return true; });
    const sender = f.player.getPacketSender();
    for (const method of ['sendObject', 'sendObjectRemoval', 'sendSoundEffect']) {
      const original = sender[method].bind(sender);
      test.mock.method(sender, method, (...args) => {
        f.packets.push([method, ...args]); return original(...args);
      });
    }
    test.mock.method(f.player.getSession(), 'isTileInScene', () => true);
    viewers.push(f.player);
    test.after(() => {
      PluginManager.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
      viewers.splice(viewers.indexOf(f.player), 1);
    });
    return f;
  }
  async function open(f, id, x, y) {
    objectAt(id, [x, 2899, 0]);
    f.player.setLocation(new core.Location(x, y, 0)); f.player.needsPlacement = false;
    await f.connection.dispatch([{ type: 'object_option', id, x, y: 2899, clickType: 1, action: 'Open' }]);
    f.connection.processTurnPackets();
  }
  function turn(...fixtures) {
    core.World.processCycle++;
    for (const f of fixtures) f.player.getMovementQueue().beginCycle();
    core.TaskManager.process();
    for (const f of fixtures) {
      f.player.getMovementQueue().process(); core.TaskManager.processWalkTo(f.player.getIndex());
    }
  }
  const owned = (f, id, x) => core.MapObjects.getPrivateArea(f.player, id, new core.Location(x, 2899, 0));
  const added = f => f.packets.filter(row => row[0] === 'sendObject').map(row => row[1].getId());
  for (const [id, openedId, x] of [[6545, 6546, 3233], [6547, 6548, 3232]]) {
    for (const side of [-1, 1]) await t.test(`native Open${id} walks ${side < 0 ? 'north' : 'south'} and closes after two ticks`, async test => {
      const f = doorPlayer(test), observer = doorPlayer(test, 0, 0);
      f.player.setRunning(side < 0);
      const at = new core.Location(x, 2899, 0), base = objectAt(id, [x, 2899, 0]);
      const beforeClip = RegionManager.getClipping(x, 2899, 0, null);
      assert.equal(core.ObjectDefinition.forId(id).getName(), 'Pyramid entrance');
      assert.equal(core.CacheDefinitions.getObject(openedId).seqId, -1, 'no invented opening animation');
      await open(f, id, x, 2899 + side);
      turn(f);
      assert.deepEqual(position(f.player.getLocation()), [x, 2899, 0]);
      const leaf = owned(f, openedId, x);
      assert.ok(leaf, 'the temporary opened leaf is registered for the acting player');
      assert.equal(leaf.getOwner(), f.player);
      assert.equal(leaf.getType(), 10); assert.equal(leaf.getFace(), 1);
      assert.equal(core.MapObjects.get(id, at, null), base, 'the shared closed leaf is never removed');
      assert.equal(owned(observer, openedId, x), null, 'an unready player gains no opened entrance');
      assert.equal(RegionManager.getClipping(x, 2899, 0, null), beforeClip, 'global clipping stays intact');
      assert.deepEqual(added(f), [openedId]); assert.deepEqual(added(observer), []);
      const { encodeSound } = require('../dist/net/protocol/ClientProtocol');
      assert.equal(f.packets.filter(row => row[0] === 'sendSoundEffect').length, 1);
      assert.ok(f.frames.some(frame => frame.equals(encodeSound(62, { loops: 1, delay: 0 }))), 'native sound packet matches the capture');
      const view = f.player.getSession().createPlayerView(f.player);
      assert.deepEqual([view.x, view.y, view.level], [x, 2899, 0], 'native player sync sees the walked tile');
      assert.equal(f.player.isNeedsPlacement(), false, 'passage is walking, not a teleport');
      assert.equal(f.player.getForceMovement(), undefined);
      turn(f);
      assert.deepEqual(position(f.player.getLocation()), [x, 2899, 0]);
      assert.ok(owned(f, openedId, x), 'the leaf stays open for the second tick');
      turn(f);
      assert.deepEqual(position(f.player.getLocation()), [x, 2899 - side, 0]);
      assert.equal(owned(f, openedId, x), null);
      assert.deepEqual(added(f), [openedId, id], 'the same shape/anchor is restored silently');
      turn(f);
      assert.equal(f.player.hasFlag('movement:ignore-clipping'), false);
      assert.equal(quest.getStage(f.player), 12, 'opening does not enter the underground pyramid or advance the quest');
      assert.equal(quest.getStage(observer.player), 0);
    });
  }
  await t.test('native exterior Open refuses missing diamonds and unrelated Pyramid entrance objects', async test => {
    for (const [stage, placed] of [[0, 0], [11, 3]]) {
      const f = doorPlayer(test, stage, placed);
      await open(f, 6547, 3232, 2900); turn(f);
      assert.deepEqual(position(f.player.getLocation()), [3232, 2900, 0]);
      assert.match(f.messages.at(-1), /powerful force prevents/);
      assert.deepEqual(added(f), []); assert.equal(f.player.hasFlag('movement:ignore-clipping'), false);
    }
    const f = doorPlayer(test);
    const object = new core.GameObject(6547, new core.Location(3200, 3200, 0), 10, 1);
    assert.equal(PluginManager.emitObjectInteraction({ player: f.player, object, objectId: 6547,
      clickType: 1, location: { x: 3200, y: 3200, z: 0 }, handled: false }), false);
  });
  await t.test('walking away and disconnecting restore owned leaves and never resume the cancelled passage', async test => {
    const a = doorPlayer(test), b = doorPlayer(test);
    await open(a, 6547, 3232, 2898); await open(b, 6547, 3232, 2900);
    turn(a, b);
    assert.ok(owned(a, 6548, 3232)); assert.ok(owned(b, 6548, 3232));
    a.player.getMovementQueue().requestWalk(new core.Location(3232, 2898, 0));
    assert.equal(a.player.hasFlag('movement:ignore-clipping'), false);
    assert.equal(owned(a, 6548, 3232), null);
    assert.ok(owned(b, 6548, 3232), 'A cancellation preserves B opening');
    PluginManager.emitPlayerDisconnect({ player: b.player, username: b.player.getUsername() }); b.player.setRegistered(false);
    assert.equal(owned(b, 6548, 3232), null);
    assert.equal(b.player.hasFlag('movement:ignore-clipping'), false);
    for (let tick = 0; tick < 5; tick++) turn(a);
    assert.deepEqual(position(a.player.getLocation()), [3232, 2898, 0]);
    assert.deepEqual(position(b.player.getLocation()), [3232, 2899, 0]);
  });
  await t.test('a distant native click approaches normally, replays the owned leaf and finishes the crossing', async test => {
    const f = doorPlayer(test);
    f.player.setRunning(false);
    await open(f, 6547, 3232, 2904);
    for (let tick = 0; tick < 12 && !owned(f, 6548, 3232); tick++) turn(f);
    assert.deepEqual(position(f.player.getLocation()), [3232, 2899, 0]);
    assert.ok(owned(f, 6548, 3232), 'the walk-to callback did not erase the scripted step');
    f.packets.length = 0;
    core.ObjectManager.onRegionChange(f.player, 3184, 2848);
    assert.ok(added(f).includes(6548), 'a scene rebuild replays the owned opened leaf');
    for (let tick = 0; tick < 4; tick++) turn(f);
    assert.deepEqual(position(f.player.getLocation()), [3232, 2898, 0]);
    assert.equal(owned(f, 6548, 3232), null);
    assert.equal(f.player.hasFlag('movement:ignore-clipping'), false);
  });
  await t.test('the exterior passage connects to the separately gated native entrance ladder', async test => {
    const f = doorPlayer(test);
    await open(f, 6547, 3232, 2900);
    for (let tick = 0; tick < 3; tick++) turn(f);
    assert.deepEqual(position(f.player.getLocation()), [3232, 2898, 0]);
    await f.connection.dispatch([{ type: 'object_option', id: 6497, x: 3233, y: 2897,
      clickType: 1, action: 'Climb-down' }]);
    f.connection.processTurnPackets();
    assert.equal(f.player.hasFlag('movement:ignore-clipping'), false, 'another object route ends the passage exemption');
    for (let tick = 0; tick < 6; tick++) turn(f);
    assert.deepEqual(position(f.player.getLocation()), [2912, 4953, 3]);
    assert.equal(quest.getStage(f.player), 13, 'the ladder alone advances entry progress');
  });
  await t.test('cancelling before opening and becoming movement-locked leave no passage behind', async test => {
    const a = doorPlayer(test), b = doorPlayer(test);
    await open(a, 6545, 3233, 2898);
    a.player.getMovementQueue().requestWalk(new core.Location(3232, 2898, 0));
    await open(b, 6547, 3232, 2900);
    b.player.getMovementQueue().setBlockMovement(true);
    for (let tick = 0; tick < 4; tick++) turn(a, b);
    for (const f of [a, b]) {
      assert.deepEqual(added(f), []);
      assert.equal(f.player.hasFlag('movement:ignore-clipping'), false);
      assert.equal(f.player.getMovementQueue().size(), 0);
    }
    assert.deepEqual(position(a.player.getLocation()), [3232, 2898, 0]);
    assert.deepEqual(position(b.player.getLocation()), [3232, 2900, 0]);
  });
  await t.test('a relocated player is not pulled back and a pre-existing movement flag survives completion', async test => {
    const a = doorPlayer(test), b = doorPlayer(test, 15, 0);
    await open(a, 6545, 3233, 2898); turn(a);
    a.player.setLocation(new core.Location(3220, 2900, 0)); turn(a);
    assert.equal(owned(a, 6546, 3233), null);
    assert.equal(a.player.hasFlag('movement:ignore-clipping'), false);
    b.player.setFlag('movement:ignore-clipping', true);
    await open(b, 6545, 3233, 2900);
    for (let tick = 0; tick < 5; tick++) turn(b);
    assert.deepEqual(position(a.player.getLocation()), [3220, 2900, 0]);
    assert.deepEqual(position(b.player.getLocation()), [3233, 2898, 0]);
    assert.equal(b.player.hasFlag('movement:ignore-clipping'), true);
    assert.equal(quest.getStage(b.player), 15);
  });
});
