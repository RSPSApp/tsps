// Fishing Contest (q041) route contract.
// From server/: node --test tests/qh728-q041.test.cjs (dist from the baseline build).
//
// The main test walks the mandatory Quest Helper legs from stage 0 through the
// trophy hand-in, dispatching the plugin's registered handlers. Recovery and
// guard tests fixture a clearly labelled stage/inventory first. Ground item
// pickups (Seers' garlic) and travel are world content, not this plugin.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

const transcripts = [];
const originalStartTranscript = runtime.startTranscript;
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};
after(() => { runtime.startTranscript = originalStartTranscript; });

const START_HOOK = 'quest:fishing-contest:start';
const PAGE = 'Fishing Contest';
const S = { STARTED: 1, COMPETING: 2, GARLIC: 3, WON: 4, COMPLETE: 5 };
const PIPE_SPOT = 4080;
const BIG_DAVE_SPOT = 4081;
const WALL_PIPE = 41;
const GATE = 48;
const GATE_HINGE = 47;
const GATE_OPEN_IDS = new Set([49, 50]);
const HEMENSTER_GATE_IDS = new Set([GATE_HINGE, GATE]);
const VINE = 58;

function setup({ withDoors = false, withTranscript = false, promptChoice = null } = {}) {
  const realCore = PluginManager.getCoreApi();
  class FakeCountdownTask {
    constructor(_player, _ticks, callback) { this.callback = callback; }
  }
  const TaskManager = { submit(task) { if (typeof task.callback === 'function') task.callback(); }, cancelTasks() {} };
  const questCore = { ...realCore, TaskManager, CountdownTask: FakeCountdownTask };
  if (withTranscript) {
    questCore.NpcDefinition = {
      forId: (id) => ({ getId: () => id, getName: () => (id === 4069 ? 'Bonzo' : undefined) }),
    };
  }
  const doorWorld = new Map();
  const doorOps = [];
  let dialogueManager = { isActive: () => false, getCurrent: () => null, reset() {} };
  let transcriptCleanup = () => {};
  if (withDoors) {
    questCore.CacheDefinitions = {
      // Keep the startup catalog scan empty; the wooden gate table is static.
      getCounts: () => ({ objects: 0 }),
      getObject: (id) => (HEMENSTER_GATE_IDS.has(id) ? { name: 'Gate' } : undefined),
    };
    questCore.MapObjects = {
      get: (id, location) => doorWorld.get(
        `${id}@${location.getX()},${location.getY()},${location.getZ()}`) ?? null,
    };
    questCore.Sounds = { sendSound() {} };
    questCore.ObjectDefinition = { forPlayer: (id) => ({ id }) };
    questCore.ObjectManager = {
      deregister: (object) => doorOps.push(['deregister', object.getId()]),
      register: (object) => doorOps.push(['register', object.getId()]),
    };
  }

  const custom = new Map();
  const variants = [];
  const conditions = [];
  const namedInteractions = new Map();
  const genericInteractions = [];
  const namedObjects = new Map();
  const itemOnObjectHandlers = [];
  const objectRoutes = [];
  const loginHandlers = [];

  const api = new Proxy({
    core: questCore,
    persistAttribute() {},
    onNpcDialogueVariant(handler) { variants.push(handler); },
    onNpcDialogueCondition(handler) { conditions.push(handler); },
    onNpcInteraction(nameOrHandler, actions) {
      if (typeof nameOrHandler === 'function') genericInteractions.push(nameOrHandler);
      else namedInteractions.set(nameOrHandler, actions);
    },
    onObjectInteraction(nameOrHandler, actions) {
      if (typeof nameOrHandler === 'function') namedObjects.set('*', nameOrHandler);
      else namedObjects.set(nameOrHandler, actions);
    },
    onItemOnObject(...args) {
      const handler = args.find((value) => typeof value === 'function');
      if (handler) itemOnObjectHandlers.push(handler);
    },
    onObjectRoute(handler) { objectRoutes.push(handler); },
    onPlayerLogin(handler) { loginHandlers.push(handler); },
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      for (const handler of custom.get(name) ?? []) handler(event);
    },
    sendMultiChatboxPrompt(_player, _prompt, ...pairs) {
      for (let index = 0; index < pairs.length; index += 2) {
        const callback = pairs[index + 1];
        if (typeof callback !== 'function') continue;
        if (promptChoice && !promptChoice.test(String(pairs[index] ?? ''))) continue;
        callback();
        return true;
      }
      return false;
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });

  require('../plugins/quests/quests/FishingContest.Quest')(api);
  if (withDoors) {
    delete require.cache[require.resolve('../plugins/objects/Doors.plugin')];
    require('../plugins/objects/Doors.plugin').register(api);
  }
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'fishing_contest');

  const attributes = new Map();
  const items = new Map();
  const messages = [];
  const configs = [];
  const varbits = [];
  const xp = [];
  let full = false;
  let location = new core.Location(2821, 3486, 0);

  const sender = new Proxy({}, { get: (_target, key) => {
    if (key === 'sendConfig') return (id, value) => { configs.push({ id, value }); return sender; };
    if (key === 'sendVarbit') return (id, value) => { varbits.push({ id, value }); return sender; };
    return () => sender;
  } });

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    adds(id, amount = 1) {
      if (full && !(items.get(id) ?? 0)) return false;
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber(id, amount = 1) {
      const left = Math.max(0, (items.get(id) ?? 0) - amount);
      if (left === 0) items.delete(id); else items.set(id, left);
      return true;
    },
    addItem(item) {
      const id = item.getId();
      const amount = item.getAmount();
      if (full && !(items.get(id) ?? 0)) return false;
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28),
    isFull: () => full,
    full() { messages.push('full'); },
  };

  const skills = {
    getCurrentLevel: (skill) => (skill === core.Skill.FISHING ? 10 : 1),
    getMaxLevel: () => 10,
    addExperiences(skill, amount) { xp.push({ skill: skill.getIndex?.() ?? skill, amount }); },
  };

  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ contains: () => false }),
    getPacketSender: () => sender,
    getSkillManager: () => skills,
    getDialogueManager: () => dialogueManager,
    getLocation: () => location,
    getPrivateArea: () => null,
    getUsername: () => 'qh728-q041', getDisplayName: () => 'qh728-q041',
    getHitpoints: () => 10,
    isRegistered: () => true,
    moveTo: (next) => { location = next; },
    performAnimation() {},
    sendMessage: (message) => messages.push(message),
  };

  if (withTranscript) {
    dialogueManager = new DialogueManager(player);
    const hooks = conditions.map((handler) => ({ pluginName: 'qh728-q041', handler }));
    PluginManager.npcDialogueConditionHooks.push(...hooks);
    transcriptCleanup = () => {
      for (const hook of hooks) {
        const index = PluginManager.npcDialogueConditionHooks.indexOf(hook);
        if (index !== -1) PluginManager.npcDialogueConditionHooks.splice(index, 1);
      }
    };
  }

  const variant = (npcId) => variants.map((handler) => handler({ player, npcId })).find(Boolean) ?? null;
  const condition = (npcId, text) => {
    for (const handler of conditions) {
      const answer = handler({ player, npcId, text });
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const action = (npcId, stepId, extra = {}) => {
    const event = { player, npcId, stepId, handled: false, ...extra };
    for (const handler of custom.get('npc-dialogue:action') ?? []) handler(event);
    return event;
  };
  const hook = (npcId, name) => {
    const event = { player, npcId, hook: name, handled: false };
    for (const handler of custom.get('npc-dialogue:hook') ?? []) handler(event);
    return event;
  };
  const line = (npcId, text) => {
    const event = { player, npcId, text, handled: false };
    for (const handler of custom.get('npc-dialogue:line') ?? []) handler(event);
    return event;
  };
  const choice = (npcId, option) => {
    const event = { player, npcId, option, handled: false };
    for (const handler of custom.get('npc-dialogue:choice') ?? []) handler(event);
    return event;
  };
  const npcInteraction = (name, npcId, option = 'Talk-to') => {
    const event = {
      player, npcId, clickType: 1, handled: false,
      definition: { getName: () => name, getActions: () => [option] },
      npc: { getLocation: () => location },
    };
    const actions = namedInteractions.get(name);
    if (actions?.[option]) actions[option](event);
    if (!event.handled) for (const handler of genericInteractions) handler(event);
    return event;
  };
  const object = (name, objectId, option, at) => {
    const event = {
      player, objectId, handled: false,
      object: { getLocation: () => new core.Location(at.x, at.y, at.z ?? 0) },
    };
    const actions = namedObjects.get(name);
    if (actions?.[option]) actions[option](event);
    return event;
  };
  const itemOnObject = (itemId, objectId, at) => {
    const event = {
      player, itemId, objectId, handled: false,
      object: { getLocation: () => new core.Location(at.x, at.y, at.z ?? 0) },
    };
    for (const handler of itemOnObjectHandlers) handler(event);
    return event;
  };
  const route = (objectId, at) => {
    const event = {
      player, objectId, clickType: 1, handled: false, destination: null,
      object: { getLocation: () => new core.Location(at.x, at.y, at.z ?? 0) },
      sourceLocation: { x: location.getX(), y: location.getY(), z: location.getZ() },
    };
    for (const handler of objectRoutes) handler(event);
    return event;
  };
  const login = () => loginHandlers.forEach((handler) => handler({ player }));
  const placeGate = (id, x, y, face = 0) => {
    const object = new realCore.GameObject(id, new realCore.Location(x, y, 0), 0, face, null);
    doorWorld.set(`${id}@${x},${y},0`, object);
    return object;
  };
  const clickGate = (id, x, y, face = 0) => {
    const object = placeGate(id, x, y, face);
    const event = {
      player, objectId: id, clickType: 1, handled: false, object,
      definition: { getName: () => 'Gate', getActions: () => ['Open'] },
      location: object.getLocation(),
    };
    const opened = namedObjects.get('Gate')?.Open?.(event) === true;
    return { event, opened };
  };
  const emit = (name, event) => {
    for (const handler of custom.get(name) ?? []) handler(event);
    return event;
  };

  const drive = (limit = 200) => {
    while (limit-- > 0 && dialogueManager.isActive()) dialogueManager.advance();
  };
  const cleanup = () => transcriptCleanup();

  return {
    quest, player, api, attributes, items, messages, configs, varbits, xp, transcripts,
    variant, condition, action, hook, line, choice, npcInteraction, object, itemOnObject, route, login, emit,
    clickGate, placeGate, doorOps, drive, cleanup,
    stage: () => quest.getStage(player),
    setStage: (value) => attributes.set('quest.fishing_contest.stage', value),
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
  };
}

test('Fishing Contest runs the mandatory route from stage 0 to completion', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  h.items.set(I.COINS, 10);
  h.items.set(I.SPADE, 1);
  h.items.set(I.GARLIC, 1);
  assert.equal(h.stage(), 0);

  // Start: the choice hook starts the quest; the transcript message hands over the pass.
  h.npcInteraction('Vestri', N.VESTRI);
  assert.equal(h.transcripts.at(-1).variant, 'starting-out-speaking-to-vestri-or-austri-to-start-the-quest');
  h.hook(N.VESTRI, START_HOOK);
  assert.equal(h.stage(), S.STARTED);
  h.action(N.VESTRI, 'DMXLo9', { kind: 'message', text: 'You got the Fishing Contest Pass!' });
  assert.equal(h.items.get(I.FISHING_PASS), 1, 'the start transcript gives the pass');
  // Replaying the message does not duplicate the pass.
  h.action(N.VESTRI, 'DMXLo9', { kind: 'message', text: 'You got the Fishing Contest Pass!' });
  assert.equal(h.items.get(I.FISHING_PASS), 1);

  // Red vine worm from the McGrubor's Woods vine (spade in the inventory).
  h.object('Vine', VINE, 'Check', { x: 2631, y: 3498 });
  assert.equal(h.items.get(I.RED_VINE_WORM), 1, 'the vine yields a red vine worm');

  // Grandpa Jack: guard conditions, then the actual hand-over message sells the rod.
  assert.equal(h.condition(N.GRANDPA_JACK, 'If the player has a fishing rod in their inventory:'), false);
  assert.equal(h.condition(N.GRANDPA_JACK, 'If the player has insufficient coins:'), false);
  assert.equal(h.condition(N.GRANDPA_JACK, 'If the player has insufficient inventory space:'), false);
  h.choice(N.GRANDPA_JACK, 'Can I buy one of your fishing rods?');
  assert.equal(h.items.get(I.COINS), 10, 'asking about a rod is not the purchase');
  assert.equal(h.items.get(I.FISHING_ROD), undefined);
  h.action(N.GRANDPA_JACK, 'qkk2D3', { kind: 'message' });
  assert.equal(h.items.get(I.COINS), 5, 'the rod costs 5 coins');
  assert.equal(h.items.get(I.FISHING_ROD), 1);

  // Morris/gate route accepts the pass and records it.
  const gate = h.route(GATE, { x: 2642, y: 3441 });
  assert.equal(gate.handled, false);
  assert.equal(h.attributes.get('fishing-contest:gate-pass-shown'), true);
  assert.equal(h.transcripts.at(-1).variant, 'entering-the-competition-clicking-on-the-gate');

  // Bonzo's entry fee.
  assert.equal(h.variant(N.BONZO).variant, 'the-contest-speaking-to-bonzo');
  h.choice(N.BONZO, "I'll enter the competition please.");
  assert.equal(h.stage(), S.COMPETING);
  assert.equal(h.items.get(I.COINS) ?? 0, 0, 'Bonzo takes the 5 coin entry fee');
  assert.equal(h.condition(N.BONZO, 'If garlic was placed in the pipes:'), false);

  // Put the garlic in the wall pipe; the stranger moves and the wire advances.
  h.itemOnObject(I.GARLIC, WALL_PIPE, { x: 2638, y: 3446 });
  assert.equal(h.items.get(I.GARLIC), undefined, 'the garlic is consumed');
  assert.equal(h.attributes.get('fishing-contest:garlic-in-pipe'), true);
  assert.equal(h.stage(), S.GARLIC);

  // Catch the winning carp beside the pipes.
  h.setLocation(2637, 3445);
  h.npcInteraction('Fishing spot', PIPE_SPOT, 'Bait');
  assert.equal(h.items.get(I.RAW_GIANT_CARP), 1, 'the pipe spot yields the raw giant carp');
  assert.equal(h.items.get(I.RED_VINE_WORM), undefined, 'the bait is consumed');

  // Bonzo takes the carp and hands over the trophy.
  assert.equal(h.variant(N.BONZO).variant, 'the-contest-speaking-to-bonzo-after-catching-a-fish');
  assert.equal(h.condition(N.BONZO, 'With the giant carp:'), true);
  const wait = h.action(N.BONZO, '3xCeSp', { kind: 'message', text: 'You wait' });
  assert.equal(wait.handled, false, 'the real "You wait" message is shown, not skipped');
  h.action(N.BONZO, 'jUkdtL', { kind: 'message', text: 'You are given the Hemenster fishing trophy!' });
  assert.equal(h.stage(), S.WON);
  assert.equal(h.items.get(I.RAW_GIANT_CARP), undefined);
  assert.equal(h.items.get(I.FISHING_TROPHY), 1);

  // Vestri finishes the quest and consumes the trophy.
  h.npcInteraction('Vestri', N.VESTRI);
  assert.equal(h.transcripts.at(-1).variant, 'returning-to-vestri-or-austri');
  h.action(N.VESTRI, 'VGuVO2', { kind: 'action', text: 'Congratulations! Quest complete!' });
  assert.equal(h.stage(), S.COMPLETE);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.items.get(I.FISHING_TROPHY), undefined);
  assert.equal(h.attributes.get('quest.points'), 1);
  assert.deepEqual(h.xp, [{ skill: core.Skill.FISHING.getIndex(), amount: 2437.5 }]);
  assert.ok(h.configs.some((entry) => entry.id === 11 && entry.value === 5),
    'completion sends the canonical varp 11 at the cache threshold 5');

  // Login/replay re-sends the saved stage on the canonical wire.
  h.configs.length = 0;
  h.login();
  assert.ok(h.configs.some((entry) => entry.id === 11 && entry.value === 5),
    'login bootstrap re-sends varp 11 = 5');
});

test('Fishing Contest rod purchase respects its transcript guards', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  h.items.set(I.COINS, 5);
  assert.equal(h.condition(N.GRANDPA_JACK, 'If the player has a fishing rod in their inventory:'), false);
  assert.equal(h.condition(N.GRANDPA_JACK, 'If the player has insufficient coins:'), false);
  h.choice(N.GRANDPA_JACK, 'Can I buy one of your fishing rods?');
  assert.equal(h.items.get(I.COINS), 5, 'the first dialogue option never charges');

  // Full inventory: the transcript's space guard is true and the message does not sell.
  h.setFull(true);
  assert.equal(h.condition(N.GRANDPA_JACK, 'If the player has insufficient inventory space:'), true);
  h.action(N.GRANDPA_JACK, 'qkk2D3', { kind: 'message' });
  assert.equal(h.items.get(I.COINS), 5);
  assert.equal(h.items.get(I.FISHING_ROD), undefined);
  h.setFull(false);

  // Already carrying a rod: refused, no second rod.
  h.items.set(I.FISHING_ROD, 1);
  assert.equal(h.condition(N.GRANDPA_JACK, 'If the player has a fishing rod in their inventory:'), true);
  h.action(N.GRANDPA_JACK, 'qkk2D3', { kind: 'message' });
  assert.equal(h.items.get(I.COINS), 5);
  assert.equal(h.items.get(I.FISHING_ROD), 1);

  // Too few coins: the transcript's coin guard is true.
  h.items.set(I.FISHING_ROD, 0);
  h.items.set(I.COINS, 4);
  assert.equal(h.condition(N.GRANDPA_JACK, 'If the player has insufficient coins:'), true);
});

test('Fishing Contest replaces a lost pass and a lost trophy on the canonical branches', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  // Fixture: started and paid, pass destroyed, no trophy.
  h.setStage(S.COMPETING);
  h.npcInteraction('Vestri', N.VESTRI);
  assert.equal(h.transcripts.at(-1).variant, 'starting-out-retrieving-another-fishing-pass-from-vestri-or-austri');
  h.choice(N.VESTRI, 'I need another competition pass.');
  assert.equal(h.items.get(I.FISHING_PASS), 1, 'Vestri replaces the lost pass');
  h.choice(N.VESTRI, 'I need another competition pass.');
  assert.equal(h.items.get(I.FISHING_PASS), 1, 'the replacement does not stack');

  // Fixture: won, trophy lost. Bonzo's spare-trophy line is the recovery route.
  h.setStage(S.WON);
  assert.equal(h.variant(N.BONZO).variant, 'the-contest-talking-to-bonzo-after-winning');
  assert.equal(h.condition(N.BONZO, 'If the fishing trophy has been lost:'), true);
  h.line(N.BONZO, "Is that all chump? Don't worry, I have a spare!");
  assert.equal(h.items.get(I.FISHING_TROPHY), 1, 'Bonzo replaces the lost trophy');
});

test('Fishing Contest unlocks the White Wolf tunnel stairs only after completion', () => {
  const h = setup();
  const climb = (at) => h.emit('ladders:climb', {
    player: h.player, handled: false,
    object: { getLocation: () => new core.Location(at.x, at.y, at.z ?? 0) },
  });

  h.setStage(S.WON);
  const locked = climb({ x: 2820, y: 3484 });
  assert.equal(locked.handled, true, 'the west tunnel stairs are blocked before completion');
  assert.ok(h.messages.some((text) => /won the Fishing Contest/.test(text)));
  assert.equal(climb({ x: 2820, y: 3500 }).handled, false, 'unrelated stairs are not blocked');

  h.setStage(S.COMPLETE);
  assert.equal(climb({ x: 2820, y: 3484 }).handled, false, 'completion unlocks the tunnel');
});

test('Fishing Contest early and competing interactions stay on their branches', () => {
  const h = setup({ withDoors: true });
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  // Stage 0, no pass: the registered Doors gate click refuses and the spots point at Bonzo.
  const gate = h.route(GATE, { x: 2642, y: 3441 });
  assert.equal(gate.handled, false);
  const gateClick = h.clickGate(GATE, 2642, 3441);
  assert.equal(gateClick.opened, true, 'Doors accepts the quest refusal');
  assert.equal(h.doorOps.length, 0, 'Doors does not open the gate');
  assert.ok(h.messages.some((text) => /start the Fishing Contest quest/.test(text)));
  assert.equal(h.attributes.get('fishing-contest:gate-pass-shown'), undefined);
  h.npcInteraction('Fishing spot', PIPE_SPOT, 'Bait');
  assert.equal(h.transcripts.at(-1).variant, 'the-contest-fishing-before-entering-the-competition');
  assert.equal(h.items.get(I.RAW_GIANT_CARP), undefined);

  // Paid but garlic not placed: the pipe spot is still the stranger's.
  h.setStage(S.COMPETING);
  h.items.set(I.RED_VINE_WORM, 1);
  h.npcInteraction('Fishing spot', PIPE_SPOT, 'Bait');
  assert.equal(h.transcripts.at(-1).variant, 'the-contest-trying-to-fish-in-the-other-spots-sinister-stranger');
  assert.equal(h.items.get(I.RAW_GIANT_CARP), undefined);

  // Someone else's spot at the fishing stage.
  h.setStage(S.GARLIC);
  h.npcInteraction('Fishing spot', BIG_DAVE_SPOT, 'Bait');
  assert.equal(h.transcripts.at(-1).variant, 'the-contest-trying-to-fish-in-the-other-spots-big-dave');
  assert.equal(h.items.get(I.RAW_GIANT_CARP), undefined);

  // Both transformed Sinister Stranger ids play the contestant page.
  assert.equal(h.variant(N.SINISTER_STRANGER).variant, 'speaking-to-the-other-contestants-sinister-stranger');
  assert.equal(h.variant(N.SINISTER_STRANGER_2).variant, 'speaking-to-the-other-contestants-sinister-stranger');
});


function transcriptSetup(promptChoice) {
  const saved = runtime.startTranscript;
  runtime.startTranscript = originalStartTranscript;
  try {
    return setup({ withTranscript: true, promptChoice });
  } finally {
    runtime.startTranscript = saved;
  }
}

test('Fishing Contest reaches the imported wait message through the real transcript with carp only', () => {
  const h = transcriptSetup(/big fish/i);
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;
  try {
    h.setStage(S.COMPETING);
    h.items.set(I.RAW_GIANT_CARP, 1);

    h.npcInteraction('Bonzo', N.BONZO);
    h.drive();

    assert.ok(h.messages.includes('You wait'), 'the real condition runner passes the carp branch and reaches 3xCeSp');
    assert.equal(h.stage(), S.WON, 'the winning hand-over after the wait completes the contest');
    assert.equal(h.items.get(I.RAW_GIANT_CARP), undefined, 'the winning carp is handed over');
    assert.equal(h.items.get(I.FISHING_TROPHY), 1);
  } finally {
    h.cleanup();
  }
});

test('Fishing Contest real transcript takes regular fish first when both fish are held', () => {
  const h = transcriptSetup(/big fish/i);
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;
  try {
    h.setStage(S.COMPETING);
    h.items.set(I.RAW_GIANT_CARP, 1);
    h.items.set(I.RAW_SARDINE, 1);

    h.npcInteraction('Bonzo', N.BONZO);
    h.drive();

    assert.equal(h.messages.includes('You wait'), false, 'H12Vw3 regular fish is chosen before O3plju carp');
    assert.equal(h.messages.includes('You hand over your catch.'), true, 'the regular fish is handed over');
    assert.equal(h.stage(), S.COMPETING, 'a regular fish does not win');
    assert.equal(h.items.get(I.FISHING_TROPHY), undefined);
    assert.equal(h.items.get(I.RAW_SARDINE), undefined);
    assert.equal(h.items.get(I.RAW_GIANT_CARP), 1, 'the carp is not consumed on the losing branch');
  } finally {
    h.cleanup();
  }
});

test('Fishing Contest only shows Morris the pass when the player owns one', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  assert.equal(h.stage(), 0);
  const noPass = h.variant(N.MORRIS);
  assert.equal(noPass.page, 'Morris');
  assert.equal(noPass.variant, 'standard-dialogue-entering-the-gate');
  h.action(N.MORRIS, 'O2HuL5', { kind: 'message', text: 'You show Morris your pass.' });
  assert.equal(h.attributes.get('fishing-contest:gate-pass-shown'), undefined,
    'the pass-show message must not mark the gate shown without the pass');

  h.setStage(S.STARTED);
  assert.equal(h.variant(N.MORRIS).variant, 'standard-dialogue-entering-the-gate',
    'a started player without the pass still gets the refusal page');
  h.items.set(I.FISHING_PASS, 1);
  assert.equal(h.variant(N.MORRIS).page, PAGE);
  assert.equal(h.variant(N.MORRIS).variant, 'entering-the-competition-talking-to-morris');
  h.action(N.MORRIS, 'O2HuL5', { kind: 'message', text: 'You show Morris your pass.' });
  assert.equal(h.attributes.get('fishing-contest:gate-pass-shown'), true);
});

test('Fishing Contest gate opens through the registered Doors dispatch only with the pass', () => {
  const h = setup({ withDoors: true });
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  h.placeGate(GATE_HINGE, 2642, 3442);

  // Started but pass lost: the shared gate handler must keep it closed.
  h.setStage(S.STARTED);
  const refused = h.clickGate(GATE, 2642, 3441);
  assert.equal(refused.opened, true, 'Doors treats the quest claim as handled');
  assert.equal(h.doorOps.length, 0, 'no hinge/extension is replaced while the gate stays shut');

  // With the pass, the quest leaves the interaction to Doors, which opens canonically.
  h.items.set(I.FISHING_PASS, 1);
  const opened = h.clickGate(GATE, 2642, 3441);
  assert.equal(opened.opened, true, 'the quest leaves a valid pass click to Doors');
  assert.deepEqual(h.doorOps.filter(([op]) => op === 'register').map(([, id]) => id).sort(), [49, 50],
    'Doors swings both Hemenster gate panels');
});

test('Fishing Contest gate lets a passless player leave from the field side', () => {
  const h = setup({ withDoors: true });
  const I = core.ItemIdentifiers;

  h.placeGate(GATE_HINGE, 2642, 3442);
  h.setStage(S.STARTED);
  h.items.set(I.FISHING_PASS, 1);

  // Enter with the pass, then lose it inside the field.
  const entered = h.clickGate(GATE, 2642, 3441);
  assert.equal(entered.opened, true);
  assert.deepEqual(h.doorOps.filter(([op]) => op === 'register').map(([, id]) => id).sort(), [49, 50]);
  h.doorOps.length = 0;
  h.messages.length = 0;
  h.items.delete(I.FISHING_PASS);
  h.setLocation(2641, 3441);

  const exited = h.clickGate(GATE, 2642, 3441);
  assert.equal(exited.opened, true, 'the field-side gate click is left to Doors');
  assert.deepEqual(h.doorOps.filter(([op]) => op === 'register').map(([, id]) => id).sort(), [49, 50],
    'Doors still swings both panels to let the player out');
  assert.equal(h.messages.some((text) => /need a fishing pass/.test(text)), false,
    'the exit is not refused for the lost pass');
});

test('Fishing Contest only claims the canonical Hemenster gate tiles', () => {
  const h = setup({ withDoors: true });

  h.setStage(S.STARTED);
  h.setLocation(2651, 3440);
  const wrongTile = h.clickGate(GATE_HINGE, 2650, 3440);
  assert.equal(wrongTile.event.handled, false, 'a synthetic 47 outside its canonical tile is not claimed');
  assert.equal(wrongTile.opened, false, 'Doors finds no gate partner there');
  assert.equal(h.messages.some((text) => /need a fishing pass|start the Fishing Contest/.test(text)), false,
    'no quest refusal is sent for a wrong-location gate');
});

test('Fishing Contest post-quest dwarves use their post-quest dialogue', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  h.setStage(S.COMPLETE);
  h.items.set(I.FISHING_PASS, 1);
  h.npcInteraction('Austri', N.AUSTRI);
  assert.deepEqual(h.transcripts.at(-1), {
    npcId: N.AUSTRI, page: 'Austri', variant: 'standard-dialogue-after-fishing-contest',
  });

  h.items.delete(I.FISHING_PASS);
  h.npcInteraction('Vestri', N.VESTRI);
  assert.deepEqual(h.transcripts.at(-1), {
    npcId: N.VESTRI, page: 'Vestri', variant: 'standard-dialogue-after-fishing-contest',
  }, 'a completed player without the pass is not offered a spare pass');

  // Before completion the active branches are preserved.
  h.setStage(S.WON);
  h.items.set(I.FISHING_TROPHY, 1);
  h.npcInteraction('Vestri', N.VESTRI);
  assert.equal(h.transcripts.at(-1).variant, 'returning-to-vestri-or-austri');
});
test('Fishing Contest native rounds stop after three catches and keep manual hand-in', async (t) => {
  const path = require('node:path');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const { SkillManager } = require('../dist/game/content/skill/SkillManager');
  const oldBots = process.env.DISABLE_PLAYER_BOTS, savedTranscript = runtime.startTranscript;
  const oldSubmit = core.TaskManager.submit, oldError = console.error;
  const tasks = new Set(), players = [], npcs = [], errors = [], clients = new Map(), messages = new Map();
  let started = false;
  process.env.DISABLE_PLAYER_BOTS = '1';
  t.after(() => {
    try {
      for (const task of tasks) if (task.isRunning()) task.stop();
      for (const npc of npcs) if (npc.isRegistered()) core.World.getNpcs().removes(npc);
      for (const player of players) {
        if (player.isRegistered()) core.World.getPlayers().removes(player);
      }
      if (started) PluginManager.emitServerShutdown({});
      for (const task of tasks) if (task.isRunning()) task.stop();
      core.World.process();
      assert.ok([...tasks].every((task) => !task.isRunning()), 'fixture tasks stopped');
      assert.ok(npcs.every((npc) => !npc.isRegistered()), 'fixture NPCs removed');
      assert.deepEqual(errors, [], 'native execution and teardown have no hidden plugin errors');
    } finally {
      core.TaskManager.submit = oldSubmit; console.error = oldError;
      runtime.startTranscript = savedTranscript;
      if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = oldBots;
    }
  });
  core.TaskManager.submit = function (...args) { if (args[0]) tasks.add(args[0]); return oldSubmit.apply(this, args); };
  console.error = (...args) => { errors.push(args.map(String).join(' ')); return oldError.apply(console, args); };
  // Earlier route tests deliberately replace this; the native case needs the actual transcript runner.
  runtime.startTranscript = originalStartTranscript;
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  const { World, Location, Item, NPC, Skill, ItemIdentifiers: I, NpcIdentifiers: N } = core;
  core.RegionManager.init(); core.RegionManager.loadMapFiles(2637, 3445);
  PluginManager.emitServerStartup({}); started = true;
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === 'fishing_contest').at(-1);
  assert.ok(quest, 'real plugin registers the quest');
  const channel = () => ({ kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  function actor(name, stage, loadedSave = null) {
    assert.match(name, /^[a-z0-9]{1,12}$/, 'fixture actor has a legal username');
    const wire = channel(), p = new Player(new PlayerSession(wire)); players.push(p);
    const client = new ClientConnection(wire); client.player = p; clients.set(p, client);
    const send = p.sendMessage.bind(p); messages.set(p, []);
    p.sendMessage = (text, ...args) => { messages.get(p).push(String(text)); return send(text, ...args); };
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name));
    if (loadedSave) loadedSave.applyToPlayer(p);
    else p.setLocation(new Location(2637, 3445, 0));
    p.setAttribute('bot-skip-persistence', true);
    assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    if (!loadedSave) {
      const skills = p.getSkillManager();
      skills.setExperience(Skill.FISHING, SkillManager.getExperienceForLevel(20));
      skills.setMaxLevel(Skill.FISHING, 20); skills.setCurrentLevel(Skill.FISHING, 20, true);
      p.getInventory().add(new Item(I.FISHING_ROD), true);
      p.getInventory().add(new Item(I.RED_VINE_WORM, 10), true);
      quest.setStage(p, stage);
    }
    return p;
  }
  function makeNpc(id, x, y) {
    const n = NPC.create(id, new Location(x, y, 0)); npcs.push(n); n.setScriptedMovement(true);
    assert.equal(World.getNpcs().add(n), true); n.needsPlacement = false; return n;
  }
  const pipe = makeNpc(4080, 2638, 3445), willow = makeNpc(4079, 2638, 3446);
  const bonzo = makeNpc(N.BONZO, 2637, 3446);
  function click(p, npc, action) {
    const definition = npc.getCurrentDefinition(p), clickType = definition.getActions().indexOf(action) + 1;
    const at = npc.getLocation();
    assert.ok(clickType > 0, `cache exposes ${action} on ${npc.getId()}`);
    // Exercise the registered hook with the native event shape; no walk-to packet is claimed.
    assert.equal(PluginManager.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), npcIndex: npc.getIndex(),
      location: { x: at.getX(), y: at.getY(), z: at.getZ() }, definition, clickType, handled: false }), true);
  }
  function ticks() { for (let i = 0; i < 4; i++) World.process(); }
  function cast(p, spot) { click(p, spot, 'Bait'); ticks(); }
  function bonzoLine(p, expected) {
    const current = p.getDialogueManager().getCurrent();
    const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();
    assert.ok(current instanceof core.NpcDialogue, 'the active result is an NPC dialogue');
    assert.equal(current.getNpcId(), N.BONZO, 'Bonzo owns the result line');
    assert.equal(p.getPacketSender().isChatboxInterface(231), true, 'Bonzo dialogue is mounted');
    assert.ok(expected.map(normalize).includes(normalize(current.getText())), 'the complete existing Bonzo line is shown');
  }
  async function drive(p) {
    const manager = p.getDialogueManager(), sender = p.getPacketSender();
    for (let i = 0; i < 30 && (manager.isActive() || MultiChatboxPrompt.getPending(p)); i++) {
      const prompt = MultiChatboxPrompt.getPending(p);
      if (prompt) {
        assert.equal(prompt.title, 'Select an option', 'the actor owns the native prompt');
        assert.equal(sender.isChatboxInterface(219), true, 'native prompt is mounted');
        assert.deepEqual(prompt.options, ['I have this big fish. Is it enough to win?', 'I think I might still be able to find a bigger fish.']);
        await clients.get(p).dispatch([{ type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: 1 }]);
        clients.get(p).processTurnPackets();
        continue;
      }
      const current = manager.getCurrent();
      if (current instanceof core.OptionDialogue) {
        const options = current.getOptions(), index = options.findIndex((text) => /big fish/i.test(text));
        assert.equal(sender.isChatboxInterface(219), true, 'native option dialogue owns the mounted chatbox');
        assert.deepEqual(options, ['I have this big fish. Is it enough to win?', 'I think I might still be able to find a bigger fish.']);
        assert.ok(index >= 0, 'native manual hand-in offers the big-fish choice');
        assert.equal(manager.handleResume((219 << 16) | 1, index + 1), true);
      } else {
        const group = [217, 231, 229, 193].find((id) => sender.isChatboxInterface(id));
        assert.ok(group, 'current native dialogue has a mounted chatbox');
        assert.equal(manager.handleResume(group << 16, 0), true);
      }
    }
    assert.equal(manager.isActive(), false, 'native dialogue finishes');
    assert.equal(MultiChatboxPrompt.getPending(p), null, 'the actor has no pending native prompt');
  }
  World.process(); for (const npc of npcs) npc.needsPlacement = false;
  const manual = actor('cntmanual', S.GARLIC);
  cast(manual, pipe);
  assert.equal(manual.getInventory().getAmount(I.RAW_GIANT_CARP), 1, 'control: actual quest Bait produces one carp');
  assert.equal(manual.getInventory().getAmount(I.RED_VINE_WORM), 9, 'control: the catch consumes bait');
  click(manual, bonzo, 'Talk-to'); await drive(manual);
  assert.equal(quest.getStage(manual), S.WON, 'control: one carp wins through Bonzo dialogue');
  assert.equal(manual.getInventory().getAmount(I.FISHING_TROPHY), 1);
  const winner = actor('cntwinner', S.GARLIC);
  cast(winner, pipe);
  assert.equal(winner.getInventory().getAmount(I.RAW_GIANT_CARP), 1, 'first catch remains in inventory');
  assert.equal(quest.getStage(winner), S.GARLIC, 'contest continues after the first catch');
  cast(winner, pipe);
  assert.equal(winner.getInventory().getAmount(I.RAW_GIANT_CARP), 2, 'first two catches remain in inventory');
  assert.equal(quest.getStage(winner), S.GARLIC, 'contest continues after two catches');
  cast(winner, pipe);
  assert.equal(winner.getInventory().getAmount(I.RED_VINE_WORM), 7, 'only three real catches consume worms');
  assert.deepEqual(errors, [], 'registered handlers and tasks report no hidden errors before the target');
  assert.equal(winner.getInventory().getAmount(I.RAW_GIANT_CARP), 0, 'third catch automatically hands over round carp');
  assert.equal(quest.getStage(winner), S.WON, 'automatic carp result awards the win');
  assert.equal(winner.getInventory().getAmount(I.FISHING_TROPHY), 1);
  bonzoLine(winner, ["We have a new winner! The heroic-looking person who was fishing by the pipes has caught the biggest carp I've seen since Grandpa Jack used to compete!"]);
  await drive(winner);
  assert.equal(winner.getInventory().getAmount(I.RAW_GIANT_CARP), 0, 'result replay does not hand over fish twice');
  assert.equal(winner.getInventory().getAmount(I.FISHING_TROPHY), 1, 'result replay awards no second trophy');
  cast(winner, pipe);
  assert.equal(winner.getInventory().getAmount(I.RED_VINE_WORM), 7, 'a won round cannot consume a fourth worm');
  const stale = actor('conteststale', S.GARLIC);
  cast(stale, pipe);
  click(stale, pipe, 'Bait');
  click(stale, bonzo, 'Talk-to'); await drive(stale); ticks();
  assert.equal(quest.getStage(stale), S.WON, 'manual win closes the round');
  assert.equal(stale.getInventory().getAmount(I.RED_VINE_WORM), 9, 'pre-win queued cast cannot consume bait later');
  assert.equal(stale.getInventory().getAmount(I.RAW_GIANT_CARP), 0, 'pre-win queued cast cannot award a later fish');
  const loser = actor('contestloser', S.COMPETING);
  loser.getInventory().add(new Item(I.RAW_SARDINE, 2), true);
  cast(loser, willow); cast(loser, willow);
  click(loser, willow, 'Bait'); click(loser, willow, 'Bait'); ticks();
  assert.equal(loser.getInventory().getAmount(I.RED_VINE_WORM), 7, 'the queued fourth cast cannot consume bait');
  assert.equal(loser.getInventory().getAmount(I.RAW_SARDINE), 2, 'automatic loss hands over no more than round fish');
  bonzoLine(loser, ['And the winner is... The stranger in black!', 'And the winner is... local favourite - Big Dave!']);
  await drive(loser);
  assert.equal(loser.getInventory().getAmount(I.RAW_SARDINE), 2, 'loss replay does not hand over another fish');
  const worms = loser.getInventory().getAmount(I.RED_VINE_WORM);
  cast(loser, willow);
  assert.equal(loser.getInventory().getAmount(I.RED_VINE_WORM), worms, 'closed round cannot catch a fourth fish');
  const guidance = "Your fishing round has ended. Use Bonzo's Pay option to start another round.";
  await t.test('a closed round explains its actual re-entry route', async () => {
    assert.equal(messages.get(loser).at(-1), guidance, 'closed Bait explains the real re-entry option');
    const closedRound = structuredClone(loser.getAttribute('fishing-contest:round'));
    click(loser, bonzo, 'Talk-to');
    assert.equal(messages.get(loser).at(-1), guidance, 'closed Talk also explains re-entry');
    assert.deepEqual(loser.getAttribute('fishing-contest:round'), closedRound, 'talking alone does not reopen or debit');
    assert.equal(loser.getInventory().getAmount(I.COINS), 0);
  });
  click(loser, bonzo, 'Pay');
  bonzoLine(loser, ["You've already paid, you don't need to pay me again!"]);
  await drive(loser);
  cast(loser, willow);
  assert.equal(loser.getInventory().getAmount(I.RAW_SARDINE), 3, 'existing Pay route reopens a lost round');

  await t.test('manual regular-fish loss closes before a queued cast', async () => {
  const mixed = actor('cntmixed', S.GARLIC);
  cast(mixed, willow); cast(mixed, pipe);
  click(mixed, pipe, 'Bait'); // a cast queued before the manual loss
  click(mixed, bonzo, 'Talk-to'); await drive(mixed); ticks();
  assert.equal(quest.getStage(mixed), S.GARLIC, 'manual regular-fish result loses, even with a carp');
  assert.equal(mixed.getInventory().getAmount(I.RAW_SARDINE), 0, 'manual regular result consumes one sardine');
  assert.equal(mixed.getInventory().getAmount(I.RAW_GIANT_CARP), 1, 'manual regular-first result preserves the carp');
  assert.equal(mixed.getInventory().getAmount(I.RED_VINE_WORM), 8, 'queued cast cannot finish after manual loss');
  click(mixed, pipe, 'Bait'); ticks();
  assert.equal(messages.get(mixed).at(-1), guidance, 'manual loss also requires re-entry');
  click(mixed, bonzo, 'Pay'); await drive(mixed);
  click(mixed, bonzo, 'Talk-to'); await drive(mixed);
  assert.equal(quest.getStage(mixed), S.WON, 'preserved carp can be handed in after re-entry');
  assert.equal(mixed.getInventory().getAmount(I.RAW_GIANT_CARP), 0);
  assert.equal(mixed.getInventory().getAmount(I.FISHING_TROPHY), 1, 'manual hand-in awards one trophy');
  });

  await t.test('a fresh paid entry resets old round and queued work', async () => {
  const reset = actor('cntreset', S.COMPETING);
  cast(reset, willow);
  click(reset, willow, 'Bait'); // stale work from the previous round
  quest.setStage(reset, S.STARTED); // explicit admin/debug stage reset, not normal quest progression
  reset.getInventory().add(new Item(I.COINS, 5), true);
  click(reset, bonzo, 'Pay'); await drive(reset); ticks();
  assert.equal(reset.getInventory().getAmount(I.COINS), 0, 'fresh entry takes the actual fee');
  assert.equal(reset.getInventory().getAmount(I.RED_VINE_WORM), 9, 'fresh entry invalidates the old pending cast');
  assert.equal(reset.getInventory().getAmount(I.RAW_SARDINE), 1, 'no stale fish is awarded after entry');
  cast(reset, willow); cast(reset, willow); cast(reset, willow);
  assert.equal(reset.getInventory().getAmount(I.RAW_SARDINE), 1, 'fresh paid entry starts a full new round');
  await drive(reset);
  });

  await t.test('a fresh paid entry clears an already-closed round', async () => {
  const closed = actor('cntclosed', S.COMPETING);
  cast(closed, willow); cast(closed, willow); cast(closed, willow);
  assert.equal(closed.getAttribute('fishing-contest:round').closed, true, 'the actual three-catch loss closed the round');
  await drive(closed);
  quest.setStage(closed, S.STARTED); // model an admin/debug reset of the quest stage
  closed.getInventory().add(new Item(I.COINS, 5), true);
  click(closed, bonzo, 'Pay'); await drive(closed);
  assert.equal(closed.getInventory().getAmount(I.COINS), 0, 'the new entry fee is paid');
  cast(closed, willow);
  assert.equal(closed.getInventory().getAmount(I.RAW_SARDINE), 1, 'paid entry reopens the formerly closed round');
  assert.equal(closed.getInventory().getAmount(I.RED_VINE_WORM), 6, 'the new cast consumes one worm');
  });

  await t.test('round survives a serialized save and logout cancels the queued cast', async () => {
  // A real logout cancels the player-keyed pending cast. Serialize the actual
  // PlayerSave through the existing JSON codec, then restore it to a new actor.
  const savedPlayer = actor('cntpersist', S.GARLIC);
  cast(savedPlayer, pipe);
  const previousTasks = new Set(tasks);
  click(savedPlayer, pipe, 'Bait');
  const pending = [...tasks].filter((task) => !previousTasks.has(task) && task.key === savedPlayer && task.isRunning());
  assert.equal(pending.length, 1, 'the old player owns an active queued cast before logout');
  assert.equal(World.getPlayers().removes(savedPlayer), true, 'native World removal runs logout');
  assert.equal(savedPlayer.isRegistered(), false);
  assert.ok(pending.every((task) => !task.isRunning()), 'real logout cancels the queued cast');
  let codec;
  require('../plugins/persistence/JsonPlayerPersistence.plugin').register({
    getSkillManager: () => SkillManager, setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
  const snapshot = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(savedPlayer), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  assert.equal(snapshot.attributes['fishing-contest:round'].catches, 1, 'actual saved round contains the first catch');
  const reloaded = actor('cntpersist', null, codec.hydratePlayerSave(snapshot));
  PluginManager.emitPlayerLogin({ player: reloaded, username: reloaded.getUsername(), isNewAccount: false });
  reloaded.needsPlacement = false;
  assert.equal(quest.getStage(reloaded), S.GARLIC, 'quest stage survives the save codec');
  assert.equal(reloaded.getAttribute('fishing-contest:round').catches, 1, 'round progress survives the save codec');
  ticks();
  assert.equal(reloaded.getInventory().getAmount(I.RED_VINE_WORM), 9, 'old queued cast does not affect the reloaded actor');
  assert.equal(reloaded.getInventory().getAmount(I.RAW_GIANT_CARP), 1);
  cast(reloaded, pipe); cast(reloaded, pipe);
  assert.equal(quest.getStage(reloaded), S.WON, 'the restored third catch finishes the round');
  assert.equal(reloaded.getInventory().getAmount(I.FISHING_TROPHY), 1);
  await drive(reloaded);
  });
  assert.deepEqual(errors, [], 'real quest and tasks do not report hidden errors');
});
