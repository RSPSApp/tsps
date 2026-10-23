// From server/: node --test tests/qh728-q128.test.cjs (after the baseline build).
// Focused Zogre Flesh Eaters contracts: the cache wire (varbit 487 in parent varp
// 455, completion threshold 14), the imported start/key/potion message hand-outs,
// the final artefact hand-in, and login resend for existing durable saves.
//
// Fixture-set starting stages below are declared starting states. They prove the
// registered handler contract; they are not a natural playthrough.
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
const noop = () => {};

const KEY = 'zogre_flesh_eaters';
const VARBIT_ZOGRE = 487;
const STAGE_STARTED = 2;
const STAGE_SITHIK = 4;
const STAGE_PERMANENT_SPELL = 8;
const STAGE_GIVEN_KEY = 10;
const STAGE_KILLED_SLASH_BASH = 12;
const STAGE_COMPLETE = 14;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function makePlayer(attrs = new Map()) {
  const items = new Map();
  const messages = [];
  const packets = [];
  const xp = [];
  const sender = new Proxy({}, {
    get: (_target, property) => (...args) => {
      packets.push([String(property), ...args]);
      return sender;
    },
  });
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd: (_player, item) => {
      const id = item.getId();
      items.set(id, (items.get(id) ?? 0) + item.getAmount());
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => 28 - [...items.values()].filter(amount => amount > 0).length,
    isFull: () => [...items.values()].filter(amount => amount > 0).length >= 28,
    full: noop,
  };
  const player = {
    attrs,
    items,
    messages,
    packets,
    xp,
    setStage(stage) {
      attrs.set(`quest.${KEY}.stage`, stage);
    },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, reset: noop, startDialogues: noop }),
    getFrameUpdater: () => null,
    getPrivateArea: () => null,
    getUsername: () => 'qh728-q128',
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill, amount]) }),
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
  };
  return player;
}

function harness() {
  const custom = new Map();
  const conditions = [];
  const transcripts = [];
  const logins = [];
  const spawned = [];
  const api = new Proxy({
    core,
    persistAttribute: noop,
    onNpcDialogueVariant: noop,
    onNpcDialogueCondition: handler => conditions.push(handler),
    onNpcInteraction: noop,
    onItemAction: noop,
    onItemOnNpc: noop,
    onItemOnObject: noop,
    onItemOnGroundItem: noop,
    onObjectInteraction: noop,
    onNpcDeath: noop,
    onPlayerLogin: handler => logins.push(handler),
    onCustomEvent: (name, handler) => {
      if (!custom.has(name)) custom.set(name, []);
      custom.get(name).push(handler);
    },
    emitCustomEvent: (name, payload) => {
      for (const handler of custom.get(name) ?? []) handler(payload);
    },
    spawnNpc: definition => {
      const npc = { definition, getId: () => definition.id };
      spawned.push(npc);
      return npc;
    },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return noop;
    },
  });

  const originalStartTranscript = runtime.startTranscript;
  runtime.startTranscript = (_api, player, npcId, page, variant) => {
    transcripts.push({ player, npcId, page, variant });
    return true;
  };
  try {
    require('../plugins/quests/quests/ZogreFleshEaters.Quest')(api);
  } finally {
    runtime.startTranscript = originalStartTranscript;
  }
  const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === KEY);
  const dispatch = (name, event) => {
    for (const handler of custom.get(name) ?? []) handler(event);
    return event;
  };
  const lastVarbit = (player, id) => player.packets
    .filter(([method, packetId]) => method === 'sendVarbit' && packetId === id)
    .map(([, , value]) => value)
    .at(-1);
  return { custom, conditions, transcripts, logins, spawned, quest, dispatch, lastVarbit };
}

// Runs the real transcript runner through the production PluginManager hooks.
// Starting stages and inventories are declared fixtures, not a natural route.
function registerRealRunner() {
  const pluginName = 'ZogreFleshEatersRunnerTest';
  const variantDepth = PluginManager.npcDialogueVariantHooks.length;
  const conditionDepth = PluginManager.npcDialogueConditionHooks.length;
  const customNames = new Set();
  const api = new Proxy({ core }, {
    get(target, key) {
      if (key in target) return target[key];
      switch (key) {
        case 'persistAttribute': return noop;
        case 'onNpcDialogueVariant': return handler => PluginManager.npcDialogueVariantHooks.push({ pluginName, handler });
        case 'onNpcDialogueCondition': return handler => PluginManager.npcDialogueConditionHooks.push({ pluginName, handler });
        case 'onCustomEvent': return (name, handler) => {
          customNames.add(name);
          const hooks = PluginManager.customEventHooks.get(name) ?? [];
          hooks.push({ pluginName, handler });
          PluginManager.customEventHooks.set(name, hooks);
        };
        case 'emitCustomEvent': return (name, payload) => PluginManager.emitCustomEvent(name, payload);
        case 'spawnNpc': return definition => ({ definition, getId: () => definition.id, isRegistered: () => true });
        case 'removeNpc': return noop;
        case 'getWorld': return () => ({ getNpcs: () => [] });
        default: return noop;
      }
    },
  });
  require('../plugins/quests/quests/ZogreFleshEaters.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === KEY);
  const apiForRunner = {
    core,
    emitCustomEvent: (name, payload) => PluginManager.emitCustomEvent(name, payload),
    sendMultiChatboxPrompt(player, title, ...pairs) {
      player.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
  };
  return {
    api: apiForRunner,
    quest,
    cleanup() {
      PluginManager.npcDialogueVariantHooks.length = variantDepth;
      PluginManager.npcDialogueConditionHooks.length = conditionDepth;
      for (const name of customNames) {
        const kept = (PluginManager.customEventHooks.get(name) ?? [])
          .filter(hook => hook.pluginName !== pluginName);
        if (kept.length) PluginManager.customEventHooks.set(name, kept);
        else PluginManager.customEventHooks.delete(name);
      }
    },
  };
}

function runnerPlayer({ ranged = 99 } = {}) {
  const attrs = new Map();
  const items = new Map();
  const configs = new Map();
  const varbits = new Map();
  const log = [];
  const xp = [];
  const messages = [];
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    isFull: () => false,
    getFreeSlots: () => 28,
    adds: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); },
    forceAdd: (_player, item) => { items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()); },
    deleteNumber: (id, amount = 1) => { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); },
    full: noop,
  };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendInterfaceRemoval() { p.manager?.reset?.(); p.prompt = null; return packet; },
  }, { get: (target, key) => target[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = {
    attrs, items, configs, varbits, log, xp, messages, prompt: null, text: '',
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => packet,
    getDialogueManager: () => p.manager,
    getSkillManager: () => ({
      getCurrentLevel: skill => (skill === core.Skill.RANGED ? ranged : 99),
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getLocation: () => new core.Location(2447, 3049, 0),
    getPrivateArea: () => null,
    getUsername: () => 'qh728-q128-runner',
    getIndex: () => 1,
    isRegistered: () => true,
    isPlayer: () => true,
    sendMessage: text => messages.push(text),
    getFrameUpdater: () => null,
    getUpdateFlag: () => ({ flag: noop }),
  };
  p.manager = new DialogueManager(p);
  return p;
}

function advanceToPrompt(player, limit = 200) {
  while (!player.prompt) {
    assert.ok(player.manager.getCurrent?.(), 'dialogue ended before the expected menu');
    player.manager.advance();
    assert.ok(limit-- > 0, 'dialogue stalled before a menu');
  }
}

function choose(player, text) {
  const prompt = player.prompt;
  assert.ok(prompt, `no menu open for ${text}`);
  const index = prompt.options.indexOf(text);
  assert.ok(index >= 0, `option ${text} missing from ${JSON.stringify(prompt.options)}`);
  player.prompt = null;
  prompt.pairs[index * 2 + 1]();
}

function drain(player, limit = 300) {
  while (player.manager.getCurrent?.()) {
    player.manager.advance();
    assert.ok(limit-- > 0, 'dialogue stalled');
  }
}

function metRequirements(player) {
  player.setAttribute('quest.jungle_potion.stage', 12);
  player.setAttribute('quest.big_chompy_bird_hunting.stage', 65);
}

test('registers the cache wire as varbit 487 with completion threshold 14', () => {
  const h = harness();
  assert.equal(h.quest.varbitId, VARBIT_ZOGRE, 'quest status reads varbit 487 (parent varp 455)');
  assert.equal(h.quest.varpId, undefined, 'varp 487 is not the canonical quest wire');
  assert.equal(h.quest.startedValue, STAGE_STARTED);
  assert.equal(h.quest.completionValue, STAGE_COMPLETE, 'cache DB column 19 completion threshold');
});

test('the imported Grish start message starts the quest once and hands out the food and potions', () => {
  const h = harness();
  const p = makePlayer();
  h.dispatch('npc-dialogue:action', {
    player: p, npcId: core.NpcIdentifiers.GRISH, stepId: 'luhaXl', kind: 'message', handled: false,
  });
  assert.equal(h.quest.getStage(p), STAGE_STARTED);
  assert.equal(p.items.get(core.ItemIdentifiers.COOKED_CHOMPY), 3);
  assert.equal(p.items.get(core.ItemIdentifiers.SUPER_RESTORE_3_), 2);
  assert.equal(h.lastVarbit(p, VARBIT_ZOGRE), STAGE_STARTED);

  h.dispatch('npc-dialogue:action', {
    player: p, npcId: core.NpcIdentifiers.GRISH, stepId: 'luhaXl', kind: 'message', handled: false,
  });
  assert.equal(p.items.get(core.ItemIdentifiers.COOKED_CHOMPY), 3, 'replaying the message does not duplicate the food');
  assert.equal(p.items.get(core.ItemIdentifiers.SUPER_RESTORE_3_), 2, 'replaying the message does not duplicate the potions');
});

test('the imported Grish key message advances to the given-key stage and recovers a missing key', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(STAGE_PERMANENT_SPELL);
  h.dispatch('npc-dialogue:action', {
    player: p, npcId: core.NpcIdentifiers.GRISH, stepId: 'uZirGH', kind: 'message', handled: false,
  });
  assert.equal(h.quest.getStage(p), STAGE_GIVEN_KEY);
  assert.equal(p.items.get(core.ItemIdentifiers.OGRE_GATE_KEY), 1);
  assert.equal(h.lastVarbit(p, VARBIT_ZOGRE), STAGE_GIVEN_KEY);

  h.dispatch('npc-dialogue:action', {
    player: p, npcId: core.NpcIdentifiers.GRISH, stepId: 'uZirGH', kind: 'message', handled: false,
  });
  assert.equal(p.items.get(core.ItemIdentifiers.OGRE_GATE_KEY), 1, 'a second hand-out does not stack another key');
});

test('the imported Zavistic lost-potion message restores the strange potion once', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(STAGE_SITHIK);
  h.dispatch('npc-dialogue:action', {
    player: p, npcId: core.NpcIdentifiers.ZAVISTIC_RARVE, stepId: '_QKSlE', kind: 'message', handled: false,
  });
  assert.equal(p.items.get(core.ItemIdentifiers.STRANGE_POTION), 1);
  assert.equal(h.quest.getStage(p), STAGE_SITHIK, 'recovery does not move the stage backwards or forwards');

  h.dispatch('npc-dialogue:action', {
    player: p, npcId: core.NpcIdentifiers.ZAVISTIC_RARVE, stepId: '_QKSlE', kind: 'message', handled: false,
  });
  assert.equal(p.items.get(core.ItemIdentifiers.STRANGE_POTION), 1, 'a held potion is not duplicated');
});

test('the final Grish hand-in consumes the artefact, sends varbit 487=14 and grants the rewards once', () => {
  const h = harness();
  const p = makePlayer();
  p.setStage(STAGE_KILLED_SLASH_BASH);
  p.items.set(core.ItemIdentifiers.OGRE_ARTEFACT, 1);

  const event = h.dispatch('npc-dialogue:action', {
    player: p, npcId: core.NpcIdentifiers.GRISH, stepId: 'yn-UXu', kind: 'action', handled: false,
  });
  assert.equal(event.handled, true);
  assert.equal(h.quest.getStage(p), STAGE_COMPLETE);
  assert.ok(h.quest.isComplete(p));
  assert.equal(h.lastVarbit(p, VARBIT_ZOGRE), STAGE_COMPLETE, 'native getState reads varbit 487 at the cache threshold');
  assert.equal(p.packets.some(([method, id]) => method === 'sendConfig' && id === VARBIT_ZOGRE), false,
    'the quest no longer writes varp 487');
  assert.equal(p.items.get(core.ItemIdentifiers.OGRE_ARTEFACT) ?? 0, 0, 'the artefact is handed in');
  assert.equal(p.items.get(core.ItemIdentifiers.OURG_BONES), 3, 'three ourg bones (two + scroll reward)');
  assert.equal(p.items.get(core.ItemIdentifiers.ZOGRE_BONES), 2, 'two zogre bones');
  assert.deepEqual(p.xp, [
    [core.Skill.FLETCHING, 2000],
    [core.Skill.RANGED, 2000],
    [core.Skill.HERBLORE, 2000],
  ]);
});

test('the Grish hand-in menu only offers the return option when the artefact is held', () => {
  const h = harness();
  const answer = h.conditions.at(-1);
  const holder = makePlayer();
  holder.setStage(STAGE_KILLED_SLASH_BASH);
  holder.items.set(core.ItemIdentifiers.OGRE_ARTEFACT, 1);
  const empty = makePlayer();
  empty.setStage(STAGE_KILLED_SLASH_BASH);
  const hasOption = 'If the player has the Ogre artefact:';
  const lostOption = 'If the player lost the Ogre artefact:';
  assert.equal(answer({ player: holder, npcId: core.NpcIdentifiers.GRISH, text: hasOption }), true);
  assert.equal(answer({ player: empty, npcId: core.NpcIdentifiers.GRISH, text: hasOption }), false);
  assert.equal(answer({ player: empty, npcId: core.NpcIdentifiers.GRISH, text: lostOption }), true);
});

test('login resend replays the durable stage as varbit 487 for old and completed saves', () => {
  const h = harness();
  const completed = makePlayer();
  completed.setStage(STAGE_COMPLETE);
  runtime.sendQuestVarps({ player: completed });
  assert.equal(h.lastVarbit(completed, VARBIT_ZOGRE), STAGE_COMPLETE, 'an existing completion save stays complete');

  const bossDone = makePlayer();
  bossDone.setStage(STAGE_KILLED_SLASH_BASH);
  runtime.sendQuestVarps({ player: bossDone });
  assert.equal(h.lastVarbit(bossDone, VARBIT_ZOGRE), STAGE_KILLED_SLASH_BASH);
});

test('real runner: the Grish start route reaches luhaXl and hands out the food and potions', () => {
  const h = registerRealRunner();
  try {
    const p = runnerPlayer();
    metRequirements(p);
    const variant = PluginManager.emitNpcDialogueVariant({ player: p, npcId: core.NpcIdentifiers.GRISH });
    assert.equal(variant, 'getting-started-talking-to-grish');
    runtime.startTranscript(h.api, p, core.NpcIdentifiers.GRISH, 'Zogre Flesh Eaters', variant);

    advanceToPrompt(p);
    choose(p, 'What do you mean sickies?');
    advanceToPrompt(p);
    choose(p, 'Can I help in any way?');
    advanceToPrompt(p);
    choose(p, "Ok, I'll check things out then and report back.");
    advanceToPrompt(p);
    choose(p, "Yes, I'm really sure!");
    drain(p);

    assert.equal(h.quest.getStage(p), STAGE_STARTED);
    assert.equal(p.items.get(core.ItemIdentifiers.COOKED_CHOMPY), 3);
    assert.equal(p.items.get(core.ItemIdentifiers.SUPER_RESTORE_3_), 2);
    assert.ok(p.messages.includes('Grish hands you some food and two potions.'));
    assert.equal(p.varbits.get(VARBIT_ZOGRE), STAGE_STARTED);
  } finally {
    h.cleanup();
  }
});

test('real runner: unmet requirements follow the neighboring negative branch and do not start the quest', () => {
  const h = registerRealRunner();
  try {
    const p = runnerPlayer({ ranged: 1 });
    metRequirements(p);
    const variant = PluginManager.emitNpcDialogueVariant({ player: p, npcId: core.NpcIdentifiers.GRISH });
    assert.equal(variant, 'getting-started-talking-to-grish');
    runtime.startTranscript(h.api, p, core.NpcIdentifiers.GRISH, 'Zogre Flesh Eaters', variant);

    advanceToPrompt(p);
    choose(p, 'What do you mean sickies?');
    advanceToPrompt(p);
    choose(p, 'Can I help in any way?');
    drain(p);

    assert.equal(h.quest.getStage(p), 0);
    assert.equal(p.items.get(core.ItemIdentifiers.COOKED_CHOMPY) ?? 0, 0);
    assert.equal(p.items.get(core.ItemIdentifiers.SUPER_RESTORE_3_) ?? 0, 0);
    assert.ok(p.messages.some(text => text.includes('You do not meet all of the requirements')));
  } finally {
    h.cleanup();
  }
});

test('real runner: the Grish key route reaches uZirGH and advances to the given-key stage', () => {
  const h = registerRealRunner();
  try {
    const p = runnerPlayer();
    h.quest.setStage(p, STAGE_PERMANENT_SPELL);
    const variant = PluginManager.emitNpcDialogueVariant({ player: p, npcId: core.NpcIdentifiers.GRISH });
    assert.equal(variant, 'defeating-the-zogres-talking-to-grish');
    runtime.startTranscript(h.api, p, core.NpcIdentifiers.GRISH, 'Zogre Flesh Eaters', variant);

    advanceToPrompt(p);
    choose(p, "I found who's responsible for the Zogres being here.");
    drain(p);

    assert.equal(h.quest.getStage(p), STAGE_GIVEN_KEY);
    assert.equal(p.items.get(core.ItemIdentifiers.OGRE_GATE_KEY), 1);
    assert.ok(p.messages.includes('Grish gives you a crudely crafted key.'));
    assert.equal(p.varbits.get(VARBIT_ZOGRE), STAGE_GIVEN_KEY);
  } finally {
    h.cleanup();
  }
});

test('real runner: Zavistic gives a lost potion through _QKSlE but the held-potion sibling does not duplicate it', () => {
  const h = registerRealRunner();
  try {
    const lost = runnerPlayer();
    h.quest.setStage(lost, STAGE_SITHIK);
    const variant = PluginManager.emitNpcDialogueVariant({ player: lost, npcId: core.NpcIdentifiers.ZAVISTIC_RARVE });
    assert.equal(variant, 'investigating-b-vahn-talking-to-zavistic-rarve-after-getting-the-potion');
    runtime.startTranscript(h.api, lost, core.NpcIdentifiers.ZAVISTIC_RARVE, 'Zogre Flesh Eaters', variant);
    drain(lost);
    assert.equal(lost.items.get(core.ItemIdentifiers.STRANGE_POTION), 1);
    assert.ok(lost.messages.includes('Zavistic hands you a bottle of strange potion.'));
    assert.equal(h.quest.getStage(lost), STAGE_SITHIK);

    const held = runnerPlayer();
    h.quest.setStage(held, STAGE_SITHIK);
    held.items.set(core.ItemIdentifiers.STRANGE_POTION, 1);
    runtime.startTranscript(h.api, held, core.NpcIdentifiers.ZAVISTIC_RARVE, 'Zogre Flesh Eaters', variant);
    advanceToPrompt(held);
    assert.equal(held.items.get(core.ItemIdentifiers.STRANGE_POTION), 1);
    assert.equal(held.messages.includes('Zavistic hands you a bottle of strange potion.'), false);
  } finally {
    h.cleanup();
  }
});
