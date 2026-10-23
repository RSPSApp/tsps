// Sleeping Giants (q105): registered-handler stage graph, cache wire and shared-object contracts.
// From server/: node --test tests/qh728-q105.test.cjs
//
// The route test dispatches the same NPC/object/custom/dialogue events the production
// dialogue and Giants' Foundry plugins emit; startTranscript is recorded rather than
// played. It proves the handler contract and stage/wire mapping, not a live playthrough.
// The generated scene, cutscene pacing, visual Quest Helper overlay and a live client
// are not exercised here.
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

const PAGE = 'Sleeping Giants';
const START_HOOK = 'quest:sleeping-giants:start';
const QUEST_VARBIT = 13902;
const TUTORIAL_VARBIT = 13903;
const REPAIR_VARBITS = [13904, 13905, 13906];
const FOUNDRY_Y = 11483;

let nextIndex = 1;
const noop = () => {};

const transcripts = [];
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};

class FakeTask {
  constructor(ticks, key) { this.ticks = ticks; this.key = key; this.running = false; }
  setRunning(value) { this.running = value; }
  stop() { this.running = false; }
  tick() {
    if (!this.running) return;
    if (this.ticks-- <= 0) { this.running = false; this.execute(); }
  }
}

function setup() {
  transcripts.length = 0;
  const attributes = new Map();
  const items = new Map();
  const messages = [];
  const varbits = new Map();
  const xp = [];
  const events = new Map();
  const variantHooks = [];
  const conditionHooks = [];
  const npcHooks = [];
  const objectHooks = [];
  const itemObjectHooks = [];
  const loginHooks = [];
  const tasks = [];
  const npcs = [];
  let freeSlots = 28;
  let location = new core.Location(3362, 3146, 0);

  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { for (const task of tasks) if (task.key === key && task.running) task.stop(); },
  };
  const objectManager = { register() {} };
  class FakePrivateArea {
    constructor(boundaries) { this.boundaries = boundaries; this.destroyed = false; }
    enter() {}
    leave() { this.destroyed = true; }
    add() {}
    isDestroyed() { return this.destroyed; }
    postLeave() {}
  }
  class FakeTaskBase extends FakeTask {}

  const api = new Proxy({
    core: {
      ...core,
      Animation: core.Animation,
      Boundary: core.Boundary,
      PrivateArea: FakePrivateArea,
      Task: FakeTaskBase,
      TaskManager: taskManager,
      ForceMovement: core.ForceMovement,
      ForceMovementTask: class extends FakeTaskBase {
        constructor(player, ticks, movement) { super(ticks, player); this.movement = movement; }
        execute() {}
      },
      GameObject: core.GameObject,
      ObjectManager: objectManager,
    },
    persistAttribute() {},
    onCustomEvent(name, handler) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
    },
    emitCustomEvent(name, event) { for (const handler of events.get(name) ?? []) handler(event); },
    onNpcDialogueVariant(handler) { variantHooks.push(handler); },
    onNpcDialogueCondition(handler) { conditionHooks.push(handler); },
    onNpcInteraction(handler) { npcHooks.push(handler); },
    onObjectInteraction(handler) { objectHooks.push(handler); },
    onItemOnObject(handler) { itemObjectHooks.push(handler); },
    onPlayerLogin(handler) { loginHooks.push(handler); },
    onPlayerLogout() {},
    onPlayerDeath() {},
    spawnNpc(definition) {
      const npc = {
        ...definition, removed: false, index: nextIndex++,
        getId: () => definition.id,
        getIndex() { return npc.index; },
        getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        isRegistered: () => !npc.removed,
        setNpcTransformationId(id) { npc.id = id; },
        getMovementQueue: () => ({ reset: noop, addSteps: noop }),
      };
      npcs.push(npc);
      return npc;
    },
  }, { get(target, key) { return key in target ? target[key] : () => undefined; } });

  require('../plugins/quests/quests/SleepingGiants.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'sleeping_giants');

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(`config:${id}`, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    getVarp(id) { return varbits.get(`config:${id}`) ?? 0; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    adds(id, amount = 1) { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    deleteNumber(id, amount = 1) {
      assert.ok((items.get(id) ?? 0) >= amount, `deleting ${amount} of ${id} it does not hold`);
      items.set(id, (items.get(id) ?? 0) - amount);
      return true;
    },
    getFreeSlots: () => freeSlots,
    isFull: () => freeSlots <= 0,
    refreshItems() {},
    forceAdd(id, amount = 1) { items.set(id, (items.get(id) ?? 0) + amount); },
  };
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null, contains: () => false, refreshItems: noop }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ reset: noop, getCurrent: () => null, advance: noop, startDialogues: noop }),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getCurrentLevel: () => 99,
      addExperiences: (skill, amount) => xp.push([typeof skill === 'number' ? skill : skill.getIndex(), amount]),
    }),
    getMovementQueue: () => ({ setBlockMovement: noop, reset: noop, addSteps: noop }),
    getLocation: () => location,
    moveTo: (to) => { location = to; },
    setUntargetable: noop,
    setForceMovement: noop,
    performAnimation: noop,
    getUsername: () => 'qh728-q105',
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
    getBanks: () => [],
    getRunEnergy: () => 100,
    setRunEnergy: noop,
  };

  const emit = (name, payload) => {
    const event = { player, ...payload };
    for (const handler of events.get(name) ?? []) handler(event);
    return event;
  };
  const hook = (name) => emit('npc-dialogue:hook', { hook: name });
  const line = (text, npcId = core.NpcIdentifiers.KOVAC) => {
    const event = emit('npc-dialogue:line', { npcId, text });
    event.before?.();
    event.after?.();
    return event;
  };
  const action = (stepId, kind = 'message', npcId = core.NpcIdentifiers.KOVAC) =>
    emit('npc-dialogue:action', { npcId, stepId, kind });
  const choice = (option, npcId = core.NpcIdentifiers.KOVAC) =>
    emit('npc-dialogue:choice', { npcId, option });
  const step = (name) => emit('giants-foundry:step', { step: name });
  const variant = (npcId = core.NpcIdentifiers.KOVAC) =>
    variantHooks.map((handler) => handler({ player, npcId })).find(Boolean) ?? null;
  const condition = (stepId, npcId = core.NpcIdentifiers.KOVAC) => {
    for (const handler of conditionHooks) {
      const answer = handler({ player, npcId, stepId });
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const npcClick = (npcId, clickType = 1) => {
    const event = { player, npcId, clickType, handled: false };
    for (const handler of npcHooks) handler(event);
    return event;
  };
  const objectClick = (objectId, x = 3361, y = FOUNDRY_Y, clickType = 1) => {
    const event = { player, objectId, clickType, handled: false, location: { x, y, z: 0 } };
    for (const handler of objectHooks) handler(event);
    return event;
  };
  const tick = (count) => { while (count-- > 0) [...tasks].forEach((task) => task.tick()); };

  return {
    quest, player, attributes, items, messages, varbits, xp, npcs, transcripts,
    hook, line, action, choice, step, variant, condition, npcClick, objectClick, tick,
    on(name, handler) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
    },
    setStage: (value) => quest.setStage(player, value),
    setFreeSlots: (value) => { freeSlots = value; },
    login() {
      for (const handler of loginHooks) handler({ player });
      runtime.sendQuestVarps({ player });
    },
  };
}

function startQuest(h) {
  h.npcClick(core.NpcIdentifiers.HILL_GIANT_12, 1);
  assert.deepEqual(h.transcripts.at(-1), {
    npcId: core.NpcIdentifiers.HILL_GIANT_12,
    page: PAGE,
    variant: 'starting-out-talking-to-kovac',
  });
  assert.equal(h.quest.getStage(h.player), 0, 'the start hook, not the Strike click, starts the quest');
  h.hook(START_HOOK);
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(h.varbits.get(QUEST_VARBIT), 5, 'stage 1 begins on the helper step-5 wire value');
  h.line('We fix tools...');
  assert.equal(h.attributes.get('sleeping-giants:introduction'), 15);
  assert.equal(h.varbits.get(QUEST_VARBIT), 15, 'stage 1 after the intro reads helper step 15');
}

function repair(h, objectId, lineText) {
  const event = h.objectClick(objectId, 3364, 11497);
  assert.equal(event.handled, true);
  h.choice('Yes.');
  h.line(lineText);
  h.tick(20);
}

test('the mandatory route walks stage 0 to the cache completion wire 13902=30', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  const commissions = [];
  h.on('giants-foundry:start-commission', (event) => commissions.push(event));

  startQuest(h);

  h.items.set(I.OAK_LOGS, 3);
  h.items.set(I.STEEL_NAILS, 10);
  h.items.set(I.WOOL, 1);
  h.items.set(I.CHISEL, 1);
  h.items.set(I.HAMMER, 1);

  repair(h, 44773, "That looks like it'll do the trick. What do you think?");
  assert.equal(h.items.get(I.OAK_LOGS), 2);
  assert.equal(h.items.get(I.STEEL_NAILS), 5);
  assert.equal(h.varbits.get(REPAIR_VARBITS[0]), 2);
  assert.equal(h.varbits.get(QUEST_VARBIT), 15, 'one repaired tool is still helper step 15');

  repair(h, 44774, 'Well that required a bit of elbow grease. It should be good to go now.');
  assert.equal(h.items.get(I.CHISEL), 1, 'the grindstone keeps the chisel');
  assert.equal(h.varbits.get(REPAIR_VARBITS[1]), 2);
  assert.equal(h.quest.getStage(h.player), 1);

  repair(h, 44775, 'Not my finest work, but I think it will do.');
  assert.equal(h.items.get(I.OAK_LOGS), 0);
  assert.equal(h.items.get(I.STEEL_NAILS), 0);
  assert.equal(h.items.get(I.WOOL), 0);
  assert.equal(h.varbits.get(REPAIR_VARBITS[2]), 2);
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.varbits.get(QUEST_VARBIT), 15, 'all tools repaired before the briefing is still 15');

  h.line('Kovac agree. Ready to make sword?');
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.varbits.get(QUEST_VARBIT), 20, 'briefed reads helper step 20');
  h.line('then we can start.');
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.varbits.get(QUEST_VARBIT), 25, 'commission reads helper step 25');

  h.line('Kovac need a Flat Broad sword.');
  assert.deepEqual(commissions.at(-1).words, [3, 4]);
  assert.equal(commissions.at(-1).tutorial, true);
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 5);
  h.line('Load metals into crucible until it looks full.');
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 10, 'commission received matches QH >=10');
  h.objectClick(44779, 3370, FOUNDRY_Y);
  assert.deepEqual(h.transcripts.at(-1), {
    npcId: core.NpcIdentifiers.KOVAC,
    page: PAGE,
    variant: 'make-a-sword-searching-crate',
  });
  h.action('BkbGGN');
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 15, 'crate looted matches QH >=15');
  assert.equal(h.items.get(I.BRONZE_BAR), 8);
  assert.equal(h.items.get(I.IRON_BAR), 6);
  assert.equal(h.items.get(I.BRONZE_BATTLEAXE), 2);
  assert.equal(h.items.get(I.IRON_LONGSWORD), 2);
  assert.equal(h.items.get(I.BRONZE_PLATEBODY), 1);
  assert.equal(h.items.get(I.IRON_PLATEBODY), 1);

  h.step('metal-added');
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 20);
  h.step('crucible-full');
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 25);
  assert.equal(h.variant(), 'make-a-sword-talking-to-kovac-after-filling-the-crucible');
  h.line('a forte, a blade and a tip.');
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 30, 'mould briefing matches QH >=30');

  h.step('mould-set');
  assert.equal(h.quest.getStage(h.player), 6);
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 35);
  assert.equal(h.variant(), 'make-a-sword-talking-to-kovac-after-setting-the-mould');
  h.line('Well done little one. We are ready.');
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 40, 'pour briefing matches QH >=40');

  h.step('poured');
  assert.equal(h.quest.getStage(h.player), 7);
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 45);
  assert.equal(h.variant(), 'make-a-sword-before-picking-up-the-preform');
  h.step('preform-taken');
  assert.equal(h.quest.getStage(h.player), 9);
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 50, 'preform taken matches QH >=50');

  h.step('hammered');
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(h.variant(), 'make-a-sword-talking-to-him-after-hammering-the-preform-enough');
  h.step('ground');
  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.variant(), 'make-a-sword-talking-to-him-after-hammering-the-preform-enough-2');
  h.step('finished');
  assert.equal(h.quest.getStage(h.player), 12);
  assert.equal(h.variant(), 'make-a-sword-handing-in-the-sword');
  assert.equal(h.varbits.get(QUEST_VARBIT), 25, 'the whole sword leg stays on helper step 25');

  h.varbits.set(13939, 75);
  assert.equal(h.condition('qSPkVz'), false);
  assert.equal(h.condition('z6vfKd'), true);
  assert.equal(h.condition('udi3Mo'), true);
  h.attributes.set('giant-lairs:obor-chests-opened', 1);
  assert.equal(h.condition('udi3Mo'), false);
  assert.equal(h.condition('GTJR2P'), true);

  const discards = [];
  h.on('giants-foundry:discard-preform', (event) => discards.push(event));
  h.action('RydkiD');
  assert.equal(discards.length, 1);
  assert.equal(discards[0].preserveQuality, true);
  h.action('Y7bMs-', 'action');
  assert.equal(discards.length, 2);
  assert.equal(h.quest.getStage(h.player), 13);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.varbits.get(QUEST_VARBIT), 30, 'completion maps to the cache threshold 30');
  assert.deepEqual(h.xp, [[core.Skill.SMITHING.getIndex(), 6000]]);
  assert.equal(h.attributes.get(runtime.QUEST_POINTS_ATTRIBUTE), 1);
  assert.equal(h.variant(), null, 'post-quest Kovac is left to the shared NPC owner');

  h.setStage(13);
  h.login();
  assert.equal(h.quest.getStage(h.player), 13, 'the durable completion survives login');
  assert.equal(h.varbits.get(QUEST_VARBIT), 30, 'login re-sends varbit 13902=30');
  assert.equal(h.varbits.get(TUTORIAL_VARBIT), 65, 'login re-sends the handed-in tutorial value');

  const xpAfter = h.xp.length;
  h.action('Y7bMs-', 'action');
  assert.equal(h.quest.getStage(h.player), 13);
  assert.equal(h.xp.length, xpAfter, 'a repeated completion grants no second reward');
});

test('the crate refuses fewer than 20 free slots and the repair refuses missing materials', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  startQuest(h);
  h.setStage(3);

  h.setFreeSlots(19);
  h.objectClick(44779, 3370, FOUNDRY_Y);
  assert.equal(h.condition('jYd0Ih'), true);
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.items.get(I.BRONZE_BAR), undefined);

  h.setFreeSlots(20);
  assert.equal(h.condition('jYd0Ih'), false);

  h.setStage(1);
  h.items.set(I.HAMMER, 1);
  const event = h.objectClick(44773, 3364, 11497);
  assert.equal(event.handled, true);
  h.choice('Yes.');
  assert.equal(h.condition('FNsqM2'), true, 'the transcript takes the no-materials branch');
  h.line("That looks like it'll do the trick. What do you think?");
  h.tick(10);
  assert.equal(h.varbits.get(REPAIR_VARBITS[0]) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(h.items.get(I.HAMMER), 1);
});

test('the shared Pile of Buckets 33309 gives a bucket only at the foundry tile', () => {
  const h = setup();
  const I = core.ItemIdentifiers;

  const throneRoom = h.objectClick(33309, 2867, 3934);
  assert.equal(throneRoom.handled, false, 'My Arm throne room pile 2867,3934 is not ours');
  assert.equal(h.items.get(I.BUCKET), undefined);

  const foundry = h.objectClick(33309, 3361, FOUNDRY_Y);
  assert.equal(foundry.handled, true);
  assert.equal(h.items.get(I.BUCKET), 1);

  h.setFreeSlots(0);
  h.objectClick(33309, 3361, FOUNDRY_Y);
  assert.equal(h.items.get(I.BUCKET), 1);
  assert.ok(h.messages.includes('You need some free inventory space for a bucket.'));
});

test('the Smithing 15 setup gate and the pre-start cave message are source-backed', () => {
  const h = setup();
  h.player.getSkillManager = () => ({ getMaxLevel: () => 14, getCurrentLevel: () => 14, addExperiences: noop });
  h.npcClick(core.NpcIdentifiers.HILL_GIANT_12, 1);
  assert.equal(h.transcripts.length, 0, 'below 15 Smithing the Strike does not start a conversation');
  assert.ok(h.messages.includes('You need a Smithing level of 15 to help Kovac.'));

  const c = setup();
  const cave = c.objectClick(44635, 3366, 3150);
  assert.equal(cave.handled, true);
  assert.deepEqual(c.transcripts.at(-1), {
    npcId: core.NpcIdentifiers.HILL_GIANT_12,
    page: PAGE,
    variant: 'starting-out-entering-the-cave-before-starting-the-quest',
  });
  assert.equal(c.quest.getStage(c.player), 0);
});
