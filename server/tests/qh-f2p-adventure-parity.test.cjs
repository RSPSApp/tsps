// Quest Helper source comparison for the f2p-adventure group.
// Run from server/: node --test tests/qh-f2p-adventure-parity.test.cjs (after yarn build).
// These load the production quest modules and drive the same variant/condition
// hooks the NPC dialogue runtime emits, so a stale selector fails here rather
// than only in game.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
let nextIndex = 1;
const noop = () => {};
const conditionText = new Map();

before(async () => {
  const server = path.resolve(__dirname, '..');
  await CachePipeline.initialize(server);
  new NpcDefinitionLoader().load();
  const data = JSON.parse(fs.readFileSync(path.join(server, 'data', 'definitions', 'npc-dialogues.json'), 'utf8'));
  for (const page of ['The Corsair Curse', 'Misthalin Mystery']) {
    const texts = new Map();
    const walk = value => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== 'object') return;
      if (value.type === 'condition') texts.set(value.id, value.text);
      Object.values(value).forEach(walk);
    };
    walk(data[page].variants);
    conditionText.set(page, texts);
  }
});

function harness(name) {
  const hooks = {}, events = {}, tasks = [], itemsOnGround = [], npcs = [];
  const api = new Proxy({
    core: { ...core,
      TaskManager: {
        submit(task) { task.setRunning(true); tasks.push(task); },
        cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
      },
      ObjectManager: { register: noop, deregister: noop },
      ItemOnGroundManager: { registerLocation: (...args) => itemsOnGround.push(args) },
    },
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => {
      if (key === 'quest:is-complete' && event?.key === 'big_chompy_bird_hunting') {
        event.complete = Boolean(h.bigChompy);
      }
      for (const fn of events[key] ?? []) fn(event);
    },
    spawnNpc(definition) {
      const npc = { ...definition, getId: () => definition.id, getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        moveTo: noop, getMovementQueue: () => ({ addSteps: noop }), getCombat: () => ({ attack: noop, getHitQueue: () => ({ addPendingDamage: noop }) }),
        setNpcTransformationId: noop, setPositionToFace: noop, faceTile: noop, performAnimation: noop, performGraphic: noop,
        forceChat: noop, isPlayer: () => false, isNpc: () => true, getAsNpc: () => npc, getArea: () => null,
        setArea: noop, isRegistered: () => true, getIndex: () => nextIndex++ };
      npcs.push(npc); return npc;
    },
    removeNpc(npc) { npc.removed = true; },
    registerNpcCombatMethodProvider: noop,
    registerArea: noop,
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(value => typeof value === 'function'))) });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  PluginManager.emitNpcDialogueVariant = event => {
    for (const fn of hooks.onNpcDialogueVariant ?? []) {
      const answer = fn(event);
      if (answer) return answer;
    }
    return null;
  };
  const h = { api, hooks, events, tasks, itemsOnGround, npcs, quest: runtime.getRegisteredQuests().at(-1),
    condition(event) { return PluginManager.emitNpcDialogueCondition(event); },
    variant(event) { for (const fn of hooks.onNpcDialogueVariant ?? []) { const answer = fn(event); if (answer) return answer; } return null; },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
  };
  return h;
}

function player() {
  const attrs = new Map(), items = new Map(), varbits = new Map(), configs = new Map(), log = [], xp = [];
  let location = new core.Location(3228, 3369, 0);
  const inv = {
    getAmount: id => items.get(id) ?? 0,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); },
    getFreeSlots: () => p.freeSlots ?? (p.full ? 0 : 28),
    isFull: () => (p.freeSlots ?? (p.full ? 0 : 28)) <= 0,
  };
  const packet = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendConfig(id, value) { configs.set(id, value); return packet; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    getVarp(id) { return varbits.get(id) ?? 0; },
  }, { get: (target, key) => target[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const manager = { startDialogues: noop, reset: noop, getCurrent: () => null, isActive: () => false };
  const p = { attrs, items, varbits, configs, log, xp, manager, messages: [], freeSlots: undefined, full: false, crafting: 99, cooking: 99,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inv, getEquipment: () => ({ get: () => null, deleteNumber: noop }),
    getPacketSender: () => packet, getDialogueManager: () => p.manager,
    getSkillManager: () => ({ getCurrentLevel: () => p.crafting, getCombatLevel: () => 20, addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]) }),
    getLocation: () => location, moveTo: to => { location = to; }, getArea: () => null, setArea: noop,
    setUntargetable: noop, getMovementQueue: () => ({ reset() { return this; }, setBlockMovement: noop, addSteps: noop }),
    performAnimation: noop, performGraphic: noop, sendMessage: text => p.messages.push(text),
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, getIndex: () => nextIndex++,
    isRegistered: () => true, getUsername: () => 'QhParity', getAppearance: () => ({ isMale: () => true }),
  };
  return p;
}

const corsairCondition = (h, p, npcId, stepId) =>
  h.condition({ player: p, npcId, stepId, text: conditionText.get('The Corsair Curse').get(stepId), pages: [{ page: 'The Corsair Curse' }] });
const misthalinCondition = (h, p, stepId) =>
  h.condition({ player: p, npcId: N.ABIGALE, stepId, text: conditionText.get('Misthalin Mystery').get(stepId), pages: [{ page: 'Misthalin Mystery' }] });

test("Corsair prose conditions dispatch to the QH investigation predicates", () => {
  const h = harness('CorsairCurse'), p = player();
  const thief = value => p.attrs.set('quest.the_corsair_curse.thief', value);
  thief(1); assert.equal(corsairCondition(h, p, N.ARSEN_THE_THIEF, 'EXq6K1'), true);
  thief(2); assert.equal(corsairCondition(h, p, N.ARSEN_THE_THIEF, 'EXq6K1'), false, 'relic held');
  assert.equal(corsairCondition(h, p, N.CAPTAIN_TOCK, 'EXq6K1'), null, 'another NPC must not answer it');

  thief(2); assert.equal(corsairCondition(h, p, N.ARSEN_THE_THIEF, 'pEzzRs'), true);
  thief(3); assert.equal(corsairCondition(h, p, N.ARSEN_THE_THIEF, 'pEzzRs'), false, 'tooth-pick returned');

  h.bigChompy = false;
  assert.equal(corsairCondition(h, p, N.ITHOI_THE_NAVIGATOR, 'HqAI6F'), true);
  assert.equal(corsairCondition(h, p, N.ITHOI_THE_NAVIGATOR, '_SmqOy'), false);
  assert.equal(corsairCondition(h, p, N.CABIN_BOY_COLIN, 'q6KWx3'), true);
  assert.equal(corsairCondition(h, p, N.CABIN_BOY_COLIN, 'Kk6cWa'), false);
  h.bigChompy = true;
  assert.equal(corsairCondition(h, p, N.ITHOI_THE_NAVIGATOR, 'HqAI6F'), false);
  assert.equal(corsairCondition(h, p, N.ITHOI_THE_NAVIGATOR, '_SmqOy'), true);
  assert.equal(corsairCondition(h, p, N.CABIN_BOY_COLIN, 'q6KWx3'), false);
  assert.equal(corsairCondition(h, p, N.CABIN_BOY_COLIN, 'Kk6cWa'), true);

  p.crafting = 17;
  assert.equal(corsairCondition(h, p, N.GNOCCI_THE_COOK, 'k-Ae5A'), true);
  assert.equal(corsairCondition(h, p, N.GNOCCI_THE_COOK, 'gZdLev'), false);
  p.crafting = 18;
  assert.equal(corsairCondition(h, p, N.GNOCCI_THE_COOK, 'k-Ae5A'), false);
  assert.equal(corsairCondition(h, p, N.GNOCCI_THE_COOK, 'gZdLev'), true);

  assert.equal(corsairCondition(h, p, N.GNOCCI_THE_COOK, 'Sc-0qW'), false);
  p.attrs.set('quest.the_corsair_curse.traitor', 1 << 1);
  assert.equal(corsairCondition(h, p, N.GNOCCI_THE_COOK, 'Sc-0qW'), true, 'Arsen theory heard');
});

test("Misthalin prose conditions dispatch to the QH inventory and stage predicates", () => {
  const h = harness('MisthalinMystery'), p = player();
  const cond = stepId => misthalinCondition(h, p, stepId);
  assert.equal(h.condition({ player: p, npcId: N.ABIGALE, stepId: 'Wdyx0U',
    text: conditionText.get('Misthalin Mystery').get('Wdyx0U'), pages: [{ page: 'The Corsair Curse' }] }), null,
    'conditions from another page are not answered');

  p.full = true;
  assert.equal(cond('Wdyx0U'), true);
  assert.equal(cond('io6UYK'), false);
  p.full = false;

  p.items.set(I.BUCKET, 1);
  assert.equal(cond('TF8mo0'), true);
  assert.equal(cond('Vh1jSy'), true);
  assert.equal(cond('kJLY9k'), false);
  p.items.set(I.MANOR_KEY_2, 1);
  assert.equal(cond('Vh1jSy'), false);
  assert.equal(cond('kJLY9k'), true);
  assert.equal(cond('jv36xs'), true);

  p.items.set(I.SAPPHIRE_KEY_2, 1);
  assert.equal(cond('rqIawh'), true);
  assert.equal(cond('yYJU21'), false);
  assert.equal(cond('chJAZK'), true);

  p.items.set(I.NOTES_5, 1); p.items.set(I.NOTES_6, 1); p.items.set(I.NOTES_7, 1);
  assert.equal(cond('cUhUGo'), true);
  assert.equal(cond('cTwCFK'), true);
  assert.equal(cond('2iN6Be'), true);
  p.items.set(I.KNIFE, 1); assert.equal(cond('IFjjxp'), true);
  p.items.set(I.RUBY_KEY_2, 1); assert.equal(cond('vFYc9H'), true);
  p.items.set(I.TINDERBOX, 1); assert.equal(cond('BU2aLo'), true);
  p.items.set(I.EMERALD_KEY_2, 1); assert.equal(cond('kG6bgp'), true);

  h.quest.setStage(p, 65);
  assert.equal(cond('SSJnzh'), true);
  h.quest.setStage(p, 70);
  assert.equal(cond('SSJnzh'), false);
  assert.equal(cond('UO2OqW'), true);
  h.quest.setStage(p, 75);
  assert.equal(cond('UO2OqW'), false);

  h.quest.setStage(p, 100);
  assert.equal(cond('3p3-SG'), true);
  assert.equal(cond('0ATSgO'), false);
  h.quest.setStage(p, 105);
  assert.equal(cond('3p3-SG'), false);
  assert.equal(cond('0ATSgO'), true);

  p.freeSlots = 2;
  assert.equal(cond('7i23Ik'), true);
  assert.equal(cond('HViuB4'), false);
  p.freeSlots = 3;
  assert.equal(cond('7i23Ik'), false);
  assert.equal(cond('HViuB4'), true);
});

test("Corsair stage 5 re-entry replays the initial Tock conversation, not the post-investigation one", () => {
  const h = harness('CorsairCurse'), p = player();
  h.quest.setStage(p, 1);
  assert.equal(h.variant({ player: p, npcId: N.CAPTAIN_TOCK }),
    'the-cursed-crew-talking-to-captain-tock');

  const rimmington = { getLocation: () => new core.Location(2910, 3226, 0) };
  assert.equal(h.variant({ player: p, npcId: N.CAPTAIN_TOCK_3, npc: rimmington }),
    'the-cursed-crew-talking-to-captain-tock-again');

  h.quest.setStage(p, 3);
  assert.equal(h.variant({ player: p, npcId: N.CAPTAIN_TOCK }), 'the-cursed-crew-talking-to-captain-tock-after-ithoi');
});

test('post-quest Gnocci resolves to 7970 and the real Talk-to graph plays the after variant', () => {
  const h = harness('CorsairCurse'), p = player();
  h.quest.setStage(p, 9);
  for (const fn of h.events['npc-dialogue:action'] ?? []) fn({ player: p, npcId: N.GNOCCI_THE_COOK, stepId: 'SaQ1Mg' });
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.varbits.get(6071), 60);

  const resolved = CacheDefinitions.resolveNpc(7974, p.getPacketSender());
  assert.equal(resolved?.id, N.GNOCCI_THE_COOK, '7974 is the outside post-quest multi-NPC parent');

  p.manager = new DialogueManager(p);
  let talk;
  const npcApi = {
    core: { NpcDefinition: core.NpcDefinition, StatementDialogue: core.StatementDialogue },
    emitCustomEvent: (key, event) => { for (const fn of h.events[key] ?? []) fn(event); },
    sendMultiChatboxPrompt: () => true,
    onCustomEvent: (key, fn) => (h.events[key] ??= []).push(fn),
    onAnyNpcInteraction: actions => { talk = actions['Talk-to']; },
  };
  require('../plugins/npcs/NpcDialogues.plugin.js').register(npcApi);
  const definition = core.NpcDefinition.forId(N.GNOCCI_THE_COOK);
  const play = npcId => {
    p.log.length = 0;
    assert.equal(talk({ player: p, npc: { getId: () => 7974 }, definition, npcId }), true);
    for (let guard = 0; guard < 10 && p.manager.getCurrent(); guard++) p.manager.advance();
    return p.log.filter(row => row[0] === 'sendString').map(row => String(row[1])).join('\n');
  };

  assert.match(play(resolved.id), /I'm really grateful to you for clearing up what/);
  assert.doesNotMatch(play(resolved.id), /too sick to chat/);
  assert.equal(h.quest.getStage(p), 10, 'talking does not change the completed state');
});

test('Corsair returning-Colin transcript converges on TOLD for both Big Chompy states', () => {
  const CABINBOY = 'quest.the_corsair_curse.cabinboy';
  const COOK = 'quest.the_corsair_curse.cook';
  const THIEF = 'quest.the_corsair_curse.thief';
  const NAVIGATOR = 'quest.the_corsair_curse.navigator';
  const told = "Oh. Oh, I see. Okay... I guess that means I didn't upset a mermaid after all. So the curse isn't my fault! Thank you!";
  const standalone = "He's definitely not a mermaid.";
  const branches = [
    [false, "He's definitely not a mermaid.", "I've met that ogre before."],
    [true, "I've met that ogre before. He lives with his dad in the Feldip Hills. He's definitely not a mermaid.", null],
  ];
  for (const [chompy, expectedLine, absentLine] of branches) {
    const h = harness('CorsairCurse'), p = player();
    h.bigChompy = chompy;
    p.manager = new DialogueManager(p);
    p.attrs.set(CABINBOY, 2);
    p.attrs.set(COOK, 3);
    p.attrs.set(THIEF, 6);
    p.attrs.set(NAVIGATOR, 1);
    assert.equal(runtime.startTranscript(h.api, p, N.CABIN_BOY_COLIN, 'The Corsair Curse', 'colin-s-curse-returning-to-colin'), true);
    const texts = [];
    let options = 0;
    for (let guard = 0; guard < 80 && p.manager.getCurrent(); guard++) {
      const current = p.manager.getCurrent();
      if (typeof current.getOptions === 'function') options++;
      if (typeof current.getText === 'function') texts.push(String(current.getText()));
      p.manager.advance();
    }
    const transcript = texts.join('\n').replace(/\s+/g, ' ');
    assert.equal(options, 0, `Big Chompy ${chompy}: returning Colin must not show the unrelated mermaid menu`);
    assert.ok(transcript.includes(expectedLine), `Big Chompy ${chompy}: branch line missing`);
    if (absentLine) assert.ok(!transcript.includes(absentLine), `Big Chompy ${chompy}: other branch line leaked`);
    assert.equal(texts.includes(standalone), !chompy, `Big Chompy ${chompy}: standalone non-Chompy line`);
    assert.ok(transcript.includes(told), `Big Chompy ${chompy}: TOLD line missing`);
    assert.equal(p.attrs.get(CABINBOY), 3, `Big Chompy ${chompy}: cabinboy TOLD`);
    assert.equal(p.attrs.get(COOK), 3, 'cook unchanged');
    assert.equal(p.attrs.get(THIEF), 6, 'thief unchanged');
    assert.equal(p.attrs.get(NAVIGATOR), 1, 'navigator unchanged');
  }

  const h = harness('CorsairCurse'), p = player();
  p.attrs.set(CABINBOY, 2);
  for (const fn of h.events['npc-dialogue:line'] ?? []) {
    fn({ player: p, npcId: N.GNOCCI_THE_COOK, text: told });
  }
  assert.equal(p.attrs.get(CABINBOY), 2, 'a non-Colin NPC cannot set cabinboy TOLD');
});

test('Misthalin only the riddle fireplace responds to the knife, not the manor fireplaces', () => {
  const h = harness('MisthalinMystery'), p = player();
  h.quest.setStage(p, 95);
  const knife = (objectId, x, y) => {
    const event = { player: p, itemId: I.KNIFE, objectId, definition: { id: objectId }, location: { x, y, z: 0 } };
    h.hooks.onItemOnObject[0](event);
    return event;
  };
  const decorative = knife(O.FIREPLACE_26, 1636, 4834);
  assert.equal(decorative.handled, undefined);
  assert.equal(h.quest.getStage(p), 95, 'a lit manor fireplace is not the riddle');
  const riddle = knife(O.FIREPLACE_24, 1647, 4835);
  assert.equal(riddle.handled, true);
  assert.equal(h.quest.getStage(p), 100);
});

test('Misthalin candle morphs map each base placement to its own QH varbit', () => {
  const h = harness('MisthalinMystery'), p = player();
  h.quest.setStage(p, 50);
  p.items.set(I.TINDERBOX, 1);
  const placements = [[29652, 4039, 1641, 4831], [29653, 4040, 1646, 4832], [29654, 4041, 1647, 4827], [29655, 4042, 1641, 4826]];
  for (const [placement, varbit, x, y] of placements) {
    h.hooks.onItemOnObject[0]({
      player: p, itemId: I.TINDERBOX, objectId: O.UNLIT_CANDLE,
      definition: { id: O.UNLIT_CANDLE }, object: { getId: () => placement }, location: { x, y, z: 0 },
    });
    assert.equal(p.varbits.get(varbit), 1, `placement ${placement} writes varbit ${varbit}`);
  }
  assert.equal(h.quest.getStage(p), 55);
});
