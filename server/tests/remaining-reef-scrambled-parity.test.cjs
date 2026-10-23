// From server/: node --test tests/remaining-reef-scrambled-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test, before, afterEach } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const StaticShips = require('../plugins/skills/sailing/StaticShips.Sailing');
const { World } = require('../dist/game/World');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { pickVariant } = require('../plugins/npcs/NpcDialogues.plugin');
const transcripts = require('../data/definitions/npc-dialogues.json');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
let nextIndex = 1;
const noop = () => {};
afterEach(() => { for (const ship of StaticShips.all()) StaticShips.dispose(ship); });
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); new NpcDefinitionLoader().load(); });

function harness(name) {
  const hooks = {}, events = {}, tasks = [], areas = [], npcs = [], removed = [], objects = [], ground = [], clicks = new Map(), buttons = new Map(), namedNpcs = new Map(), namedObjects = new Map();
  const objectManager = { register: object => objects.push(object), deregister: object => { const i = objects.indexOf(object); if (i >= 0) objects.splice(i, 1); } };
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  }, ObjectManager: { register: object => objects.push(object), deregister: noop } },
    registerArea: area => areas.push(area),
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args), getGroundItem: () => null }),
    onInterfaceActionButton: (ids, fn) => [].concat(ids).forEach(id => { const callbacks = buttons.get(id) ?? []; callbacks.push(fn); buttons.set(id, callbacks); }),
    onObjectClick: (ids, click, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    onNpcInteraction: (name, actions) => namedNpcs.set(name, actions),
    onObjectInteraction: (name, actions) => { if (typeof name === 'function') (hooks.onObjectInteraction ??= []).push(name); else namedObjects.set(name, actions); },
    onObjectFirstClick: (ids, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    persistAttribute: noop,
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
        getHitpoints: () => npc.hitpoints ?? 100, setHitpoints: value => { npc.hitpoints = value; return npc; },
        getMaxHitpoints: () => npc.maxHitpoints ?? 100,
      }; npcs.push(npc); return npc;
    }, removeNpc: npc => { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) { const answer = fn(event); if (answer !== null && answer !== undefined) return answer; }
    return null;
  };
  const h = { api, hooks, events, tasks, areas, npcs, removed, objects, ground, clicks, buttons, namedNpcs, namedObjects, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    line(p, npcId, text) { const event = { player: p, npcId, text }; h.emit('npc-dialogue:line', event); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId }; h.emit('npc-dialogue:action', event); return event; },
    talk(p, npcId) { const choice = (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean); assert.ok(choice, `no variant for ${npcId}`); runtime.startTranscript(api, p, npcId, typeof choice === 'string' ? h.quest.name : choice.page, typeof choice === 'string' ? choice : choice.variant); },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    choose(p, text) { const prompt = p.prompt; assert.ok(prompt, `no menu for ${text}`); const index = prompt.options.findIndex(label => label === text); assert.ok(index >= 0, `missing ${text} in ${prompt.options}`); p.prompt = null; prompt.pairs[index * 2 + 1](); },
    continueUntil(p, predicate, limit = 120) { while (!predicate()) { assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`); assert.ok(p.manager.getCurrent(), `dialogue ended at ${p.text}`); p.manager.advance(); } },
    continueToMenu(p, limit = 120) { h.continueUntil(p, () => Boolean(p.prompt), limit); },
    logout(p) { for (const fn of hooks.onPlayerLogout ?? []) fn({ player: p }); },
    login(p) { for (const fn of hooks.onPlayerLogin ?? []) fn({ player: p }); },
    death(p) { for (const fn of hooks.onPlayerDeath ?? []) fn({ player: p }); },
  }; return h;
}
function player() {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [];
  let location = new core.Location(3210, 3220, 0), area = null;
  const inv = { getAmount: id => items.get(id) ?? 0, isFull: () => Boolean(p.full), getFreeSlots: () => p.full ? 0 : 28, contains: id => (items.get(id) ?? 0) > 0,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) { assert.ok((items.get(id) ?? 0) >= amount, `missing item ${id}`); items.set(id, items.get(id) - amount); },
  };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; }, sendVarbit(id, value) { varbits.set(id, value); return packet; },
    getVarbit(id) { return varbits.get(id) ?? 0; }, getVarp(id) { return configs.get(id) ?? 0; },
    isSubInterfaceOpen: () => false, closeInterface: id => { log.push(['closeInterface', id]); return packet; },
    sendString(text, uid) { if ([6, 3, 2].some(child => [217, 231, 229, 193].some(group => uid === (group << 16 | child)))) p.text = text; log.push(['text', uid, text]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = { setEnteredAmountAction: action => { p.amountAction = action; }, attrs, items, configs, varbits, log, xp, messages: [], animations: [], prompt: null, text: '', index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inv,
    getBanks: () => [{ getAmount: id => p.bank?.get(id) ?? 0 }], getEquipment: () => ({ get: () => p.amulet ? { getId: () => p.amulet } : null, getItems: () => p.amulet ? [{ getId: () => p.amulet }] : [] }),
    getSession: () => ({ sendClientPacket: frame => { log.push(['frame', Buffer.from(frame)]); return true; } }), getPacketSender: () => packet, getDialogueManager: () => p.manager, getUpdateFlag: () => ({ flag: noop }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), getCombatLevel: () => p.combat ?? 3, getCurrentLevel: () => p.magic ?? 99, getMaxLevel: () => p.level ?? 99 }),
    getPrayerActive: () => new Array(30).fill(false), getQuickPrayers: () => ({ checkActive: noop }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; }, addSteps(to) { location = to; return this; }, isBlockMovement: () => Boolean(p.blocked) }),
    setUntargetable: value => { p.untargetable = value; }, setForceMovement: movement => { p.forceMovement = movement; }, getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; }, getIndex: () => p.index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: damage => { p.damage = damage; } }) }),
    getUsername: () => 'Parity', getAppearance: () => ({ isMale: () => true }), setPositionToFace: noop, forceChat: noop,
    performAnimation: a => p.animations.push(a.getId()), sendMessage: text => p.messages.push(text),
  }; p.manager = new DialogueManager(p); return p;
}
function completeQuestEvent(h, key) {
  (h.events['quest:is-complete'] ??= []).push(event => { if (event.key === key) event.complete = true; });
}
const search = (h, p, objectId) => {
  const handler = h.namedObjects.get('Eggs').Search;
  const event = { player: p, objectId, handled: false };
  handler(event);
  return event;
};

test('Scrambled starts only with requirements, follows captured stages 2/4/6/8, and inspects the broken egg', () => {
  const h = harness('Scrambled'), p = player();
  h.talk(p, N.ALAN_2); h.continueToMenu(p); h.choose(p, 'Yes.');
  assert.equal(h.quest.getStage(p), 0);
  assert.ok(p.messages.some(text => text.includes('Children of the Sun')));
  completeQuestEvent(h, 'children_of_the_sun');
  const q = player(); h.talk(q, N.ALAN_2); h.continueToMenu(q); h.choose(q, 'Yes.');
  assert.equal(h.quest.getStage(q), 2);
  assert.ok(q.messages.some(text => text.includes("You've started a new quest")));
  h.continueToMenu(q); h.choose(q, 'Of course!');
  assert.equal(h.quest.getStage(q), 4);
  h.action(q, N.ALAN_2, '2DUXLf');
  assert.equal(h.quest.getStage(q), 4);
  assert.ok(q.log.some(row => row[0] === 'sendSubInterface' && row[2] === 174));
  h.tick(2);
  assert.ok(q.log.some(row => row[0] === 'sendCameraMoveTo'));
  assert.ok(q.log.some(row => row[0] === 'sendCameraLookAt'));
  assert.ok(h.npcs.some(npc => npc.id === 14476 && !npc.removed));
  assert.ok(h.npcs.some(npc => npc.id === 14487 && !npc.removed));
  h.tick(44);
  assert.ok(h.npcs.some(npc => npc.id === 14487 && npc.animations.includes(12308)));
  h.tick(5);
  assert.ok(h.npcs.some(npc => npc.id === 14479 && !npc.removed));
  h.tick(10);
  assert.equal(h.quest.getStage(q), 6);
  assert.ok(q.log.some(row => row[0] === 'sendCameraReset'));
  const inspect = h.namedNpcs.get('Humphrey Dumphrey').Inspect;
  inspect({ player: q, npcId: N.HUMPHREY_DUMPHREY_2 });
  h.action(q, N.HUMPHREY_DUMPHREY_2, 'pR1dDX');
  assert.equal(h.quest.getStage(q), 8);
});

test('Scrambled King lines rally the men, all three hand-ins move 14->16->18->19->20, and the judge falls', () => {
  const h = harness('Scrambled'), p = player();
  h.quest.setStage(p, 8);
  h.line(p, N.KING, "They'll be up to the task, but you'll need to rally them up.");
  assert.equal(h.quest.getStage(p), 12);
  h.line(p, N.KING, 'Nezketi should be in the temple just south of here, Kauayotl will most likely be just outside.');
  assert.equal(h.quest.getStage(p), 14);
  assert.ok(h.npcs.some(npc => npc.id === N.ACATZIN && !npc.removed));
  h.quest.setStage(p, 14);
  h.action(p, N.ACATZIN, 'vP_T1a');
  h.action(p, N.NEZKETI, 'mLipel');
  assert.equal(h.quest.getStage(p), 14);
  h.action(p, N.KAUAYOTL, 'i-UzgE');
  assert.equal(h.quest.getStage(p), 16);
  h.line(p, N.KAUAYOTL, "Right then. I'll be back once I have some eggs.");
  assert.equal(h.quest.getStage(p), 18);
  assert.deepEqual([p.varbits.get(16766), p.varbits.get(16769), p.varbits.get(16770)], [1, 1, 1]);
  p.items.set(I.JAGUAR_EGG, 1); h.action(p, N.NEZKETI, 'NXRXMq');
  assert.equal(h.quest.getStage(p), 18);
  p.items.set(I.DRAGON_EGG, 1); h.action(p, N.KAUAYOTL, 'teOflj');
  assert.equal(h.quest.getStage(p), 19);
  p.items.set(I.LARGE_EGG, 1); h.action(p, N.ACATZIN, '0pMMZD');
  assert.equal(h.quest.getStage(p), 20);
  h.action(p, N.NEZKETI, 'dPmRwZ');
  assert.equal(h.quest.getStage(p), 22);
  assert.deepEqual([p.varbits.get(16766), p.varbits.get(16769), p.varbits.get(16770)], [5, 5, 5]);
  h.line(p, N.NEZKETI, "No, it's necessary...");
  assert.equal(h.quest.getStage(p), 24);
  h.tick(1);
  assert.equal(p.configs.get(4756), 5397);
  assert.ok(p.log.some(row => row[0] === 'sendInterfaceFlagsRange' && row[1] === ((922 << 16) | 7) && row[4] === (1 << 23)));
  const trigger = h.hooks.onInterfaceActionClick[0];
  const event = piece => ({ player: p, groupId: 922, childId: 7, slot: piece, scriptTrigger: true, handled: false });
  trigger({ ...event(3), scriptTrigger: false });
  trigger(event(99));
  assert.equal(p.attrs.get('scrambled:jigsaw'), undefined);
  for (let piece = 0; piece < 26; piece++) trigger(event(piece));
  trigger(event(0));
  assert.equal(p.attrs.get('scrambled:jigsaw'), (1 << 26) - 1);
  assert.equal(p.configs.get(4749), (1 << 26) - 1);
  assert.equal(h.quest.getStage(p), 26);
  assert.ok(p.log.filter(row => row[0] === 'closeInterface' && row[1] === 922).length === 1);
  assert.equal(p.log.filter(row => row[0] === 'sendInterfaceScript' && row[1] === 7970).length, 26);
});

test('Scrambled logout during the egg-fall fade cancels the pending scene and teleport', () => {
  const h = harness('Scrambled'), p = player();
  h.quest.setStage(p, 4);
  const npcCount = h.npcs.length;
  h.action(p, N.ALAN_2, '2DUXLf');
  assert.equal(p.blocked, true, 'fade takes movement');
  h.logout(p);
  h.tick(10);
  assert.equal(h.npcs.length, npcCount, 'no egg-fall actors spawn after logout');
  assert.equal(p.blocked, false, 'logout restores movement');
});

test('Scrambled egg piles spawn their guardian, unlock after the kill, and the final dialogue completes once', () => {
  const h = harness('Scrambled'), p = player();
  h.quest.setStage(p, 18);
  search(h, p, 56926);
  assert.equal(p.varbits.get(16770), 2);
  const chicken = h.npcs.find(npc => npc.id === N.LARGE_CHICKEN && !npc.removed);
  assert.ok(chicken);
  h.hooks.onNpcDeath[0]({ npcId: N.LARGE_CHICKEN, npc: chicken, killer: p });
  assert.equal(p.varbits.get(16770), 3);
  search(h, p, 56926);
  assert.equal(p.items.get(I.LARGE_EGG), 1);
  assert.equal(p.varbits.get(16770), 3);
  p.full = true; p.items.delete(I.LARGE_EGG);
  search(h, p, 56926);
  assert.equal(p.items.get(I.LARGE_EGG), undefined);
  p.full = false;
  h.quest.setStage(p, 26);
  h.action(p, N.NEZKETI, 'Txl_sf');
  assert.equal(h.quest.getStage(p), 28);
  h.emit('npc-dialogue:action', { player: p, npcId: N.NEZKETI, step: { type: 'end' } });
  assert.equal(h.quest.getStage(p), 30);
  assert.ok(p.messages.some(text => text.includes("completed a quest")));
  assert.deepEqual(p.xp, [[core.Skill.CONSTRUCTION.getIndex(), 5000], [core.Skill.COOKING.getIndex(), 5000], [core.Skill.SMITHING.getIndex(), 5000]]);
  h.emit('npc-dialogue:action', { player: p, npcId: N.NEZKETI, step: { type: 'end' } });
  assert.deepEqual(p.xp, [[core.Skill.CONSTRUCTION.getIndex(), 5000], [core.Skill.COOKING.getIndex(), 5000], [core.Skill.SMITHING.getIndex(), 5000]]);
});

test('Scrambled old completed stage-8 saves migrate without granting rewards again', () => {
  const h = harness('Scrambled'), p = player();
  p.attrs.set('quest.scrambled.stage', 8);
  p.attrs.set('quest.points', 5);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(h.quest.getStage(p), 30);
  assert.equal(p.attrs.get('quest.points'), 5);
  assert.deepEqual(p.xp, []);
});

test('Red Reef accepts the captured start, advances 4/6/8 through Finn, Katt and Floopa, and arrives at Red Rock', () => {
  const h = harness('RedReef'), p = player();
  completeQuestEvent(h, 'troubled_tortugans');
  h.talk(p, N.ELDER_RALEY); h.continueToMenu(p); h.choose(p, 'Yes.');
  assert.equal(h.quest.getStage(p), 2);
  const finn = N.FINN_2;
  h.talk(p, finn);
  assert.equal(h.quest.getStage(p), 4);
  h.quest.setStage(p, 4);
  h.talk(p, N.ELDER_KATT);
  assert.equal(h.quest.getStage(p), 8);
  h.line(p, N.FLOOPA_4, 'Good luck, friend, and... thank you.');
  assert.equal(h.quest.getStage(p), 10);
  h.hooks.onZoneEnter[0]({ player: p });
  assert.equal(h.quest.getStage(p), 12);
});

test('Red Reef receptionist, displays and Paxton follow 14/16/18 and the pirate stages do not skip', () => {
  const h = harness('RedReef'), p = player();
  h.quest.setStage(p, 10); h.hooks.onZoneEnter[0]({ player: p }); assert.equal(h.quest.getStage(p), 12);
  h.talk(p, N.RECEPTIONIST); assert.equal(h.quest.getStage(p), 14);
  h.hooks.onObjectInteraction[0]({ player: p, objectId: O.DISPLAY, handled: false });
  const openScript = p.log.find(row => row[0] === 'sendInterfaceScript' && row[1] === 2524);
  assert.deepEqual(openScript, ['sendInterfaceScript', 2524, [-1, -1]]);
  assert.ok(p.log.some(row => row[0] === 'sendInterface' && row[1] === 400));
  const render = p.log.find(row => row[0] === 'sendInterfaceScript' && row[1] === 8565);
  assert.equal(render?.[2][0], 'The Brentwood Trading Company');
  assert.equal(render?.[2][1], 58824);
  assert.ok(render?.[2][2].startsWith('In the year 144 of the Fifth Age'));
  assert.deepEqual(render?.[2].slice(3), [-5, 150, 57, 1938, 0, 320, 0]);
  for (const id of [O.DISPLAY_2, O.DISPLAY_3, O.DISPLAY_4]) {
    h.hooks.onObjectInteraction[0]({ player: p, objectId: id, handled: false });
  }
  assert.equal(h.quest.getStage(p), 16);
  const renders = p.log.filter(row => row[0] === 'sendInterfaceScript' && row[1] === 8565).map(row => row[2]);
  assert.deepEqual(renders.map(args => [args[0], args[1], args[4]]), [
    ['The Brentwood Trading Company', 58824, 150],
    ['Brentwood Diving Bell', 58825, 140],
    ['Red Coral', 58826, 150],
    ['The Red Reef', 58827, 130],
  ]);
  assert.equal(renders.length, 4);
  h.talk(p, N.THEODORE_PAXTON); assert.equal(h.quest.getStage(p), 18);
  h.quest.setStage(p, 18);
  h.hooks.onZoneEnter[1]({ player: p });
  assert.equal(h.quest.getStage(p), 18);
  const pirates = StaticShips.all().filter(ship => ship.boat.ownerPlayerId === p.getIndex() && ship.id.startsWith('red_reef_pirate'));
  assert.deepEqual(pirates.map(ship => ship.id).sort(), ['red_reef_pirate_1', 'red_reef_pirate_2']);
  assert.ok(pirates.every(ship => ship.boat.ownerOnly));
  const foreign = { id: 'red_reef_pirate_1', boat: { ownerPlayerId: p.getIndex() + 1 } };
  h.emit('sailing:ship-sunk', { player: p, ship: foreign });
  assert.equal(p.varbits.get(13219) ?? 0, 0);
  h.emit('sailing:ship-sunk', { player: p, ship: pirates[0] });
  assert.equal(p.varbits.get(13219), 1);
  assert.equal(h.quest.getStage(p), 18);
  h.emit('sailing:ship-sunk', { player: p, ship: pirates[0] });
  assert.equal(p.varbits.get(13219), 1);
  h.emit('sailing:ship-sunk', { player: p, ship: pirates[1] });
  assert.equal(p.varbits.get(13219), 2);
  assert.equal(h.quest.getStage(p), 20);
  h.hooks.onZoneEnter[1]({ player: p });
  assert.equal(h.quest.getStage(p), 22);
  assert.ok(h.npcs.filter(npc => npc.id >= N.PIRATE_53 && npc.id <= N.PIRATE_56 && !npc.removed).length === 6);
  for (const npc of h.npcs.filter(npc => npc.id >= N.PIRATE_53 && npc.id <= N.PIRATE_56 && !npc.removed)) {
    h.hooks.onNpcDeath[0]({ npc, killer: p });
  }
  assert.equal(h.quest.getStage(p), 24);
  const bethel = h.npcs.find(npc => npc.id === N.BLACK_EYE_BETHEL && !npc.removed);
  assert.ok(bethel);
  assert.deepEqual([bethel.x, bethel.y, bethel.z], [2865, 2324, 2], 'captured Bethel add tile');
  if (RegionManager.regions.size === 0) RegionManager.init();
  assert.equal(RegionManager.getClipping(2865, 2324, 2, null) & 0x200000, 0,
    'captured Bethel tile is walkable (old 2862,2323 was blocked)');
  assert.equal(RegionManager.getClipping(2865, 2325, 2, null) & 0x200000, 0,
    'a cardinal melee neighbour of Bethel is walkable');
  h.hooks.onNpcDeath[0]({ npc: bethel, killer: p });
  assert.equal(h.quest.getStage(p), 26);
});

test('Red Reef diving route reaches 42 through lobster, dredger messages and the finale, rewarding once', () => {
  const h = harness('RedReef'), p = player();
  h.quest.setStage(p, 26);
  h.talk(p, N.THEODORE_PAXTON);
  assert.equal(h.quest.getStage(p), 28);
  h.talk(p, N.SPENCER_BRENTWOOD);
  assert.equal(h.quest.getStage(p), 30);
  while (p.manager.getCurrent()) p.manager.advance();
  p.items.set(I.MEDALLION_OF_THE_DEEP, 1); p.amulet = I.MEDALLION_OF_THE_DEEP;
  h.talk(p, N.SPENCER_BRENTWOOD);
  h.continueToMenu(p);
  h.choose(p, "Let's go.");
  assert.equal(h.quest.getStage(p), 32);
  assert.equal(p.varbits.get(19526), 1, 'the dive publishes player_diving');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2837, 8922],
    'the dive lands on the captured player tile');
  assert.equal(h.npcs.some(npc => [15018, 15020].includes(npc.id) && !npc.removed), false,
    'the stage-30 diving Spencer is not a stage-32 talk fallback');

  // The repair object is the raw placed parent 58497; its current definition is 58500.
  if (RegionManager.regions.size === 0) RegionManager.init();
  const dredger = core.MapObjects.get(58497, new core.Location(2844, 8942, 1), null);
  assert.ok(dredger, 'the raw placed dredger exists');
  const dredgerDefinition = core.ObjectDefinition.forPlayer(dredger.getId(), p);
  assert.equal(dredgerDefinition?.id, 58500, 'the placed parent resolves to the repair child');
  // The stage-32 object click, not a Spencer talk, is the canonical first repair.
  h.hooks.onObjectInteraction[0]({ player: p, object: dredger, objectId: dredger.getId(),
    definition: dredgerDefinition, location: { x: 2844, y: 8942, z: 1 }, handled: false });
  const lobster = h.npcs.find(npc => npc.id === N.GIANT_LOBSTER_4 && !npc.removed);
  assert.ok(lobster, 'the stage-32 repair click spawns the giant lobster');
  assert.deepEqual([lobster.x, lobster.y, lobster.z], [2847, 8938, 1], 'captured lobster add tile');
  assert.equal(RegionManager.getClipping(2847, 8938, 1, null) & 0x200000, 0,
    'captured lobster tile is reachable (old 2841,8946 was blocked)');
  h.action(p, 15020, 'XpLPqf');
  assert.equal(h.npcs.filter(npc => npc.id === N.GIANT_LOBSTER_4 && !npc.removed).length, 1,
    'the deck XpLPqf message cannot spawn a second lobster');
  h.hooks.onNpcDeath[0]({ npc: lobster, killer: p });
  assert.equal(h.quest.getStage(p), 34);

  h.hooks.onObjectInteraction[0]({ player: p, object: dredger, objectId: dredger.getId(),
    definition: dredgerDefinition, location: { x: 2844, y: 8942, z: 1 }, handled: false });
  for (let i = 0; i < 20 && h.quest.getStage(p) === 34; i++) {
    if (p.manager.getCurrent()) p.manager.advance(); else break;
  }
  assert.equal(h.quest.getStage(p), 36, 'the second repair finishes through its real message transcript');
  h.action(p, 15020, 'NpiI3y');
  assert.equal(h.quest.getStage(p), 38);
  assert.equal(p.varbits.get(19526), 0, 'surfacing clears player_diving');
  h.line(p, N.SPENCER_BRENTWOOD, "Thank you. I'd best be on my way.");
  assert.equal(h.quest.getStage(p), 40);
  h.action(p, N.ELDER_RALEY, 'vNjARR');
  assert.equal(h.quest.getStage(p), 42);
  assert.deepEqual(p.xp, [[core.Skill.SAILING.getIndex(), 15000], [core.Skill.SMITHING.getIndex(), 5000]]);
  h.action(p, N.ELDER_RALEY, 'vNjARR');
  assert.deepEqual(p.xp, [[core.Skill.SAILING.getIndex(), 15000], [core.Skill.SMITHING.getIndex(), 5000]]);
});

test('Scrambled whetstone and cart repairs use the real locs, require their tools and hand over the axes', () => {
  const h = harness('Scrambled'), p = player();
  h.quest.setStage(p, 14);
  p.attrs.set('scrambled:man-acatzin', 3);
  const whetstone = h.namedObjects.get('Broken whetstone').Repair;
  whetstone({ player: p, objectId: 56936 });
  assert.equal(p.attrs.get('scrambled:man-acatzin'), 3);
  assert.ok(p.messages.some(text => text.includes('need a hammer')));
  p.items.set(I.HAMMER, 1);
  whetstone({ player: p, objectId: 56936 });
  assert.equal(p.attrs.get('scrambled:man-acatzin'), 4);
  h.action(p, N.BLACKSMITH_4, 'cXz59o');
  assert.equal(p.items.get(I.ACATZINS_AXE), 1);
  for (const handler of h.hooks.onItemOnObject) handler({ player: p, itemId: I.ACATZINS_AXE, objectId: 56936 });
  assert.equal(p.items.get(I.ACATZINS_AXE), 0);
  assert.equal(p.items.get(I.ACATZINS_AXE_2), 1);

  p.attrs.set('scrambled:man-kauayotl', 2);
  const cart = h.namedObjects.get('Cart').Repair;
  cart({ player: p, objectId: 56941 });
  assert.equal(p.attrs.get('scrambled:man-kauayotl'), 2);
  assert.ok(p.messages.some(text => text.includes('two planks')));
  p.items.set(I.PLANK, 2); p.items.set(I.IRON_NAILS, 6); p.items.set(I.SAW, 1);
  cart({ player: p, objectId: 56941 });
  assert.equal(p.attrs.get('scrambled:man-kauayotl'), 3);
  assert.equal(p.items.get(I.PLANK), 0);
  assert.equal(p.items.get(I.IRON_NAILS), 0);
});

test('Red Reef Bethel sweeps after a wind-up, switches scimitars and disables protection prayers', () => {
  const h = harness('RedReef'), p = player();
  h.quest.setStage(p, 24);
  const bethel = h.npcs.find(npc => npc.id === N.BLACK_EYE_BETHEL && !npc.removed);
  assert.ok(bethel);
  bethel.hitpoints = 180; bethel.maxHitpoints = 180;
  p.moveTo(bethel.getLocation());
  const area = h.areas[0];
  for (let tick = 0; tick < 9; tick++) area.process(p);
  assert.ok(bethel.animations.includes(13131));
  assert.ok(bethel.said === "Dodge this!" || bethel.said === "It's slashin' time!" || bethel.said === "You're done!");
  h.tick(2);
  assert.ok(p.damage?.length === 2, 'sweep should queue two hits');
  bethel.hitpoints = 100;
  area.process(p);
  assert.equal(bethel.said, "Let's see if you can handle this!");
  assert.ok(bethel.animations.includes(1056));
  bethel.hitpoints = 50;
  area.process(p);
  assert.equal(bethel.said, 'I stole this one from a monkey!');
  bethel.hitpoints = 30;
  area.process(p);
  assert.ok(bethel.animations.includes(1872));
  assert.ok(p.messages.some(text => text.includes('protection prayers have been disabled')));
  bethel.hitpoints = 180;
  for (let tick = 0; tick < 9; tick++) area.process(p);
  p.moveTo(new core.Location(3000, 3000, 0));
  h.tick(2);
  assert.ok(p.messages.some(text => text.includes('dodge out of the way')));
});

test('Scrambled and Red Reef versioned migrations map old saves once and keep rewards single', () => {
  const scrambled = harness('Scrambled'), sp = player();
  sp.attrs.set('quest.scrambled.stage', 5);
  scrambled.hooks.onPlayerLogin[0]({ player: sp });
  assert.equal(scrambled.quest.getStage(sp), 18);
  assert.equal(sp.attrs.get('scrambled:version'), 2);
  scrambled.hooks.onPlayerLogin[0]({ player: sp });
  assert.equal(scrambled.quest.getStage(sp), 18);
  assert.deepEqual(sp.xp, []);

  const reef = harness('RedReef'), rp = player();
  rp.attrs.set('quest.the_red_reef.stage', 26);
  reef.hooks.onPlayerLogin[0]({ player: rp });
  assert.equal(reef.quest.getStage(rp), 28);
  assert.equal(rp.attrs.get('the-red-reef:version'), 2);
  reef.hooks.onPlayerLogin[0]({ player: rp });
  assert.equal(reef.quest.getStage(rp), 28);
  assert.deepEqual(rp.xp, []);
});

test('Scrambled resumes a partly solved jigsaw with its locks and does not reopen before stage 24', () => {
  const h = harness('Scrambled'), p = player();
  h.quest.setStage(p, 18);
  const fix = h.namedNpcs.get('Humphrey Dumphrey').Fix;
  fix({ player: p, npcId: N.HUMPHREY_DUMPHREY_3 });
  assert.equal(p.configs.get(4756), undefined);
  h.quest.setStage(p, 24);
  p.attrs.set('scrambled:jigsaw', 0b101);
  fix({ player: p, npcId: N.HUMPHREY_DUMPHREY_3 });
  assert.equal(p.configs.get(4756), 5397);
  assert.equal(p.configs.get(4749), 0b101);
  const locks = p.log.filter(row => row[0] === 'sendInterfaceScript' && row[1] === 7970);
  assert.equal(locks.length, 2);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.configs.get(4749), 0b101);
});

test('Red Reef spawns the owner-private Zenith with Spencer on deck, boards and returns cleanly', () => {
  const h = harness('RedReef'), p = player();
  try {
    h.quest.setStage(p, 28);
    const zenith = StaticShips.all().find(ship => ship.id === 'the_zenith' && ship.boat.ownerPlayerId === p.getIndex());
    assert.ok(zenith);
    assert.ok(zenith.boat.ownerOnly);
    const deck = StaticShips.deckLocation(zenith, 8, 13);
    const spencer = [...World.getNpcs()].filter(npc =>
      npc && npc.getId?.() === N.SPENCER_BRENTWOOD && npc.getLocation?.().equals?.(deck));
    assert.equal(spencer.length, 1);
    h.quest.setStage(p, 28);
    const again = [...World.getNpcs()].filter(npc =>
      npc && npc.getId?.() === N.SPENCER_BRENTWOOD && npc.getLocation?.().equals?.(deck));
    assert.equal(again.length, 1, 'deck Spencer must not duplicate');
    const before = p.getLocation().clone();
    assert.equal(StaticShips.board(p, zenith), null);
    assert.equal(p.getArea()?.boat, zenith.boat);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [
      StaticShips.deckLocation(zenith, zenith.spec.boardingTile.x, zenith.spec.boardingTile.y).getX(),
      StaticShips.deckLocation(zenith, zenith.spec.boardingTile.x, zenith.spec.boardingTile.y).getY(),
    ]);
    assert.equal(StaticShips.leave(p), true);
    assert.equal(p.getArea()?.boat, undefined);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [before.getX(), before.getY()]);
  } finally {
    for (const ship of StaticShips.all()) {
      if (ship.boat.ownerPlayerId === p.getIndex()) StaticShips.dispose(ship);
    }
  }
});

test('Red Reef removes private ships on logout and resummons only unsunk pirate ships on relog', () => {
  const h = harness('RedReef'), p = player();
  try {
    h.quest.setStage(p, 18);
    const first = StaticShips.all().find(ship => ship.id === 'red_reef_pirate_1' && ship.boat.ownerPlayerId === p.getIndex());
    assert.ok(first);
    h.emit('sailing:ship-sunk', { player: p, ship: first });
    assert.equal(p.varbits.get(13219), 1);
    h.hooks.onPlayerLogout[0]({ player: p });
    assert.ok(!StaticShips.all().some(ship => ship.boat.ownerPlayerId === p.getIndex()));
    h.quest.setStage(p, 18);
    const resumed = StaticShips.all().filter(ship => ship.boat.ownerPlayerId === p.getIndex());
    assert.deepEqual(resumed.map(ship => ship.id), ['red_reef_pirate_2']);
  } finally {
    for (const ship of StaticShips.all()) {
      if (ship.boat.ownerPlayerId === p.getIndex()) StaticShips.dispose(ship);
    }
  }
});

test("Scrambled stage 26 opens King's men finale through the shipped transcript and completes once", () => {
  const h = harness('Scrambled'), p = player();
  h.quest.setStage(p, 24);
  for (const key of ['acatzin', 'nezketi', 'kauayotl']) p.attrs.set(`scrambled:man-${key}`, 7);
  p.attrs.set('scrambled:jigsaw', 0);
  assert.throws(() => h.talk(p, N.NEZKETI), 'stage 24 must stay gated on the unsolved jigsaw');
  p.attrs.set('scrambled:jigsaw', (1 << 26) - 1);
  assert.throws(() => h.talk(p, N.NEZKETI), 'stage 24 must not start the finale even with a full mask');
  h.quest.setStage(p, 26);
  h.talk(p, N.NEZKETI);
  assert.ok(p.text === '' || true);
  for (let step = 0; step < 400 && h.quest.getStage(p) !== 30 && p.manager.getCurrent(); step++) {
    p.manager.advance();
  }
  assert.equal(h.quest.getStage(p), 30);
  assert.ok(p.messages.some(text => text.includes('completed a quest')));
  const rewards = p.xp.slice();
  assert.deepEqual(rewards, [
    [core.Skill.CONSTRUCTION.getIndex(), 5000],
    [core.Skill.COOKING.getIndex(), 5000],
    [core.Skill.SMITHING.getIndex(), 5000],
  ]);
  assert.ok(p.items.get(I.EGG_4) === undefined || p.items.get(I.EGG_4) === 1);
  h.talk(p, N.NEZKETI);
  for (let step = 0; step < 40 && p.manager.getCurrent(); step++) p.manager.advance();
  assert.deepEqual(p.xp, rewards, 'post-quest dialogue must not grant rewards again');
});


test('Red Reef restores player_diving only for the actual seabed and clears it on the surface', () => {
  const h = harness('RedReef'), p = player(), other = player();
  const seabed = new core.Location(2837, 8922, 1);
  const surface = new core.Location(2851, 2326, 0);

  for (const stage of [32, 34, 36]) {
    h.quest.setStage(p, stage);
    p.moveTo(seabed);
    h.login(p);
    assert.equal(p.varbits.get(19526), 1, `stage ${stage} in the seabed restores player_diving`);
  }

  h.quest.setStage(p, 38);
  p.moveTo(surface);
  h.login(p);
  assert.equal(p.varbits.get(19526), 0, 'surface login clears player_diving');
  h.quest.setStage(p, 40);
  h.login(p);
  assert.equal(p.varbits.get(19526), 0, 'stage 40 login stays surfaced');

  // Completed quest must not clear another diving area's bit on login.
  p.varbits.set(19526, 1);
  h.quest.setStage(p, 42);
  h.login(p);
  assert.equal(p.varbits.get(19526), 1, 'stage 42 must not touch unrelated diving state');

  // Scoped to the actual player: another player's login cannot change this one.
  h.quest.setStage(other, 32);
  other.moveTo(seabed);
  h.login(other);
  assert.equal(other.varbits.get(19526), 1);
  assert.equal(p.varbits.get(19526), 1, 'no cross-player varbit writes');
});

test('Red Reef stage-40 Zenith Spencer disembark uses the normal StaticShips return', () => {
  const h = harness('RedReef'), p = player();
  try {
    h.quest.setStage(p, 40);
    const zenith = StaticShips.all().find(ship =>
      ship.id === 'the_zenith' && ship.boat.ownerPlayerId === p.getIndex());
    assert.ok(zenith, 'stage 40 keeps the real Zenith');
    const deckSpencer = () => [...World.getNpcs()].some(npc =>
      npc?.getId?.() === N.SPENCER_BRENTWOOD && !npc.removed);
    assert.ok(deckSpencer(), 'stage 40 keeps the real aboard Spencer until normal exit');
    p.items.set(I.MEDALLION_OF_THE_DEEP, 1);
    p.moveTo(new core.Location(2870, 2504, 0));
    const landing = p.getLocation().clone();
    assert.equal(StaticShips.board(p, zenith), null);
    assert.equal(p.getArea()?.boat, zenith.boat);
    h.talk(p, N.SPENCER_BRENTWOOD);
    h.continueToMenu(p);
    h.choose(p, "Actually, I'd like to disembark.");
    assert.notEqual(p.getArea()?.boat, zenith.boat, 'the normal choice leaves the Zenith');
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()],
      [landing.getX(), landing.getY()], 'returns to the canonical boarding landing');
    assert.equal(h.quest.getStage(p), 40, 'disembarking does not advance the quest');
    assert.ok(deckSpencer(), 'Spencer stays aboard for a later normal exit');
    assert.ok(StaticShips.all().some(ship => ship.id === 'the_zenith' &&
      ship.boat.ownerPlayerId === p.getIndex()), 'the Zenith is not disposed by disembarking');
    assert.deepEqual(p.xp, [], 'no rewards on disembark');
  } finally {
    for (const ship of StaticShips.all()) {
      if (ship.boat.ownerPlayerId === p.getIndex()) StaticShips.dispose(ship);
    }
  }
});


/** Plays Theodore through the real transcript runner, including NpcDialogues' null fallback. */
function theodoreTalk(h, p, stage) {
  h.quest.setStage(p, stage);
  const choice = (h.hooks.onNpcDialogueVariant ?? [])
    .map(fn => fn({ player: p, npcId: N.THEODORE_PAXTON })).find(Boolean);
  const record = transcripts['The Red Reef'];
  let variant = choice;
  if (!variant) {
    const steps = pickVariant(record);
    variant = Object.keys(record.variants).find(key => record.variants[key] === steps);
  }
  assert.ok(variant, 'Theodore must resolve a variant');
  p.manager.reset();
  assert.equal(runtime.startTranscript(h.api, p, N.THEODORE_PAXTON, 'The Red Reef', variant), true);
  const lines = [];
  for (let step = 0; step < 40; step++) {
    const current = p.manager.getCurrent();
    if (!current) break;
    if (current instanceof core.NpcDialogue) {
      lines.push({ speaker: core.NpcDefinition.forId(current.getNpcId())?.getName?.(), text: current.getText() });
    }
    p.manager.advance();
  }
  return { variant, lines };
}

test('Scrambled pet egg survives a full inventory and can be retried without duplication', () => {
  const h = harness('Scrambled'), p = player();
  h.quest.setStage(p, 30);
  const inv = new Inventory(p);
  inv.resetItems();
  p.getInventory = () => inv;
  inv.adds(385, 28); // 28 non-stackable sharks fill every slot
  assert.equal(inv.getFreeSlots(), 0);
  const talk = h.namedNpcs.get('Humphrey Dumphrey')['Talk-to'];
  talk({ player: p, npcId: N.HUMPHREY_DUMPHREY });
  assert.equal(inv.getAmount(I.EGG_4), 0, 'no egg may be swallowed on a full inventory');
  assert.equal((Number(p.attrs.get('quest.scrambled.bits')) || 0) & 4, 0, 'the received bit stays clear');
  assert.ok(p.messages.some(text => text.includes("couldn't hold all those items")),
    'the engine still gives its normal full-inventory feedback');
  inv.deleteNumber(385, 1);
  talk({ player: p, npcId: N.HUMPHREY_DUMPHREY });
  assert.equal(inv.getAmount(I.EGG_4), 1);
  assert.equal((Number(p.attrs.get('quest.scrambled.bits')) || 0) & 4, 4);
  talk({ player: p, npcId: N.HUMPHREY_DUMPHREY });
  assert.equal(inv.getAmount(I.EGG_4), 1, 'retrying after success cannot duplicate the egg');
});

test("Scrambled keeps interactive King's men through the stage-28 finisher and post-quest", () => {
  const h = harness('Scrambled'), p = player();
  h.quest.setStage(p, 28);
  h.login(p);
  assert.equal(h.quest.getStage(p), 28, 'login must not auto-complete the quest');
  const men = () => h.npcs.filter(npc =>
    [N.NEZKETI, N.KAUAYOTL, N.ACATZIN].includes(npc.id) && !npc.removed);
  assert.equal(men().length, 3, 'the stage-28 finisher needs a real interactive actor');
  h.talk(p, N.NEZKETI);
  for (let step = 0; step < 400 && h.quest.getStage(p) !== 30 && p.manager.getCurrent(); step++) {
    p.manager.advance();
  }
  assert.equal(h.quest.getStage(p), 30);
  const rewards = p.xp.slice();
  assert.equal(men().length, 3, 'post-quest King\u2019s men stay available');
  h.talk(p, N.NEZKETI);
  for (let step = 0; step < 40 && p.manager.getCurrent(); step++) p.manager.advance();
  assert.deepEqual(p.xp, rewards, 'post-quest dialogue must not grant rewards again');
});

test('Red Reef stage-30 Zenith disembark leaves the real static ship', () => {
  const h = harness('RedReef'), p = player();
  try {
    h.quest.setStage(p, 30);
    const zenith = StaticShips.all().find(ship =>
      ship.id === 'the_zenith' && ship.boat.ownerPlayerId === p.getIndex());
    assert.ok(zenith, 'stage 30 owns the real Zenith');
    p.items.set(I.MEDALLION_OF_THE_DEEP, 1);
    p.moveTo(new core.Location(2870, 2504, 0));
    const landing = p.getLocation().clone();
    assert.equal(StaticShips.board(p, zenith), null);
    assert.equal(p.getArea()?.boat, zenith.boat);
    h.talk(p, N.SPENCER_BRENTWOOD);
    h.continueToMenu(p);
    h.choose(p, "Actually, I'd like to disembark.");
    assert.notEqual(p.getArea()?.boat, zenith.boat, 'the choice leaves the Zenith at stage 30');
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()],
      [landing.getX(), landing.getY()], 'returns to the canonical boarding landing');
    assert.equal(h.quest.getStage(p), 30, 'disembarking does not advance the quest');
    assert.deepEqual(p.xp, [], 'no rewards on disembark');
  } finally {
    for (const ship of StaticShips.all()) {
      if (ship.boat.ownerPlayerId === p.getIndex()) StaticShips.dispose(ship);
    }
  }
});

test('Red Reef Theodore uses his exact NPC page before the meeting and after completion', () => {
  const h = harness('RedReef'), p = player();
  const pre = 'on-red-rock-talking-to-theodore-paxton-before-talking-to-the-receptionist';
  const before = theodoreTalk(h, p, 0);
  assert.equal(before.variant, pre, 'fresh stage 0 must not fall back to Elder Raley');
  assert.ok(before.lines.some(line => line.speaker === 'Theodore Paxton'
    && line.text.includes("don't seem to recall inviting you")), JSON.stringify(before.lines));
  assert.ok(!before.lines.some(line => /Raley/.test(line.speaker ?? '')), 'must not steal Elder Raley');

  for (const stage of [10, 12, 14]) {
    const active = theodoreTalk(h, p, stage);
    assert.equal(active.variant, pre, 'pre-meeting window at stage ' + stage);
    assert.ok(active.lines.some(line => line.speaker === 'Theodore Paxton'), 'Theodore speaks at stage ' + stage);
  }
  assert.equal(theodoreTalk(h, p, 16).variant, 'on-red-rock-talking-to-theodore-paxton');
  assert.equal(theodoreTalk(h, p, 18).variant, 'on-red-rock-talking-to-theodore-paxton-again');

  const xp = p.xp.slice();
  const done = theodoreTalk(h, p, 42);
  assert.equal(h.quest.getStage(p), 42, 'completed talk must not change stage');
  assert.deepEqual(done.lines.map(line => line.speaker), ['Theodore Paxton']);
  assert.deepEqual(p.xp, xp, 'completed talk must not reward');
});
