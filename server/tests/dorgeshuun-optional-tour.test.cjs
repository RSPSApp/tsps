// From server/: node --test tests/dorgeshuun-optional-tour.test.cjs (after yarn build).
// Production PluginManager dispatch with mocked players and follower actors.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const core = PluginManager.getCoreApi();
const N = core.NpcIdentifiers;
let nextIndex = 1;
const noop = () => {};
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); new NpcDefinitionLoader().load(); });

const PAGE = 'Death to the Dorgeshuun';
const STAGE_KEY = 'quest.death_to_the_dorgeshuun.stage';
const BITS_KEY = 'quest.death_to_the_dorgeshuun.bits';

function harness() {
  const realApi = PluginManager.createApi("DorgeshuunOptionalTourTest");
  const hooks = {}, tasks = [], objects = [], npcs = [];
  const objectManager = { register: object => objects.push(object), deregister: object => { const i = objects.indexOf(object); if (i >= 0) objects.splice(i, 1); } };
  const taskManager = { submit(task) { task.setRunning(true); tasks.push(task); }, cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); } };
  const api = new Proxy({
    core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: taskManager,
      MultiChatboxPrompt: { getPending: p => p.prompt }, ObjectManager: objectManager },
    getTaskManager: () => taskManager,
    registerArea: noop,
    getObjectManager: () => objectManager,
    onCustomEvent: (key, fn) => realApi.onCustomEvent(key, fn),
    emitCustomEvent: (key, event) => realApi.emitCustomEvent(key, event),
    persistAttribute: noop,
    onNpcInteraction: (name, actions) => realApi.onNpcInteraction(name, actions),
    onNpcDialogueCondition: fn => realApi.onNpcDialogueCondition(fn),
    onNpcDialogueVariant: fn => realApi.onNpcDialogueVariant(fn),
    onPlayerLogin: fn => (hooks.onPlayerLogin ??= []).push(fn),
    onPlayerLogout: fn => (hooks.onPlayerLogout ??= []).push(fn),
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null, following = null, transformed = definition.id;
      const npc = { ...definition, getId: () => definition.id, index: nextIndex++, getLocation: () => location, moveTo: to => { location = to; },
        getArea: () => area, setArea: value => { area = value; },
        getFollowing: () => following, setFollowing: value => { following = value; }, setMobileInteraction: noop,
        setNpcTransformationId: value => { transformed = value; }, getContentId: () => transformed,
        getCurrentDefinition: player => NpcDefinition.forId(CacheDefinitions.resolveNpc(transformed, player.getPacketSender())?.id ?? transformed),
        isRegistered: () => !npc.removed, setPositionToFace: noop,
        performAnimation: noop, showHitsplat: noop, getMovementQueue: () => ({ addSteps: to => { npc.walkingTo = to; } }),
        getOwner: () => definition.owner, getCombat: () => ({ attack: player => { npc.target = player; }, reset: noop }) };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => { npc.removed = true; },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require('../plugins/quests/quests/DeathToTheDorgeshuun.Quest')(api);
  const h = { api, hooks,
    login(p) { (hooks.onPlayerLogin ?? []).forEach(fn => fn({ player: p })); },
    clearChat(p) { p.manager.reset(); p.prompt = null; },
  };
  return h;
}

function container(size) {
  let items = Array.from({ length: size }, () => new core.Item(-1, 0));
  return { getItems: () => items, setItems: next => { items = next; }, refreshItems: noop,
    get: slot => items[slot],
    getAmount: id => items.filter(item => item.getId() === id).reduce((n, item) => n + item.getAmount(), 0),
    getFreeSlots: () => items.filter(item => item.getId() < 0).length,
    isFull: () => items.every(item => item.getId() >= 0), full: noop,
    adds(id, amount) { const i = items.findIndex(item => item.getId() < 0); assert.ok(i >= 0, 'inventory full'); items[i] = new core.Item(id, amount); },
    deleteNumber(id, amount) { const i = items.findIndex(item => item.getId() === id); assert.ok(i >= 0, `missing item ${id}`); items[i] = new core.Item(-1, 0); },
  };
}

function player(stage = 0) {
  const attrs = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [], messages = [];
  let location = new core.Location(3210, 3220, 0), area = null, text = '', prompt = null;
  const inventory = container(28), equipment = container(14);
  let manager;
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; }, sendVarbit(id, value) {
      const {baseVar,startBit,endBit}=CacheDefinitions.getVarbit(id);
      const mask=(2**(endBit-startBit+1)-1)<<startBit;
      configs.set(baseVar,((configs.get(baseVar)??0)&~mask)|((value<<startBit)&mask));
      varbits.set(id, value); return packet;
    },
    getVarbit: id => varbits.get(id) ?? 0, getVarp: id => configs.get(id) ?? 0,
    sendString(value) { text = value; log.push(['text', value]); return packet; },
    sendInterfaceRemoval() { manager.reset(); prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = { attrs, configs, varbits, log, xp, messages, inventory, equipment, index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inventory,
    getEquipment: () => equipment, getPacketSender: () => packet, getDialogueManager: () => manager,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), getMaxLevel: () => 99, getCurrentLevel: () => 99 }),
    getMovementQueue: () => ({ isMovings: () => false, followX: -1, followY: -1, reset() { return this; }, addSteps(to) { location = to; return this; }, setBlockMovement() { return this; } }),
    getLocation: () => location, moveTo: to => { location = to; }, getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; },
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true, getUsername: () => 'q018', getDisplayName: () => 'q018', getIndex: () => p.index,
    setUntargetable: noop, setPositionToFace: noop, performAnimation: noop, sendMessage: value => messages.push(value),
    getCombat: () => ({ reset: noop }), getHitpoints: () => 99,
    isTeleportingReturn: () => false, isPlayerBot: () => false, isDyingReturn: () => false,
    tiles: () => [location],
    outterTiles: () => [new core.Location(location.getX()-1,location.getY(),location.getZ()),
      new core.Location(location.getX()+1,location.getY(),location.getZ())],
  };
  manager = new DialogueManager(p);
  Object.defineProperty(p, 'text', { get: () => text, set: value => { text = value; } });
  Object.defineProperty(p, 'prompt', { get: () => prompt, set: value => { prompt = value; } });
  Object.defineProperty(p, 'manager', { get: () => manager });
  attrs.set(STAGE_KEY, stage);
  return p;
}


// Production NPC dispatch and transcript playback; this only establishes the
// first conversation, not retail repeat or interruption semantics. Run this
// file in its own process: node --test tests/dorgeshuun-optional-tour.test.cjs
test('optional surface conversations use exact quest pages and preserve fallthrough', () => {
  let h, p, other;
  try {
  assert.equal(PluginManager.registerPluginCandidate({ pluginPath: 'NpcDialogues.plugin.js', pluginName: 'NpcDialoguesOptionalTour',
    plugin: require('../plugins/npcs/NpcDialogues.plugin'), dependsOn: [] }), true);
  h = harness(); p = player(2); other = player(2);
  require('../plugins/quests/quests/RestlessGhost.Quest')(PluginManager.createApi('OptionalTourRestlessGhost'));
  h.login(p);
  const starts = [];
  const emit = h.api.emitCustomEvent;
  h.api.emitCustomEvent = (name, request) => { if (name === 'npc-dialogue:start' && request.exact) starts.push(request); emit(name, request); };
  const spoken = [];
  PluginManager.createApi('OptionalTourObserve').onCustomEvent('npc-dialogue:line', event => {
    spoken.push({ player: event.player, text: event.text, speaker: event.step?.speaker, pages: event.pages });
  });
  function talk(who, id) {
    const definition = NpcDefinition.forId(id);
    const npc = { getId: () => id, getCurrentDefinition: () => definition,
      getLocation: () => who.getLocation(), getIndex: () => 999, isRegistered: () => true };
    const actionIndex = definition.getActions().indexOf('Talk-to');
    assert.notEqual(actionIndex, -1, `NPC ${id} has a Talk-to action`);
    const event = { player: who, npc, npcId: id, definition, clickType: actionIndex + 1, handled: false };
    PluginManager.emitNpcInteraction(event);
    return event;
  }
  for (const [id, variant, expected, last, kind] of [[N.MILLIE_MILLER, 'a-tour-of-lumbridge-millie-miller', 'Hello Adventurers. Welcome to Mill Lane Mill. Can I help you?', "We don't have any of those things in Dorgesh-Kaan! They sound so interesting!"],
    [N.FATHER_URHNEY, 'a-tour-of-lumbridge-father-urhney', "Go away! I'm meditating!", "I don't care! I'm still meditating!"], [N.GEE, 'a-tour-of-lumbridge-gee-or-donie', 'Hello there, can I help you?', "You'd get used to it!"],
    [N.DONIE, 'a-tour-of-lumbridge-gee-or-donie', 'Hello there, can I help you?', "You'd get used to it!"],
    [N.FRED_THE_FARMER, 'a-tour-of-lumbridge-fred-the-farmer', 'What are you doing on my land?', 'What are you doing on my land?'],
    [N.CANDLE_SELLER, 'a-tour-of-lumbridge-candle-seller', 'Do you want a lit candle for 1000 gold?', "Oh, that's good! And it's all down to the candles I sold! So do you want to buy another one?", 'menu'],
    [N.BORDER_GUARD, 'a-tour-of-lumbridge-border-guard', 'You may pass if you pay the toll, but your goblin friend must stay on this side.', "I don't think we need to go to Al Kharid anyway!", 'name'],
    [N.BORDER_GUARD_2, 'a-tour-of-lumbridge-border-guard', 'You may pass if you pay the toll, but your goblin friend must stay on this side.', "I don't think we need to go to Al Kharid anyway!", 'name']]) {
    spoken.length = 0; starts.length = 0;
    assert.equal(talk(p, id).handled, true);
    assert.equal(starts.length, 1);
    assert.equal(starts[0].npcId, id);
    assert.deepEqual(starts[0].variant, { page: PAGE, variant });
    // The border guard's transcript opens with the player's own line; its guard line follows one Continue later.
    if (kind === 'name') p.manager.advance();
    assert.ok(spoken.some(line => line.player === p && line.text === expected), `quest line for ${id}`);
    assert.equal(p.manager.getCurrent()?.getNpcId?.(), id, 'the clicked actor supplies the chathead');
    for (let i = 0; i < 30 && p.manager.getCurrent() && !(kind === 'menu' && core.MultiChatboxPrompt.getPending(p)); i++) p.manager.advance();
    if (kind === 'menu') assert.ok(core.MultiChatboxPrompt.getPending(p), `the transcript's closing menu is offered for ${id} (current ${p.manager.getCurrent()?.constructor?.name}, last spoken ${JSON.stringify(spoken.filter(line => line.player === p).slice(-2).map(line => line.text))})`);
    else assert.equal(p.manager.getCurrent(), undefined, 'conversation completes within 30 advances');
    // A transcript line can carry the player's name ("[player name]"): only its fixed ends are compared.
    assert.ok(spoken.some(line => line.player === p && (kind === 'name' ? line.text.endsWith(last) : line.text === last)), `final quest line for ${id}`);
    const expectedLines = require('../data/definitions/npc-dialogues.json')[PAGE].variants[variant].filter(step => step.type === 'line').map(step => step.text);
    const actualLines = spoken.filter(line => line.player === p).map(line => line.text);
    let position = 0;
    const fixedEnds = text => text.split('[player name]');
    const same = (actual, want) => { const [head, tail] = fixedEnds(want); return want.includes('[player name]') ? actual.startsWith(head) && actual.endsWith(tail) : actual === want; };
    for (const line of actualLines) if (position < expectedLines.length && same(line, expectedLines[position])) position++;
    assert.equal(position, expectedLines.length, `all transcript NPC lines occur in order for ${id}`);
    assert.equal(p.attrs.get(STAGE_KEY), 2, 'optional conversation preserves touring stage');
    assert.equal(p.attrs.get(BITS_KEY) ?? 0, 0, 'optional conversation preserves mandatory tour bits');
    spoken.length = 0; starts.length = 0;
    assert.equal(talk(p, N.HANS).handled, true, 'ordinary next tour interaction is reachable');
    assert.ok(spoken.some(line => line.text === 'Hello. What are you doing here?'), 'Hans uses the tour conversation');
    h.clearChat(p);
  }
  assert.equal(p.attrs.get(BITS_KEY) ?? 0, 0, 'optional conversations do not change mandatory bits');
  spoken.length = 0; starts.length = 0;
  talk(other, N.MILLIE_MILLER);
  assert.equal(starts.length, 0, 'another tour-stage player cannot use this player’s Zanik');
  h.clearChat(other);
  // An interrupted first conversation remains available in this implementation;
  // this is not evidence about the live game's repeat behavior.
  spoken.length = 0; talk(p, N.MILLIE_MILLER); h.clearChat(p);
  spoken.length = 0; talk(p, N.MILLIE_MILLER);
  assert.ok(spoken.some(line => line.text === 'Hello Adventurers. Welcome to Mill Lane Mill. Can I help you?'));
  h.clearChat(p);
  p.attrs.set(STAGE_KEY, 3); spoken.length = 0;
  assert.equal(talk(p, N.FATHER_URHNEY).handled, true);
  for (let i = 0; i < 30 && p.manager.getCurrent() && !core.MultiChatboxPrompt.getPending(p); i++) p.manager.advance();
  assert.ok(core.MultiChatboxPrompt.getPending(p), "ordinary dialogue menu must appear within 30 advances");
  assert.ok(core.MultiChatboxPrompt.getPending(p)?.options.includes("I've come to repossess your house."), 'ordinary Restless Ghost menu owns the fallback');
  h.clearChat(p);
  p.attrs.set(STAGE_KEY, 2);
  // Simulate an unanswered exact request; this does not prove a missing
  // catalogue variant, only the handler's fallthrough contract.
  h.api.emitCustomEvent = (name, request) => { if (name !== 'npc-dialogue:start' || !request.exact) emit(name, request); };
  assert.equal(talk(p, N.FATHER_URHNEY).handled, true);
  for (let i = 0; i < 30 && p.manager.getCurrent() && !core.MultiChatboxPrompt.getPending(p); i++) p.manager.advance();
  assert.ok(core.MultiChatboxPrompt.getPending(p), "ordinary dialogue menu must appear within 30 advances");
  assert.ok(core.MultiChatboxPrompt.getPending(p)?.options.includes("I've come to repossess your house."));
  } finally {
    if (p) p.manager.reset();
    if (other) other.manager.reset();
    if (h && p) for (const fn of h.hooks.onPlayerLogout ?? []) fn({ player: p });
  }
});
