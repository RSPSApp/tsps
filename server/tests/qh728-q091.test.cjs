// From server/: node --test tests/qh728-q091.test.cjs (after yarn build).
// Focused Rag and Bone Man I contracts: the whole durable stage graph through
// the registered handlers, the canonical varp 714 wire mapping (cache quest DB
// row 114 completes at 4), the eight-bone cleaning hand-in, and boiler recovery.
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

const VARP = 714;
const ODD_OLD_MAN = core.NpcIdentifiers.ODD_OLD_MAN;
const FORTUNATO = core.NpcIdentifiers.FORTUNATO;
const POT_BOILER = 14004;
const START_HOOK = 'quest:rag-and-bone-man-i:start';
const COMPLETE_ACTION = 'TzmM_e';

const BONES = [
  { raw: core.ItemIdentifiers.GOBLIN_SKULL, vinegar: core.ItemIdentifiers.BONE_IN_VINEGAR,
    cleaned: core.ItemIdentifiers.GOBLIN_SKULL_2, npcId: 3045, npcName: 'Goblin' },
  { raw: core.ItemIdentifiers.BEAR_RIBS, vinegar: core.ItemIdentifiers.BONE_IN_VINEGAR_2,
    cleaned: core.ItemIdentifiers.BEAR_RIBS_2, npcId: 2839, npcName: 'Black bear' },
  { raw: core.ItemIdentifiers.BIG_FROG_LEG, vinegar: core.ItemIdentifiers.BONE_IN_VINEGAR_33,
    cleaned: core.ItemIdentifiers.BIG_FROG_LEG_2, npcId: 8701, npcName: 'Big frog' },
  { raw: core.ItemIdentifiers.RAM_SKULL, vinegar: core.ItemIdentifiers.BONE_IN_VINEGAR_3,
    cleaned: core.ItemIdentifiers.RAM_SKULL_2, npcId: 1261, npcName: 'Ram' },
  { raw: core.ItemIdentifiers.UNICORN_BONE, vinegar: core.ItemIdentifiers.BONE_IN_VINEGAR_4,
    cleaned: core.ItemIdentifiers.UNICORN_BONE_2, npcId: 2837, npcName: 'Unicorn' },
  { raw: core.ItemIdentifiers.MONKEY_PAW, vinegar: core.ItemIdentifiers.BONE_IN_VINEGAR_15,
    cleaned: core.ItemIdentifiers.MONKEY_PAW_2, npcId: 2848, npcName: 'Monkey' },
  { raw: core.ItemIdentifiers.GIANT_RAT_BONE, vinegar: core.ItemIdentifiers.BONE_IN_VINEGAR_5,
    cleaned: core.ItemIdentifiers.GIANT_RAT_BONE_2, npcId: 2856, npcName: 'Giant rat' },
  { raw: core.ItemIdentifiers.GIANT_BAT_WING, vinegar: core.ItemIdentifiers.BONE_IN_VINEGAR_6,
    cleaned: core.ItemIdentifiers.GIANT_BAT_WING_2, npcId: 2834, npcName: 'Giant bat' },
];
const ALL_BONES = (1 << BONES.length) - 1;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const xp = new Map();
  const calls = [];
  const varbits = new Map();
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      if ((items.get(id) ?? 0) === 0) items.delete(id);
      return true;
    },
    getFreeSlots: () => 28 - [...items.values()].filter(amount => amount > 0).length,
    isFull: () => inventory.getFreeSlots() <= 0,
    getItems: () => [...items.entries()].filter(([, amount]) => amount > 0)
      .map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };
  const sender = {
    sendConfig: (id, value) => calls.push(['sendConfig', id, value]),
    sendVarbit: (id, value) => { calls.push(['sendVarbit', id, value]); varbits.set(id, value); },
    getVarbit: id => varbits.get(id) ?? 0,
    getVarp: () => 0,
  };
  const proxy = new Proxy(sender, {
    get: (target, prop) => target[prop] ?? ((...args) => { calls.push([String(prop), ...args]); return proxy; }),
  });
  return {
    attrs, items, messages, xp, calls, varbits,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getSkillManager: () => ({
      addExperiences: (skill, amount) => xp.set(skill, (xp.get(skill) ?? 0) + amount),
    }),
    getUsername: () => 'ragbone1-test',
    getPacketSender: () => proxy,
    getDialogueManager: () => ({ isActive: () => false, startDialogues: noop, reset: noop }),
    getLocation: () => new core.Location(3362, 3502, 0),
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
  const variants = [];
  const custom = {};
  const npcDeath = [];
  const logins = [];
  const itemOnItem = [];
  const itemOnObject = [];
  const objectInteraction = {};
  const shops = [];
  const ground = [];
  class ImmediateCountdownTask {
    constructor(_player, ticks, run) { this.ticks = ticks; this.run = run; }
    execute() { this.run(); }
  }
  const testCore = {
    ...core,
    CountdownTask: ImmediateCountdownTask,
    TaskManager: { submit: task => task.execute() },
    ShopManager: { open: (player, id) => shops.push([player, id]) },
  };
  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onCustomEvent: (key, handler) => (custom[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (custom[key] ?? []).forEach(handler => handler(event)),
    onItemOnItem: handler => itemOnItem.push(handler),
    onItemOnObject: handler => itemOnObject.push(handler),
    onObjectInteraction: (name, options) => { objectInteraction[name] = options; },
    onNpcDeath: handler => npcDeath.push(handler),
    onPlayerLogin: handler => logins.push(handler),
    getItemOnGroundManager: () => ({
      registerLocation: (_player, item, location) => ground.push([item.getId?.() ?? item.id, location]),
    }),
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/RagAndBoneManI.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === 'rag_and_bone_man_i');
  return {
    api, quest, variants, custom, npcDeath, logins, itemOnItem, itemOnObject, objectInteraction,
    shops, ground,
    variant: player => variants[0]({ player, npcId: ODD_OLD_MAN }),
    start: player => (custom['npc-dialogue:hook'][0])({ player, npcId: ODD_OLD_MAN, hook: START_HOOK }),
    line: (player, text) => (custom['npc-dialogue:line'][0])({ player, npcId: ODD_OLD_MAN, text }),
    action: (player, stepId) => {
      const event = { player, npcId: ODD_OLD_MAN, stepId, handled: false, end: false };
      (custom['npc-dialogue:action'][0])(event);
      return event;
    },
  };
}

const loc = new core.Location(3362, 3502, 0);
const objectEvent = (player, itemId) => ({ player, itemId, objectId: POT_BOILER, handled: false });

test('fresh stage 0, decline and accept follow the start contract on wire 1', () => {
  const h = harness();
  const p = makePlayer();
  assert.equal(h.variant(p), 'starting-off');
  (h.custom['npc-dialogue:choice'][0])({ player: p, npcId: ODD_OLD_MAN, option: 'No' });
  assert.equal(p.getAttribute('quest.rag_and_bone_man_i.declined'), 1);
  assert.equal(h.variant(p), 'starting-off-after-initally-declining-the-quest');

  h.start(p);
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(p.lastConfig(VARP), 1);
  assert.equal(p.getAttribute('quest.rag_and_bone_man_i.declined'), 0);
  h.start(p);
  assert.equal(h.quest.getStage(p), 1);
});

test('mandatory route: eight drops, vinegar, boiler cleaning, hand-in and completion on wire 4', () => {
  const h = harness();
  const p = makePlayer();
  h.start(p);
  assert.equal(h.quest.getStage(p), 1);

  assert.equal(h.variant(p), 'before-having-any-bones');
  assert.equal(h.variants[0]({ player: p, npcId: FORTUNATO }), 'getting-the-vinegar');
  assert.equal(h.variants[0]({ player: p, npcId: FORTUNATO }), 'getting-the-vinegar-need-more-vinegar');
  (h.custom['npc-dialogue:action'][0])({
    player: p, npcId: FORTUNATO, stepId: 'gW205J', handled: false, end: false,
  });
  assert.deepEqual(h.shops, [[p, 1383]]);

  // Fixture: bought eight jugs and brought eight pots, as the helper setup asks.
  p.items.set(core.ItemIdentifiers.JUG_OF_VINEGAR, 8);
  p.items.set(core.ItemIdentifiers.POT, 8);
  for (let i = 0; i < 8; i++) {
    const event = { player: p, usedItemId: core.ItemIdentifiers.JUG_OF_VINEGAR, usedWithItemId: core.ItemIdentifiers.POT, handled: false };
    h.itemOnItem[0](event);
    assert.equal(event.handled, true);
  }
  assert.equal(p.items.get(core.ItemIdentifiers.POT_OF_VINEGAR), 8);
  assert.equal(p.items.get(core.ItemIdentifiers.JUG_OF_VINEGAR) ?? 0, 0);
  assert.equal(p.items.get(core.ItemIdentifiers.POT) ?? 0, 0);

  // Every helper monster is a real cache name and drops its quest bone while stage 1.
  for (const bone of BONES) {
    assert.equal(core.NpcDefinition.forId(bone.npcId).getName(), bone.npcName);
    h.npcDeath[0]({ killer: p, npc: { getLocation: () => loc }, npcId: bone.npcId });
    assert.equal(h.ground.at(-1)[0], bone.raw);
    p.items.set(bone.raw, 1);
    h.itemOnItem[0]({
      player: p, usedItemId: bone.raw, usedWithItemId: core.ItemIdentifiers.POT_OF_VINEGAR, handled: false,
    });
    assert.equal(p.items.get(bone.raw) ?? 0, 0);
    assert.equal(p.items.get(bone.vinegar), 1);
  }
  assert.equal(p.items.get(core.ItemIdentifiers.POT_OF_VINEGAR) ?? 0, 0);

  p.items.set(core.ItemIdentifiers.LOGS, 8);
  p.items.set(core.ItemIdentifiers.TINDERBOX, 1);
  for (const bone of BONES) {
    const logs = objectEvent(p, core.ItemIdentifiers.LOGS);
    h.itemOnObject[0](logs);
    assert.equal(logs.handled, true);
    const boneEvent = objectEvent(p, bone.vinegar);
    h.itemOnObject[0](boneEvent);
    assert.equal(boneEvent.handled, true);
    assert.equal(p.items.get(bone.vinegar) ?? 0, 0);
    h.itemOnObject[0](objectEvent(p, core.ItemIdentifiers.TINDERBOX)); // immediate countdown
    h.objectInteraction['Pot-boiler']['Remove-Bone']({ player: p });
    assert.equal(p.items.get(bone.cleaned), 1);
  }
  assert.equal(p.items.get(core.ItemIdentifiers.LOGS) ?? 0, 0);

  assert.equal(h.variant(p), 'finishing-up');
  h.line(p, "That's the last of them!");
  assert.equal(p.getAttribute('quest.rag_and_bone_man_i.handed'), ALL_BONES);
  for (const bone of BONES) assert.equal(p.items.get(bone.cleaned) ?? 0, 0);
  const action = h.action(p, COMPLETE_ACTION);
  assert.equal(action.handled, true);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.lastConfig(VARP), 4);
  assert.equal(p.xp.get(core.Skill.COOKING), 500);
  assert.equal(p.xp.get(core.Skill.PRAYER), 500);
  assert.equal(Number(p.getAttribute('quest.points')), 1);

  runtime.sendQuestVarps({ player: p });
  assert.equal(p.lastConfig(VARP), 4, 'login/replay resends the completed wire value');

  h.action(p, COMPLETE_ACTION);
  assert.equal(p.xp.get(core.Skill.COOKING), 500, 'completion cannot be rewarded twice');
  assert.equal(Number(p.getAttribute('quest.points')), 1);
  assert.equal(h.variant(p), 'after-rag-and-bone-man-i');
});

test('existing durable saves replay 0/1/4 on the shared varp', () => {
  const h = harness();
  const fresh = makePlayer();
  runtime.sendQuestVarps({ player: fresh });
  assert.equal(fresh.lastConfig(VARP), 0);

  const started = makePlayer();
  h.quest.setStage(started, 1);
  assert.equal(started.lastConfig(VARP), 1);
  runtime.sendQuestVarps({ player: started });
  assert.equal(started.lastConfig(VARP), 1);

  // A save made before the mapping fix stored durable stage 2. It must still load complete.
  const oldSave = makePlayer();
  oldSave.attrs.set('quest.rag_and_bone_man_i.stage', 2);
  runtime.sendQuestVarps({ player: oldSave });
  assert.equal(oldSave.lastConfig(VARP), 4);
  assert.equal(h.quest.isComplete(oldSave), true);
});

test('all handed-in bones but unfinished still offers finishing-up and completes', () => {
  const h = harness();
  const p = makePlayer();
  h.start(p);
  p.attrs.set('quest.rag_and_bone_man_i.handed', ALL_BONES);
  assert.equal(h.variant(p), 'finishing-up');
  h.action(p, COMPLETE_ACTION);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.lastConfig(VARP), 4);
});

test('hand-in consumes cleaned bones and partial runs stay in progress', () => {
  const h = harness();
  const p = makePlayer();
  h.start(p);
  p.items.set(core.ItemIdentifiers.GOBLIN_SKULL_2, 1);
  p.items.set(core.ItemIdentifiers.BEAR_RIBS_2, 1);
  assert.equal(h.variant(p), 'handing-in-some-bones');
  h.line(p, "Wonderful! I'll put this with the rest.");
  assert.equal(p.items.get(core.ItemIdentifiers.GOBLIN_SKULL_2) ?? 0, 0);
  assert.equal(p.items.get(core.ItemIdentifiers.BEAR_RIBS_2) ?? 0, 0);
  assert.equal(p.getAttribute('quest.rag_and_bone_man_i.handed'), 0b11);
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(p.lastConfig(VARP), 1);
});

test('boiler recovery: full bag keeps the bone, relog refunds the vinegar bone', () => {
  const h = harness();
  const p = makePlayer();
  h.start(p);
  p.items.set(core.ItemIdentifiers.LOGS, 1);
  p.items.set(core.ItemIdentifiers.BONE_IN_VINEGAR, 1);
  p.items.set(core.ItemIdentifiers.TINDERBOX, 1);
  h.itemOnObject[0](objectEvent(p, core.ItemIdentifiers.LOGS));
  h.itemOnObject[0](objectEvent(p, core.ItemIdentifiers.BONE_IN_VINEGAR));
  h.itemOnObject[0](objectEvent(p, core.ItemIdentifiers.TINDERBOX));
  for (let i = 0; i < 28; i++) p.items.set(900000 + i, 1);
  h.objectInteraction['Pot-boiler']['Remove-Bone']({ player: p });
  assert.ok(p.messages.includes("You don't have enough inventory space."));

  // The relog hand-back uses the persisted pending-bone attribute.
  p.items.clear();
  p.attrs.set('quest.rag_and_bone_man_i.boiler', core.ItemIdentifiers.BONE_IN_VINEGAR);
  h.logins[0]({ player: p });
  assert.equal(p.items.get(core.ItemIdentifiers.BONE_IN_VINEGAR), 1);
  assert.equal(p.getAttribute('quest.rag_and_bone_man_i.boiler'), 0);
});
