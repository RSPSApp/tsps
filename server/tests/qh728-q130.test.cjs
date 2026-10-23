// His Faithful Servants (q130) source contracts.
// From server/: node --test tests/qh728-q130.test.cjs
//
// Most cases fixture-set stages/items and dispatch registered handlers. The
// registered-runner cases also play the imported canonical transcript variants;
// these source regressions do not claim a natural live playthrough.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;

const PAGE = 'His Faithful Servants';
const INTRO = 'starting-out-talking-to-the-strange-old-man';
const WITHOUT_ICON = 'starting-out-talking-to-him-again-without-the-icon';
const WITH_ICON = 'giving-the-strange-icon';
const GIVEN_ICON_RECOVERY = 'giving-the-strange-icon-if-the-player-gives-the-strange-old-man-the-icon';
const DESTROYED_ICON_RECOVERY = 'giving-the-strange-icon-if-the-strange-old-man-destroyed-the-icon';
const CLAIM_LATER = 'giving-the-strange-icon-if-the-player-claims-the-lamp-or-map-later';

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

let activeHarness = null;
const originalConditionEmit = PluginManager.emitNpcDialogueCondition.bind(PluginManager);
PluginManager.emitNpcDialogueCondition = (event) => {
  if (activeHarness) {
    for (const handler of activeHarness.conditions) {
      const result = handler(event);
      if (typeof result === 'boolean') return result;
    }
  }
  return originalConditionEmit(event);
};

function makePlayer({ transcript = false } = {}) {
  const attrs = new Map();
  const slots = new Array(28).fill(null);
  const messages = [];
  const varbits = new Map();
  const varbitSends = [];
  const configs = new Map();
  const dialogues = [];
  const experience = new Map();
  const bankItems = new Map();
  let full = false;
  let location = new core.Location(3564, 3288, 0);
  const used = () => slots.reduce((count, item) => count + (item ? 1 : 0), 0);

  const inventory = {
    getAmount(id) {
      return slots.reduce((total, item) => total + (item?.getId?.() === id ? item.getAmount() : 0), 0);
    },
    adds(id, amount = 1) {
      if (full) return false;
      for (let i = 0; i < amount; i++) {
        const slot = slots.indexOf(null);
        if (slot === -1) return false;
        slots[slot] = new core.Item(id, 1);
      }
      return true;
    },
    forceAdd(_player, item) { return inventory.adds(item.getId(), item.getAmount()); },
    deleteNumber(id, amount = 1) {
      let left = amount;
      for (let i = 0; i < slots.length && left > 0; i++) {
        if (slots[i]?.getId?.() !== id) continue;
        slots[i] = null;
        left--;
      }
      return left === 0;
    },
    deleteAtSlot(slot) {
      if (!slots[slot]) return false;
      slots[slot] = null;
      return true;
    },
    get(slot) { return slots[slot] ?? undefined; },
    getFreeSlots() { return full ? 0 : slots.filter((item) => item === null).length; },
    isFull() { return full || used() >= slots.length; },
    full() { messages.push('Not enough space in your inventory.'); },
  };

  const stubManager = {
    isActive: () => false,
    getCurrent: () => null,
    startDialogues: (chain) => dialogues.push(chain),
  };
  let manager = null;
  const sender = new Proxy({
    sendVarbit(id, value) {
      varbits.set(id, value);
      varbitSends.push([id, value]);
      return sender;
    },
    sendConfig(id, value) { configs.set(id, value); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const player = {
    attrs, messages, varbits, varbitSends, configs, dialogues,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    setBank(id, amount) { bankItems.set(id, amount); },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getBanks: () => [{ getAmount: (id) => bankItems.get(id) ?? 0 }],
    getPacketSender: () => sender,
    getDialogueManager: () => manager ?? stubManager,
    getSkillManager: () => ({
      getExperience: (skill) => experience.get(skill) ?? 0,
      addExperience: (skill, amount) => experience.set(skill, (experience.get(skill) ?? 0) + amount),
      getMaxLevel: () => 99,
    }),
    getUsername: () => 'qh728-q130',
    getLocation: () => location,
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
  };
  if (transcript) manager = new DialogueManager(player);
  return player;
}

function harness({ priestComplete = true } = {}) {
  const events = new Map();
  const variants = [];
  const conditions = [];
  const npcRegistrations = [];
  const itemRegistrations = [];
  const bankHooks = [];
  const prompts = [];
  const emitted = [];
  const transcripts = [];
  events.set('quest:is-complete', [(request) => {
    if (request.key === 'priest_in_peril') request.complete = priestComplete;
  }]);
  const api = new Proxy({
    core,
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onNpcInteraction: (name, actions) => npcRegistrations.push({ name, actions }),
    onItemAction: (name, actions) => itemRegistrations.push({ name, actions }),
    onCanBankItem: (handler) => bankHooks.push(handler),
    onCustomEvent: (name, handler) => {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(handler);
    },
    emitCustomEvent: (name, event) => {
      emitted.push({ name, event });
      for (const handler of events.get(name) ?? []) handler(event);
    },
    sendMultiChatboxPrompt: (player, prompt, ...args) => {
      const pairs = [];
      for (let i = 0; i < args.length; i += 2) pairs.push({ text: args[i], run: args[i + 1] });
      prompts.push({
        player, prompt, args, pairs,
        yesText: pairs[0]?.text, yes: pairs[0]?.run,
        noText: pairs[1]?.text, no: pairs[1]?.run,
      });
      return true;
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const originalStart = runtime.startTranscript;
  runtime.startTranscript = (...args) => {
    transcripts.push({ npcId: args[2], page: args[3], variant: args[4] });
    return originalStart(...args);
  };
  try {
    require('../plugins/quests/quests/HisFaithfulServants.Quest')(api);
  } finally {
    runtime.startTranscript = originalStart;
  }
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'his_faithful_servants');
  const result = { events, variants, conditions, npcRegistrations, itemRegistrations, bankHooks, prompts, emitted, transcripts, quest };
  activeHarness = result;
  return result;
}

function emit(h, name, event) {
  for (const handler of h.events.get(name) ?? []) handler(event);
}

function variant(h, player, npcId = N.STRANGE_OLD_MAN) {
  for (const handler of h.variants) {
    const choice = handler({ npcId, player });
    if (choice) return choice;
  }
  return null;
}

function npcTalk(h, player) {
  for (const registration of h.npcRegistrations) {
    if (registration.name !== 'Strange Old Man') continue;
    const handler = registration.actions['Talk-to'];
    const event = {
      player, npcId: N.STRANGE_OLD_MAN, npc: { getId: () => N.STRANGE_OLD_MAN }, clickType: 1, handled: false,
    };
    return handler(event) !== false;
  }
  return false;
}

function action(h, player, stepId) {
  const event = { player, npcId: N.STRANGE_OLD_MAN, stepId, handled: false, end: false };
  emit(h, 'npc-dialogue:action', event);
  return event;
}

function line(h, player, text) {
  const event = { player, npcId: N.STRANGE_OLD_MAN, text, skip: false };
  emit(h, 'npc-dialogue:line', event);
  return event;
}

function itemAction(h, name, option, event) {
  for (const registration of h.itemRegistrations) {
    if (registration.name !== name) continue;
    const handler = registration.actions[option];
    if (handler) return handler(event);
  }
  return false;
}

function bank(h, player, item) {
  const event = { player, item, allow: true };
  for (const handler of h.bankHooks) handler(event);
  return event.allow;
}

function advanceToPrompt(h, player) {
  const manager = player.getDialogueManager();
  for (let i = 0; i < 400 && manager.isActive(); i++) manager.advance();
  return h.prompts.at(-1) ?? null;
}

function advanceToEnd(player) {
  const manager = player.getDialogueManager();
  for (let i = 0; i < 400 && manager.isActive(); i++) manager.advance();
}

function advanceUntilStage(h, player, stage) {
  const manager = player.getDialogueManager();
  for (let i = 0; i < 400; i++) {
    if (h.quest.getStage(player) >= stage) return;
    if (!manager.isActive()) break;
    manager.advance();
  }
  assert.ok(h.quest.getStage(player) >= stage, `expected stage ${stage}, got ${h.quest.getStage(player)}`);
}

function choose(h, text) {
  const prompt = h.prompts.at(-1);
  const option = prompt?.pairs.find((pair) => pair.text === text);
  assert.ok(option, `prompt option ${JSON.stringify(text)} in ${JSON.stringify(prompt?.pairs.map((p) => p.text))}`);
  option.run();
  advanceToEnd(prompt.player);
}

function cancel(player) {
  player.getDialogueManager().reset();
}

function relogin(p) {
  const next = makePlayer({ transcript: true });
  for (const [key, value] of p.attrs) next.setAttribute(key, value);
  return next;
}

test('fresh stage 0 selects the canonical intro, starts, and replays varbit 14973', () => {
  const h = harness();
  const p = makePlayer();
  assert.equal(h.quest.getStage(p), 0);
  assert.deepEqual(variant(h, p), { page: PAGE, variant: INTRO });
  assert.equal(npcTalk(h, p), true);
  assert.deepEqual(h.transcripts.at(-1), { npcId: N.STRANGE_OLD_MAN, page: PAGE, variant: INTRO });

  const first = line(h, p, "It's time.");
  first.before();
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.varbits.get(14973), 2);
  assert.equal(p.configs.has(3894), false, 'the shared parent varp is never overwritten');

  p.varbits.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(14973), 2, 'bootstrap resends the saved stage');
});

test('Priest in Peril gates the intro without stealing the standard NPC dialogue', () => {
  const h = harness({ priestComplete: false });
  const p = makePlayer();
  assert.equal(variant(h, p), null);
  assert.equal(npcTalk(h, p), false);
  const first = line(h, p, "It's time.");
  first.before?.();
  assert.equal(h.quest.getStage(p), 0);
});

test('a six-brother Barrows chest grants the strange icon once and a fifth brother does not', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 2);
  p.setAttribute('barrows', { looted: true, killed: [0, 1, 2, 3, 4, 5], chests: 1 });
  emit(h, 'collection-log:obtain', { player: p, itemId: I.MIND_RUNE, amount: 1 });
  assert.equal(p.getInventory().getAmount(I.STRANGE_ICON), 1);
  assert.equal(h.quest.getStage(p), 4);
  assert.equal(p.varbits.get(14973), 4);
  emit(h, 'collection-log:obtain', { player: p, itemId: I.CHAOS_RUNE, amount: 1 });
  assert.equal(p.getInventory().getAmount(I.STRANGE_ICON), 1, 'one icon per chest');

  const short = makePlayer();
  h.quest.setStage(short, 2);
  short.setAttribute('barrows', { looted: true, killed: [0, 1, 2, 3, 4], chests: 1 });
  emit(h, 'collection-log:obtain', { player: short, itemId: I.MIND_RUNE, amount: 1 });
  assert.equal(short.getInventory().getAmount(I.STRANGE_ICON), 0);
  assert.equal(h.quest.getStage(short), 2);

  const lost = makePlayer();
  h.quest.setStage(lost, 4);
  lost.setAttribute('barrows', { looted: true, killed: [0, 1, 2, 3, 4, 5], chests: 2 });
  emit(h, 'collection-log:obtain', { player: lost, itemId: I.MIND_RUNE, amount: 1 });
  assert.equal(lost.getInventory().getAmount(I.STRANGE_ICON), 1, 'a lost icon can be earned again');
});

test('a full bag at the icon loot keeps the run incomplete and gives the standard full message', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 2);
  p.setFull(true);
  p.setAttribute('barrows', { looted: true, killed: [0, 1, 2, 3, 4, 5], chests: 1 });
  emit(h, 'collection-log:obtain', { player: p, itemId: I.MIND_RUNE, amount: 1 });
  assert.equal(p.getInventory().getAmount(I.STRANGE_ICON), 0);
  assert.equal(h.quest.getStage(p), 2);
  assert.deepEqual(p.messages, ['Not enough space in your inventory.']);
});

test('the hand-in keeps the canonical story order and can resume at stages 6 and 8', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 4);
  p.getInventory().adds(I.STRANGE_ICON, 1);

  const given = action(h, p, 'UbCs8y');
  assert.equal(p.getInventory().getAmount(I.STRANGE_ICON), 0);
  assert.equal(h.quest.getStage(p), 6);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 0, 'stage 6 is not auto-completed');
  assert.deepEqual(given.box.items, [I.STRANGE_ICON]);

  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, GIVEN_ICON_RECOVERY);
  assert.equal(h.quest.getStage(p), 6);

  const destroyed = action(h, p, 'F5Q98i');
  assert.equal(h.quest.getStage(p), 8);
  assert.deepEqual(destroyed.box.items, [28131]);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, DESTROYED_ICON_RECOVERY);
  assert.equal(h.quest.getStage(p), 8);

  action(h, p, 'ShNyAX');
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1);
  action(h, p, 'ShNyAX');
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1, 'repeat grants no second lamp');
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1, 'repeat grants no second map');
});

test('a stage-6 interruption resumes the given-icon branch, then the destroyed-icon branch', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 6);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, GIVEN_ICON_RECOVERY);
  assert.equal(h.quest.getStage(p), 6);
  action(h, p, 'F5Q98i');
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, DESTROYED_ICON_RECOVERY);
  action(h, p, 'ShNyAX');
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1);
});

test('a stage-8 interruption resumes the destroyed-icon branch without skipping the reward', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 8);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, DESTROYED_ICON_RECOVERY);
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 0);
  action(h, p, 'ShNyAX');
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1);
});

test('a full bag at the reward stays at stage 8 and a later retry grants once', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 8);
  p.setFull(true);
  action(h, p, 'ShNyAX');
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 0);
  assert.ok(p.messages.includes('Not enough space in your inventory.'));
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, DESTROYED_ICON_RECOVERY);

  p.setFull(false);
  action(h, p, 'ShNyAX');
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1);
  action(h, p, 'ShNyAX');
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1, 'retry does not duplicate rewards');
});

test('completed-but-unclaimed rewards use claim-later and grant only the missing unused item', () => {
  const h = harness();

  const both = makePlayer();
  h.quest.setStage(both, 10);
  assert.equal(npcTalk(h, both), true);
  assert.equal(h.transcripts.at(-1).variant, CLAIM_LATER);
  action(h, both, 'QxZGeY');
  assert.equal(both.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(both.getInventory().getAmount(I.CRYPT_MAP), 1);
  action(h, both, 'QxZGeY');
  assert.equal(both.getInventory().getAmount(I.DUSTY_LAMP), 1, 'claim-later does not duplicate');

  const lampOnly = makePlayer();
  h.quest.setStage(lampOnly, 10);
  lampOnly.setAttribute('his-faithful-servants:crypt-map-studied', 1);
  assert.equal(npcTalk(h, lampOnly), true);
  assert.equal(h.transcripts.at(-1).variant, CLAIM_LATER);
  action(h, lampOnly, 'PSnOhU');
  assert.equal(lampOnly.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(lampOnly.getInventory().getAmount(I.CRYPT_MAP), 0, 'used map is not regranted');

  const mapOnly = makePlayer();
  h.quest.setStage(mapOnly, 10);
  mapOnly.setAttribute('his-faithful-servants:lamp-used', 1);
  assert.equal(npcTalk(h, mapOnly), true);
  assert.equal(h.transcripts.at(-1).variant, CLAIM_LATER);
  action(h, mapOnly, 'I0bAY_');
  assert.equal(mapOnly.getInventory().getAmount(I.CRYPT_MAP), 1);
  assert.equal(mapOnly.getInventory().getAmount(I.DUSTY_LAMP), 0, 'used lamp is not regranted');
});

test('the dusty lamp rubs for 20,000 Prayer XP and cannot be banked', () => {
  const h = harness();
  const p = makePlayer();
  p.getInventory().adds(I.DUSTY_LAMP, 1);
  const item = p.getInventory().get(0);
  assert.equal(itemAction(h, 'Dusty lamp', 'Rub', { player: p, itemId: I.DUSTY_LAMP, item, slot: 0 }), true);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].prompt, 'Use the lamp to receive 20,000 Prayer experience?');
  h.prompts[0].yes();
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 0);
  assert.equal(p.getSkillManager().getExperience(core.Skill.PRAYER), 20000);
  assert.equal(p.getAttribute('his-faithful-servants:lamp-used'), 1);
  assert.equal(bank(h, p, new core.Item(I.DUSTY_LAMP, 1)), false);
  assert.equal(bank(h, p, new core.Item(I.CRYPT_MAP, 1)), true);
});

test('a rubbed lamp is never reclaimable, including after relog or with a duplicate lamp', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 10);
  p.getInventory().adds(I.DUSTY_LAMP, 1);
  p.getInventory().adds(I.CRYPT_MAP, 1);
  const lamp = p.getInventory().get(0);
  itemAction(h, 'Dusty lamp', 'Rub', { player: p, itemId: I.DUSTY_LAMP, item: lamp, slot: 0 });
  h.prompts.at(-1).yes();
  assert.equal(p.getAttribute('his-faithful-servants:lamp-used'), 1);
  assert.equal(p.getSkillManager().getExperience(core.Skill.PRAYER), 20000);

  assert.equal(npcTalk(h, p), false, 'the used lamp is not offered again');
  p.getInventory().adds(I.DUSTY_LAMP, 1);
  const duplicate = p.getInventory().get(0);
  assert.equal(itemAction(h, 'Dusty lamp', 'Rub', { player: p, itemId: I.DUSTY_LAMP, item: duplicate, slot: 0 }), true);
  assert.equal(p.getSkillManager().getExperience(core.Skill.PRAYER), 20000);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1, 'the duplicate is left alone');
  assert.ok(p.messages.includes('You have already used the dusty lamp.'));
  p.getInventory().deleteNumber(I.DUSTY_LAMP, 1);

  const relogged = makePlayer();
  for (const [key, value] of p.attrs) relogged.setAttribute(key, value);
  relogged.getInventory().adds(I.CRYPT_MAP, 1);
  assert.equal(npcTalk(h, relogged), false);

  p.getInventory().deleteNumber(I.CRYPT_MAP, 1);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, CLAIM_LATER);
  action(h, p, 'I0bAY_');
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1, 'an unused, lost map is still claimable');
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 0, 'the used lamp is not part of that claim');
});

test('a studied map is never reclaimable, including after relog or with a duplicate map', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 10);
  p.getInventory().adds(I.CRYPT_MAP, 1);
  p.getInventory().adds(I.DUSTY_LAMP, 1);
  const map = p.getInventory().get(0);
  assert.equal(itemAction(h, 'Crypt map', 'Study', { player: p, itemId: I.CRYPT_MAP, item: map, slot: 0 }), true);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 0);
  assert.equal(p.getAttribute('his-faithful-servants:crypt-map-studied'), 1);
  assert.equal(npcTalk(h, p), false, 'the studied map is not offered again');

  p.getInventory().adds(I.CRYPT_MAP, 1);
  const duplicate = p.getInventory().get(0);
  assert.equal(itemAction(h, 'Crypt map', 'Study', { player: p, itemId: I.CRYPT_MAP, item: duplicate, slot: 0 }), true);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1, 'the duplicate is left alone');
  assert.ok(p.messages.includes('You have already studied the crypt map.'));

  const relogged = makePlayer();
  for (const [key, value] of p.attrs) relogged.setAttribute(key, value);
  relogged.getInventory().adds(I.DUSTY_LAMP, 1);
  assert.equal(npcTalk(h, relogged), false);

  p.getInventory().deleteNumber(I.DUSTY_LAMP, 1);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, CLAIM_LATER);
  action(h, p, 'PSnOhU');
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1, 'an unused, destroyed lamp is still claimable');
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1, 'the studied map is not part of that claim');
});

test('banked unused rewards are owned, not regranted', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 10);
  p.setBank(I.DUSTY_LAMP, 1);
  p.setBank(I.CRYPT_MAP, 1);
  assert.equal(npcTalk(h, p), false);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 0);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 0);
});

test('reward actions after both rewards are used grant nothing and still complete', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 8);
  p.setAttribute('his-faithful-servants:lamp-used', 1);
  p.setAttribute('his-faithful-servants:crypt-map-studied', 1);
  action(h, p, 'ShNyAX');
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 0);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 0);
});

test('studying the crypt map consumes it once, records state, and notifies Barrows', () => {
  const h = harness();
  const p = makePlayer();
  p.getInventory().adds(I.CRYPT_MAP, 1);
  const item = p.getInventory().get(0);
  assert.equal(itemAction(h, 'Crypt map', 'Study', { player: p, itemId: I.CRYPT_MAP, item, slot: 0 }), true);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 0);
  assert.equal(p.getAttribute('his-faithful-servants:crypt-map-studied'), 1);
  assert.ok(h.emitted.some((event) => event.name === 'barrows:minimap-reveal' && event.event.player === p));
  assert.equal(p.dialogues.length, 1);
});

test('registered runner: intro and without-icon variants, cancellation, re-entry and relog', () => {
  const h = harness();
  const p = makePlayer({ transcript: true });
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, INTRO);
  advanceToPrompt(h, p);
  assert.equal(h.quest.getStage(p), 2);

  cancel(p);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, WITHOUT_ICON);
  advanceToPrompt(h, p);
  choose(h, 'Can you tell me more about the brothers?');
  assert.equal(p.getInventory().getAmount(I.CRUMBLING_TOME), 1);

  const relogged = relogin(p);
  assert.equal(npcTalk(h, relogged), true);
  assert.equal(h.transcripts.at(-1).variant, WITHOUT_ICON);
  advanceToPrompt(h, relogged);
  choose(h, "Okay, I'll be back soon.");
});

test('registered runner: hand-in order, cancellation at 6/8, relog and one reward', () => {
  const h = harness();
  const p = makePlayer({ transcript: true });
  h.quest.setStage(p, 4);
  p.getInventory().adds(I.STRANGE_ICON, 1);

  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, WITH_ICON);
  advanceUntilStage(h, p, 6);
  assert.equal(h.quest.getStage(p), 6);
  assert.equal(p.getInventory().getAmount(I.STRANGE_ICON), 0);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 0, 'no reward at stage 6');
  assert.equal(h.quest.isComplete(p), false);
  cancel(p);

  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, GIVEN_ICON_RECOVERY);
  advanceUntilStage(h, p, 8);
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 0, 'no reward at stage 8');
  assert.equal(h.quest.isComplete(p), false);
  cancel(p);

  const relogged = relogin(p);
  assert.equal(npcTalk(h, relogged), true);
  assert.equal(h.transcripts.at(-1).variant, DESTROYED_ICON_RECOVERY);
  advanceUntilStage(h, relogged, 10);
  assert.equal(relogged.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(relogged.getInventory().getAmount(I.CRYPT_MAP), 1);
  advanceToEnd(relogged);
  assert.equal(npcTalk(h, relogged), false);
  assert.equal(relogged.getInventory().getAmount(I.DUSTY_LAMP), 1, 'repeat Talk-to does not duplicate');
  assert.deepEqual(
    h.transcripts.slice(-3).map((entry) => entry.variant),
    [WITH_ICON, GIVEN_ICON_RECOVERY, DESTROYED_ICON_RECOVERY]
  );
});

test('registered runner: full-bag destroyed-icon branch retries and grants once', () => {
  const h = harness();
  const p = makePlayer({ transcript: true });
  h.quest.setStage(p, 8);
  p.setFull(true);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, DESTROYED_ICON_RECOVERY);
  advanceToEnd(p);
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 0);
  assert.ok(p.messages.includes('Not enough space in your inventory.'));

  p.setFull(false);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, DESTROYED_ICON_RECOVERY);
  advanceUntilStage(h, p, 10);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1);
  advanceToEnd(p);
  assert.equal(npcTalk(h, p), false);
});

test('registered runner: claim-later conditions, cancellation, re-entry and relog', () => {
  const h = harness();
  const p = makePlayer({ transcript: true });
  h.quest.setStage(p, 10);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, CLAIM_LATER);
  cancel(p);
  assert.equal(npcTalk(h, p), true);
  assert.equal(h.transcripts.at(-1).variant, CLAIM_LATER);
  advanceToPrompt(h, p);
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1);
  choose(h, "I'll leave you to it then...");

  assert.equal(npcTalk(h, p), false, 'both claimed rewards leave the standard transcript');
  assert.equal(p.getInventory().getAmount(I.DUSTY_LAMP), 1, 're-entry does not duplicate');
  assert.equal(p.getInventory().getAmount(I.CRYPT_MAP), 1, 're-entry does not duplicate');

  const lampOnly = makePlayer({ transcript: true });
  h.quest.setStage(lampOnly, 10);
  lampOnly.setAttribute('his-faithful-servants:crypt-map-studied', 1);
  assert.equal(npcTalk(h, lampOnly), true);
  advanceToPrompt(h, lampOnly);
  assert.equal(lampOnly.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(lampOnly.getInventory().getAmount(I.CRYPT_MAP), 0);
  choose(h, "I'll leave you to it then...");

  const mapOnly = makePlayer({ transcript: true });
  h.quest.setStage(mapOnly, 10);
  mapOnly.setAttribute('his-faithful-servants:lamp-used', 1);
  assert.equal(npcTalk(h, mapOnly), true);
  advanceToPrompt(h, mapOnly);
  assert.equal(mapOnly.getInventory().getAmount(I.CRYPT_MAP), 1);
  assert.equal(mapOnly.getInventory().getAmount(I.DUSTY_LAMP), 0);
  choose(h, "I'll leave you to it then...");

  const relogged = relogin(p);
  assert.equal(npcTalk(h, relogged), true);
  assert.equal(h.transcripts.at(-1).variant, CLAIM_LATER);
  advanceToPrompt(h, relogged);
  assert.equal(relogged.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(relogged.getInventory().getAmount(I.CRYPT_MAP), 1);
});

test('Barrows minimap uses the existing processPlayer phase lifecycle only inside the crypt', () => {
  const Barrows = require('../plugins/minigames/Barrows.plugin.js');
  const { syncMinimap, phaseOf } = Barrows._test;

  const outside = makePlayer();
  syncMinimap(outside, 'outside');
  assert.equal(outside.varbitSends.length, 0, 'never overwrite another area minimap');

  const tunnels = makePlayer();
  tunnels.setLocation(3550, 9690, 0);
  assert.equal(phaseOf(tunnels), 'tunnels');
  syncMinimap(tunnels, 'tunnels');
  assert.equal(tunnels.varbits.get(6719), 2);
  syncMinimap(tunnels, 'tunnels');
  assert.equal(tunnels.varbitSends.length, 1, 'no repeat send while the phase is unchanged');

  tunnels.setAttribute('his-faithful-servants:crypt-map-studied', 1);
  syncMinimap(tunnels, 'tunnels');
  assert.equal(tunnels.varbits.get(6719), 0, 'study reveals the minimap');

  tunnels.setLocation(3564, 3288, 0);
  syncMinimap(tunnels, 'outside');
  assert.equal(tunnels.varbitSends.at(-1)[1], 0);

  const crypt = makePlayer();
  crypt.setLocation(3550, 9690, 3);
  assert.equal(phaseOf(crypt), 'crypt');
  syncMinimap(crypt, 'crypt');
  assert.equal(crypt.varbits.get(6719), 2);
});

test('Quests registers HisFaithfulServants exactly once', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../plugins/quests/Quests.plugin.js'), 'utf8');
  assert.equal((source.match(/"HisFaithfulServants"/g) ?? []).length, 1);
});
