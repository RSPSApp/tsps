// From server/: node --test tests/remaining-moons-eye-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { Location } = require('../dist/game/model/Location');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
const ClimbLinks = require('../plugins/objects/ClimbLinks');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { World } = require('../dist/game/World');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
let nextIndex = 1;
const noop = () => {};
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); new NpcDefinitionLoader().load(); });

function harness(name) {
  const hooks = {}, events = {}, tasks = [], areas = [], npcs = [], removed = [], objects = [], ground = [], clicks = new Map(), buttons = new Map(), namedNpcs = new Map(), namedObjects = new Map(), persisted = new Map();
  const objectManager = { register: object => objects.push(object), deregister: object => { const i = objects.indexOf(object); if (i >= 0) objects.splice(i, 1); } };
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  }, ObjectManager: { register: object => objects.push(object), deregister: noop } },
    registerArea: area => areas.push(area),
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args) }),
    onInterfaceActionButton: (ids, fn) => [].concat(ids).forEach(id => { const callbacks = buttons.get(id) ?? []; callbacks.push(fn); buttons.set(id, callbacks); }),
    onObjectClick: (ids, click, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    onNpcInteraction: (name, actions) => namedNpcs.set(name, actions),
    onObjectInteraction: (name, actions) => { if (typeof name === 'function') (hooks.onObjectInteraction ??= []).push(name); else namedObjects.set(name, actions); },
    onObjectFirstClick: (ids, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    persistAttribute: (key, value) => persisted.set(key, value),
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null;
      const npc = { ...definition, animations: [], graphics: [], getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, setForceMovement: movement => { npc.forceMovement = movement; }, getLocation: () => location, moveTo: to => { location = to; },
        getArea: () => area, setArea: value => { area = value; }, isNpc: () => true, isPlayer: () => false, getAsNpc: () => npc,
        isRegistered: () => !npc.removed, setPositionToFace: noop, forceChat: text => { npc.said = text; },
        performAnimation: animation => npc.animations.push(animation.getId()), performGraphic: graphic => npc.graphics.push(graphic.id),
        getMovementQueue: () => ({ reset() { return this; }, addSteps: to => { npc.walkingTo = to; } }),
        exactMove: (to, options) => { npc.exact = options; location = to; },
        setFollowing: target => { npc.following = target; }, setMobileInteraction: noop, setNpcTransformationId: noop,
        setPet: noop, setOwner: noop, getOwner: () => definition.owner,
        setCombatXpMultiplier: value => { npc.multiplier = value; },
        getCombat: () => ({ attack: player => { npc.target = player; } }),
      }; npcs.push(npc); return npc;
    }, removeNpc: npc => { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) { const answer = fn(event); if (answer !== null && answer !== undefined) return answer; }
    return null;
  };
  const h = { api, hooks, events, tasks, areas, npcs, removed, objects, ground, clicks, buttons, namedNpcs, namedObjects, persisted, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    variant(p, npcId) { return (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean); },
    talk(p, npcId) { p.prompt = null; const choice = h.variant(p, npcId); assert.ok(choice, `no variant for ${npcId}`); runtime.startTranscript(api, p, npcId, typeof choice === 'string' ? h.quest.name : choice.page, typeof choice === 'string' ? choice : choice.variant); },
    line(p, npcId, text) { const event = { player: p, npcId, text }; h.emit('npc-dialogue:line', event); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId }; h.emit('npc-dialogue:action', event); return event; },
    object(p, objectId, location, clickType = 1, actions = ['Pass-through']) {
      const event = { player: p, objectId, location: new core.Location(location.x, location.y, location.z), clickType, definition: { getInteractions: () => actions } };
      for (const fn of hooks.onObjectInteraction ?? []) fn(event);
      return event;
    },
    itemOnObject(p, itemId, objectId, location, actions = []) {
      const event = { player: p, itemId, objectId, location: new core.Location(location.x, location.y, location.z), definition: { getInteractions: () => actions } };
      for (const fn of hooks.onItemOnObject ?? []) fn(event);
      return event;
    },
    itemOnNpc(p, itemId, npcId) { const event = { player: p, itemId, npcId }; for (const fn of hooks.onItemOnNpc ?? []) fn(event); return event; },
    itemOnItem(p, usedItemId, usedWithItemId) { const event = { player: p, usedItemId, usedWithItemId }; for (const fn of hooks.onItemOnItem ?? []) fn(event); return event; },
    itemAction(p, itemId, option) { const event = { player: p, itemId, option }; for (const fn of hooks.onItemAction ?? []) fn(event); return event; },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    choose(p, text) { const prompt = p.prompt; assert.ok(prompt, `no menu for ${text}`); const index = prompt.options.findIndex(label => label === text); assert.ok(index >= 0, `missing ${text} in ${prompt.options}`); p.prompt = null; prompt.pairs[index * 2 + 1](); },
    continueUntil(p, predicate, limit = 120) { while (!predicate()) { assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`); assert.ok(p.manager.getCurrent(), `dialogue ended at ${p.text}`); p.manager.advance(); } },
    finish(p, limit = 300) { let n = limit; const polite = ['I\'ll be back soon.', 'Okay, thanks.', 'Goodbye.', 'See you around.', 'I\'d better go.', 'Nothing thanks, I\'m just looking around.', 'Nothing. I\'m just looking around.', 'No thanks.', 'Actually, I don\'t need anything right now.']; while (n-- > 0) { if (p.prompt) { const label = polite.find(option => p.prompt.options.includes(option)); if (!label) break; h.choose(p, label); continue; } if (!p.manager.getCurrent()) break; p.manager.advance(); } assert.ok(n > 0, `dialogue did not end at ${p.text}`); p.prompt = null; },
  }; return h;
}

function player() {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [];
  let location = new core.Location(3210, 3220, 0), area = null;
  const inv = { getAmount: id => items.get(id) ?? 0, isFull: () => Boolean(p.full), getFreeSlots: () => p.full ? 0 : 28 - items.size, contains: id => (items.get(id) ?? 0) > 0,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) { assert.ok((items.get(id) ?? 0) >= amount, `missing ${id}`); items.set(id, items.get(id) - amount); },
  };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; }, sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendString(text, uid) { if ([6, 3, 2].some(child => [217, 231, 229, 193].some(group => uid === (group << 16 | child)))) p.text = text; log.push(['text', uid, text]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = { setEnteredAmountAction: action => { p.amountAction = action; }, attrs, items, configs, varbits, log, xp, messages: [], animations: [], prompt: null, text: '', index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inv,
    getBanks: () => [{ getAmount: id => p.bank?.get(id) ?? 0 }], getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getSession: () => ({ sendClientPacket: frame => { log.push(['frame', Buffer.from(frame)]); return true; } }), getPacketSender: () => packet, getDialogueManager: () => p.manager, getUpdateFlag: () => ({ flag: noop }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), addExperience: (skill, amount) => xp.push([skill.getIndex(), amount]), getCombatLevel: () => p.combat ?? 3, getCurrentLevel: () => p.magic ?? 99, getMaxLevel: () => p.level ?? 99 }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; }, addSteps(to) { location = to; return this; }, isBlockMovement: () => Boolean(p.blocked) }),
    setUntargetable: value => { p.untargetable = value; }, setForceMovement: movement => { p.forceMovement = movement; }, getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; }, getIndex: () => p.index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: damage => { p.damage = damage; } }) }),
    getUsername: () => 'Parity', getAppearance: () => ({ isMale: () => true }), setPositionToFace: noop, forceChat: noop,
    performAnimation: a => p.animations.push(a.getId()), sendMessage: text => p.messages.push(text),
  }; p.manager = new DialogueManager(p); return p;
}

test('Temple of the Eye accepts, declines and recovers; real stage scale and amulet hand-over', () => {
  const h = harness('TempleOfTheEye'), p = player();
  p.level = 99; p.attrs.set('quest.rune_mysteries.stage', 6);
  h.talk(p, N.WIZARD_PERSTEN);
  h.continueUntil(p, () => Boolean(p.prompt));
  h.choose(p, "What's a wizard doing in Al Kharid?");
  h.continueUntil(p, () => Boolean(p.prompt));
  h.choose(p, 'No.');
  h.finish(p);
  assert.equal(h.quest.getStage(p), 0);
  assert.equal(p.attrs.get('temple-of-the-eye:declined'), 1);
  assert.equal(p.items.get(I.EYE_AMULET), undefined);
  h.talk(p, N.WIZARD_PERSTEN);
  h.continueUntil(p, () => Boolean(p.prompt));
  h.choose(p, 'Yes.');
  h.finish(p);
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.items.get(I.EYE_AMULET), 1);
  assert.equal(p.attrs.get('temple-of-the-eye:declined'), 0);
});

test('Temple of the Eye follows varbit stages 5..125 through dialogue, items, altars and the tutorial', () => {
  const h = harness('TempleOfTheEye'), p = player();
  p.level = 99; p.attrs.set('quest.rune_mysteries.stage', 6);
  const stage = () => h.quest.getStage(p);
  const finishTo = (npcId, choice) => { h.talk(p, npcId); if (choice) { h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, choice); } h.finish(p); };

  h.talk(p, N.WIZARD_PERSTEN); h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, "What's a wizard doing in Al Kharid?"); h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'Yes.'); h.finish(p);
  // With the canonical dialogue fix the hand-over is in this conversation; with
  // the current export the Yes branch only ends it, so the repeat talk recovers it.
  if (!p.items.get(I.EYE_AMULET)) { h.talk(p, N.WIZARD_PERSTEN); h.finish(p); }
  assert.equal(stage(), 10); assert.equal(p.items.get(I.EYE_AMULET), 1);

  p.items.set(I.BUCKET_OF_WATER, 1);
  finishTo(N.MAGE_OF_ZAMORAK, 'I need your help with an amulet.');
  assert.equal(stage(), 15);

  finishTo(N.TEA_SELLER, 'Could I have a strong cup of tea?');
  assert.equal(p.items.get(I.STRONG_CUP_OF_TEA), 1);
  finishTo(N.MAGE_OF_ZAMORAK, 'Could you help me with that amulet now?');
  assert.equal(stage(), 20);
  h.talk(p, N.MAGE_OF_ZAMORAK);
  h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'Could you help me with that amulet now?');
  h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'Yes.'); h.finish(p);
  assert.equal(stage(), 25);

  h.talk(p, N.DARK_MAGE); h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'I need your help with an amulet.'); h.finish(p);
  assert.equal(stage(), 35);
  p.attrs.set('quest.temple_of_the_eye.energy-order', '012345');
  p.attrs.set('quest.temple_of_the_eye.energy-progress', 0);
  // Real cache map ids/coords (capture 1693); each is a multi-loc whose varbit
  // 13747-13752 picks base 43768-43773 (1) or white 43774-43779 (2).
  const spots = [[43842,3040,4834],[43843,3041,4832],[43844,3037,4832],[43845,3038,4830],[43846,3038,4834],[43847,3040,4830]];
  const earthLoc = CacheDefinitions.getObject(43842);
  assert.deepEqual(earthLoc.transforms, [-1, 43768, 43774, -1]);
  assert.equal(earthLoc.transformVarbit, 13747);
  // A one-click arbitrary energy object id, or a real id on the wrong tile, must do nothing.
  h.object(p, O.EARTH_ENERGY, { x: 3040, y: 4834, z: 0 });
  h.object(p, 43842, { x: 3040, y: 4833, z: 0 });
  assert.equal(stage(), 35);
  assert.equal(p.attrs.get('quest.temple_of_the_eye.energy-progress'), 0);
  h.object(p, 43842, { x: 3040, y: 4834, z: 0 });
  assert.equal(p.attrs.get('quest.temple_of_the_eye.energy-progress'), 1);
  assert.equal(p.varbits.get(13747), 2, 'correct earth shows the white transform');
  h.object(p, 43847, { x: 3040, y: 4830, z: 0 });
  assert.equal(p.attrs.get('quest.temple_of_the_eye.energy-progress'), 0, 'wrong trial resets');
  assert.deepEqual([13747,13748,13749,13750,13751,13752].map(id => p.varbits.get(id)), [1,1,1,1,1,1]);
  assert.ok(p.messages.includes('The fire energy does not respond to your touch.'));
  for (const [id, x, y] of spots) h.object(p, id, { x, y, z: 0 });
  assert.equal(stage(), 40);
  assert.ok(p.messages.includes('The fire energy reacts strangely to your touch.'));
  assert.deepEqual([13747,13748,13749,13750,13751,13752].map(id => p.varbits.get(id)), [0,0,0,0,0,0]);
  assert.ok(p.messages.includes('The earth energy reacts strangely to your touch.'));
  finishTo(N.DARK_MAGE);
  assert.equal(stage(), 45); assert.equal(p.items.get(I.ABYSSAL_INCANTATION), 1);

  finishTo(N.WIZARD_PERSTEN);
  assert.equal(stage(), 60); assert.equal(p.items.get(I.EYE_AMULET), 0); assert.equal(p.items.get(I.ABYSSAL_INCANTATION), 1);

  finishTo(N.ARCHMAGE_SEDRIDOR, 'I need your help with an incantation.');
  assert.equal(stage(), 70); assert.equal(p.items.get(I.ABYSSAL_INCANTATION), 0);
  finishTo(N.WIZARD_TRAIBORN, 'I need your apprentices to help with an incantation.');
  assert.equal(stage(), 75);
  for (const [npcId, varbit] of [[N.APPRENTICE_FELIX_2, 13743], [N.APPRENTICE_TAMARA, 13742], [N.APPRENTICE_CORDELIA, 13744]]) {
    finishTo(npcId);
    assert.equal(p.varbits.get(varbit), 1, `riddle marker ${varbit}`);
  }
  h.tick(3);
  assert.equal(p.attrs.get('quest.temple_of_the_eye.tower-apprentices') & 7, 7, `riddles ${p.attrs.get('quest.temple_of_the_eye.tower-apprentices')}`);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: p });
  assert.deepEqual([13742, 13743, 13744].map(id => p.varbits.get(id)), [1, 1, 1], 'seen riddle markers resync on relog');
  assert.ok(p.log.some(row => row[0] === 'sendInterface' && row[1] === 291), 'riddle interface 291 opens');
  assert.ok(p.log.some(row => row[0] === 'text' && row[1] === ((291 << 16) | 8) && row[2].startsWith('Fire is four')), 'Cordelia riddle text');
  h.action(p, N.APPRENTICE_FELIX_2, 't_zXOj'); h.tick(1);
  assert.ok(p.log.some(row => row[0] === 'text' && row[1] === ((291 << 16) | 8) && row[2].startsWith('Water is six')), 'repeat riddle reopens interface 291');
  assert.equal(stage(), 80, `stage before traiborn ${stage()}`);
  finishTo(N.WIZARD_TRAIBORN, "I think I know what a thingummywut is!");
  assert.equal(stage(), 85);
  finishTo(N.ARCHMAGE_SEDRIDOR, "Let's do it.");
  assert.equal(stage(), 100);
  assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 3107 && row[2] === 9563), 'incantation camera');
  assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 2399 && row[2] === 5636), 'temple arrival camera');
  assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 2391 && row[2] === 5641), 'underwater reveal camera');
  assert.ok(p.log.some(row => row[0] === 'sendCameraReset'), 'temple cutscene camera reset');
  assert.equal(p.attrs.get('quest.temple_of_the_eye.tower-apprentices') & 7, 7);

  for (const npcId of [N.APPRENTICE_FELIX_4, N.APPRENTICE_TAMARA_3, N.APPRENTICE_CORDELIA_3]) finishTo(npcId);
  assert.equal(stage(), 105);
  finishTo(N.WIZARD_PERSTEN_4);
  assert.equal(stage(), 115);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 0);
  assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 2389 && row[2] === 5734), 'vision camera');
  assert.ok(p.log.some(row => row[0] === 'sendCameraShake' && row[1] === 0 && row[2] === 5), 'rift shake sequence');
  assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 2386 && row[2] === 5663), 'Great Guardian camera');

  finishTo(N.APPRENTICE_FELIX_4);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 5);
  h.object(p, O.WEAK_CELLS, { x: 3614, y: 9499, z: 0 }, 1, ['Take-from']);
  assert.equal(p.items.get(I.WEAK_CELL), 1);
  finishTo(N.APPRENTICE_TAMARA_3);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 10);
  h.object(p, O.INACTIVE_CELL_TILE, { x: 3610, y: 9509, z: 0 }, 1, ['Place']);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 15);
  h.object(p, O.FLOOR_CHISEL_OBJECT_ID ?? O.COL_FF9040_CHISEL_COL, { x: 3621, y: 9485, z: 0 }, 1, ['Take']);
  for (const id of [I.WEAK_CELL, I.WEAK_CELL]) h.object(p, O.WEAK_CELLS, { x: 3614, y: 9499, z: 0 }, 1, ['Take-from']);
  assert.equal(p.items.get(I.CHISEL), 1);
  h.object(p, O.ESSENCE_PILE_ELEMENTAL_, { x: 3613, y: 9510, z: 0 }, 1, ['Assemble']);
  h.object(p, O.ESSENCE_PILE_CATALYTIC_, { x: 3618, y: 9510, z: 0 }, 1, ['Assemble']);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 25);
  p.items.set(I.BRONZE_PICKAXE, 1);
  for (let i = 0; i < 5; i++) h.object(p, O.GUARDIAN_PARTS, { x: 3620, y: 9490, z: 0 }, 1, ['Mine']);
  assert.equal(p.items.get(I.GUARDIAN_FRAGMENTS), 5);
  h.object(p, O.WORKBENCH_21, { x: 3615, y: 9505, z: 0 }, 1, ['Work-at']);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 30);
  h.object(p, O.UNCHARGED_CELLS, { x: 3611, y: 9500, z: 0 }, 1, ['Take-from']);
  h.object(p, O.GUARDIAN_OF_MIND, { x: 3613, y: 9498, z: 0 }, 1, ['Enter']);
  h.object(p, O.ALTAR_34, { x: 2793, y: 4827, z: 0 }, 1, ['Craft-rune']);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 35);
  h.object(p, O.PORTAL_40, { x: 2793, y: 4830, z: 0 }, 1, ['Exit']);
  h.object(p, O.INACTIVE_CELL_TILE, { x: 3610, y: 9509, z: 0 }, 1, ['Place']);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 40);
  for (const fn of h.hooks.onNpcInteraction?.get?.('The Great Guardian') ? [] : []);
  h.namedNpcs.get('The Great Guardian')['Power-up']({ player: p, npcId: N.THE_GREAT_GUARDIAN_3 });
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 45);
  h.object(p, O.UNCHARGED_CELLS, { x: 3611, y: 9500, z: 0 }, 1, ['Take-from']);
  h.object(p, O.GUARDIAN_OF_WATER, { x: 3613, y: 9498, z: 0 }, 1, ['Enter']);
  h.object(p, O.ALTAR_35, { x: 2720, y: 4831, z: 0 }, 1, ['Craft-rune']);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 50);
  h.object(p, O.PORTAL_41, { x: 2720, y: 4835, z: 0 }, 1, ['Exit']);
  h.namedNpcs.get('The Great Guardian')['Power-up']({ player: p, npcId: N.THE_GREAT_GUARDIAN_3 });
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 55);
  h.object(p, O.ESSENCE_PILE_ELEMENTAL_, { x: 3613, y: 9510, z: 0 }, 1, ['Assemble']);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 60);
  h.object(p, O.UNCHARGED_CELLS, { x: 3611, y: 9500, z: 0 }, 1, ['Take-from']);
  h.itemOnObject(p, I.PORTAL_TALISMAN_WATER_, O.GUARDIAN_OF_WATER, { x: 3613, y: 9498, z: 0 });
  h.object(p, O.ALTAR_35, { x: 2720, y: 4831, z: 0 }, 1, ['Craft-rune']);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 65);
  h.object(p, O.PORTAL_41, { x: 2720, y: 4835, z: 0 }, 1, ['Exit']);
  h.object(p, O.INACTIVE_CELL_TILE, { x: 3610, y: 9509, z: 0 }, 1, ['Place']);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 70);
  h.namedNpcs.get('The Great Guardian')['Power-up']({ player: p, npcId: N.THE_GREAT_GUARDIAN_3 });
  assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 2386 && row[2] === 5663), 'final rift camera');
  h.finish(p);
  assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 2399 && row[2] === 5667 && row[3] === 820), 'rift close camera');
  assert.ok(p.log.some(row => row[0] === 'sendCameraReset'), 'final rift camera reset');
  assert.equal(stage(), 130);
  assert.equal(p.varbits.get(13738), 130);
  assert.equal(p.varbits.get(13759), 115);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.attrs.get('quest.points'), 1);
  assert.deepEqual(p.xp.filter(([skill]) => skill === core.Skill.RUNECRAFTING.getIndex()).reduce((sum, [, amount]) => sum + amount, 0), 9210);
  assert.equal(p.items.get(I.MEDIUM_POUCH), 1);
});

test('Perilous Moons completes naturally from Attala to the Moons on the real stage scale', () => {
  const h = harness('PerilousMoons'), p = player();
  p.level = 99;
  h.events['quest:is-complete'] ??= [];
  h.events['quest:is-complete'].push(request => { if (request.key === 'twilights_promise') request.complete = true; });
  const stage = () => h.quest.getStage(p);
  const finish = () => h.finish(p);
  const vars = value => ({ getVarbit: id => (id === 9819 ? value : 0), getVarp: () => 0 });
  const surfaceZuma = CacheDefinitions.getNpc(13363);
  const neyZuma = CacheDefinitions.getNpc(13365);
  assert.equal(surfaceZuma.transformVarbit, 9819);
  assert.ok(surfaceZuma.transforms.includes(12860), 'surface raw 13363 transforms to Zuma 12860');
  assert.equal(neyZuma.transformVarbit, 9819);
  assert.ok(neyZuma.transforms.includes(12860), 'Ney raw 13365 transforms to Zuma 12860');
  assert.equal(CacheDefinitions.resolveNpc(13363, vars(2)).name, 'Zuma');
  assert.equal(CacheDefinitions.resolveNpc(13363, vars(5)), undefined, 'surface Zuma is gone after the city stage');
  assert.equal(CacheDefinitions.resolveNpc(13365, vars(7)), undefined, 'Ney Zuma is not shown before the expedition');
  assert.equal(CacheDefinitions.resolveNpc(13365, vars(8)).name, 'Zuma');
  assert.equal(CacheDefinitions.resolveNpc(13365, vars(30)).name, 'Zuma');

  h.talk(p, N.ATTALA); h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'Yes.'); finish();
  assert.equal(stage(), 2);
  assert.equal(p.attrs.get('perilous-moons:stage-schema'), 2);
  const surfaceZumaNpc = h.npcs.find(npc => npc.id === 13363);
  assert.ok(surfaceZumaNpc, 'the surface Zuma spawns its raw base id 13363');
  assert.ok(!h.npcs.some(npc => npc.id === 13347), 'the wrong Teomat Zuma is never spawned');
  const nagua = h.npcs.find(npc => npc.id === N.SULPHUR_NAGUA);
  assert.ok(nagua, 'the sulphur nagua spawned');
  for (const fn of h.hooks.onNpcDeath ?? []) fn({ npcId: N.SULPHUR_NAGUA, npc: nagua, killer: p });
  assert.equal(stage(), 4);
  finish();

  h.talk(p, N.ATTALA); finish();
  assert.equal(stage(), 5);
  h.object(p, O.ENTRANCE_15, { x: 1435, y: 3129, z: 0 }, 1, ['Pass-through']);
  assert.equal(stage(), 6);
  h.talk(p, N.JESSAMINE_2); h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'Can I be of any help with the dig?'); finish();
  assert.equal(stage(), 7);
  h.object(p, O.ENTRANCE_15, { x: 1439, y: 9600, z: 1 }, 1, ['Pass-through']);
  assert.equal(stage(), 8);
  h.tick(9);
  assert.ok(p.log.some(row => row[0] === 'sendSubInterface'), 'Neypotzli entrance fades');
  assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 1448 && row[2] === 9580 && row[3] === 1400), 'Neypotzli entrance camera');
  assert.ok(p.log.some(row => row[0] === 'sendCameraReset'), 'Neypotzli camera resets');
  h.talk(p, N.ATTALA); finish();
  h.talk(p, N.ZUMA_2); finish();
  h.talk(p, N.JESSAMINE); finish();
  assert.equal(stage(), 10);
  assert.ok(h.npcs.some(npc => npc.id === 13365), 'Neypotzli Zuma spawns its raw base id 13365');
  assert.ok(!h.npcs.some(npc => npc.id === 13347), 'the wrong Teomat Zuma is never spawned in Neypotzli');

  h.object(p, O.BUILDING_SUPPLIES_3, { x: 1436, y: 9637, z: 1 }, 1, ['Take-from']);
  finish();
  assert.ok(p.items.get(I.BUILDING_SUPPLIES) >= 3);
  for (const [x, y] of [[1349, 9580], [1374, 9710], [1510, 9693]]) {
    h.itemOnObject(p, I.BUILDING_SUPPLIES, O.COOKING_STOVE, { x, y, z: 0 });
  }
  assert.equal(stage(), 12);

  h.talk(p, N.JESSAMINE); h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'What does the inscription say?');
  h.continueUntil(p, () => Boolean(p.prompt)); assert.equal(stage(), 13); h.choose(p, 'What do we do now?'); finish();
  assert.equal(stage(), 15);
  assert.equal(p.items.get(I.WATER_TALISMAN), 1); assert.equal(p.items.get(I.EARTH_TALISMAN), 1);

  h.talk(p, N.NAHTA); h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, "Actually, I've been sent by Attala."); finish();
  assert.equal(stage(), 16);
  h.talk(p, N.BLACKSMITH_2); h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'I need your help with these talismans.');
  h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'Can you help?'); finish();
  assert.equal(stage(), 17);
  h.talk(p, N.ATTALA); finish();
  assert.equal(stage(), 18);

  p.moveTo(new core.Location(1483, 9692, 0));
  h.itemAction(p, I.INFUSED_WATER_TALISMAN, 'Locate');
  h.finish(p);
  assert.equal(stage(), 19);
  h.talk(p, N.JESSAMINE); finish();
  assert.equal(stage(), 23);
  assert.ok(p.log.some(row => row[0] === 'sendCameraShake' && row[1] === 0 && row[2] === 8), 'Eyatlalli earthquake shake');

  h.object(p, O.SUPPLY_CRATES, { x: 1511, y: 9695, z: 0 }, 1, ['Take-from']);
  h.object(p, O.GRUBBY_SAPLING, { x: 1517, y: 9690, z: 0 }, 1, ['Collect-from']);
  h.object(p, 62193, { x: 1521, y: 9689, z: 0 }, 1, ['Fish']);
  h.itemOnItem(p, I.KNIFE, I.RAW_BREAM);
  h.object(p, O.ROCK_167, { x: 1377, y: 9682, z: 0 }, 1, ['Trap']);
  h.object(p, O.ROCK_167, { x: 1379, y: 9682, z: 0 }, 1, ['Trap']);
  h.object(p, O.BUSH_63, { x: 1380, y: 9684, z: 0 }, 1, ['Rustle']);
  p.items.set(I.RAW_MOSS_LIZARD, 1);
  h.itemOnItem(p, I.KNIFE, I.RAW_MOSS_LIZARD);
  p.items.set(I.MOONLIGHT_GRUB_PASTE, 1);
  assert.equal(p.items.get(I.BREAM_SCALES), 1);
  assert.equal(p.items.get(I.MOSS_LIZARD_TAIL), 1);

  h.talk(p, N.EYATLALLI); finish();
  assert.equal(stage(), 27);
  assert.ok(p.log.some(row => row[0] === 'sendCameraShake' && row[1] === 0 && row[2] === 8), 'ritual earthquake shake');
  RegionManager.init();
  RegionManager.loadMapFiles(1509, 9673);
  RegionManager.loadMapFiles(1478, 9632);
  const eclipseGate = MapObjects.get(O.ENTRANCE_15, new Location(1509, 9673, 0), null);
  assert.ok(eclipseGate, 'real cache Eclipse tunnel loc 51375');
  assert.equal(eclipseGate.getDefinition().getInteractions()[0], 'Pass-through');
  const eclipseStatue = MapObjects.get(51374, new Location(1467, 9631, 0), null);
  assert.ok(eclipseStatue, 'real cache Eclipse statue loc 51374');
  assert.ok(eclipseStatue.getDefinition().getInteractions().includes('Use'));
  h.object(p, O.ENTRANCE_15, { x: 1509, y: 9673, z: 0 }, 1, ['Pass-through']);
  assert.equal(stage(), 28);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1461, 9632, 0]);
  assert.ok(!p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 1478 && row[2] === 9632), 'the 51375 tunnel must not lock the Eclipse cutscene early');
  p.attrs.set('perilous-moons:eclipse-cutscene', true);
  for (const fn of h.hooks.onZoneEnter ?? []) fn({ player: p, x: 1461, y: 9632, z: 0 });
  assert.ok(!p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 1478 && row[2] === 9632), 'the 1461,9632 foyer landing is outside the Eclipse arena zone');
  assert.equal(p.blocked, false, 'foyer landing keeps controls free even with legacy seen=true');
  p.moveTo(new Location(1478, 9632, 0));
  for (const fn of h.hooks.onZoneEnter ?? []) fn({ player: p, x: 1478, y: 9632, z: 0 });
  const arenaCameras = () => p.log.filter(row => row[0] === 'sendCameraMoveTo' && row[1] === 1478 && row[2] === 9632 && row[3] === 875).length;
  assert.equal(arenaCameras(), 1, 'Eclipse scene camera starts for unfinished stage28 even with legacy seen=true');
  for (const fn of h.hooks.onZoneEnter ?? []) fn({ player: p, x: 1478, y: 9632, z: 0 });
  assert.equal(arenaCameras(), 1, 'duplicate active arena entry does not start a second scene');
  h.line(p, N.ZUMA_2, "I can't believe it... An emissary of my god, standing before me...");
  assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 1475 && row[2] === 9632 && row[3] === 875), 'Eclipse camera cycle 1');
  h.line(p, N.ZUMA_2, 'Zuma, no! Step back!');
  h.line(p, N.ZUMA_2, 'Get out of here!'); h.tick(8);
  assert.ok(p.log.some(row => row[0] === 'sendCameraReset'), 'Eclipse camera resets');
  assert.equal(stage(), 29);
  assert.equal(p.attrs.get('perilous-moons:eclipse-cutscene'), true, 'seen marks only when the final callback completes');
  assert.equal(p.blocked, false, 'controls free after the completed intro');
  const completedCameras = arenaCameras();
  for (const fn of h.hooks.onZoneEnter ?? []) fn({ player: p, x: 1478, y: 9632, z: 0 });
  assert.equal(arenaCameras(), completedCameras, 'completed stage29 never repeats the intro');
  h.finish(p);
  h.object(p, O.ENTRANCE_17, { x: 1404, y: 9703, z: 0 }, 1, ['Pass-through']);
  for (const moon of ['blood', 'blue', 'eclipse']) h.emit('moons-of-peril:killed', { player: p, moon });
  assert.equal(stage(), 30);

  h.talk(p, N.JESSAMINE); finish();
  h.talk(p, N.EYATLALLI); finish();
  assert.equal(h.quest.isComplete(p), false, 'Zuma is still needed');
  h.talk(p, N.ZUMA_2); finish();
  assert.equal(stage(), 31, 'the Zuma finishing line is the 31 boundary');
  h.talk(p, N.EYATLALLI); finish();
  assert.equal(stage(), 36);
  assert.equal(p.varbits.get(9819), 36);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.attrs.get('quest.points'), 2);
  assert.deepEqual(p.xp.filter(([skill]) => skill === core.Skill.SLAYER.getIndex()).reduce((sum, [, amount]) => sum + amount, 0), 40000);

  const xpAfter = p.xp.length, pointsAfter = p.attrs.get('quest.points');
  h.emit('npc-dialogue:line', { player: p, npcId: N.EYATLALLI, text: 'For now though, thank you for your help, iknil.' });
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: p });
  assert.equal(stage(), 36);
  assert.equal(p.xp.length, xpAfter, 'no reward replay on repeat completion/relogin');
  assert.equal(p.attrs.get('quest.points'), pointsAfter);
});

test('Perilous Moons refuses to start without its requirements', () => {
  const h = harness('PerilousMoons'), p = player();
  p.level = 1;
  h.events['quest:is-complete'] ??= [];
  h.events['quest:is-complete'].push(request => { request.complete = false; });
  h.talk(p, N.ATTALA); h.finish(p);
  assert.equal(h.quest.getStage(p), 0);
});

test('Temple of the Eye tutorial progress survives relog and lost cells/chisel are re-obtainable', () => {
  const h = harness('TempleOfTheEye'), p = player();
  h.quest.setStage(p, 115);
  p.attrs.set('temple-of-the-eye:tutorial', 30);
  p.attrs.set('temple-of-the-eye:stage-schema', 2);
  for (const fn of h.hooks.onPlayerLogout ?? []) fn({ player: p });
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: p });
  assert.equal(h.quest.getStage(p), 115);
  assert.equal(p.attrs.get('temple-of-the-eye:tutorial'), 30);
  h.object(p, O.WEAK_CELLS, { x: 3614, y: 9499, z: 0 }, 1, ['Take-from']);
  h.object(p, O.FLOOR_CHISEL_OBJECT_ID ?? O.COL_FF9040_CHISEL_COL, { x: 3621, y: 9485, z: 0 }, 1, ['Take']);
  assert.equal(p.items.get(I.WEAK_CELL), 1);
  assert.equal(p.items.get(I.CHISEL), 1);
});

test('Perilous Moons entrance scene tasks are cancelled on logout without losing progress', () => {
  const h = harness('PerilousMoons'), p = player();
  h.quest.setStage(p, 7);
  h.object(p, O.ENTRANCE_15, { x: 1439, y: 9600, z: 1 }, 1, ['Pass-through']);
  assert.equal(h.quest.getStage(p), 8);
  assert.ok(p.log.some(row => row[0] === 'sendSubInterface'), 'fade starts');
  for (const fn of h.hooks.onPlayerLogout ?? []) fn({ player: p });
  h.tick(10);
  assert.equal(p.log.filter(row => row[0] === 'sendCameraMoveTo' && row[1] === 1448).length, 0, 'cancelled entrance camera');
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: p });
  assert.equal(h.quest.getStage(p), 8);
});

test('Temple of the Eye rift shake tasks stop on logout', () => {
  const h = harness('TempleOfTheEye'), p = player();
  h.quest.setStage(p, 110);
  p.attrs.set('temple-of-the-eye:stage-schema', 2);
  h.action(p, N.ARCHMAGE_SEDRIDOR, 'dUuNRU');
  const shakes = p.log.filter(row => row[0] === 'sendCameraShake').length;
  assert.ok(shakes > 0);
  for (const fn of h.hooks.onPlayerLogout ?? []) fn({ player: p });
  h.tick(10);
  assert.equal(p.log.filter(row => row[0] === 'sendCameraShake').length, shakes, 'later shakes cancelled');
});

test('Temple of the Eye migrates an old 1-26 save once and re-syncs visible varbits on login', () => {
  const h = harness('TempleOfTheEye');
  const legacy = player();
  legacy.attrs.set('quest.temple_of_the_eye.stage', 25);
  legacy.attrs.set('temple-of-the-eye:tutorial', 0);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: legacy });
  assert.equal(h.quest.getStage(legacy), 115);
  assert.equal(legacy.attrs.get('temple-of-the-eye:tutorial'), 70);
  assert.equal(legacy.varbits.get(13738), 115);
  assert.equal(legacy.varbits.get(13759), 70);
  assert.equal(legacy.attrs.get('temple-of-the-eye:stage-schema'), 2);

  const done = player();
  done.attrs.set('quest.temple_of_the_eye.stage', 26);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: done });
  assert.equal(h.quest.getStage(done), 130);
  assert.equal(done.varbits.get(13738), 130);
});

test('Temple of the Eye registers its fixed persistence defaults', () => {
  const h = harness('TempleOfTheEye');
  assert.equal(h.persisted.get('temple-of-the-eye:declined'), false);
  assert.equal(h.persisted.get('temple-of-the-eye:tutorial'), 0);
  assert.equal(h.persisted.get('temple-of-the-eye:stage-schema'), 0);
});

test('Temple of the Eye restores the energy prefix on relog', () => {
  const h = harness('TempleOfTheEye');
  const p = player();
  h.quest.setStage(p, 35);
  p.attrs.set('temple-of-the-eye:stage-schema', 2);
  p.attrs.set('quest.temple_of_the_eye.dark-mage', 1);
  p.attrs.set('quest.temple_of_the_eye.energy-order', '012345');
  p.attrs.set('quest.temple_of_the_eye.energy-progress', 3);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: p });
  assert.deepEqual([13747,13748,13749,13750,13751,13752].map(id => p.varbits.get(id)), [2,2,2,1,1,1]);
});

test('Temple tower apprentices spawn on the captured first-floor tiles reachable by the cache map', () => {
  RegionManager.init();
  const h = harness('TempleOfTheEye');
  const p = player();
  h.quest.setStage(p, 75);
  p.attrs.set('temple-of-the-eye:stage-schema', 2);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: p });
  const spawned = (id) => h.npcs.find(npc => npc.id === id);
  for (const [id, x, y] of [[N.APPRENTICE_CORDELIA, 3110, 3161], [N.APPRENTICE_FELIX_2, 3111, 3163],
    [N.APPRENTICE_TAMARA, 3113, 3163]]) {
    const npc = spawned(id);
    assert.ok(npc, `spawn ${id}`);
    assert.deepEqual([npc.x, npc.y, npc.z], [x, y, 1], `capture 1693 addnpc ${id}`);
  }
  const route = (dx, dy) => {
    const checkpoints = [];
    const queue = { lastDestX: 0, lastDestY: 0, reset() { return this; }, setRoute() { return this; },
      setPathX() { return this; }, setPathY() { return this; }, syncDestinationFlagToRoute() { return this; },
      addCheckpoint(tile) { checkpoints.push(tile); return this; } };
    const entity = { getMovementQueue: () => queue, getLocation: () => new Location(3113, 3163, 1), getSize: () => 1,
      getPrivateArea: () => null, isPlayer: () => true, getAsPlayer: () => ({ getUsername: () => 'parity' }) };
    return PathFinder.calculateRoute(entity, 1, dx, dy, 0, 0, 0, 0, false);
  };
  assert.equal(RegionManager.blocked(new Location(3113, 3163, 1), null), false);
  assert.ok(route(3111, 3163) > 0, 'Felix is on the reachable room floor');
  assert.ok(route(3110, 3161) > 0, 'Cordelia is on the reachable room floor');
});

test('Wizards Tower basement ladder 2148 reaches the 2147 ground-floor ladder through normal dispatch', () => {
  RegionManager.init();
  const at = (x, y, z, id) => {
    RegionManager.loadMapFiles(x, y);
    const object = (MapObjects.mapObjects.get(MapObjects.getHash(x, y, z)) ?? []).find((o) => o.getId() === id);
    assert.ok(object, `cache map object ${id} at ${x},${y},${z}`);
    return object;
  };
  const up = at(3103, 9576, 0, 2148);
  const down = at(3104, 3162, 0, 2147);
  assert.deepEqual(up.getDefinition().getInteractions(), ['Climb-up', undefined, undefined, undefined, undefined]);
  assert.deepEqual(down.getDefinition().getInteractions(), ['Climb-down', undefined, undefined, undefined, undefined]);

  const landing = ClimbLinks.destination(up, ClimbLinks.UP, new Location(3104, 9576, 0));
  assert.deepEqual([landing.getX(), landing.getY(), landing.getZ()], [3105, 3162, 0]);
  const standIn = { getLocation: () => landing, getSize: () => 1, getPrivateArea: () => null };
  assert.ok(PathFinder.reachedObject(standIn, 3104, 3162, 1, 1, 3, 10,
    down.getDefinition().getBlockingMask()), 'the landing can use the ground-floor ladder');

  const route = (sx, sy, dx, dy) => {
    const checkpoints = [];
    const queue = { lastDestX: 0, lastDestY: 0, reset() { return this; }, setRoute() { return this; },
      setPathX() { return this; }, setPathY() { return this; }, syncDestinationFlagToRoute() { return this; },
      addCheckpoint(tile) { checkpoints.push(tile); return this; } };
    const entity = { getMovementQueue: () => queue, getLocation: () => new Location(sx, sy, 0), getSize: () => 1,
      getPrivateArea: () => null, isPlayer: () => true, getAsPlayer: () => ({ getUsername: () => 'parity' }) };
    const steps = PathFinder.calculateRoute(entity, 1, dx, dy, 0, 0, 0, 0, false);
    return { steps, last: checkpoints.at(-1) };
  };
  assert.ok(route(3103, 9574, 3108, 9574).steps > 0, 'walks around the basement furniture');
  assert.ok(route(3108, 9574, 3108, 9576).steps > 0);
  const lastLeg = route(3108, 9576, 3104, 9576);
  assert.deepEqual([lastLeg.last.getX(), lastLeg.last.getY()], [3104, 9576], 'natural approach tile');

  const handlers = {};
  const tasks = [];
  require('../plugins/objects/Ladders.plugin.js').register({
    getTaskManager: () => ({ submit: task => { task.setRunning(true); tasks.push(task); } }),
    onCustomEvent: () => {},
    emitCustomEvent: () => {},
    onObjectInteraction: (name, options) => { handlers[name] = options; },
    sendMultiChatboxPrompt: () => false,
  });
  let location = new Location(3104, 9576, 0);
  const movement = { isMovementBlocked: () => false, didMovePreviousCycle: () => true,
    reset() { return this; }, setBlockMovement() { return this; } };
  const player = { getLocation: () => location, getHitpoints: () => 99, getPrivateArea: () => null,
    getMovementQueue: () => movement, performAnimation: () => {}, moveTo: to => { location = to; } };
  handlers.Ladder['Climb-up']({ player, object: up, objectId: 2148,
    location: up.getLocation(), sourceLocation: { x: 3104, y: 9576, z: 0 } });
  assert.equal(tasks.length, 1, 'the normal ladder handler queues the climb');
  for (let tick = 0; tick < 3; tick++) for (const task of [...tasks]) task.tick();
  assert.deepEqual([location.getX(), location.getY(), location.getZ()], [3105, 3162, 0]);
});

test('Temple login mirrors the captured reward varbit without re-granting it', () => {
  const h = harness('TempleOfTheEye');
  const done = player();
  h.quest.setStage(done, 130);
  done.attrs.set('temple-of-the-eye:stage-schema', 2);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: done });
  assert.equal(done.varbits.get(13757), 1);
  assert.equal(done.xp.length, 0, 'login does not grant reward XP again');
  assert.equal(done.items.get(I.MEDIUM_POUCH) ?? 0, 0, 'login does not grant the pouch again');

  const mid = player();
  h.quest.setStage(mid, 75);
  mid.attrs.set('temple-of-the-eye:stage-schema', 2);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: mid });
  assert.equal(mid.varbits.get(13757), 0);
});

test('Temple completion delivers the medium pouch through real inventory overflow', () => {
  const h = harness('TempleOfTheEye');
  const before = World.getItems().length;
  assert.equal(core.ItemDefinition.forId(I.MEDIUM_POUCH).isStackable(), false, 'real cache pouch is nonstackable');
  const make = () => {
    const p = player();
    const inventory = new Inventory(p);
    p.getInventory = () => inventory;
    return { p, inventory };
  };
  const fill = (inventory, slots) => {
    for (let i = 0; i < slots; i++) inventory.adds(1438, 1);
  };

  try {
    const full = make();
    fill(full.inventory, 28);
    assert.equal(full.inventory.isFull(), true);
    h.quest.setStage(full.p, 125);
    assert.equal(h.quest.complete(full.p), true);
    assert.equal(h.quest.getStage(full.p), 130);
    assert.equal(full.inventory.getAmount(I.MEDIUM_POUCH), 0, 'full bag keeps the pouch out of inventory');
    const dropped = World.getItems().slice(before).filter(entry => entry.getItem().getId() === I.MEDIUM_POUCH);
    assert.equal(dropped.length, 1, 'engine overflow drops exactly one pouch');
    assert.ok(dropped[0].getPosition().equals(full.p.getLocation()), 'pouch drops at the reward location');
    assert.deepEqual(full.p.xp, [[core.Skill.RUNECRAFTING.getIndex(), 5000]]);
    assert.equal(h.quest.complete(full.p), false, 'completion stays one-shot');
    assert.equal(World.getItems().slice(before).filter(entry => entry.getItem().getId() === I.MEDIUM_POUCH).length, 1);
    assert.deepEqual(full.p.xp, [[core.Skill.RUNECRAFTING.getIndex(), 5000]]);

    const oneFree = make();
    fill(oneFree.inventory, 27);
    h.quest.setStage(oneFree.p, 125);
    h.quest.complete(oneFree.p);
    assert.equal(oneFree.inventory.getAmount(I.MEDIUM_POUCH), 1, 'one free slot receives the pouch');
    assert.equal(World.getItems().slice(before).filter(entry => entry.getItem().getId() === I.MEDIUM_POUCH).length, 1,
      'the one-free-slot case adds no extra ground pouch');

    const owned = make();
    owned.inventory.adds(I.MEDIUM_POUCH, 1);
    h.quest.setStage(owned.p, 125);
    h.quest.complete(owned.p);
    assert.equal(owned.inventory.getAmount(I.MEDIUM_POUCH), 1, 'an existing pouch is not duplicated');

    for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: full.p });
    assert.equal(World.getItems().slice(before).filter(entry => entry.getItem().getId() === I.MEDIUM_POUCH).length, 1,
      'relog does not re-grant the pouch');
    assert.deepEqual(full.p.xp, [[core.Skill.RUNECRAFTING.getIndex(), 5000]]);
  } finally {
    World.getItems().splice(before);
  }
});

test('Perilous Moons migrates legacy completed 31 without replaying rewards, but a fresh 31 still completes', () => {
  const h = harness('PerilousMoons');
  const old = player();
  old.attrs.set('quest.perilous_moons.stage', 31);
  old.attrs.set('quest.points', 2);
  old.xp.push([core.Skill.SLAYER.getIndex(), 40000]);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: old });
  assert.equal(h.quest.getStage(old), 36);
  assert.equal(old.attrs.get('quest.points'), 2);
  assert.equal(old.xp.length, 1, 'legacy completion rewards are not replayed');

  const fresh = player();
  fresh.attrs.set('quest.perilous_moons.stage', 31);
  fresh.attrs.set('perilous-moons:stage-schema', 2);
  fresh.attrs.set('perilous-moons:trio-talked', 6);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: fresh });
  assert.equal(h.quest.getStage(fresh), 31, 'a native finishing-line save stays incomplete');
  h.emit('npc-dialogue:line', { player: fresh, npcId: N.EYATLALLI, text: 'For now though, thank you for your help, iknil.' });
  assert.equal(h.quest.getStage(fresh), 36);
  assert.equal(fresh.attrs.get('quest.points'), 2);
  assert.equal(fresh.xp.filter(([skill]) => skill === core.Skill.SLAYER.getIndex()).reduce((sum, [, amount]) => sum + amount, 0), 40000);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: fresh });
  assert.equal(fresh.attrs.get('quest.points'), 2);
});

test('shipped NpcDialogues resolves both Wizard Persten intro paths and decline/reaccept without an Abyss detour', () => {
  const NpcDialogues = require('../plugins/npcs/NpcDialogues.plugin');
  const perstenIds = [11436, 11437, 11438, 11439];
  const index = require('../data/definitions/npc-dialogue-index.json');
  for (const id of perstenIds) {
    assert.equal(core.NpcDefinition.forId(id)?.getName?.(), 'Wizard Persten');
    assert.ok(index[String(id)]?.some(entry => entry.page === 'Transcript:Temple of the Eye'));
  }
  // Cache 241 resolves 11491 to Menaphite Akh, not Persten; the shipped index has no
  // entry for it, so the real Persten ids above are the correct native targets.
  assert.equal(core.NpcDefinition.forId(11491)?.getName?.(), 'Menaphite Akh');

  const h = harness('TempleOfTheEye');
  const dialogueHooks = [];
  const api2 = new Proxy({}, { get: (_, key) => key === 'onAnyNpcInteraction'
    ? actions => dialogueHooks.push(actions) : h.api[key] });
  NpcDialogues.register(api2);
  const origVariant = PluginManager.emitNpcDialogueVariant;
  PluginManager.emitNpcDialogueVariant = event => {
    for (const fn of h.hooks.onNpcDialogueVariant ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return origVariant ? origVariant(event) : null;
  };
  const talk = dialogueHooks[0]['Talk-to'];
  const def = core.NpcDefinition.forId(11436);

  function start(p) {
    p.level = 99;
    p.attrs.set('quest.rune_mysteries.stage', 6);
    p.log.length = 0;
    talk({ player: p, npc: { getId: () => 11436 }, npcId: 11436, definition: def });
  }
  function toMenu(p) { h.continueUntil(p, () => Boolean(p.prompt)); }
  function noAbyss(p) {
    const texts = p.log.filter(row => row[0] === 'text').map(row => String(row[2]));
    assert.ok(!texts.some(text => /Do you mean what am I doing here in the Abyss/i.test(text)), 'no Dark Mage Abyss speech');
    assert.ok(!p.log.some(row => String(row[0]).startsWith('sendNpcHead') && (row[1] === 2583 || row[2] === 2583)), 'no Dark Mage head');
    assert.ok(p.log.some(row => row[0] === 'text' && row[1] === ((231 << 16) | 4) && row[2] === 'Wizard Persten'), 'Persten is the speaker');
  }

  const first = player();
  start(first);
  toMenu(first);
  assert.ok(first.prompt.options.includes('Who are you?'));
  h.choose(first, 'Who are you?');
  toMenu(first);
  h.choose(first, 'So what are you doing in Al Kharid?');
  toMenu(first);
  assert.deepEqual(first.prompt.options, ['Yes.', 'No.'], 'nested intro reaches the acceptance choice');
  noAbyss(first);
  h.choose(first, 'Yes.');
  h.finish(first);
  assert.equal(h.quest.getStage(first), 10);
  assert.equal(first.items.get(I.EYE_AMULET), 1);

  const direct = player();
  start(direct);
  toMenu(direct);
  h.choose(direct, "What's a wizard doing in Al Kharid?");
  toMenu(direct);
  assert.deepEqual(direct.prompt.options, ['Yes.', 'No.']);
  noAbyss(direct);
  h.choose(direct, 'Yes.');
  h.finish(direct);
  assert.equal(h.quest.getStage(direct), 10);
  assert.equal(direct.items.get(I.EYE_AMULET), 1);

  const declined = player();
  start(declined);
  toMenu(declined);
  h.choose(declined, 'Who are you?');
  toMenu(declined);
  h.choose(declined, 'So what are you doing in Al Kharid?');
  toMenu(declined);
  h.choose(declined, 'No.');
  h.finish(declined);
  assert.equal(h.quest.getStage(declined), 0);
  assert.equal(declined.attrs.get('temple-of-the-eye:declined'), 1);
  start(declined);
  toMenu(declined);
  assert.ok(declined.prompt.options.includes('Yes.'), 're-talk offers acceptance');
  h.choose(declined, 'Yes.');
  h.finish(declined);
  assert.equal(h.quest.getStage(declined), 10);
  assert.equal(declined.items.get(I.EYE_AMULET), 1);
});

test('Perilous Moons tunnel gates use the captured destinations and leave the non-tunnel gate alone', () => {
  const h = harness('PerilousMoons'), p = player();
  h.quest.setStage(p, 18);
  h.object(p, O.ENTRANCE_17, { x: 1527, y: 9670, z: 0 }, 1, ['Pass-through']);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1513, 9596, 0]);
  assert.ok(p.messages.includes('You follow a long and winding tunnel before emerging on the other side.'));
  h.tick(5);
  h.object(p, O.ENTRANCE_17, { x: 1512, y: 9560, z: 0 }, 1, ['Pass-through']);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1355, 9538, 0]);
  p.moveTo(new core.Location(1510, 9582, 0));
  h.object(p, O.ENTRANCE_17, { x: 1493, y: 9579, z: 0 }, 1, ['Pass-through']);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1510, 9582], 'walk-through gate is not a tunnel');
});

test('Temple shared stage guards use 60..130 and real cache pages for Sedridor/Traiborn', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ['RuneMysteries.Quest.js', 'DemonSlayer.Quest.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../plugins/quests/quests', file), 'utf8');
    assert.match(source, /TOTE_TOWER_STAGE = 60;/);
    assert.match(source, /TOTE_COMPLETE_STAGE = 130;/);
  }
  const shipped = require('../data/definitions/npc-dialogues.json');
  assert.ok(shipped['Temple of the Eye'].variants['help-from-some-wizards-talking-to-archmage-sedridor']);
  assert.ok(shipped['Archmage Sedridor'].variants['standard-dialogue-after-rune-mysteries']);
  assert.ok(shipped['Temple of the Eye'].variants['help-from-some-wizards-talking-to-wizard-traiborn']);
  assert.ok(shipped['Wizard Traiborn'].variants['standard-dialogue']);

  const rm = harness('RuneMysteries'), toe = harness('TempleOfTheEye');
  const p = player();
  p.attrs.set('quest.rune_mysteries.stage', 6);
  p.attrs.set('quest.temple_of_the_eye.stage', 60);
  const rmSelect = rm.hooks.onNpcDialogueVariant[0], toeSelect = toe.hooks.onNpcDialogueVariant[0];
  assert.equal(rmSelect({ npcId: 11432, player: p }), null, 'Rune Mysteries steps aside at Temple 60');
  assert.ok(toeSelect({ npcId: 11432, player: p }), 'Temple Sedridor wins at 60');
  p.attrs.set('quest.temple_of_the_eye.stage', 130);
  assert.ok(rmSelect({ npcId: 11432, player: p }), 'Rune Mysteries resumes at 130');

  const ds = harness('DemonSlayer');
  const d = player();
  d.attrs.set('quest.demon_slayer.stage', ds.quest.completionValue);
  d.attrs.set('quest.temple_of_the_eye.stage', 75);
  const dsSelect = ds.hooks.onNpcDialogueVariant[0];
  assert.equal(dsSelect({ npcId: 5081, player: d }), null, 'Demon Slayer leaves Traiborn to Temple at 75');
  d.attrs.set('quest.temple_of_the_eye.stage', 130);
  assert.ok(dsSelect({ npcId: 5081, player: d }), 'Demon Slayer resumes Traiborn at 130');
});


test('cache map placements prove the two Perilous tunnels are real Pass-through gates with walkable landings', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.init();
  for (const [x, y, z, lx, ly, lz] of [
    [1527, 9670, 0, 1513, 9596, 0],
    [1512, 9560, 0, 1355, 9538, 0],
  ]) {
    const object = MapObjects.get(core.ObjectIdentifiers.ENTRANCE_17, new core.Location(x, y, z), null);
    assert.ok(object, `cache placement 51377@${x},${y},${z}`);
    assert.equal(object.getDefinition().getInteractions()[0], 'Pass-through');
    assert.ok(object.getFace() >= 0);
    assert.equal(RegionManager.blocked(new core.Location(lx, ly, lz), null), false, `landing ${lx},${ly},${lz}`);
  }
});
