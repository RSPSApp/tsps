// The Heart of Darkness (q056) registered-dispatch contracts.
// From server/: node --test tests/qh728-q056.test.cjs
//
// Fixture starts are labelled per test: they set only the durable quest stage (and
// prerequisite completion) before dispatching the real registered NPC/object handler.
// This proves the handler contract, not a natural route. Live playthrough and the
// Quest Helper overlay are not part of this file.
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
const core = PluginManager.getCoreApi();

const PAGE = 'The Heart of Darkness';
const STAGE_VARBIT = 11117;
const START_HOOK = 'quest:the-heart-of-darkness:start';
const transcripts = [];
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};

function setup() {
  transcripts.length = 0;
  const attributes = new Map();
  const items = new Map();
  const messages = [];
  const varbits = new Map();
  const xp = [];
  const events = new Map();
  const npcActions = new Map();
  const objectActions = new Map();
  const variantHooks = [];
  const prerequisites = new Set();
  let location = new core.Location(1454, 3173, 0);

  const attach = (map, name, actions) => {
    const current = map.get(name) ?? {};
    for (const [option, handler] of Object.entries(actions ?? {})) {
      const previous = current[option];
      current[option] = previous
        ? (event) => {
            const result = previous(event);
            return result === true || event.handled ? result : handler(event);
          }
        : handler;
    }
    map.set(name, current);
  };

  const api = new Proxy({
    core,
    persistAttribute() {},
    onCustomEvent(name, handler) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      for (const handler of events.get(name) ?? []) handler(event);
    },
    onNpcInteraction(name, actions) {
      if (typeof name === 'string') attach(npcActions, name, actions);
    },
    onNpcsInteraction(names, actions) {
      for (const name of names) attach(npcActions, name, actions);
    },
    onObjectInteraction(name, actions) {
      if (typeof name === 'string') attach(objectActions, name, actions);
    },
    onNpcDialogueVariant(handler) { variantHooks.push(handler); },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  require('../plugins/quests/quests/TheHeartOfDarkness.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'the_heart_of_darkness');

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(`config:${id}`, value); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds(id, amount = 1) { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    deleteNumber(id, amount = 1) { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
    getFreeSlots: () => 28,
    isFull: () => false,
    forceAdd() { return true; },
  };
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ getItems: () => [], get: () => null }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, startDialogues() {}, reset() {} }),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      addExperiences: (skill, amount) => xp.push([typeof skill === 'number' ? skill : skill.getIndex(), amount]),
    }),
    getLocation: () => location,
    moveTo: (to) => { location = to; },
    getUsername: () => 'qh728-q056',
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
  };
  // The plugin's quest:is-complete listeners answer for Twilight's Promise; tests
  // choose which prerequisite quests are finished. Store the handler explicitly:
  // a real two-plugin test may have registered the runtime's widget hooks first.
  const completeHandlers = events.get('quest:is-complete') ?? [];
  completeHandlers.push((event) => {
    if (prerequisites.has(event.key)) event.complete = true;
  });
  events.set('quest:is-complete', completeHandlers);

  const npcOption = (name, option, npcId) => {
    const handler = npcActions.get(name)?.[option];
    if (!handler) return false;
    const event = { player, npcId, option, clickType: 1, handled: false,
      definition: { getName: () => name, getActions: () => [option, null, null, null, null] } };
    const result = handler(event);
    return event.handled === true || result === true;
  };
  const objectOption = (name, option, objectId) => {
    const handler = objectActions.get(name)?.[option];
    if (!handler) return false;
    const event = { player, objectId, handled: false, definition: { id: objectId } };
    const result = handler(event);
    return event.handled === true || result === true;
  };
  const line = (text, npcId) => {
    const event = { player, npcId, text, pages: [{ page: PAGE }] };
    for (const handler of events.get('npc-dialogue:line') ?? []) handler(event);
    event.after?.();
    return event;
  };
  const hook = (name) => {
    const event = { player, hook: name, pages: [{ page: PAGE }] };
    for (const handler of events.get('npc-dialogue:hook') ?? []) handler(event);
    return event;
  };

  const variant = (npcId) => variantHooks.map((handler) => handler({ player, npcId })).find(Boolean) ?? null;

  return {
    quest, player, attributes, items, messages, varbits, xp, prerequisites, transcripts,
    npcOption, objectOption, line, hook, variant,
    setStage: (value) => quest.setStage(player, value),
    bootstrap: () => {
      const event = { player };
      for (const handler of events.get('player:bootstrap-complete') ?? []) handler(event);
    },
  };
}

// Real PluginManager dispatch uses the same api/hook lists the server uses. This
// player only supplies the state those hooks read; no transcript or handler is stubbed.
function realPlayer() {
  const attributes = new Map();
  const items = new Map();
  const varbits = new Map();
  const messages = [];
  let location = new core.Location(1454, 3173, 0);
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(`config:${id}`, value); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });
  return {
    attributes, items, varbits, messages,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      adds(id, amount = 1) { items.set(id, (items.get(id) ?? 0) + amount); return true; },
      deleteNumber(id, amount = 1) { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
      getFreeSlots: () => 28,
      isFull: () => false,
      contains: (id) => (items.get(id) ?? 0) > 0,
    }),
    getEquipment: () => ({ getItems: () => [], get: () => null }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, startDialogues() {}, reset() {} }),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCombatLevel: () => 99, getCurrentLevel: () => 99,
      addExperiences() {} }),
    getLocation: () => location,
    moveTo: (to) => { location = to; },
    getUsername: () => 'qh728-q056-real',
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
  };
}

test('real registered order: HoD stage 74 hand-in wins, incomplete stages yield, Final Dawn starts after completion', () => {
  const api = PluginManager.createApi('qh728-q056-two-plugin');
  // The actual Quests.plugin.js order: TheFinalDawn registers before TheHeartOfDarkness.
  require('../plugins/quests/quests/TheFinalDawn.Quest')(api);
  require('../plugins/quests/quests/TheHeartOfDarkness.Quest')(api);
  const hod = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'the_heart_of_darkness');
  const player = realPlayer();
  const definition = { getName: () => 'Servius, Teokan of Ralos', getActions: () => ['Talk-to', null, null, null, null] };
  const dispatch = () => {
    transcripts.length = 0;
    const event = { player, npcId: 13694, clickType: 1, definition, handled: false,
      npc: { getCurrentDefinition: () => definition, getId: () => 13694 } };
    const handled = PluginManager.emitNpcInteraction(event);
    return { handled, event };
  };

  hod.setStage(player, 58);
  assert.equal(dispatch().handled, false, 'a neighboring HoD stage does not claim Servius');
  assert.equal(transcripts.length, 0, 'Final Dawn does not start while HoD is incomplete');

  hod.setStage(player, 74);
  const handIn = dispatch();
  assert.equal(handIn.handled, true);
  assert.deepEqual(transcripts, [{
    npcId: 13694, page: PAGE, variant: 'heart-of-the-ruins-talking-to-servius-teokan-of-ralos',
  }], 'HoD owns the stage-74 Servius conversation');

  hod.setStage(player, 76);
  const next = dispatch();
  assert.equal(next.handled, true);
  assert.deepEqual(transcripts, [{
    npcId: 13694, page: 'The Final Dawn', variant: 'infiltration-ii-talking-to-servius',
  }], 'after HoD completion Final Dawn offers its canonical start');
});

test('Prince Itzla at the Teomat dispatches the Heart of Darkness page, then stage 0 and 8 replay on login', () => {
  const h = setup();
  h.prerequisites.add('twilights_promise');

  assert.equal(h.npcOption('Prince Itzla Arkan', 'Talk-to', 12896), true,
    'the Teomat Itzla has a registered handler (he is absent from the dialogue index)');
  assert.deepEqual(h.transcripts.at(-1), { npcId: 12896, page: PAGE,
    variant: 'starting-the-quest-talking-to-prince-itzla-arkan' });

  h.hook(START_HOOK);
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.varbits.get(STAGE_VARBIT), 2);
  assert.ok(h.messages.some((text) => text.includes('The Heart of Darkness')));

  h.setStage(8);
  h.bootstrap();
  assert.equal(h.quest.getStage(h.player), 8, 'the durable stage survives the login replay');
  assert.equal(h.attributes.get('quest.the_heart_of_darkness.stage'), 8);
  assert.equal(h.varbits.get(STAGE_VARBIT), 8, 'bootstrap re-sends varbit 11117');
  assert.equal(h.varbits.get(11123), 1, 'vmq3_itzla_vis follows the saved stage');

  h.setStage(26);
  assert.equal(h.npcOption('Prince Itzla Arkan', 'Talk-to', 13690), true,
    'the disguised tower-lobby Itzla has a registered handler');
  assert.equal(h.transcripts.at(-1).variant,
    'talking-to-prince-itzla-arkan-reporting-back-to-prince-itzla-arkan');
});

test('Prince Itzla yields while Twilight\'s Promise is unfinished', () => {
  const h = setup();
  assert.equal(h.npcOption('Prince Itzla Arkan', 'Talk-to', 12896), false);
  assert.equal(h.transcripts.length, 0);
});

test('Servius completes the stage-74 hand-in once and yields the NPC after completion', () => {
  const h = setup();
  h.prerequisites.add('twilights_promise');
  h.setStage(74);

  assert.equal(h.npcOption('Servius, Teokan of Ralos', 'Talk-to', 13694), true);
  assert.equal(h.transcripts.at(-1).variant, 'heart-of-the-ruins-talking-to-servius-teokan-of-ralos');

  h.line('Timoiva, my child, and may the sun light your way.', 13694);
  assert.equal(h.quest.getStage(h.player), 76);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.xp.length, 4, 'the four 8,000 XP rewards are granted once');
  assert.ok(h.xp.every(([, amount]) => amount === 8000));

  const rewards = h.xp.length;
  h.npcOption('Servius, Teokan of Ralos', 'Talk-to', 13694);
  h.line('Timoiva, my child, and may the sun light your way.', 13694);
  assert.equal(h.xp.length, rewards, 'a repeat conversation grants no more XP');

  assert.equal(h.npcOption('Servius, Teokan of Ralos', 'Talk-to', 13694), false,
    'after completion the Heart of Darkness handler yields Servius to the shared NPC owner');
  assert.equal(h.variant(13694), null,
    'the post-quest variant selector leaves Servius on his canonical page');
});

test('the Tapoyauik temple entrance still answers after completion instead of silently doing nothing', () => {
  const h = setup();
  h.prerequisites.add('twilights_promise');
  h.setStage(76);

  assert.equal(h.objectOption('Stairs', 'Climb-down', 54525), true);
  assert.equal(h.transcripts.at(-1)?.variant,
    'heart-of-the-ruins-attempting-to-re-enter-the-ruins',
    'post-quest re-entry plays the canonical player line');
});
