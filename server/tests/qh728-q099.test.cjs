// A Ruff Situation (q099) registered-dispatch contract.
// From server/: node --test tests/qh728-q099.test.cjs
//
// Fixture start: stage 0 unless a test names a later stage; inventory, varbit
// packets and skills are test doubles. Every transition below is delivered
// through the plugin's real npc-dialogue hooks, NPC interaction handlers or
// login hooks, never by calling a local helper. The dialogue runtime itself is
// replaced with a recorder so these tests prove handler/state contracts only;
// the existing p2p-varlamore-pair-parity suite owns the scene choreography.
const assert = require('node:assert/strict');
const { test } = require('node:test');
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
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
const PAGE = { page: 'A Ruff Situation' };
const VARP_DOGQUEST = 5742, STAGE_VARBIT = 15889, COMPLETION = 120;
let nextIndex = 1;
const noop = () => {};

const transcripts = [];
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};

function harness() {
  const hooks = {}, events = {}, tasks = [], areas = [], npcs = [], namedNpcs = new Map();
  const api = new Proxy({
    core: { ...core, TaskManager: {
      submit(task) { task.setRunning(true); tasks.push(task); },
      cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
    } },
    registerArea: area => areas.push(area),
    onNpcInteraction: (name, actions) => namedNpcs.set(name, actions),
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(_player, title, ...pairs) { prompt = { title, pairs }; return true; },
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z);
      const npc = { ...definition, getId: () => definition.id, getIndex: () => npc.index, index: nextIndex++,
        getLocation: () => location, moveTo: to => { location = to; }, isNpc: () => true, isPlayer: () => false,
        getAsNpc: () => npc, isRegistered: () => !npc.removed, setPositionToFace: noop, forceChat: noop,
        getArea: () => null, setArea: noop,
        getMovementQueue: () => ({ reset() { return this; }, addSteps: to => { npc.walkingTo = to; } }),
        setFollowing: target => { npc.following = target; }, setMobileInteraction: noop, setMovementSteps: noop,
        getOwner: () => definition.owner,
      };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => { npc.removed = true; },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  let prompt = null;
  require('../plugins/quests/quests/ARuffSituation.Quest')(api);
  const h = {
    api, hooks, events, tasks, areas, npcs, namedNpcs,
    quest: runtime.getRegisteredQuests().findLast(entry => entry.key === 'a_ruff_situation'),
    get prompt() { return prompt; },
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    line(p, npcId, text) {
      const event = { player: p, npcId, text, pages: [PAGE] };
      h.emit('npc-dialogue:line', event);
      event.before?.(); event.after?.();
      return event;
    },
    action(p, npcId, stepId) {
      const event = { player: p, npcId, stepId, pages: [PAGE], handled: false };
      h.emit('npc-dialogue:action', event);
      return event;
    },
    message(p, npcId, text) {
      const event = { player: p, npcId, text, kind: 'message', pages: [PAGE], handled: false };
      h.emit('npc-dialogue:action', event);
      return event;
    },
    hook(p, npcId, hook) { h.emit('npc-dialogue:hook', { player: p, npcId, hook }); },
    login(p) { for (const fn of hooks.onPlayerLogin ?? []) fn({ player: p }); },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
  };
  return h;
}

function player(level = 15) {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), xp = [], messages = [];
  let location = new core.Location(3197, 3414, 0), area = null;
  const inv = {
    getAmount: id => items.get(id) ?? 0, contains: id => (items.get(id) ?? 0) > 0,
    isFull: () => Boolean(p.full), getFreeSlots: () => p.full ? 0 : 28,
    adds(id, amount = 1) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount = 1) { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); },
  };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); return packet; },
  }, { get: (target, key) => target[key] ?? ((...args) => packet) });
  const p = {
    full: false, attrs, items, configs, varbits, xp, messages, level, prompt: null,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inv, getPacketSender: () => packet, getDialogueManager: () => p.manager,
    getSkillManager: () => ({
      getMaxLevel: () => p.level,
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
      getExperience: () => 0,
    }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; },
      addSteps(to) { location = to; return this; } }),
    setUntargetable: value => { p.untargetable = value; },
    getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; },
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    index: nextIndex++, getIndex: () => p.index,
    getUsername: () => 'qh728-q099', sendMessage: text => messages.push(text), performAnimation: noop,
    getBanks: () => [],
  };
  p.manager = new DialogueManager(p);
  return p;
}

function clean(_p) { transcripts.length = 0; }

test('stuffed-dog crafting cannot regress the hunt or a stale accepted craft menu', () => {
  const h = harness(), p = player();
  for (const id of [I.GRAIN, I.FUR, I.NEEDLE, I.THREAD]) p.items.set(id, 1);
  h.quest.setStage(p, 60);
  const craft = h.hooks.onItemOnItem[0];
  const use = () => craft({ player: p, usedItemId: I.GRAIN, usedWithItemId: I.FUR, handled: false });
  use();
  const accept = h.prompt.pairs[1];
  assert.equal(typeof accept, 'function');
  h.quest.setStage(p, 70);
  p.setAttribute('quest.a_ruff_situation.goblins-left', true);
  accept();
  assert.equal(h.quest.getStage(p), 70);
  assert.equal(p.items.get(I.GRAIN), 1);
  assert.equal(p.items.get(I.FUR), 1);
  assert.equal(p.items.get(I.STUFFED_DOG) ?? 0, 0);
  use();
  assert.equal(h.quest.getStage(p), 70);
  assert.equal(p.items.get(I.STUFFED_DOG) ?? 0, 0);
  h.quest.setStage(p, 66);
  use();
  h.prompt.pairs[1]();
  assert.equal(p.items.get(I.STUFFED_DOG), 1);
  assert.equal(h.quest.getStage(p), 66, 'a retry never lowers an already reached trade stage');
});

test('Ruff starts only at 15 Crafting, sets helper stage 5 on the start hook and 10 on the following Gertrude line', () => {
  const h = harness(), p = player(14);
  p.level = 14;
  h.hook(p, N.TALIA_2, 'quest:a-ruff-situation:start');
  assert.equal(h.quest.getStage(p), 0);
  p.level = 15;
  h.hook(p, N.TALIA_2, 'quest:a-ruff-situation:start');
  assert.equal(h.quest.getStage(p), 5);
  assert.equal(p.varbits.get(STAGE_VARBIT), 5);
  h.line(p, N.TALIA_2, 'Gertrude.');
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.varbits.get(STAGE_VARBIT), 10);
  // Out of stage, Gertrude Talk-to is released so another quest's handler can claim her.
  const fresh = player();
  assert.equal(h.namedNpcs.get('Gertrude')['Talk-to']({ player: fresh, npcId: 3500 }), false);
});

test('Ruff inspection completion survives a closed conversation and relog: dog Interact replays the tail and reaches stage 35/route cook', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, 30);
  h.login(p);
  assert.equal(h.quest.getStage(p), 30);
  assert.equal(p.varbits.get(STAGE_VARBIT), 30);
  clean(p);
  h.namedNpcs.get('Stray dog').Interact({ player: p, npcId: N.STRAY_DOG_8 });
  assert.deepEqual(transcripts.at(-1), { npcId: N.STRAY_DOG_8, page: 'A Ruff Situation', variant: 'at-the-dog-s-house-after-inspecting-all-three-objects' });
  h.line(p, N.STRAY_DOG_8, "What's wrong? Have you caught their scent?");
  assert.equal(h.quest.getStage(p), 35);
  assert.equal(p.varbits.get(STAGE_VARBIT), 35);
  p.moveTo(new core.Location(3197, 3414, 0));
  h.areas[0].process(p);
  const dog = h.npcs.findLast(npc => !npc.removed && npc.id === N.STRAY_DOG_8);
  assert.ok(dog.walkingTo, 'the Cooks Guild route starts after the recovered line');
});

test('Ruff dog sniff reminder cannot skip the goblin trade; the second-puppy conversation still advances to stage 80', () => {
  const h = harness(), p = player();
  p.items.set(I.STRAY_PUPPY, 1);
  h.quest.setStage(p, 60);
  h.login(p);
  assert.equal(h.quest.getStage(p), 60);
  assert.equal(p.varbits.get(STAGE_VARBIT), 60);
  clean(p);
  h.namedNpcs.get('Stray dog').Interact({ player: p, npcId: N.STRAY_DOG_8 });
  assert.equal(transcripts.at(-1).variant, 'cutscene-interacting-with-the-stray-dog');
  h.message(p, N.STRAY_DOG_8, 'The stray dog sniffs the air...');
  h.tick(3);
  assert.equal(h.quest.getStage(p), 60, 'reminder must not jump past the stuffed-dog barter');
  assert.equal(p.varbits.get(STAGE_VARBIT), 60);

  const q = player();
  q.items.set(I.STRAY_PUPPY, 1);
  q.items.set(I.STRAY_PUPPY_2, 1);
  h.quest.setStage(q, 75);
  h.login(q);
  clean(q);
  h.namedNpcs.get('Stray dog').Interact({ player: q, npcId: N.STRAY_DOG_8 });
  assert.equal(transcripts.at(-1).variant, 'looking-for-the-third-puppy');
  h.message(q, N.STRAY_DOG_8, 'The stray dog sniffs the air...');
  h.tick(3);
  assert.equal(h.quest.getStage(q), 80);
  assert.equal(q.varbits.get(STAGE_VARBIT), 80);
});

test('Ruff final hand-in consumes the puppies and completes at the cache threshold 120 on varbit 15889, once, then offers post-quest talk', () => {
  const h = harness(), p = player();
  for (const id of [I.STRAY_PUPPY, I.STRAY_PUPPY_2, I.STRAY_PUPPY_3]) p.items.set(id, 1);
  h.quest.setStage(p, 105);
  h.login(p);
  clean(p);
  h.namedNpcs.get('Talia')['Talk-to']({ player: p, npcId: N.TALIA_2 });
  h.tick(7);
  assert.equal(h.quest.getStage(p), 115);
  assert.equal(transcripts.at(-1).variant, 'looking-for-the-third-puppy-back-at-the-shelter');
  h.action(p, N.TALIA_2, '9JXyoS');
  assert.equal(p.items.get(I.STRAY_PUPPY), 0);
  assert.equal(p.items.get(I.STRAY_PUPPY_2), 0);
  assert.equal(p.items.get(I.STRAY_PUPPY_3), 0);
  assert.equal(h.quest.isComplete(p), false);
  h.line(p, N.TALIA_2, 'Business is business.');
  assert.equal(h.quest.getStage(p), COMPLETION);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.varbits.get(STAGE_VARBIT), COMPLETION);
  assert.equal(p.configs.has(VARP_DOGQUEST), false, 'stage must be written as varbit 15889, not the parent varp');
  assert.deepEqual(p.xp, [[core.Skill.CRAFTING.getIndex(), 1000]]);
  assert.equal(p.attrs.get('quest.points'), 1);
  assert.equal(h.quest.complete(p), false);
  assert.deepEqual(p.xp, [[core.Skill.CRAFTING.getIndex(), 1000]]);
  h.tick(2);
  clean(p);
  h.namedNpcs.get('Talia')['Talk-to']({ player: p, npcId: N.TALIA_2 });
  assert.equal(transcripts.at(-1).variant, 'post-quest-dialogue');
});
