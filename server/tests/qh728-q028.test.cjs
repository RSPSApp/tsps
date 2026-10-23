// Eadgar's Ruse (Quest Helper 06da90f) route, shared-NPC and item-operation regressions.
// Run from server/: node --test tests/qh728-q028.test.cjs
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
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
let nextIndex = 1;
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function harness(name) {
  const hooks = {}, events = {}, tasks = [], npcs = [], namedNpcs = new Map(), itemActions = new Map(), genericNpc = [];
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  };
  function attach(map, name, actions) {
    const current = map.get(name) ?? {};
    for (const [action, callback] of Object.entries(actions)) {
      const previous = current[action];
      current[action] = previous ? event => {
        const result = previous(event);
        return result === true || event.handled ? result : callback(event);
      } : callback;
    }
    map.set(name, current);
  }
  const api = new Proxy({
    core: { ...core, World: { ...core.World, getNpcs: () => npcs, getNpcsNear: () => npcs }, TaskManager: taskManager,
      MultiChatboxPrompt: { getPending: p => p.prompt } },
    getTaskManager: () => taskManager,
    getWorld: () => ({ getNpcs: () => npcs }),
    onNpcsInteraction: (names, actions) => names.forEach(n => attach(namedNpcs, n, actions)),
    onItemAction: (a, b) => { if (typeof a === 'function') (hooks.onItemAction ??= []).push(a); else itemActions.set(a, b); },
    onNpcInteraction: (npc, actions) => { if (typeof npc === 'function') genericNpc.push(npc); else attach(namedNpcs, npc, actions); },
    onObjectInteraction: fn => (hooks.onObjectInteraction ??= []).push(fn),
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      const npc = { ...definition, removed: false, getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        isRegistered: () => !npc.removed, performAnimation: noop, forceChat: noop };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => { npc.removed = true; },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const h = {
    api, hooks, events, tasks, npcs, namedNpcs, itemActions, genericNpc,
    quest: runtime.getRegisteredQuests().at(-1),
    variant(p, npcId) {
      for (const fn of hooks.onNpcDialogueVariant ?? []) {
        const choice = fn({ player: p, npcId });
        if (choice) return choice;
      }
      return null;
    },
    talk(p, npcId) {
      const choice = h.variant(p, npcId);
      assert.ok(choice, `no variant for ${npcId} at stage ${h.quest.getStage(p)}`);
      runtime.startTranscript(api, p, npcId, typeof choice === 'string' ? h.quest.name : choice.page,
        typeof choice === 'string' ? choice : choice.variant);
    },
    object(p, objectId, option = 'Open', location = { x: 0, y: 0, z: 0 }, object) {
      for (const fn of hooks.onObjectInteraction ?? []) {
        fn({ player: p, objectId, clickType: 1, location, object, definition: { getActions: () => [option] } });
      }
    },
    itemOnItem(p, a, b) {
      for (const fn of hooks.onItemOnItem ?? []) {
        fn({ player: p, usedItemId: a, usedWithItemId: b, itemId: a, targetItemId: b });
      }
    },
    itemOnObject(p, itemId, objectId, object) {
      for (const fn of hooks.onItemOnObject ?? []) {
        fn({ player: p, itemId, objectId, object, clickType: 1 });
      }
    },
    npcAction(p, npcId) {
      for (const fn of genericNpc) {
        const event = { player: p, npcId, npc: null, clickType: 1 };
        if (fn(event) === true || event.handled) return event;
      }
      return null;
    },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    choose(p, text) {
      const prompt = p.prompt;
      assert.ok(prompt, `no menu for ${text}`);
      const index = prompt.options.indexOf(text);
      assert.ok(index >= 0, `missing ${text} in ${prompt.options}`);
      p.prompt = null;
      prompt.pairs[index * 2 + 1]();
    },
    continueUntil(p, predicate, limit = 600) {
      while (!predicate()) {
        assert.ok(limit-- > 0, `dialogue stalled at ${JSON.stringify(p.text)}`);
        assert.ok(p.manager.getCurrent(), `dialogue ended at ${JSON.stringify(p.text)}`);
        p.manager.advance();
      }
    },
    toPrompt(p, limit = 600) {
      while (!p.prompt) {
        assert.ok(limit-- > 0, `no menu at ${JSON.stringify(p.text)}`);
        assert.ok(p.manager.getCurrent(), `dialogue ended at ${JSON.stringify(p.text)}`);
        p.manager.advance();
      }
    },
    finish(p) { h.continueUntil(p, () => !p.manager.getCurrent() && !p.prompt); },
    playThrough(p, closing = 'No thanks, Eadgar.', limit = 600) {
      for (let i = 0; i < limit; i++) {
        if (p.prompt) {
          const options = p.prompt.options;
          const preferred = options.indexOf(closing);
          if (preferred >= 0) h.choose(p, closing);
          else if (options.includes('More...')) h.choose(p, 'More...');
          else h.choose(p, options[options.length - 1]);
          continue;
        }
        if (!p.manager.getCurrent()) return;
        p.manager.advance();
      }
      assert.fail(`dialogue did not finish at ${JSON.stringify(p.text)}`);
    },
  };
  return h;
}

function player() {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [];
  const inv = {
    getAmount: id => items.get(id) ?? 0,
    getFreeSlots: () => p.freeSlots ?? (28 - items.size),
    isFull: () => inv.getFreeSlots() === 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds(id, amount) {
      const before = items.get(id) ?? 0;
      if (before === 0 && typeof p.freeSlots === 'number') p.freeSlots = Math.max(0, p.freeSlots - 1);
      items.set(id, before + amount);
    },
    forceAdd(owner, item) {
      if (inv.getFreeSlots() <= 0) p.ground.push(item);
      else items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount());
    },
    deleteNumber(id, amount) {
      const have = items.get(id) ?? 0;
      const del = Math.min(amount, have);
      if (del <= 0) return;
      const after = have - del;
      if (after === 0 && typeof p.freeSlots === 'number') p.freeSlots += 1;
      items.set(id, after);
    },
  };
  const packet = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    getVarbit: id => varbits.get(id) ?? 0,
    sendConfig(id, value) { configs.set(id, value); return packet; },
    getConfig: id => configs.get(id) ?? 0,
    sendString(text, uid) { p.text = text; log.push(['text', uid, text]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (target, key) => target[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = {
    attrs, items, configs, varbits, log, xp, messages: [], ground: [], banks: [], prompt: null, text: '', levels: {}, eq: {},
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inv,
    getBanks: () => p.banks,
    getEquipment: () => ({ get: slot => p.eq[slot] ? { getId: () => p.eq[slot] } : null }),
    getPacketSender: () => packet,
    getDialogueManager: () => p.manager,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
      getCombatLevel: () => 3, getCurrentLevel: skill => p.levels[skill.getIndex()] ?? 99,
      getMaxLevel: skill => p.levels[skill.getIndex()] ?? 99 }),
    getLocation: () => new core.Location(2899, 3429, 1), moveTo: noop, getUsername: () => 'Q028',
    sendMessage: text => p.messages.push(text), isRegistered: () => true, isPlayerBot: () => false,
  };
  p.manager = new DialogueManager(p);
  return p;
}

function eadgarsRuse({ druidic = 4, trollStronghold = 50, herblore = 31 } = {}) {
  const h = harness('EadgarsRuse');
  const p = player();
  p.attrs.set('quest.druidic_ritual.stage', druidic);
  p.attrs.set('quest.troll_stronghold.stage', trollStronghold);
  p.levels[core.Skill.HERBLORE.getIndex()] = herblore;
  const stage = () => h.quest.getStage(p);
  return { h, p, stage };
}

function startQuest(h, p) {
  h.talk(p, N.SANFEW);
  h.toPrompt(p);
  h.choose(p, 'Ask general questions.');
  h.toPrompt(p);
  h.choose(p, 'Have you any more work for me, to help reclaim the circle?');
  h.toPrompt(p);
  h.choose(p, 'Yes.');
  h.finish(p);
}

function sawText(p, pattern) {
  return p.log.some(([kind, uid, text]) => kind === 'text' && typeof text === 'string' && pattern.test(text));
}

test("Eadgar's Ruse runs stage 0 to the cache completion value through the registered handlers", () => {
  const { h, p, stage } = eadgarsRuse();

  startQuest(h, p);
  assert.equal(stage(), 10);
  assert.equal(p.configs.get(335), 10, 'the start is mirrored to varp 335');

  h.talk(p, N.EADGAR);
  h.toPrompt(p);
  h.choose(p, 'I need to find some goutweed.');
  h.finish(p);
  assert.equal(stage(), 15, 'Eadgar explains goutweed troll cooking');

  h.talk(p, N.BURNTMEAT);
  h.finish(p);
  assert.equal(stage(), 25, 'talking after Eadgar records the cook-first branch');

  h.talk(p, N.EADGAR);
  h.toPrompt(p);
  assert.equal(sawText(p, /Have you talked to the troll cook yet\?/), true,
    'the Eadgar-before-Burntmeat branch is selected at stage 25');
  h.choose(p, 'No thanks, Eadgar.');
  h.finish(p);
  assert.equal(stage(), 30, 'the zoo hint starts the parrot leg');

  for (const question of ['When did you add it?', 'What do you feed them?']) {
    h.talk(p, N.PARROTY_PETE);
    h.toPrompt(p);
    h.choose(p, question);
    h.finish(p);
  }
  assert.equal(p.attrs.get('quest.eadgars_ruse.pete'), 3, 'both Parroty Pete answers are recorded');

  p.items.set(I.PINEAPPLE_CHUNKS, 1);
  p.items.set(I.VODKA, 1);
  h.itemOnItem(p, I.PINEAPPLE_CHUNKS, I.VODKA);
  assert.equal(p.items.get(I.ALCO_CHUNKS), 1);
  assert.equal(p.items.get(I.PINEAPPLE_CHUNKS), 0);
  assert.equal(p.items.get(I.VODKA), 0);

  h.itemOnObject(p, I.ALCO_CHUNKS, O.AVIARY_HATCH, { getDefinition: () => ({ getName: () => 'Aviary hatch' }) });
  h.playThrough(p);
  assert.equal(p.items.get(I.DRUNK_PARROT), 1);
  assert.equal(p.items.get(I.ALCO_CHUNKS), 0);

  h.talk(p, N.EADGAR);
  h.playThrough(p);
  assert.equal(stage(), 50, 'giving Eadgar the parrot explains the fake-man plan');

  h.itemOnObject(p, I.DRUNK_PARROT, O.RACK_4, { getDefinition: () => ({ getName: () => 'Rack' }) });
  assert.equal(stage(), 60);
  assert.equal(p.items.get(I.DRUNK_PARROT), 0);
  assert.match(p.messages.at(-1), /hide the parrot/);

  p.items.set(I.LOGS, 1);
  p.items.set(I.RAW_CHICKEN, 5);
  p.items.set(I.GRAIN, 10);
  p.items.set(I.DIRTY_ROBE, 1);
  h.talk(p, N.EADGAR);
  h.playThrough(p);
  assert.equal(stage(), 70);
  assert.equal(p.items.get(I.LOGS), 0);
  assert.equal(p.items.get(I.RAW_CHICKEN), 0);
  assert.equal(p.items.get(I.GRAIN), 0);
  assert.equal(p.items.get(I.DIRTY_ROBE), 0);
  assert.equal(p.attrs.get('quest.eadgars_ruse.supplies'), 343, 'the packed supply state is persisted');

  h.talk(p, N.EADGAR);
  h.playThrough(p);
  assert.equal(stage(), 80, 'the second supply visit teaches the truth potion');

  h.npcAction(p, N.THISTLE);
  assert.equal(p.items.get(I.TROLL_THISTLE), 1);
  h.itemOnObject(p, I.TROLL_THISTLE, 26185, { getDefinition: () => ({ getName: () => 'Fire' }) });
  assert.equal(p.items.get(I.DRIED_THISTLE), 1);
  assert.equal(p.items.get(I.TROLL_THISTLE), 0);

  p.items.set(I.PESTLE_AND_MORTAR, 1);
  h.itemOnItem(p, I.DRIED_THISTLE, I.PESTLE_AND_MORTAR);
  assert.equal(p.items.get(I.GROUND_THISTLE), 1);

  p.items.set(I.RANARR_POTION_UNF_, 1);
  h.itemOnItem(p, I.GROUND_THISTLE, I.RANARR_POTION_UNF_);
  assert.equal(p.items.get(I.TROLL_POTION), 1);
  assert.equal(p.items.get(I.GROUND_THISTLE), 0);

  h.talk(p, N.EADGAR);
  h.playThrough(p);
  assert.equal(stage(), 85);
  assert.equal(p.items.get(I.TROLL_POTION), 0);

  h.object(p, O.RACK_4, 'Search');
  h.playThrough(p);
  assert.equal(stage(), 86);
  assert.equal(p.items.get(I.DRUNK_PARROT), 1);

  h.talk(p, N.EADGAR);
  h.playThrough(p);
  assert.equal(stage(), 87);
  assert.equal(p.items.get(I.FAKE_MAN), 1);
  assert.equal(p.items.get(I.DRUNK_PARROT), 0);

  h.talk(p, N.BURNTMEAT);
  h.toPrompt(p);
  h.choose(p, 'So, where can I get some goutweed?');
  h.finish(p);
  assert.equal(stage(), 90);
  assert.equal(p.items.get(I.BURNT_MEAT), 1);
  assert.equal(p.items.get(I.FAKE_MAN), 0);

  h.object(p, O.KITCHEN_DRAWERS, 'Search');
  assert.equal(p.items.get(I.STOREROOM_KEY), 1);
  h.object(p, O.STOREROOM_DOOR, 'Open');
  assert.equal(stage(), 100);
  assert.equal(p.items.get(I.STOREROOM_KEY), 0);

  h.object(p, O.GOUTWEED_CRATE, 'Search');
  assert.equal(p.items.get(I.GOUTWEED), 1);

  h.talk(p, N.SANFEW);
  h.toPrompt(p);
  h.choose(p, 'Ask general questions.');
  h.finish(p);
  assert.equal(stage(), 110, 'Sanfew hand-in reaches the cache completion threshold');
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.items.get(I.GOUTWEED), 0);
  assert.deepEqual(p.xp, [[core.Skill.HERBLORE.getIndex(), 11000]]);
  assert.equal(p.configs.get(335), 110, 'completion is mirrored to varp 335');
  assert.equal(p.attrs.get('quest.points'), 1);

  runtime.sendQuestVarps({ player: p });
  assert.equal(p.configs.get(335), 110, 'login replay keeps the canonical completion wire');

  const xp = JSON.stringify(p.xp);
  h.talk(p, N.SANFEW);
  h.toPrompt(p);
  h.choose(p, 'Ask general questions.');
  h.toPrompt(p);
  h.choose(p, 'Actually, I don\'t need to speak to you.');
  h.finish(p);
  assert.equal(stage(), 110);
  assert.equal(JSON.stringify(p.xp), xp, 'the completion reward is not granted twice');
});

test('talking to Burntmeat first keeps the did-not-talk-to-Eadgar branch', () => {
  const { h, p, stage } = eadgarsRuse();
  startQuest(h, p);
  h.talk(p, N.BURNTMEAT);
  h.finish(p);
  assert.equal(stage(), 20, 'talking to Burntmeat without Eadgar records the out-of-order state');

  h.talk(p, N.EADGAR);
  h.toPrompt(p);
  assert.equal(sawText(p, /Sanfew, you say\?/), true,
    'the did-not-talk-to-Eadgar branch is selected at stage 20');
  h.choose(p, 'No thanks, Eadgar.');
  h.finish(p);
  assert.equal(stage(), 30);
});

test('using pineapple chunks on the hatch consumes exactly one chunk', () => {
  const { h, p, stage } = eadgarsRuse();
  h.quest.setStage(p, 30);
  p.items.set(I.PINEAPPLE_CHUNKS, 2);
  h.itemOnObject(p, I.PINEAPPLE_CHUNKS, O.AVIARY_HATCH, { getDefinition: () => ({ getName: () => 'Aviary hatch' }) });
  h.playThrough(p);
  assert.equal(p.items.get(I.PINEAPPLE_CHUNKS), 1, 'the transcript give action consumes the chunk once');
  assert.equal(p.items.get(I.DRUNK_PARROT), undefined);
  assert.equal(stage(), 30);
});

test('a player who has lost the fake man gets another from Eadgar', () => {
  const { h, p, stage } = eadgarsRuse();
  h.quest.setStage(p, 87);
  assert.equal(p.items.get(I.FAKE_MAN), undefined);
  h.talk(p, N.EADGAR);
  h.playThrough(p);
  assert.equal(p.items.get(I.FAKE_MAN), 1, 'the lost-fake-man condition hands one back');
  assert.equal(stage(), 87);
});

test('a player who lost the parrot before the hand-in still gets the fake man', () => {
  const { h, p, stage } = eadgarsRuse();
  h.quest.setStage(p, 86);
  h.talk(p, N.EADGAR);
  h.toPrompt(p);
  assert.equal(p.text.length > 0, true);
  h.choose(p, 'No thanks, Eadgar.');
  h.finish(p);
  assert.equal(p.items.get(I.FAKE_MAN), 1);
  assert.equal(stage(), 87);
});

test('Sanfew does not hand in goutweed before the quest has opened the storeroom', () => {
  const { h, p, stage } = eadgarsRuse();
  p.items.set(I.GOUTWEED, 1);
  const variant = h.variant(p, N.SANFEW);
  assert.equal(variant, 'getting-started-talking-to-sanfew');
  h.talk(p, N.SANFEW);
  h.toPrompt(p);
  h.choose(p, 'Ask general questions.');
  h.toPrompt(p);
  h.choose(p, 'Have you any more work for me, to help reclaim the circle?');
  h.toPrompt(p);
  h.choose(p, 'Yes.');
  h.finish(p);
  assert.equal(stage(), 10);
  assert.equal(p.items.get(I.GOUTWEED), 1, 'the goutweed is not accepted before stage 100');
});

test('Sanfew yields to Druidic Ritual before it is complete', () => {
  const { h, p } = eadgarsRuse({ druidic: 0, trollStronghold: 0 });
  assert.equal(h.variant(p, N.SANFEW), null);
});

test('Tegid and Burntmeat yield outside their Eadgar windows', () => {
  const { h, p } = eadgarsRuse();
  assert.equal(h.variant(p, N.TEGID), null, 'a fresh Eadgar save does not steal Tegid');
  h.quest.setStage(p, 70);
  assert.equal(h.variant(p, N.TEGID), 'obtaining-the-robes-talking-to-tegid-about-the-robes');
  h.quest.setStage(p, 110);
  assert.equal(h.variant(p, N.BURNTMEAT), null, 'post-quest Burntmeat is left to his own page');
});
