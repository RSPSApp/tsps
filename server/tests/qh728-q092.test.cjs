// From server/: node --test tests/qh728-q092.test.cjs (after yarn build).
// Focused Rag and Bone Man II contracts: the canonical varp 714 wire mapping,
// the finishing-up recovery variant after all bones were handed in, login
// replay, and the shared pot-boiler log state. Fixture-set stages are labelled.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

const ALL_BONES = (1 << 27) - 1;
const I_STAGE_ATTRIBUTE = 'quest.rag_and_bone_man_i.stage';
const II_BONES_ATTRIBUTE = 'quest.rag_and_bone_man_ii.bones';
const VARP = 714;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer({ equipped = [], banks = [] } = {}) {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const xp = new Map();
  const varbits = new Map();
  const calls = [];
  const equipment = {
    getItems: () => equipped,
    get: () => null,
    deleteNumber: (id, amount = 1) => {
      const index = equipped.findIndex(item => item && item.getId() === id);
      if (index >= 0) {
        const item = equipped[index];
        if ((item.getAmount?.() ?? 1) <= amount) equipped.splice(index, 1);
        else item.amount = (item.amount ?? 1) - amount;
      }
      return equipment;
    },
  };
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => 28 - [...items.values()].filter(amount => amount > 0).length,
    isFull: () => inventory.getFreeSlots() <= 0,
    getItems: () => [...items.entries()].filter(([, amount]) => amount > 0)
      .map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };
  const target = {
    sendConfig: (id, value) => { calls.push(['sendConfig', id, value]); },
    sendVarbit: (id, value) => { calls.push(['sendVarbit', id, value]); varbits.set(id, value); },
    getVarbit: id => varbits.get(id) ?? 0,
  };
  const sender = new Proxy(target, {
    get: (obj, prop) => {
      if (prop in obj) return obj[prop];
      return (...args) => { calls.push([String(prop), ...args]); return sender; };
    },
  });
  const skillManager = {
    getCurrentLevel: () => 99,
    getMaxLevel: () => 99,
    getExperience: skill => xp.get(skill) ?? 0,
    addExperiences: (skill, amount) => xp.set(skill, (xp.get(skill) ?? 0) + amount),
  };
  return {
    attrs, items, messages, xp, varbits, calls,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getBanks: () => banks,
    getSkillManager: () => skillManager,
    getUsername: () => 'rab2-test',
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, startDialogues: noop, reset: noop }),
    getLocation: () => new core.Location(3361, 3505, 0),
    isRegistered: () => true,
    isPlayer: () => true,
    sendMessage: text => messages.push(text),
    performAnimation: noop,
    lastConfig: id => {
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i][0] === 'sendConfig' && calls[i][1] === id) return calls[i][2];
      }
      return undefined;
    },
  };
}

function harness() {
  const variants = [], conditions = [], npcInteraction = [], itemOnItem = [], itemOnObject = [];
  const custom = {}, npcDeath = [], loginHandlers = [], objectInteraction = {};
  const transcripts = [];
  const tasks = [];
  class TestCountdownTask {
    constructor(player, ticks, callback) {
      this.player = player;
      this.ticks = ticks;
      this.callback = callback;
    }
  }
  const testCore = Object.assign({}, core, {
    CountdownTask: TestCountdownTask,
    TaskManager: { submit: task => tasks.push(task) },
  });
  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onNpcInteraction: (...args) => npcInteraction.push(args),
    onItemOnItem: handler => itemOnItem.push(handler),
    onItemOnObject: handler => itemOnObject.push(handler),
    onObjectInteraction: (name, actions) => { objectInteraction[name] = actions; },
    onNpcDeath: handler => npcDeath.push(handler),
    onPlayerLogin: handler => loginHandlers.push(handler),
    onCustomEvent: (key, handler) => (custom[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (custom[key] ??= []).forEach(handler => handler(event)),
    getItemOnGroundManager: () => ({ registerLocation: noop }),
  }, { get: (target, key) => target[key] ?? noop });
  const originalStartTranscript = runtime.startTranscript;
  runtime.startTranscript = (...args) => { transcripts.push(args.slice(3, 5)); return true; };
  require('../plugins/quests/quests/RagAndBoneManI.Quest')(api);
  require('../plugins/quests/quests/RagAndBoneManII.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === 'rag_and_bone_man_ii');
  return {
    api, quest, variants, conditions, npcInteraction, itemOnItem, itemOnObject, custom, npcDeath,
    loginHandlers, objectInteraction, transcripts, tasks,
    itemOnObjectEvent(event) {
      for (const handler of itemOnObject) {
        handler(event);
        if (event.handled) break;
      }
      return event;
    },
    customEvent(key, event) {
      for (const handler of custom[key] ?? []) handler(event);
      return event;
    },
    restore: () => { runtime.startTranscript = originalStartTranscript; },
  };
}

function startedAt(h, player, stage) {
  player.attrs.set(I_STAGE_ATTRIBUTE, 2);
  h.quest.setStage(player, stage);
}

test('fresh stage 0 starts on varp 714 value 4', () => {
  const h = harness();
  try {
    const p = makePlayer();
    p.attrs.set(I_STAGE_ATTRIBUTE, 2);
    const variant = h.variants.at(-1)({ player: p, npcId: core.NpcIdentifiers.ODD_OLD_MAN });
    assert.equal(variant, 'talking-to-the-odd-old-man-without-any-bones');
    assert.equal(h.quest.getStage(p), 1);
    assert.equal(p.lastConfig(VARP), 4);
  } finally {
    h.restore();
  }
});

test('finishing-up action completes on varp 714 value 6 and awards once', () => {
  const h = harness();
  try {
    const p = makePlayer();
    startedAt(h, p, 1);
    p.attrs.set(II_BONES_ATTRIBUTE, ALL_BONES);
    const event = { player: p, npcId: core.NpcIdentifiers.ODD_OLD_MAN, stepId: 'xoRC1-', handled: false, end: false };
    h.customEvent('npc-dialogue:action', event);
    assert.equal(event.handled, true);
    assert.equal(h.quest.isComplete(p), true);
    assert.equal(p.lastConfig(VARP), 6);
    assert.equal(p.items.get(core.ItemIdentifiers.RAM_SKULL_HELM), 1);
    assert.equal(p.xp.get(core.Skill.PRAYER), 5000);
    assert.equal(Number(p.attrs.get('quest.rag_and_bone_man_ii.rewards')), 1);

    h.customEvent('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.ODD_OLD_MAN, stepId: 'apFl7S', handled: false });
    assert.equal(p.items.get(core.ItemIdentifiers.RAM_SKULL_HELM), 1);
    assert.equal(p.items.get(core.ItemIdentifiers.BONESACK) ?? 0, 0);
    assert.equal(p.xp.get(core.Skill.PRAYER), 5000);

    runtime.sendQuestVarps({ player: p });
    assert.equal(p.lastConfig(VARP), 6);
  } finally {
    h.restore();
  }
});

test('all bones handed in but incomplete still offers the finishing-up variant', () => {
  const h = harness();
  try {
    const p = makePlayer();
    startedAt(h, p, 1);
    p.attrs.set(II_BONES_ATTRIBUTE, ALL_BONES);
    const variant = h.variants.at(-1)({ player: p, npcId: core.NpcIdentifiers.ODD_OLD_MAN });
    assert.equal(variant, 'finishing-up');
  } finally {
    h.restore();
  }
});

test('started II replays 714=4 on login while unstarted II leaves Rag and Bone Man I progress', () => {
  const h = harness();
  try {
    const fresh = makePlayer();
    fresh.attrs.set(I_STAGE_ATTRIBUTE, 1);
    runtime.sendQuestVarps({ player: fresh });
    assert.equal(fresh.lastConfig(VARP), 1, 'unstarted II must not clobber Rag and Bone Man I progress');

    const completeI = makePlayer();
    completeI.attrs.set(I_STAGE_ATTRIBUTE, 2);
    runtime.sendQuestVarps({ player: completeI });
    assert.equal(completeI.lastConfig(VARP), 4);

    const started = makePlayer();
    startedAt(h, started, 1);
    runtime.sendQuestVarps({ player: started });
    assert.equal(started.lastConfig(VARP), 4);
  } finally {
    h.restore();
  }
});

test('Rag and Bone Man II uses the shared boiler actions and logout refund', () => {
  const h = harness();
  try {
    const p = makePlayer();
    startedAt(h, p, 1);
    p.items.set(core.ItemIdentifiers.BONE_IN_VINEGAR_7, 1);
    p.items.set(core.ItemIdentifiers.TINDERBOX, 1);
    p.items.set(core.ItemIdentifiers.LOGS, 1);
    const useOnBoiler = itemId => h.itemOnObjectEvent({
      player: p, itemId, objectId: core.ObjectIdentifiers.POT_BOILER, handled: false,
    });

    assert.equal(useOnBoiler(core.ItemIdentifiers.LOGS).handled, true);
    assert.equal(p.items.get(core.ItemIdentifiers.LOGS) ?? 0, 0);
    assert.equal(p.varbits.get(2046), 1);
    const first = useOnBoiler(core.ItemIdentifiers.BONE_IN_VINEGAR_7);
    assert.equal(first.handled, true);
    assert.equal(p.items.get(core.ItemIdentifiers.BONE_IN_VINEGAR_7) ?? 0, 0);
    assert.equal(p.varbits.get(2046), 2, 'the shared machine holds the bone in its pot');

    assert.equal(useOnBoiler(core.ItemIdentifiers.TINDERBOX).handled, true);
    assert.equal(p.varbits.get(2046), 3, 'lighting is a separate normal action');
    assert.equal(h.tasks.length, 1);
    h.tasks.shift().callback();
    assert.equal(p.varbits.get(2046), 4, 'boiling completes into the Remove-Bone state');
    assert.equal(p.items.get(core.ItemIdentifiers.WOLF_BONE_2) ?? 0, 0,
      'the cleaned bone is not auto-collected when the timer ends');
    h.objectInteraction['Pot-boiler']['Remove-Bone']({ player: p });
    assert.equal(p.varbits.get(2046), 0);
    assert.equal(p.items.get(core.ItemIdentifiers.WOLF_BONE_2), 1);

    p.items.set(core.ItemIdentifiers.BONE_IN_VINEGAR_7, 1);
    p.items.set(core.ItemIdentifiers.LOGS, 1);
    useOnBoiler(core.ItemIdentifiers.LOGS);
    useOnBoiler(core.ItemIdentifiers.BONE_IN_VINEGAR_7);
    h.loginHandlers[0]({ player: p });
    assert.equal(p.varbits.get(2046), 0, 'login resets the unfinished shared boiler');
    assert.equal(p.items.get(core.ItemIdentifiers.BONE_IN_VINEGAR_7), 1,
      'login returns the II bone in vinegar so the player can retry');

    const noLogs = makePlayer();
    startedAt(h, noLogs, 1);
    noLogs.items.set(core.ItemIdentifiers.BONE_IN_VINEGAR_7, 1);
    noLogs.items.set(core.ItemIdentifiers.TINDERBOX, 1);
    const blocked = h.itemOnObjectEvent({
      player: noLogs,
      itemId: core.ItemIdentifiers.BONE_IN_VINEGAR_7,
      objectId: core.ObjectIdentifiers.POT_BOILER,
      handled: false,
    });
    assert.equal(blocked.handled, true);
    assert.equal(noLogs.items.get(core.ItemIdentifiers.BONE_IN_VINEGAR_7), 1,
      'missing logs do not consume the bone');
    assert.ok(noLogs.messages.includes('You need to add some logs to the pot-boiler first.'));
  } finally {
    h.restore();
  }
});

test('Talk-to defers to Bone Voyage while its lucky-charm step is active', () => {
  const h = harness();
  try {
    const p = makePlayer();
    p.attrs.set(I_STAGE_ATTRIBUTE, 2);
    (h.custom['quest:get-stage'] ??= []).push(request => {
      if (request.key === 'bone_voyage') request.stage = 9;
    });
    const talk = h.npcInteraction[0][1]['Talk-to'];
    assert.equal(talk({ player: p, npcId: core.NpcIdentifiers.ODD_OLD_MAN }), false);
    assert.equal(h.transcripts.length, 0, 'Bone Voyage keeps NPC 1259 while the charm is owed');
    assert.equal(h.quest.getStage(p), 0, 'deferring must not start Rag and Bone Man II');

    p.attrs.set('quest.bone_voyage.charm', 2);
    assert.equal(talk({ player: p, npcId: core.NpcIdentifiers.ODD_OLD_MAN }), true);
    assert.deepEqual(h.transcripts[0], ['Rag and Bone Man II', 'talking-to-the-odd-old-man-without-any-bones']);
  } finally {
    h.restore();
  }
});

test('post-quest exchange removes an equipped reward', () => {
  const h = harness();
  try {
    const helm = { getId: () => core.ItemIdentifiers.RAM_SKULL_HELM, getAmount: () => 1 };
    const p = makePlayer({ equipped: [helm] });
    h.quest.setStage(p, 2);
    p.attrs.set('quest.rag_and_bone_man_ii.rewards', 1);
    h.customEvent('npc-dialogue:choice', {
      player: p, npcId: core.NpcIdentifiers.ODD_OLD_MAN,
      option: 'Could I exchange this helm for the bonesack?',
    });
    assert.equal(p.getEquipment().getItems().length, 0);
    assert.equal(p.items.get(core.ItemIdentifiers.BONESACK), 1);
    assert.equal(Number(p.attrs.get('quest.rag_and_bone_man_ii.rewards')), 2);
  } finally {
    h.restore();
  }
});

test('full inventory leaves an equipped reward intact until an exchange can fit', () => {
  const h = harness();
  try {
    const helm = { getId: () => core.ItemIdentifiers.RAM_SKULL_HELM, getAmount: () => 1 };
    const p = makePlayer({ equipped: [helm] });
    for (let id = 500000; id < 500028; id++) p.items.set(id, 1);
    h.quest.setStage(p, 2);
    p.attrs.set('quest.rag_and_bone_man_ii.rewards', 1);
    const exchange = () => h.customEvent('npc-dialogue:choice', {
      player: p, npcId: core.NpcIdentifiers.ODD_OLD_MAN,
      option: 'Could I exchange this helm for the bonesack?',
    });

    exchange();
    assert.equal(p.getEquipment().getItems().length, 1, 'full inventory refuses before removing the equipped helm');
    assert.equal(p.items.get(core.ItemIdentifiers.BONESACK) ?? 0, 0);
    assert.equal(Number(p.attrs.get('quest.rag_and_bone_man_ii.rewards')), 1);

    p.items.delete(500000);
    exchange();
    assert.equal(p.getEquipment().getItems().length, 0);
    assert.equal(p.items.get(core.ItemIdentifiers.BONESACK), 1);
    assert.equal(Number(p.attrs.get('quest.rag_and_bone_man_ii.rewards')), 2);
  } finally {
    h.restore();
  }
});

test('full inventory leaves a banked reward intact until an exchange can fit', () => {
  const h = harness();
  try {
    const banked = new Map([[core.ItemIdentifiers.RAM_SKULL_HELM, 1]]);
    const bank = {
      getAmount: id => banked.get(id) ?? 0,
      deleteNumber: (id, amount = 1) => banked.set(id, Math.max(0, (banked.get(id) ?? 0) - amount)),
    };
    const p = makePlayer({ banks: [bank] });
    for (let id = 500000; id < 500028; id++) p.items.set(id, 1);
    h.quest.setStage(p, 2);
    p.attrs.set('quest.rag_and_bone_man_ii.rewards', 1);
    const exchange = () => h.customEvent('npc-dialogue:choice', {
      player: p, npcId: core.NpcIdentifiers.ODD_OLD_MAN,
      option: 'Could I exchange this helm for the bonesack?',
    });

    exchange();
    assert.equal(banked.get(core.ItemIdentifiers.RAM_SKULL_HELM), 1);
    assert.equal(p.items.get(core.ItemIdentifiers.BONESACK) ?? 0, 0);
    assert.equal(Number(p.attrs.get('quest.rag_and_bone_man_ii.rewards')), 1);

    p.items.delete(500000);
    exchange();
    assert.equal(banked.get(core.ItemIdentifiers.RAM_SKULL_HELM), 0);
    assert.equal(p.items.get(core.ItemIdentifiers.BONESACK), 1);
    assert.equal(Number(p.attrs.get('quest.rag_and_bone_man_ii.rewards')), 2);
  } finally {
    h.restore();
  }
});

test('a banked reward is still possessed and is not replaced', () => {
  const h = harness();
  try {
    const banked = new Map([[core.ItemIdentifiers.RAM_SKULL_HELM, 1]]);
    const bank = {
      getAmount: id => banked.get(id) ?? 0,
      deleteNumber: (id, amount = 1) => banked.set(id, Math.max(0, (banked.get(id) ?? 0) - amount)),
    };
    const p = makePlayer({ banks: [bank] });
    h.quest.setStage(p, 2);
    p.attrs.set('quest.rag_and_bone_man_ii.rewards', 1);
    const condition = h.conditions[0];
    assert.equal(condition({ npcId: core.NpcIdentifiers.ODD_OLD_MAN, player: p, stepId: 'ou_17H' }), false);
    h.custom['npc-dialogue:condition'][0]({ npcId: core.NpcIdentifiers.ODD_OLD_MAN, player: p, stepId: 'ou_17H' });
    assert.equal(p.items.get(core.ItemIdentifiers.RAM_SKULL_HELM) ?? 0, 0, 'no duplicate while banked');

    banked.set(core.ItemIdentifiers.RAM_SKULL_HELM, 0);
    assert.equal(condition({ npcId: core.NpcIdentifiers.ODD_OLD_MAN, player: p, stepId: 'ou_17H' }), true);
    h.custom['npc-dialogue:condition'][0]({ npcId: core.NpcIdentifiers.ODD_OLD_MAN, player: p, stepId: 'ou_17H' });
    assert.equal(p.items.get(core.ItemIdentifiers.RAM_SKULL_HELM), 1);
  } finally {
    h.restore();
  }
});

test('completion scroll resolves each player’s chosen reward independently', () => {
  const h = harness();
  try {
    const bonesackPlayer = makePlayer();
    startedAt(h, bonesackPlayer, 1);
    bonesackPlayer.attrs.set(II_BONES_ATTRIBUTE, ALL_BONES);
    h.customEvent('npc-dialogue:action', {
      player: bonesackPlayer, npcId: core.NpcIdentifiers.ODD_OLD_MAN, stepId: 'apFl7S', handled: false, end: false,
    });
    assert.equal(h.quest.scrollItemId(bonesackPlayer), core.ItemIdentifiers.BONESACK);

    const helmPlayer = makePlayer();
    startedAt(h, helmPlayer, 1);
    helmPlayer.attrs.set(II_BONES_ATTRIBUTE, ALL_BONES);
    h.customEvent('npc-dialogue:action', {
      player: helmPlayer, npcId: core.NpcIdentifiers.ODD_OLD_MAN, stepId: 'xoRC1-', handled: false, end: false,
    });
    assert.equal(h.quest.scrollItemId(bonesackPlayer), core.ItemIdentifiers.BONESACK,
      'completing another player cannot change the first player’s scroll icon');
    assert.equal(h.quest.scrollItemId(helmPlayer), core.ItemIdentifiers.RAM_SKULL_HELM);
  } finally {
    h.restore();
  }
});
