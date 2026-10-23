// Run after yarn build: node --test tests/demon-shield-parity.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});
const sharedButtons = new Map();
let actorIndex = 1;
function register(name, key) {
  const hooks = new Map(), custom = new Map(), buttons = sharedButtons, namedNpc = new Map();
  const spawned = [], removed = [], ground = [], prompts = [], areas = [], tasks = [];
  const api = new Proxy({
    core: { ...core, TaskManager: {
      submit: (task) => { task.setRunning(true); tasks.push(task); },
      cancelTasks: (key) => tasks.filter((task) => task.key === key).forEach((task) => task.stop()),
    } }, persistAttribute() {}, registerArea: (area) => areas.push(area),
    onCustomEvent: (event, fn) => { if (!custom.has(event)) custom.set(event, []); custom.get(event).push(fn); },
    emitCustomEvent: (event, payload) => { for (const fn of custom.get(event) || []) fn(payload); },
    onInterfaceActionButton: (ids, fn) => { for (const id of [].concat(ids)) buttons.set(id, fn); },
    onNpcInteraction: (nameOrFn, actions) => {
      if (typeof nameOrFn === 'function') hooks.set('onNpcInteraction', [nameOrFn]);
      else for (const [action, fn] of Object.entries(actions)) namedNpc.set(`${nameOrFn}:${action}`, fn);
    },
    getItemOnGroundManager: () => ({
      registerLocation: (owner, item, location) => { ground.push({ owner, item, location }); }, getGroundItem: () => null,
    }),
    spawnNpc: (definition) => {
      let area = null, transform = -1, hp = 7, location = new core.Location(definition.x, definition.y, definition.z);
      const index = actorIndex++;
      const npc = { definition, getId: () => definition.id, getOwner: () => definition.owner,
        getLocation: () => location,
        getMovementQueue: () => ({ addSteps: value => { location = value; } }),
        getDefinition: () => core.NpcDefinition.forId(definition.id),
        getHitpoints: () => hp, setHitpoints: (value) => { hp = value; },
        getNpcTransformationId: () => transform, setNpcTransformationId: (value) => { transform = value; },
        getArea: () => area, setArea: (value) => { area = value; },
        isPlayer: () => false, isNpc: () => true, getAsNpc: () => npc, getIndex: () => index,
        getCombat: () => ({ reset() {} }), isRegistered: () => false, performAnimation() {},
      };
      spawned.push(npc); return npc;
    },
    removeNpc: (npc) => removed.push(npc),
    sendMultiChatboxPrompt: (player, title, ...options) => prompts.push({ player, title, options }),
  }, { get(target, prop) {
    if (prop in target) return target[prop];
    return (...args) => {
      const fn = args.findLast((arg) => typeof arg === 'function')
        || Object.values(args.at(-1) || {}).find((value) => typeof value === 'function');
      if (fn) { if (!hooks.has(prop)) hooks.set(prop, []); hooks.get(prop).push(fn); }
    };
  } });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  return { api, hooks, buttons, namedNpc, spawned, removed, ground, prompts, areas,
    quest: getRegisteredQuests().findLast((quest) => quest.key === key),
    emit: (event, payload) => api.emitCustomEvent(event, payload),
    call: (event, payload) => { for (const fn of hooks.get(event) || []) fn(payload); },
    tick: (count) => { while (count-- > 0) [...tasks].forEach((task) => task.tick()); },
  };
}
function player() {
  const attributes = new Map(), items = new Map(), bank = new Map(), packets = [], messages = [], equipment = [];
  let location = new core.Location(3228, 3369, 0), area = null, transform = -1, running = false, forceMovement = null;
  const index = actorIndex++;
  const inventory = {
    getAmount: (id) => items.get(id) || 0,
    adds: (id, amount) => items.set(id, (items.get(id) || 0) + amount),
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) || 0) - amount)),
    getFreeSlots: () => 28 - [...items].reduce((sum, [id, amount]) => sum + (id === 995 ? Number(amount > 0) : amount), 0),
    isFull: () => inventory.getFreeSlots() <= 0,
  };
  let packet;
  packet = new Proxy({}, { get: (_, method) => (...args) => { packets.push([method, ...args]); return packet; } });
  const p = { attributes, items, bank, equipment, packets, messages,
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory, getBanks: () => [{ getAmount: (id) => bank.get(id) || 0 }],
    getEquipment: () => ({ getItems: () => equipment }), getLocation: () => location,
    getPrivateArea: () => area instanceof core.PrivateArea ? area : null, getUsername: () => 'QuestTester', getPacketSender: () => packet,
    getFrameUpdater: () => ({ clear() {} }),
    getDialogueManager: () => ({ reset() {}, startDialogues() {}, isActive: () => false }),
    getSkillManager: () => ({ getCombatLevel: () => 20, addExperiences() {} }),
    sendMessage: (message) => messages.push(message), isPlayer: () => true, isNpc: () => false,
    getAsPlayer: () => p, getIndex: () => index, getArea: () => area, setArea: (value) => { area = value; },
    moveTo: (value) => { location = value; }, getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() {}, addSteps: (value) => { location = value; } }),
    isRunningReturn: () => running, setRunning: (value) => { running = value; },
    getForceMovement: () => forceMovement, setForceMovement: value => { forceMovement = value; },
    setUntargetable() {}, setNpcTransformationId: (value) => { transform = value; },
    getNpcTransformationId: () => transform, performAnimation() {}, performGraphic() {},
    getCombat: () => ({ reset() {} }),
  };
  return p;
}
const choose = (prompt, label) => {
  const index = prompt.options.indexOf(label); assert.ok(index >= 0, `missing choice ${label}`); prompt.options[index + 1]();
};

test('Demon Slayer keeps the captured incantation in dialogue and preserves sibling varbits', () => {
  const q = register('DemonSlayer', 'demon_slayer'), p = player(); p.items.set(995, 2);
  q.emit('npc-dialogue:choice', { player: p, npcId: core.NpcIdentifiers.ARIS, option: 'Yes.' });
  assert.equal(p.items.get(995), 1); assert.equal(q.quest.getStage(p), 0);
  p.attributes.set('demon-slayer:incantation', [4, 2, 1, 3, 0]);
  const line = { player: p, npcId: core.NpcIdentifiers.ARIS, text: '[word 1]... [word 2]... [word 3]... [word 4]... [word 5]!' };
  q.emit('npc-dialogue:line', line);
  assert.equal(line.text, 'Gabindo... Camerinthum... Aber... Purchai... Carlem!'); assert.notEqual(line.skip, true);
  q.emit('npc-dialogue:hook', { player: p, npcId: core.NpcIdentifiers.ARIS, hook: 'quest:demon-slayer:start' });
  assert.equal(q.quest.getStage(p), 1); assert.equal(p.items.get(995), 1);
  assert.ok(p.packets.some(([method, id, value]) => method === 'sendVarbit' && id === 2561 && value === 1));
  assert.equal(p.packets.some(([method, id]) => method === 'sendConfig' && id === 222), false);
});

test('Demon Slayer checks banked keys and counts partial bone deliveries', () => {
  const q = register('DemonSlayer', 'demon_slayer'), p = player(); q.quest.setStage(p, 3); p.bank.set(2400, 1);
  const condition = q.hooks.get('onNpcDialogueCondition')[0];
  assert.equal(condition({ player: p, npcId: core.NpcIdentifiers.CAPTAIN_ROVIN, text: 'If the player has the key in their bank:' }), true);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.CAPTAIN_ROVIN, stepId: 'E0eUno', kind: 'message' });
  assert.equal(p.items.get(2400) || 0, 0);
  p.items.set(526, 10);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.WIZARD_TRAIBORN, stepId: 'Sq4znF', kind: 'message' });
  assert.equal(q.quest.getStage(p), 13); assert.equal(p.items.get(526), 0);
  const line = { player: p, npcId: core.NpcIdentifiers.WIZARD_TRAIBORN, text: 'I still need [25-X] more sets.' };
  q.emit('npc-dialogue:line', line); assert.equal(line.text, 'I still need 15 more sets.');
});

test('Delrith needs five word choices; failure resets him and the learned order completes the quest', () => {
  const q = register('DemonSlayer', 'demon_slayer'), p = player(); q.quest.setStage(p, 29);
  p.attributes.set('demon-slayer:incantation', [4, 2, 1, 3, 0]); q.areas[0].process(p);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.DENATH_4, stepId: 'xjQ9zZ' });
  q.tick(6);
  const endSummoning = { player: p, npcId: core.NpcIdentifiers.DENATH_4, text: "I've got to get out of here..." };
  q.emit('npc-dialogue:line', endSummoning); endSummoning.after();
  assert.equal(q.spawned.at(-1).getId(), core.NpcIdentifiers.DELRITH, 'the demon remains visible without Silverlight equipped');
  const weaken = () => q.call('onNpcBeforeDeath', { npc: q.spawned.at(-1), preventDeath: false });
  const banish = () => q.namedNpc.get('Weakened Delrith:Banish')({ player: p, npc: q.spawned.at(-1) });
  weaken(); banish(); for (let i = 0; i < 5; i++) choose(q.prompts.at(-1), 'Carlem');
  assert.equal(q.quest.getStage(p), 29); assert.equal(q.spawned.at(-1).getId(), core.NpcIdentifiers.DELRITH);
  weaken(); banish(); for (const word of ['Gabindo', 'Camerinthum', 'Aber', 'Purchai', 'Carlem']) choose(q.prompts.at(-1), word);
  q.tick(10);
  assert.equal(q.quest.getStage(p), 30); assert.equal(q.quest.varbitValue(30, p), 3); assert.equal(p.attributes.get('quest.points'), 3);
  assert.equal(q.hooks.has('onPlayerProcess'), false);
});

test('Shield capture path pays Baraek then accepts Katrine without joining Phoenix', () => {
  const q = register('ShieldOfArrav', 'shield_of_arrav'), p = player(); q.quest.setStage(p, 2);
  const line = { player: p, npcId: core.NpcIdentifiers.RELDO, text: 'There are rumours that they are based in the south west corner of the city.' };
  q.emit('npc-dialogue:line', line); line.before();
  assert.equal(q.quest.varpValue(2, p), 3);
  assert.ok(p.packets.some(([method, id, value]) => method === 'sendConfig' && id === 146 && value === 1));
  p.items.set(995, 20); q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.BARAEK, stepId: '6ECylA' });
  assert.equal(q.quest.varpValue(2, p), 4); assert.equal(p.attributes.get('shield-of-arrav.gang'), undefined);
  assert.equal(q.hooks.get('onNpcDialogueVariant')[0]({ player: p, npcId: core.NpcIdentifiers.KATRINE }).variant, 'black-arm-gang-talking-to-katrine');
  assert.equal(q.quest.getStage(p), 2);
  q.emit('npc-dialogue:choice', { player: p, npcId: core.NpcIdentifiers.KATRINE, option: 'Okay, no problem.' });
  assert.equal(q.quest.getStage(p), 3); assert.equal(q.quest.varpValue(3, p), 4);
  assert.equal(p.attributes.get('shield-of-arrav.gang'), undefined);
  assert.ok(p.packets.some(([method, id, value]) => method === 'sendConfig' && id === 146 && value === 2));
  p.items.set(767, 2); q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.KATRINE, stepId: 'i8Y3sS', kind: 'message' });
  assert.equal(q.quest.getStage(p), 4); assert.equal(p.attributes.get('shield-of-arrav.gang'), 2);
});

test('Shield report admission works in a full inventory and recognizes a banked report', () => {
  const q = register('ShieldOfArrav', 'shield_of_arrav'), p = player(); q.quest.setStage(p, 2);
  q.emit('npc-dialogue:choice', { player: p, npcId: core.NpcIdentifiers.STRAVEN, option: "I'd like to offer you my services." });
  assert.equal(q.quest.varpValue(3, p), 8); p.bank.set(761, 1);
  const condition = q.hooks.get('onNpcDialogueCondition')[0];
  assert.equal(condition({ player: p, npcId: core.NpcIdentifiers.STRAVEN, text: 'If the player has the intel report.' }), true);
  assert.equal(condition({ player: p, npcId: core.NpcIdentifiers.STRAVEN, text: 'If the intel report is in the bank.' }), true);
  p.items.set(761, 1); p.items.set(526, 27);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.STRAVEN, stepId: 'G02Ai7', kind: 'message' });
  assert.equal(q.quest.getStage(p), 4); assert.equal(p.items.get(759), 1); assert.equal(p.items.get(761), 0);
});

test('Shield curator grants certificates on the real message event and combining needs no spare slot', () => {
  const q = register('ShieldOfArrav', 'shield_of_arrav'), p = player();
  p.attributes.set('shield-of-arrav.gang', 1); q.quest.setStage(p, 4); p.items.set(763, 1); p.items.set(526, 26);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.CURATOR_HAIG_HALEN, stepId: '2pltJk', kind: 'message' });
  assert.equal(q.quest.getStage(p), 6); assert.equal(p.items.get(763), 0); assert.equal(p.items.get(11173), 2);
  p.items.set(526, 25); p.items.set(11174, 1); assert.equal(p.getInventory().isFull(), true);
  q.call('onItemOnItem', { player: p, usedItemId: 11173, usedWithItemId: 11174 });
  assert.equal(p.items.get(769), 1); assert.equal(p.items.get(11173), 1); assert.equal(p.items.get(11174), 0);
  assert.equal(p.getInventory().getFreeSlots(), 1);
});

test('Shield crossbow hand-over asks first and drops the item for the partner', () => {
  const q = register('ShieldOfArrav', 'shield_of_arrav'), p = player(), partner = player(); p.items.set(767, 1);
  const event = { player: p, target: partner, itemId: 767 }; q.call('onItemOnPlayer', event);
  assert.equal(event.handled, true); assert.equal(p.items.get(767), 1);
  choose(q.prompts.at(-1), 'No'); assert.equal(q.ground.length, 0);
  q.call('onItemOnPlayer', event); choose(q.prompts.at(-1), 'Yes');
  assert.equal(q.ground.length, 1); assert.equal(q.ground[0].owner, partner);
  assert.equal(q.ground[0].item.getId(), 767); assert.equal(p.items.get(767), 0);
  assert.ok(p.messages.includes('QuestTester can now take the item from the ground.'));
  assert.ok(partner.messages.includes('<col=ef1020>QuestTester has dropped something for you to take.</col>'));
});

test('Shield book displays both captured page pairs through the cache next-page button', () => {
  const q = register('ShieldOfArrav', 'shield_of_arrav'), p = player(); q.quest.setStage(p, 1); p.items.set(757, 1);
  q.call('onItemAction', { player: p, itemId: 757, option: 'Read' }); assert.equal(q.quest.getStage(p), 2);
  assert.ok(p.packets.some(([method, id]) => method === 'sendInterface' && id === 392));
  assert.ok(p.packets.some(([method, text, id]) => method === 'sendString' && id === ((392 << 16) | 46) && text === 'by A. R. Wright'));
  q.buttons.get((392 << 16) | 77)({ player: p, buttonId: (392 << 16) | 77 });
  assert.ok(p.packets.some(([method, text, id]) => method === 'sendString' && id === ((392 << 16) | 44) && text === 'gold bounty (a massive sum'));
});


test('Wally vision uses the private historical actor and restores the player on completion and logout', () => {
  for (const logout of [false, true]) {
    const q = register('DemonSlayer', 'demon_slayer'), p = player();
    const original = new core.Location(3204, 3424, 0); p.moveTo(original);
    q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.ARIS, stepId: 'OzuYrk' });
    assert.ok(p.getPrivateArea()); assert.equal(p.getNpcTransformationId(), 5092);
    assert.equal(p.getLocation().getX(), 3225); assert.equal(p.getLocation().getY(), 3371);
    const line = { player: p, npcId: core.NpcIdentifiers.ARIS, text: 'Die, foul demon!' };
    q.emit('npc-dialogue:line', line); line.before();
    assert.equal(p.getLocation().getX(), 3225); assert.equal(p.getLocation().getY(), 3363);
    q.tick(4);
    assert.equal(p.getLocation().getX(), 3227); assert.equal(p.getLocation().getY(), 3367);
    if (logout) q.call('onPlayerLogout', { player: p });
    else q.emit('npc-dialogue:hook', { player: p, npcId: core.NpcIdentifiers.ARIS, hook: 'quest:demon-slayer:start' });
    assert.equal(p.getArea(), null); assert.equal(p.getNpcTransformationId(), -1);
    assert.ok(p.getLocation().equals(original));
    assert.equal(q.quest.getStage(p), logout ? 0 : 1);
  }
});

test('Shield Black Arm completion mirrors the captured independent wire states and gives 600 coins once', () => {
  const q = register('ShieldOfArrav', 'shield_of_arrav'), p = player();
  p.attributes.set('shield-of-arrav.gang', 2); p.attributes.set('shield-of-arrav.phoenix-location-known', true);
  p.attributes.set('shield-of-arrav:black-arm-task', true); q.quest.setStage(p, 6); p.items.set(769, 1);
  assert.equal(q.quest.varpValue(6, p), 4);
  assert.ok(p.packets.some(([method, id, value]) => method === 'sendConfig' && id === 146 && value === 3));
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.KING_ROALD_3, stepId: '25_j1f' });
  assert.equal(q.quest.getStage(p), 7); assert.equal(p.items.get(995), 600);
  assert.equal(q.quest.varpValue(7, p), 4);
  assert.ok(p.packets.some(([method, id, value]) => method === 'sendConfig' && id === 146 && value === 4));
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.KING_ROALD_3, stepId: '25_j1f' });
  assert.equal(p.items.get(995), 600);
  const spawns = require('../data/definitions/ground-items.json').filter((item) => item.id === 767);
  assert.ok(spawns.some((item) => item.location.x === 3243 && item.location.y === 3383 && item.location.z === 1));
  assert.ok(spawns.some((item) => item.location.x === 3245 && item.location.y === 3385 && item.location.z === 1));
});


test('Shield full certificate opens the captured readable modal and Phoenix completion uses cache state 10', () => {
  const q = register('ShieldOfArrav', 'shield_of_arrav'), p = player();
  p.attributes.set('shield-of-arrav.gang', 1); q.quest.setStage(p, 6); p.items.set(769, 1);
  q.call('onItemAction', { player: p, itemId: 769, option: 'Read' });
  assert.ok(p.packets.some(([method, id]) => method === 'sendInterface' && id === 526));
  assert.ok(p.packets.some(([method, text, id]) => method === 'sendString' && id === ((526 << 16) | 3) && text.includes('Proclimation 262')));
  q.buttons.get((526 << 16) | 4)({ player: p });
  assert.equal(p.packets.at(-1)[0], 'sendInterfaceRemoval');
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.KING_ROALD_3, stepId: '25_j1f' });
  assert.equal(q.quest.varpValue(7, p), 10);
});


test('Delrith timeout restores combat without taking over the camera again', () => {
  const q = register('DemonSlayer', 'demon_slayer'), p = player(); q.quest.setStage(p, 29);
  const originalCycle = core.World.processCycle;
  try {
    q.areas[0].process(p);
    q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.DENATH_4, stepId: 'xjQ9zZ' });
  q.tick(6);
    const line = { player: p, text: "I've got to get out of here..." };
    q.emit('npc-dialogue:line', line); line.after();
    q.call('onNpcBeforeDeath', { npc: q.spawned.at(-1) });
    q.tick(4); p.packets.length = 0;
    core.World.processCycle += 100;
    p.getArea().process(p);
    assert.equal(q.spawned.at(-1).getId(), core.NpcIdentifiers.DELRITH);
    assert.equal(p.packets.some(([method]) => method.startsWith('sendCamera')), false);
    q.call('onPlayerLogout', { player: p });
  } finally { core.World.processCycle = originalCycle; }
});


test('Demon Slayer drain wire state stays 0 through Prysin, becomes 1 on pouring, then 2 on pickup', () => {
  const q = register('DemonSlayer', 'demon_slayer'), p = player(); q.quest.setStage(p, 1);
  const wireDrain = () => p.packets.findLast(([method, id]) => method === 'sendVarbit' && id === 2568)?.[2];
  q.emit('npc-dialogue:choice', { player: p, npcId: core.NpcIdentifiers.SIR_PRYSIN, stepId: 'vc9k5u' });
  assert.equal(q.quest.getStage(p), 2);
  assert.equal(p.attributes.get('demon_slayer.drain'), undefined);
  q.call('onPlayerLogin', { player: p }); assert.equal(wireDrain(), 0);
  p.items.set(core.ItemIdentifiers.BUCKET_OF_WATER, 1);
  q.call('onItemOnObject', { player: p, itemId: core.ItemIdentifiers.BUCKET_OF_WATER, objectId: 2843 });
  assert.equal(p.attributes.get('demon_slayer.drain'), 2); assert.equal(wireDrain(), 1);
  q.call('onPlayerLogin', { player: p }); assert.equal(wireDrain(), 1, 'saved legacy flushed state remains compatible');
  q.call('onGroundItemPickup', { player: p, groundItem: {
    getItem: () => new core.Item(core.ItemIdentifiers.SILVERLIGHT_KEY_3, 1),
    getPosition: () => new core.Location(3227, 9898, 0),
  } });
  assert.equal(p.attributes.get('demon_slayer.drain'), 3); assert.equal(wireDrain(), 2);
});


test('Demon Slayer vision preserves every recorded camera target and both rates', () => {
  const q = register('DemonSlayer', 'demon_slayer'), p = player();
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.ARIS, stepId: 'OzuYrk' });
  const show = (text, phase = 'before') => {
    const event = { player: p, npcId: core.NpcIdentifiers.ARIS, text };
    q.emit('npc-dialogue:line', event); event[phase]?.(); return event;
  };
  show('Die, foul demon!');
  q.tick(4);
  show('Now, what was that incantation again?');
  show('[word 1]... [word 2]... [word 3]... [word 4]... [word 5]!', 'after');
  q.tick(4);
  show('I am the greatest demon slayer EVER!');
  q.emit('npc-dialogue:hook', { player: p, npcId: core.NpcIdentifiers.ARIS, hook: 'quest:demon-slayer:start' });
  assert.deepEqual(p.packets.filter(([method]) => method.startsWith('sendCamera')), [
    ['sendCameraMoveTo', 3227, 3369, 300, { rate: 232, rate2: 232 }],
    ['sendCameraLookAt', 3229, 3367, 250, { rate: 232, rate2: 232 }],
    ['sendCameraShake', 1, 0, 10, 10], ['sendCameraShake', 3, 0, 90, 1],
    ['sendCameraLookAt', 3227, 3367, 200, { rate: 2, rate2: 10 }],
    ['sendCameraLookAt', 3227, 3367, 100, { rate: 1, rate2: 10 }],
    ['sendCameraShake', 3, 0, 0, 0],
    ['sendCameraMoveTo', 3227, 3369, 100, { rate: 2, rate2: 10 }],
    ['sendCameraShake', 1, 0, 10, 5], ['sendCameraShake', 3, 0, 2, 50],
    ['sendCameraShake', 1, 0, 0, 0], ['sendCameraShake', 3, 0, 0, 0],
    ['sendCameraMoveTo', 3225, 3363, 500, { rate: 232, rate2: 232 }],
    ['sendCameraLookAt', 3227, 3367, 200, { rate: 232, rate2: 232 }],
    ['sendCameraReset'],
  ]);
});

test('Delrith summoning plays the full recorded camera sequence at its animation ticks', () => {
  const q = register('DemonSlayer', 'demon_slayer'), p = player(); q.quest.setStage(p, 29);
  q.areas[0].process(p);
  const cameras = () => p.packets.filter(([method]) => method.startsWith('sendCamera'));
  assert.deepEqual(cameras().slice(-3), [
    ['sendCameraMoveTo', 3224, 3376, 475, { rate: 232, rate2: 232 }],
    ['sendCameraLookAt', 3227, 3369, 300, { rate: 232, rate2: 232 }],
    ['sendCameraMoveTo', 3231, 3376, 475, { rate: 1, rate2: 1 }],
  ]);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.DENATH_4, stepId: 'xjQ9zZ' });
  assert.deepEqual(cameras().slice(-2), [
    ['sendCameraLookAt', 3227, 3369, 100, { rate: 232, rate2: 232 }],
    ['sendCameraMoveTo', 3227, 3365, 500, { rate: 232, rate2: 232 }],
  ]);
  q.tick(1); assert.equal(cameras().length, 5);
  q.tick(1); assert.deepEqual(cameras().at(-1), ['sendCameraShake', 0, 15]);
  q.tick(1); assert.deepEqual(cameras().at(-1), ['sendCameraShake', 0, 0]);
  q.tick(2); assert.equal(q.spawned.length, 4);
  q.tick(1); assert.equal(q.spawned.at(-1).getId(), core.NpcIdentifiers.DELRITH);
  assert.deepEqual(cameras().at(-1), ['sendCameraLookAt', 3227, 3369, 400, { rate: 1, rate2: 1 }]);
  q.tick(5); assert.equal(q.spawned.at(-1).getLocation().getY(), 3369);
  q.tick(1); assert.equal(cameras().length, 8); assert.equal(q.spawned.at(-1).getLocation().getY(), 3368);
  q.tick(1); assert.equal(q.spawned.at(-1).getLocation().getY(), 3367);
  assert.deepEqual(cameras().slice(-2), [
    ['sendCameraMoveTo', 3226, 3375, 500, { rate: 232, rate2: 232 }],
    ['sendCameraLookAt', 3227, 3367, 300, { rate: 232, rate2: 232 }],
  ]);
  q.tick(1);
  const line = { player: p, text: "I've got to get out of here..." };
  q.emit('npc-dialogue:line', line); line.before(); line.after();
  assert.deepEqual(cameras().slice(-2), [
    ['sendCameraMoveTo', 3226, 3383, 1000, { rate: 1, rate2: 1 }], ['sendCameraReset'],
  ]);
  q.call('onPlayerLogout', { player: p });
});


test('the native dialogue manager holds the spell message until the summoning camera finishes', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const q = register('DemonSlayer', 'demon_slayer'), p = player(), manager = new DialogueManager(p);
  p.getDialogueManager = () => manager;
  q.quest.setStage(p, 29); q.areas[0].process(p);
  assert.equal(manager.getCurrent().getText().replace(/\s+/g, ' '), 'Arise, O mighty Delrith! Bring destruction to this soft, weak city!');
  manager.advance(); assert.equal(manager.getCurrent().getText(), 'Arise, Delrith!');
  manager.advance(); assert.ok(manager.getCurrent() instanceof core.ActionDialogue);
  assert.equal(q.spawned.length, 4);
  q.tick(13); assert.ok(manager.getCurrent() instanceof core.ActionDialogue);
  assert.equal(q.spawned.at(-1).getId(), core.NpcIdentifiers.DELRITH);
  q.tick(1); assert.match(manager.getCurrent().getText(), /^Ha ha ha!/);
  q.call('onPlayerLogout', { player: p });
});

test('the native Wally dialogue waits for the charge and sword-pose camera transitions', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const q = register('DemonSlayer', 'demon_slayer'), p = player(), manager = new DialogueManager(p);
  p.getDialogueManager = () => manager;
  require('../plugins/quests/QuestRuntime').startTranscript(q.api, p, core.NpcIdentifiers.ARIS, 'Demon Slayer', 'starting-demon-slayer',
    steps => steps[2].options[0].steps[15].options[3].steps.slice(1, 10));
  assert.match(manager.getCurrent().getText(), /^Wally managed/);
  manager.advance(); assert.equal(manager.getCurrent(), undefined);
  q.tick(7); assert.equal(manager.getCurrent(), undefined);
  q.tick(1); assert.equal(manager.getCurrent().getText(), 'Now, what was that incantation again?');
  manager.advance(); assert.match(manager.getCurrent().getText(), /\.\.\./);
  manager.advance(); assert.equal(manager.getCurrent(), undefined);
  q.tick(3); assert.equal(manager.getCurrent(), undefined);
  q.tick(1); assert.equal(manager.getCurrent().getText(), 'I am the greatest demon slayer EVER!');
  manager.advance(); assert.match(manager.getCurrent().getText(), /^By reciting/);
  q.call('onPlayerLogout', { player: p });
});


test('Wally charge reaches its camera target while the teleport placement is still pending', () => {
  const q = register('DemonSlayer', 'demon_slayer'), p = player();
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.ARIS, stepId: 'OzuYrk' });
  p.isNeedsPlacement = () => true;
  p.getMovementQueue = () => ({ reset() { return this; }, setBlockMovement() {},
    addSteps() { throw new Error('ordinary steps are rejected during placement'); } });
  const event = { player: p, npcId: core.NpcIdentifiers.ARIS, text: 'Die, foul demon!' };
  q.emit('npc-dialogue:line', event); event.before();
  assert.ok(p.getForceMovement() instanceof core.ForceMovement);
  assert.equal(p.getForceMovement().getReverseSpeed(), 60);
  q.tick(1); assert.equal(p.getLocation().getX(), 3225); assert.equal(p.getLocation().getY(), 3363);
  q.tick(1); assert.equal(p.getLocation().getX(), 3227); assert.equal(p.getLocation().getY(), 3367);
  assert.equal(p.getForceMovement(), null);
  q.call('onPlayerLogout', { player: p });
});

test('Shield gang doors claim the shared door toggle and cross on the axis their wall faces', () => {
  const q = register('ShieldOfArrav', 'shield_of_arrav'), p = player();
  const toggle = (id, x, y, face) => {
    const request = { player: p, objectId: id, object: new core.GameObject(id, new core.Location(x, y, 0), 0, face, null), handled: false };
    q.emit('door:toggle', request); return request;
  };
  const at = (x, y) => { p.moveTo(new core.Location(x, y, 0)); };
  const tile = () => [p.getLocation().getX(), p.getLocation().getY()];
  at(3185, 3387);
  assert.equal(toggle(core.ObjectIdentifiers.DOOR_71, 3185, 3388, 3).handled, true);
  assert.deepEqual(tile(), [3185, 3387]); assert.equal(p.messages.at(-1), 'This door seems to be locked from the inside.');
  p.attributes.set('shield-of-arrav.gang', 2); q.quest.setStage(p, 4);
  toggle(core.ObjectIdentifiers.DOOR_71, 3185, 3388, 3); assert.deepEqual(tile(), [3185, 3388]);
  toggle(core.ObjectIdentifiers.DOOR_71, 3185, 3388, 3); assert.deepEqual(tile(), [3185, 3387]);
  at(3247, 9780);
  toggle(core.ObjectIdentifiers.DOOR_69, 3247, 9779, 1); assert.deepEqual(tile(), [3247, 9780], 'Black Arm members stay out of the Phoenix hideout');
  p.attributes.set('shield-of-arrav.gang', 1);
  toggle(core.ObjectIdentifiers.DOOR_69, 3247, 9779, 1); assert.deepEqual(tile(), [3247, 9779]);
  at(3251, 3386);
  toggle(core.ObjectIdentifiers.DOOR_70, 3251, 3386, 3); assert.deepEqual(tile(), [3251, 3386]);
  p.items.set(759, 1);
  toggle(core.ObjectIdentifiers.DOOR_70, 3251, 3386, 3); assert.deepEqual(tile(), [3251, 3385]);
  assert.equal(toggle(core.ObjectIdentifiers.DOOR_297, 3190, 3384, 0).handled, false, 'ordinary doors stay with Doors.plugin.js');
});

test("Champions' Guild door turns away entrants under 32 Quest Points through the Guildmaster's transcript", () => {
  const custom = new Map(), started = [];
  const api = { core, onCustomEvent: (name, fn) => custom.set(name, fn), onNpcDialogueCondition: (fn) => custom.set('condition', fn),
    emitCustomEvent: (name, payload) => started.push([name, payload]) };
  require('../plugins/areas/ChampionsGuild.plugin').register(api);
  const p = player(), door = (y) => {
    p.moveTo(new core.Location(3191, y, 0));
    const request = { player: p, objectId: core.ObjectIdentifiers.DOOR_45, handled: false };
    custom.get('door:toggle')(request); return request.handled;
  };
  const condition = (text) => custom.get('condition')({ player: p, npcId: core.NpcIdentifiers.GUILDMASTER, text });
  p.attributes.set('quest.points', 31);
  assert.equal(door(3363), true);
  assert.equal(started.at(-1)[1].variant, 'standard-dialogue-entering-the-champions-guild');
  assert.equal(condition('If the player does not have at least 32 quest points:'), true);
  assert.equal(door(3362), false, 'leaving is never stopped');
  p.attributes.set('quest.points', 32);
  assert.equal(door(3363), false);
  assert.equal(condition('If the player does not have at least 32 quest points:'), false);
  assert.equal(condition('If the player has at least 32 quest points:'), true);
});
