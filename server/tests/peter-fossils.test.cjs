// Peter (Fossil Island Museum Camp): fossil drop toggles through the real transcript runner.
// Run from server/: node --test tests/peter-fossils.test.cjs
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
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
let nextIndex = 1;
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function harness(nameOrNames) {
  const hooks = {}, events = {}, tasks = [];
  let npcOps = null;
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  };
  const api = new Proxy({
    core: { ...core, TaskManager: taskManager,
      MultiChatboxPrompt: { getPending: p => p.prompt } },
    getTaskManager: () => taskManager,
    persistAttribute: noop,
    onNpcInteraction: (name, ops) => { assert.equal(name, 'Peter'); npcOps = ops; },
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require('../plugins/npcs/Peter.plugin').register(api);
  // The dialogue plugin's "npc-dialogue:start": play the named variant from the real transcript.
  (events['npc-dialogue:start'] ??= []).push(request => {
    request.handled = runtime.startTranscript(api, request.player, request.npcId, request.variant.page, request.variant.variant, undefined, request.npc ?? null);
  });
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const h = { api, hooks, events, tasks,
    toggle: event => npcOps['Toggle Fossils'](event),
    talk(p, npcId) {
      const choice = (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean);
      assert.ok(choice, `no variant for ${npcId}`);
      runtime.startTranscript(api, p, npcId, choice.page, choice.variant);
    },
    tick(count) { while (count-- > 0) {
      [...tasks].forEach(task => task.tick());
      for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].isRunning?.() === false) tasks.splice(i, 1);
    } },
    choose(p, text) {
      const prompt = p.prompt; assert.ok(prompt, `no menu for ${text}`);
      const index = prompt.options.indexOf(text); assert.ok(index >= 0, `missing ${text} in ${prompt.options}`);
      p.prompt = null; prompt.pairs[index * 2 + 1]();
    },
    continueUntil(p, predicate, limit = 500) {
      while (!predicate()) {
        assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`);
        h.tick(1);
        if (tasks.length) continue;
        if (p.manager.getCurrent()) p.manager.advance();
        else assert.fail(`dialogue ended at ${p.text}`);
      }
    },
    finish(p) { h.continueUntil(p, () => !p.manager.getCurrent() && !p.prompt); },
  }; return h;
}

function player() {
  const attrs = new Map(), items = new Map(), varbits = new Map(), log = [], xp = [];
  const inv = { getValidItems: () => [...items].filter(([,amount]) => amount > 0).map(([id,amount]) => new core.Item(id,amount)).concat(p.extraItems ?? []),
    getAmount: id => items.get(id) ?? 0, isFull: () => Boolean(p.full), getFreeSlots: () => p.full ? 0 : 28,
    contains: id => (items.get(id) ?? 0) > 0,
    adds(id, amount) {
      if (!p.full) items.set(id, (items.get(id) ?? 0) + amount);
      return inv;
    },
    forceAdd(p, item) { items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()); },
    deleteNumber(id, amount) { assert.ok((items.get(id) ?? 0) >= amount); items.set(id, (items.get(id) - amount)); },
  };
  const packet = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return packet; }, getVarbit: id => varbits.get(id) ?? 0,
    sendString(text, uid) { if ([6, 3, 2].some(child => [217, 231, 229, 193].some(group => uid === (group << 16 | child)))) p.text = text; log.push(['text', uid, text]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const equipment = new Map();
  const p = { attrs, items, varbits, log, xp, messages: [], animations: [], prompt: null, text: '', amulet: undefined, equipment, full: false, localNpcs: [], index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inv,
    getBanks: () => [{ getAmount: () => 0 }],
    getEquipment: () => ({ getValidItems: () => [...equipment].map(([slot,id]) => new core.Item(id,1)), get: slot => {
      const id = slot === core.Equipment.AMULET_SLOT ? p.amulet : equipment.get(slot);
      return id ? { getId: () => id } : null;
    } }),
    getPacketSender: () => packet, getDialogueManager: () => p.manager,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), getCombatLevel: () => 3,
      getCurrentLevel: () => 99, getMaxLevel: () => 99 }),
    getLocation: () => p.location ?? new core.Location(3045, 3236, 0), moveTo: location => { p.location = location; },
    getLocalNpcs: () => p.localNpcs,
    getUsername: () => 'PeterTest', getDisplayName: () => 'PeterTest', sendMessage: text => p.messages.push(text),
    performAnimation: a => p.animations.push(a.getId()), isRegistered: () => true, isPlayerBot: () => false,
    isPlayer: () => true,
  };
  p.manager = new DialogueManager(p);
  return p;
}


const RARE = () => core.CacheDefinitions.getVarbitId('fossil_drop_rare_blocked');
const NORMAL = () => core.CacheDefinitions.getVarbitId('fossil_drop_blocked');

function setup() {
  const h = harness(), p = player();
  return { h, p };
}
/** Talk-to -> "Talk about fossils." -> rare or normal -> the confirm menu's answer. */
function talk(h, p, kind, answer) {
  runtime.startTranscript(h.api, p, N.PETER, 'Peter', 'standard-dialogue');
  h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, 'Talk about fossils.');
  h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, kind === 'rare' ? "Let's talk about rare ones." : "Let's talk about normal ones.");
  h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, answer);
}
function toggle(h, p, option) {
  const handled = h.toggle({ player: p, npcId: N.PETER, npc: null });
  assert.equal(handled, true, 'Toggle Fossils plays his menu');
  assert.equal(p.prompt.title, 'Toggle rare or normal fossils?');
  h.choose(p, option);
}
function dropBlocked(h, p, itemId) {
  const request = { player: p, itemId, blocked: false };
  h.api.emitCustomEvent('fossil-island:fossil-drop', request);
  return request.blocked;
}

test('Talk about rare fossils: Yes blocks rare fossils as Peter confirms, and the off branch turns them back on', () => {
  const { h, p } = setup();
  talk(h, p, 'rare', "Yes I'm sure.");
  assert.equal(p.varbits.get(RARE()), undefined, 'not yet: the player line shows first');
  h.continueUntil(p, () => p.text.startsWith('So be it'));
  assert.equal(p.varbits.get(RARE()), 1, 'set as Peter says it (rec 3040 tick 2634)');
  h.finish(p);
  assert.equal(dropBlocked(h, p, I.UNIDENTIFIED_RARE_FOSSIL), true);
  assert.equal(dropBlocked(h, p, I.UNIDENTIFIED_SMALL_FOSSIL), false, 'normal fossils still drop');
  // Now off: his "changed your mind" branch.
  talk(h, p, 'rare', "Yes I'm sure.");
  h.continueUntil(p, () => p.text.startsWith('Of course you are!'));
  assert.equal(p.varbits.get(RARE()), 0);
  h.finish(p);
  assert.equal(dropBlocked(h, p, I.UNIDENTIFIED_RARE_FOSSIL), false);
});

test("Changing your mind leaves the toggle alone", () => {
  const { h, p } = setup();
  talk(h, p, 'normal', "Actually, I've changed my mind.");
  h.finish(p);
  assert.equal(p.varbits.has(NORMAL()), false);
  assert.equal(dropBlocked(h, p, I.UNIDENTIFIED_LARGE_FOSSIL), false);
});

test('Toggle Fossils: Rare and Normal flip their own varbit each time', () => {
  const { h, p } = setup();
  toggle(h, p, 'Normal.');
  h.continueUntil(p, () => p.text.startsWith('Fine, regular fossils'));
  assert.equal(p.varbits.get(NORMAL()), 1, 'fossil_drop_blocked (rec 3040 tick 3840)');
  h.finish(p);
  for (const id of [I.UNIDENTIFIED_SMALL_FOSSIL, I.UNIDENTIFIED_MEDIUM_FOSSIL, I.UNIDENTIFIED_LARGE_FOSSIL]) assert.equal(dropBlocked(h, p, id), true);
  assert.equal(dropBlocked(h, p, I.UNIDENTIFIED_RARE_FOSSIL), false);
  assert.equal(dropBlocked(h, p, I.NUMULITE), false, 'numulite is not a fossil drop');
  toggle(h, p, 'Normal.');
  h.continueUntil(p, () => p.text.startsWith('Great!'));
  assert.equal(p.varbits.get(NORMAL()), 0);
  h.finish(p);
  toggle(h, p, 'Rare.');
  h.continueUntil(p, () => p.text.startsWith('That has been done'));
  assert.equal(p.varbits.get(RARE()), 1);
  h.finish(p);
  toggle(h, p, 'Rare.');
  h.continueUntil(p, () => p.text.startsWith('Excellent'));
  assert.equal(p.varbits.get(RARE()), 0);
});

test('the toggles are saved attributes and are sent again on login', () => {
  const { h, p } = setup();
  const Peter = require('../plugins/npcs/Peter.plugin');
  p.setAttribute(Peter._test.RARE_ATTRIBUTE, true);
  h.hooks.onPlayerLogin.forEach(fn => fn({ player: p }));
  assert.equal(p.varbits.get(RARE()), 1);
  assert.equal(p.varbits.get(NORMAL()), 0);
  const persisted = [];
  Peter.register(new Proxy({ core, persistAttribute: (key, value) => persisted.push([key, value]) }, { get: (t, k) => t[k] ?? noop }));
  assert.deepEqual(persisted, [[Peter._test.RARE_ATTRIBUTE, false], [Peter._test.NORMAL_ATTRIBUTE, false]]);
});

test('a drift net roll skips a blocked fossil', () => {
  const { h, p } = setup();
  p.setAttribute(require('../plugins/npcs/Peter.plugin')._test.NORMAL_ATTRIBUTE, true);
  const DriftNets = require('../plugins/skills/hunter/DriftNets.Hunter');
  const Context = require('../plugins/skills/hunter/Context.Hunter');
  Context.H.core = core; Context.H.api = h.api;
  const random = Math.random;
  try {
    Math.random = () => (9 * 3) / 175 + 0.0001; // just inside the small fossil's chance
    assert.equal(DriftNets.fossil(p, 3, 14), null, 'blocked small fossil');
    p.setAttribute(require('../plugins/npcs/Peter.plugin')._test.NORMAL_ATTRIBUTE, false);
    assert.deepEqual(DriftNets.fossil(p, 3, 14), [I.UNIDENTIFIED_SMALL_FOSSIL, 1]);
  } finally { Math.random = random; }
});
