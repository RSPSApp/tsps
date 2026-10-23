// Druidic Ritual (Quest Helper q026) source-contract checks.
// Run from server/: node --test tests/qh728-q026.test.cjs (after yarn build).
//
// The route starts at fresh stage 0 and dispatches the plugin's registered
// handlers: Kaqemeex start hook, Sanfew variant/condition hand-in, the
// Cauldron of Thunder item transform, and the Kaqemeex completion action.
// Starting inventory is fixture state (ordinary raw meats); every stage and
// item change is made by the production handlers, not by the test. These are
// handler-contract checks, not a natural playthrough or a visual QH overlay.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

const KAQEMEEX = core.NpcIdentifiers.KAQEMEEX;
const SANFEW = core.NpcIdentifiers.SANFEW;
const I = core.ItemIdentifiers;
const VARP_DRUIDIC_RITUAL = 80;
const CAULDRON_OF_THUNDER = core.ObjectIdentifiers.CAULDRON_OF_THUNDER;
const START_HOOK = 'quest:druidic-ritual:start';
const COMPLETE_ACTION = '0QWHJ-';
const HAND_IN_CONDITION = 'zWTpyU';
const ALL_MEATS_CONDITION = '5A-y0V';

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

let sender;
function makeSender() {
  const configs = new Map(), varbits = new Map();
  sender = new Proxy({
    configs,
    varbits,
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit: (id) => varbits.get(id) ?? 0,
    getVarp: (id) => configs.get(id) ?? 0,
  }, { get: (target, key) => target[key] ?? (() => sender) });
  return sender;
}

function harness() {
  const hooks = { variants: [], conditions: [], custom: new Map(), itemOnObject: [], login: [] };
  const coreApi = {
    ...core,
    CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
    TaskManager: { submit() {}, cancelTasks() {} },
  };
  const api = new Proxy({
    core: coreApi,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
    sendMultiChatboxPrompt(player, title, ...pairs) {
      player.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  require('../plugins/quests/quests/DruidicRitual.Quest')(api);
  const quest = runtime.getRegisteredQuests().find((entry) => entry.key === 'druidic_ritual');
  assert.ok(quest, 'Druidic Ritual is registered');

  const variants = (player, npcId) => {
    for (const fn of hooks.variants) {
      const result = fn({ player, npcId, npc: null, definition: { getName: () => '' } });
      if (result) return result;
    }
    return null;
  };
  const answer = (player, npcId, text) => {
    for (const fn of hooks.conditions) {
      const result = fn({ player, npcId, text, stepId: '', pages: [] });
      if (typeof result === 'boolean') return result;
    }
    return null;
  };
  const emit = (name, player, event = {}) => {
    const payload = { player, pages: [{ page: 'Druidic Ritual' }], ...event };
    for (const fn of hooks.custom.get(name) ?? []) fn(payload);
    return payload;
  };
  const startHook = (player, npcId = KAQEMEEX, hook = START_HOOK) =>
    emit('npc-dialogue:hook', player, { npcId, hook });
  const condition = (player, npcId, stepId) =>
    emit('npc-dialogue:condition', player, { npcId, stepId, text: '' });
  const action = (player, npcId, stepId) =>
    emit('npc-dialogue:action', player, { npcId, stepId, text: '', kind: 'action' });
  const itemOnObject = (player, itemId, objectId) => {
    const event = { player, itemId, objectId, handled: false };
    for (const fn of hooks.itemOnObject) fn(event);
    return event;
  };
  const login = (player) => {
    for (const fn of hooks.login) fn({ player });
  };
  const talk = (player, npcId) => {
    const variant = variants(player, npcId);
    assert.ok(variant, `no dialogue variant for ${npcId}`);
    assert.equal(runtime.startTranscript(api, player, npcId, 'Druidic Ritual', variant), true);
  };
  const choose = (player, option) => {
    assert.ok(player.prompt, `no dialogue menu for ${option}`);
    const index = player.prompt.options.indexOf(option);
    assert.notEqual(index, -1, `dialogue menu lacks ${option}: ${player.prompt.options.join(' | ')}`);
    const callback = player.prompt.pairs[index * 2 + 1];
    player.prompt = null;
    callback();
  };
  const continueToPrompt = (player) => {
    for (let index = 0; index < 20 && !player.prompt; index++) {
      if (!player.manager.getCurrent()) break;
      player.manager.advance();
    }
    assert.ok(player.prompt, 'dialogue did not reach a menu');
  };
  return { quest, variants, answer, startHook, condition, action, itemOnObject, login, talk, choose, continueToPrompt };
}

function makePlayer(attrs = new Map()) {
  const configs = makeSender().configs;
  const inventory = new Map();
  const xp = [], messages = [];
  let location = new core.Location(2925, 3486, 0);
  const player = {
    attrs,
    configs,
    inventory,
    xp,
    messages,
    getUsername: () => 'qh728-q026',
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    getDialogueManager: () => player.manager,
    sendMessage: (message) => messages.push(message),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      isFull: () => false,
      getFreeSlots: () => 28,
      adds(id, amount) { inventory.set(id, (inventory.get(id) ?? 0) + amount); },
      deleteNumber(id, amount) {
        const left = (inventory.get(id) ?? 0) - amount;
        assert.ok(left >= 0, `inventory is missing item ${id}`);
        if (left > 0) inventory.set(id, left); else inventory.delete(id);
      },
      forceAdd(id, amount) { inventory.set(id, (inventory.get(id) ?? 0) + amount); },
    }),
    getEquipment: () => ({ getItems: () => [] }),
    getSkillManager: () => ({
      addExperiences(skill, amount) { xp.push([skill.getIndex(), amount]); },
      getMaxLevel: () => 99,
    }),
    getLocation: () => location,
    moveTo: (value) => { location = value; },
    getArea: () => null,
    setArea() {},
    isRegistered: () => true,
    isPlayer: () => true,
  };
  player.manager = new DialogueManager(player);
  return player;
}

const h = harness();

test('cache ids used by the route', () => {
  assert.equal(KAQEMEEX, 5045);
  assert.equal(SANFEW, 5044);
  assert.equal(CAULDRON_OF_THUNDER, 2142);
  assert.equal(I.RAW_BEEF, 2132);
  assert.equal(I.RAW_RAT_MEAT, 2134);
  assert.equal(I.RAW_BEAR_MEAT, 2136);
  assert.equal(I.RAW_CHICKEN, 2138);
  assert.equal(I.ENCHANTED_BEEF, 522);
  assert.equal(I.ENCHANTED_RAT, 523);
  assert.equal(I.ENCHANTED_BEAR, 524);
  assert.equal(I.ENCHANTED_CHICKEN, 525);
});

test('Sanfew commits stage 2 only after the player accepts the dungeon task', () => {
  const h = harness();
  const p = makePlayer();
  h.startHook(p);
  assert.equal(h.quest.getStage(p), 1);

  h.talk(p, SANFEW);
  h.continueToPrompt(p);
  assert.equal(h.quest.getStage(p), 1, 'opening the intro does not skip the required choice');
  p.manager.reset();
  p.prompt = null;

  h.talk(p, SANFEW);
  h.continueToPrompt(p);
  h.choose(p, "Actually, I don't need to speak to you.");
  assert.equal(h.quest.getStage(p), 1, 'declining leaves the quest at the Sanfew step');
  p.manager.reset();
  p.prompt = null;

  h.talk(p, SANFEW);
  h.continueToPrompt(p);
  h.choose(p, "I've been sent to help purify the Varrock stone circle.");
  h.continueToPrompt(p);
  assert.equal(h.quest.getStage(p), 1, 'agreeing to help is not enough until the task is accepted');
  h.choose(p, "Ok, I'll go do that then.");
  assert.equal(h.quest.getStage(p), 2, 'the canonical acceptance choice advances the stage');
});

test('fresh stage 0 -> Kaqemeex start -> Sanfew -> cauldron -> hand-in -> completion', () => {
  const p = makePlayer();
  const stageAttr = 'quest.druidic_ritual.stage';
  assert.equal(h.quest.getStage(p), 0);
  assert.equal(h.variants(p, KAQEMEEX), 'starting-the-quest');
  assert.equal(h.variants(p, SANFEW), null, 'Sanfew owns no stage-0 Druidic line');

  // Kaqemeex "I'm in search of a quest." -> "Yes." carries the start hook.
  h.startHook(p);
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(p.configs.get(VARP_DRUIDIC_RITUAL), 1, 'varp 80 starts at 1');
  assert.equal(h.variants(p, KAQEMEEX), 'starting-the-quest-talking-to-kaqemeex-again');

  // Sanfew's first conversation moves the durable stage into gathering.
  h.talk(p, SANFEW);
  h.continueToPrompt(p);
  h.choose(p, "I've been sent to help purify the Varrock stone circle.");
  h.continueToPrompt(p);
  assert.equal(h.quest.getStage(p), 1, 'the gathering stage starts only after Sanfew accepts the offer');
  h.choose(p, "Ok, I'll go do that then.");
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.configs.get(VARP_DRUIDIC_RITUAL), 2);
  assert.equal(h.variants(p, SANFEW), 'gathering-the-ingredients');
  assert.equal(h.answer(p, SANFEW, "If the player doesn't have all four meats:"), true);
  assert.equal(h.answer(p, SANFEW, 'If the player does have all four meats:'), false);

  // Each raw meat becomes its enchanted item only while gathering.
  for (const [raw, enchanted] of [
    [I.RAW_BEEF, I.ENCHANTED_BEEF],
    [I.RAW_RAT_MEAT, I.ENCHANTED_RAT],
    [I.RAW_BEAR_MEAT, I.ENCHANTED_BEAR],
    [I.RAW_CHICKEN, I.ENCHANTED_CHICKEN],
  ]) {
    p.getInventory().adds(raw, 1);
    const event = h.itemOnObject(p, raw, CAULDRON_OF_THUNDER);
    assert.equal(event.handled, true);
    assert.equal(p.getInventory().getAmount(raw), 0);
    assert.equal(p.getInventory().getAmount(enchanted), 1);
  }
  assert.equal(h.quest.getStage(p), 2, 'dipping does not advance the stage');
  assert.equal(h.answer(p, SANFEW, 'If the player does have all four meats:'), true);

  // Sanfew's positive condition is the hand-in; it consumes all four.
  h.condition(p, SANFEW, HAND_IN_CONDITION);
  assert.equal(h.quest.getStage(p), 3, 'meats handed in');
  assert.equal(p.configs.get(VARP_DRUIDIC_RITUAL), 3);
  for (const id of [I.ENCHANTED_BEEF, I.ENCHANTED_RAT, I.ENCHANTED_BEAR, I.ENCHANTED_CHICKEN]) {
    assert.equal(p.getInventory().getAmount(id), 0, `hand-in consumed ${id}`);
  }

  // Between hand-in and completion Sanfew shows the canonical post-quest menu.
  assert.equal(h.variants(p, SANFEW), 'after-druidic-ritual');

  assert.equal(h.variants(p, KAQEMEEX), 'finishing-up');
  h.action(p, KAQEMEEX, COMPLETE_ACTION);
  assert.equal(h.quest.getStage(p), 4);
  assert.equal(p.configs.get(VARP_DRUIDIC_RITUAL), 4, 'varp 80 reaches the cache completion threshold');
  assert.equal(h.quest.isComplete(p), true);
  assert.deepEqual(p.xp, [[core.Skill.HERBLORE.getIndex(), 250]]);
  assert.equal(p.getAttribute('quest.points'), 4);

  // Post-quest Kaqemeex must not replay the pre-quest offer.
  assert.equal(h.variants(p, KAQEMEEX), 'after-druidic-ritual');
  // Sanfew post-quest is delegated to Eadgar's Ruse's selector (registered later).
  assert.equal(h.variants(p, SANFEW), null);

  // Repeating the completion action does not reward twice.
  h.action(p, KAQEMEEX, COMPLETE_ACTION);
  assert.equal(p.xp.length, 1);
  assert.equal(p.getAttribute('quest.points'), 4);

  // Login/relogin replays the persisted stage on the wire.
  p.configs.clear();
  h.login(p);
  assert.equal(p.getAttribute(stageAttr), 4, 'durable stage survives login');
  assert.equal(p.configs.get(VARP_DRUIDIC_RITUAL), 4, 'login re-sends varp 80 = 4');
});

test('hand-in condition without all four meats does nothing', () => {
  const p = makePlayer(new Map([['quest.druidic_ritual.stage', 2]]));
  p.getInventory().adds(I.ENCHANTED_BEEF, 1);
  assert.equal(h.answer(p, SANFEW, 'If the player does have all four meats:'), false);
  h.condition(p, SANFEW, HAND_IN_CONDITION);
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.getInventory().getAmount(I.ENCHANTED_BEEF), 1, 'partial meats are not consumed');
});

test('cauldron rejects early use and unrelated items without consuming them', () => {
  const early = makePlayer(new Map([['quest.druidic_ritual.stage', 1]]));
  early.getInventory().adds(I.RAW_BEEF, 1);
  assert.equal(h.itemOnObject(early, I.RAW_BEEF, CAULDRON_OF_THUNDER).handled, true);
  assert.equal(early.getInventory().getAmount(I.RAW_BEEF), 1, 'early dip does not consume');
  assert.equal(early.getInventory().getAmount(I.ENCHANTED_BEEF), 0);
  assert.match(early.messages.at(-1), /no reason to dip/);

  const gathering = makePlayer(new Map([['quest.druidic_ritual.stage', 2]]));
  gathering.getInventory().adds(I.RAW_BEEF, 1);
  assert.equal(h.itemOnObject(gathering, I.RAW_BEEF, 2141).handled, false, 'wrong object is ignored');
  assert.equal(gathering.getInventory().getAmount(I.RAW_BEEF), 1);
  assert.equal(h.itemOnObject(gathering, I.BONES, CAULDRON_OF_THUNDER).handled, false, 'unrelated item is ignored');
  assert.equal(gathering.getInventory().getAmount(I.BONES), 0, 'test never granted bones');
});

test('condition answering is scoped to Sanfew (no cross-quest raw-meat answers)', () => {
  const p = makePlayer();
  p.getInventory().adds(I.RAW_BEEF, 1);
  assert.equal(h.answer(p, SANFEW, 'If the player uses raw beef:'), true);
  assert.equal(h.answer(p, 12345, 'If the player uses raw beef:'), null, 'Beneath Cursed Sands condition is not ours');
});
