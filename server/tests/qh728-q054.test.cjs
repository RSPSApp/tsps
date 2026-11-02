// The Hand in the Sand (q054, Quest Helper 06da90f) route and wire contract.
// Run from server/: node --test tests/qh728-q054.test.cjs
//
// The full-route test starts at stage 0 and drives the real exported transcript
// variants through the plugin's registered variant/condition/action/line/choice,
// item and object handlers. Only supplies and the two prerequisite skill levels
// are fixture state; no postcondition stage is written. The companion test is a
// handler-only fixture for the shared Wizards' Guild bell (the object route is
// not part of a dialogue transcript).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PacketSender } = require('../dist/net/packet/PacketSender');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;
let nextIndex = 1;
const noop = () => {};
const realStartTranscript = runtime.startTranscript;
// registerQuestWidgets captures api.core once per process, so every harness must
// share the task manager used for transcript overhead lines.
const sharedTasks = [];
const sharedTaskManager = {
  submit(task) { task.setRunning(true); sharedTasks.push(task); },
  cancelTasks() {},
};

const VARBIT = 1527;
const COMPLETE = 160;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  core.ObjectDefinition.init();
});

function harness(options = {}) {
  sharedTasks.length = 0;
  const hooks = {}, events = {}, npcs = [], namedNpcs = new Map(), itemActions = [], genericNpc = [];
  const tasks = sharedTasks;
  const starts = options.captureTranscripts ? [] : null;
  const taskManager = sharedTaskManager;
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
    core: { ...core, World: { ...core.World, getNpcs: () => npcs }, TaskManager: taskManager,
      MultiChatboxPrompt: { getPending: p => p.prompt } },
    getTaskManager: () => taskManager,
    getWorld: () => ({ getNpcs: () => npcs }),
    onNpcsInteraction: (names, actions) => names.forEach(name => attach(namedNpcs, name, actions)),
    onNpcInteraction: (npc, actions) => { if (typeof npc === 'function') genericNpc.push(npc); else attach(namedNpcs, npc, actions); },
    onItemAction: (a, b) => { if (typeof a === 'function') itemActions.push(a); },
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      const npc = { ...definition, removed: false, getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        isRegistered: () => !npc.removed, isVisible: () => true,
        getPrivateArea: () => null, isOwnerOnly: () => false,
        getDefinition: () => ({ getName: () => definition.name }),
        getCurrentDefinition: () => ({ getName: () => definition.name }),
        performAnimation: noop, forceChat: noop };
      npcs.push(npc); return npc;
    },
    removeNpc(npc) { npc.removed = true; },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  const pluginPath = require.resolve('../plugins/quests/quests/HandInTheSand.Quest');
  delete require.cache[pluginPath];
  if (starts) {
    runtime.startTranscript = (_api, _player, npcId, page, variant) => {
      starts.push({ npcId, page, variant });
      return true;
    };
  }
  try {
    require(pluginPath)(api);
  } finally {
    runtime.startTranscript = realStartTranscript;
  }
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  return {
    api, hooks, events, tasks, npcs, namedNpcs, itemActions, genericNpc, starts,
    quest: runtime.getRegisteredQuests().at(-1),
    talk(p, npcId) {
      const choice = (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean);
      assert.ok(choice, `no variant for ${npcId} at stage ${this.quest.getStage(p)}`);
      runtime.startTranscript(api, p, npcId, this.quest.name, choice);
    },
    /** The variant the registered hooks answer with, like PluginManager's first-answer-wins. */
    variantFor(p, npcId) {
      for (const fn of hooks.onNpcDialogueVariant ?? []) {
        const variant = fn({ player: p, npcId });
        if (variant) return variant;
      }
      return null;
    },
    itemOnNpc(p, npcId, itemId) {
      const event = { player: p, npcId, itemId, handled: false };
      for (const fn of hooks.onItemOnNpc ?? []) fn(event);
      return event;
    },
    itemOnItem(p, first, second) {
      const event = { player: p, usedItemId: first, usedWithItemId: second, handled: false };
      for (const fn of hooks.onItemOnItem ?? []) fn(event);
      return event;
    },
    itemOnObject(p, objectId, itemId) {
      const event = { player: p, objectId, itemId, handled: false };
      for (const fn of hooks.onItemOnObject ?? []) fn(event);
      return event;
    },
    itemAction(p, itemId, option) {
      const event = { player: p, itemId, option, handled: false };
      for (const fn of itemActions) fn(event);
      return event;
    },
    object(p, objectId, option) {
      const event = { player: p, objectId, option: option.toLowerCase(), clickType: 1,
        definition: { getActions: () => [option] }, location: { x: 0, y: 0, z: 0 }, handled: false };
      for (const fn of hooks.onObjectInteraction ?? []) {
        fn(event);
        if (event.handled) break;
      }
      return event;
    },
    npcOption(p, name, npcId, option) {
      const event = { player: p, npcId, npc: null, clickType: 1, definition: { getName: () => name } };
      const actions = namedNpcs.get(name);
      assert.ok(actions?.[option], `no ${option} for ${name}`);
      actions[option](event);
      return event;
    },
    choose(p, text) {
      const prompt = p.prompt;
      assert.ok(prompt, `no menu for ${text}`);
      const index = prompt.options.indexOf(text);
      assert.ok(index >= 0, `missing ${text} in ${prompt.options.join(' | ')}`);
      p.prompt = null;
      prompt.pairs[index * 2 + 1]();
    },
    tick(count = 1) { while (count-- > 0) [...tasks].forEach(task => task.tick?.()); },
    continueUntil(p, predicate, limit = 300) {
      while (!predicate()) {
        assert.ok(limit-- > 0, `dialogue stalled at ${JSON.stringify(p.text)}`);
        if (tasks.some(task => task.isRunning?.())) {
          this.tick(1);
          continue;
        }
        assert.ok(p.manager.getCurrent(), `dialogue ended at ${JSON.stringify(p.text)}`);
        p.manager.advance();
      }
    },
    finish(p, limit = 400) {
      while (limit-- > 0) {
        if (p.prompt) return;
        if (tasks.some(task => task.isRunning?.())) {
          this.tick(1);
          continue;
        }
        if (p.manager.getCurrent()) {
          p.manager.advance();
          continue;
        }
        return;
      }
      assert.fail(`dialogue did not finish: ${JSON.stringify(p.text)}`);
    },
    nextPrompt(p) { this.continueUntil(p, () => Boolean(p.prompt)); },
  };
}

function player({ realWire = false } = {}) {
  const attrs = new Map(), items = new Map(), varbits = new Map(), log = [], xp = [], moves = [];
  const inv = {
    getAmount: id => items.get(id) ?? 0,
    getFreeSlots: () => 28 - [...items.values()].filter(amount => amount > 0).length,
    isFull: () => inv.getFreeSlots() === 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds(id, amount = 1) { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    forceAdd(_owner, item) { items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()); },
    deleteNumber(id, amount = 1) { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
    full() {},
  };
  const packet = new Proxy({
    getVarbit: id => p.wire ? p.wire.getVarbit(id) : varbits.get(id) ?? 0,
    getVarp: id => p.wire?.getVarp(id) ?? 0,
    sendVarbit(id, value) { p.wire?.sendVarbit(id, value); varbits.set(id, value); log.push(['sendVarbit', id, value]); return packet; },
    sendConfig(id, value) { p.wire?.sendConfig(id, value); log.push(['sendConfig', id, value]); return packet; },
    sendString(text, uid) { p.text = text; return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (target, key) => target[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = {
    attrs, items, varbits, log, xp, moves, localNpcs: [], messages: [], prompt: null, text: '', levels: {},
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inv,
    getPacketSender: () => packet,
    getDialogueManager: () => p.manager,
    getSkillManager: () => ({
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
      getCurrentLevel: skill => p.levels[skill.getIndex()] ?? 99,
      getMaxLevel: skill => p.levels[skill.getIndex()] ?? 99,
    }),
    getLocation: () => new core.Location(2598, 3085, 0),
    getLocalNpcs: () => p.localNpcs,
    getPrivateArea: () => null,
    moveTo: location => moves.push([location.getX(), location.getY(), location.getZ()]),
    getUsername: () => 'Q054', getDisplayName: () => 'Q054',
    getSession: () => ({ sendClientPacket: noop }),
    sendMessage: text => p.messages.push(text),
    isRegistered: () => true,
    isPlayerBot: () => false,
  };
  if (realWire) p.wire = new PacketSender(p);
  p.manager = new DialogueManager(p);
  return p;
}

function supplied() {
  const h = harness();
  const p = player({ realWire: true });
  for (const [id, amount] of [
    [I.BEER, 1], [I.VIAL, 2], [I.REDBERRIES, 1], [I.WHITE_BERRIES, 1],
    [I.LANTERN_LENS, 1], [I.EARTH_RUNE, 5], [I.BUCKET_OF_SAND, 1],
  ]) p.items.set(id, amount);
  // Fixture scene actor: the transcript's cutscene overhead line is spoken by
  // Bert, who is in Yanille's loaded local-NPC scene while Zavistic is at the bell.
  p.localNpcs = h.npcs;
  h.api.spawnNpc({ id: N.BERT, name: 'Bert', x: 2551, y: 3099, z: 0 });
  return { h, p, stage: () => h.quest.getStage(p) };
}

test('completion is sent on cache varbit 1527 at the 160 completion threshold and replayed on login', () => {
  const h = harness();
  const p = player();
  assert.equal(h.quest.varbitId, VARBIT, 'the canonical wire is varbit 1527 (tags 635 bits 0-8)');
  assert.equal(h.quest.varpId, undefined, 'varbit 1527 is not a varp id');
  assert.equal(h.quest.completionValue, COMPLETE);

  h.quest.setStage(p, COMPLETE);
  assert.equal(p.varbits.get(VARBIT), COMPLETE, 'setStage sends the varbit');
  assert.equal(p.log.some(row => row[0] === 'sendConfig' && row[1] === VARBIT), false,
    'stage progress must not be written to unrelated varp 1527');

  p.varbits.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(VARBIT), COMPLETE, 'login bootstrap replays the saved stage in the varbit');
});

test('The Hand in the Sand runs stage 0 to 160 through the registered transcript, item and object handlers', () => {
  const { h, p, stage } = supplied();

  // Bert accepts the quest and hands over the sandy hand (stage 0 -> 10).
  h.talk(p, N.BERT);
  h.nextPrompt(p);
  h.choose(p, 'Eww a hand, in the sand! Why haven\'t you told the authorities?');
  h.nextPrompt(p);
  h.choose(p, 'Yes.');
  h.finish(p);
  assert.equal(stage(), 10);
  assert.equal(p.items.get(I.SANDY_HAND), 1);

  // Beer on the Guard Captain turns the hand into the beer-soaked hand (10 -> 20).
  p.items.set(I.BEER, 1);
  const captain = h.itemOnNpc(p, N.GUARD_CAPTAIN, I.BEER);
  assert.equal(captain.handled, true);
  h.finish(p);
  assert.equal(stage(), 20);
  assert.equal(p.items.get(I.BEER) ?? 0, 0, 'the beer is consumed');
  assert.equal(p.items.get(I.SANDY_HAND) ?? 0, 0);
  assert.equal(p.items.get(I.BEER_SOAKED_HAND), 1);

  // Ring the Wizards' Guild bell; Zavistic takes the beer-soaked hand (20 -> 30).
  const bell20 = h.object(p, O.BELL_2, 'Ring');
  assert.equal(bell20.handled, true, 'the quest owns the bell while its Zavistic step is active');
  h.finish(p);
  assert.equal(stage(), 30);
  assert.equal(p.items.get(I.BEER_SOAKED_HAND) ?? 0, 0);

  // Bert gives his rota (30 -> 40).
  h.talk(p, N.BERT);
  h.finish(p);
  assert.equal(stage(), 40);
  assert.equal(p.items.get(I.BERTS_ROTA), 1);

  // Search Sandy's desk (40 -> 50), then pickpocket the sand.
  const desk = h.object(p, O.SANDYS_DESK, 'Search');
  assert.equal(desk.handled, true);
  h.finish(p);
  assert.equal(stage(), 50);
  assert.equal(p.items.get(I.SANDYS_ROTA), 1);

  h.npcOption(p, 'Sandy', N.SANDY, 'Pickpocket');
  h.finish(p);
  assert.equal(p.items.get(I.SAND), 1, 'pickpocketing Sandy yields the sand');

  // Return both rotas to Bert and receive the magic scroll (50 -> 60).
  h.talk(p, N.BERT);
  h.finish(p);
  assert.equal(stage(), 60);
  assert.equal(p.items.get(I.A_MAGIC_SCROLL), 1);
  assert.equal(p.items.get(I.BERTS_ROTA) ?? 0, 0);
  assert.equal(p.items.get(I.SANDYS_ROTA) ?? 0, 0);

  // Ring the bell and exchange the scroll for the orb (60 -> 70).
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true);
  h.nextPrompt(p);
  h.choose(p, 'I have a rather sandy problem that I\'d like to palm off on you.');
  h.finish(p);
  assert.equal(stage(), 70);
  assert.equal(p.items.get(I.A_MAGIC_SCROLL) ?? 0, 0);
  assert.equal(p.items.get(I.MAGICAL_ORB), 1);

  // Ring the bell for Zavistic's one-time teleport to Port Sarim (consumes a vial).
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true);
  h.nextPrompt(p);
  h.choose(p, 'I have a rather sandy problem that I\'d like to palm off on you.');
  h.nextPrompt(p);
  h.choose(p, 'Can you help me more?');
  h.nextPrompt(p);
  h.choose(p, 'Yes, that would be great!');
  h.finish(p);
  assert.equal(p.items.get(I.VIAL), 1, 'one of the two vials is handed over for the teleport');
  assert.deepEqual(p.moves.at(-1), [3014, 3259, 0]);
  assert.equal(p.getPacketSender().getVarbit(1531), 1, 'actual teleport earns HANDSAND_TELE');

  // Betty takes the second vial and gives bottled water.
  h.talk(p, N.BETTY);
  h.nextPrompt(p);
  h.choose(p, 'Talk to Betty about the Hand in the Sand.');
  h.finish(p);
  assert.equal(p.items.get(I.VIAL) ?? 0, 0);
  assert.equal(p.items.get(I.BOTTLED_WATER), 1);
  assert.equal(p.getPacketSender().getVarbit(1532), 1, 'Betty earns receivedBottledWater');

  // Redberry juice, pink dye, rose-tinted lens.
  h.itemOnItem(p, I.BOTTLED_WATER, I.REDBERRIES);
  assert.equal(p.items.get(I.REDBERRY_JUICE), 1);
  assert.equal(p.getPacketSender().getVarbit(1532), 2);
  h.itemOnItem(p, I.REDBERRY_JUICE, I.WHITE_BERRIES);
  assert.equal(p.items.get(I.PINK_DYE), 1);
  assert.equal(p.getPacketSender().getVarbit(1532), 3);
  h.itemOnItem(p, I.PINK_DYE, I.LANTERN_LENS);
  assert.equal(p.items.get(I.ROSE_TINTED_LENS), 1);
  assert.equal(p.getPacketSender().getVarbit(1532), 4);

  // Betty places the counter vial, then the lens makes the truth serum.
  h.talk(p, N.BETTY);
  h.nextPrompt(p);
  h.choose(p, 'Talk to Betty about the Hand in the Sand.');
  h.finish(p);
  assert.equal(p.getPacketSender().getVarbit(1537), 1, 'Betty actually places the vial');
  assert.equal(core.ObjectDefinition.forPlayer(10812, p).id, O.COUNTER_15);
  const counter = h.itemOnObject(p, O.COUNTER_15, I.ROSE_TINTED_LENS);
  assert.equal(counter.handled, true);
  h.finish(p);
  assert.equal(p.items.get(I.ROSE_TINTED_LENS) ?? 0, 0);
  assert.equal(p.items.get(I.TRUTH_SERUM), 1);
  assert.equal(p.getPacketSender().getVarbit(1532), 5, 'madeTruthSerum helper condition');
  assert.equal(p.getPacketSender().getVarbit(1537), 0);

  // Betty adds Sandy's sand (70 -> 80).
  h.talk(p, N.BETTY);
  h.nextPrompt(p);
  h.choose(p, 'Talk to Betty about the Hand in the Sand.');
  h.finish(p);
  assert.equal(stage(), 80);
  assert.equal(p.getPacketSender().getVarbit(1532), 6);
  assert.equal(p.items.get(I.SAND) ?? 0, 0);

  // Distract Sandy (80 -> 90).
  h.talk(p, N.SANDY);
  h.nextPrompt(p);
  h.choose(p, 'There\'s a herd of huge mutant herring about to drop from the sky!');
  h.finish(p);
  assert.equal(stage(), 90);

  // Pour the serum into the coffee (90 -> 100).
  const coffee = h.itemOnObject(p, O.SANDYS_COFFEE_MUG, I.TRUTH_SERUM);
  assert.equal(coffee.handled, true);
  h.finish(p);
  assert.equal(stage(), 100);
  assert.equal(p.items.get(I.TRUTH_SERUM) ?? 0, 0);

  // Activate the orb (100 -> 110).
  const activate = h.itemAction(p, I.MAGICAL_ORB, 'Activate');
  assert.equal(activate.handled, true);
  h.finish(p);
  assert.equal(stage(), 110);
  assert.equal(p.items.get(I.MAGICAL_ORB) ?? 0, 0);
  assert.equal(p.items.get(I.MAGICAL_ORB_A_), 1);

  // Ask all three questions (110 -> 120).
  h.talk(p, N.SANDY);
  h.nextPrompt(p);
  for (const question of [
    "Why is Bert's rota different from the original?",
    "Why doesn't Bert remember the change in his hours?",
    'What happened to the wizard?',
  ]) {
    h.choose(p, question);
    if (question !== 'What happened to the wizard?') h.nextPrompt(p);
  }
  h.finish(p);
  assert.equal(stage(), 120);

  // Return the full orb (120 -> 130).
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true);
  h.nextPrompt(p);
  h.choose(p, 'I have a rather sandy problem that I\'d like to palm off on you.');
  h.finish(p);
  assert.equal(stage(), 130);
  assert.equal(p.items.get(I.MAGICAL_ORB_A_) ?? 0, 0);

  // Give Zavistic the runes and sand; the sandpit fills (130 -> 140).
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true);
  h.nextPrompt(p);
  h.choose(p, 'I have a rather sandy problem that I\'d like to palm off on you.');
  h.finish(p);
  assert.equal(stage(), 140);
  assert.equal(p.items.get(I.EARTH_RUNE) ?? 0, 0);
  assert.equal(p.items.get(I.BUCKET_OF_SAND) ?? 0, 0);

  // Mazion on Entrana hands over the wizard's head (140 -> 150).
  h.talk(p, N.MAZION);
  h.finish(p);
  assert.equal(stage(), 150);
  assert.equal(p.items.get(I.WIZARDS_HEAD), 1);

  // Final hand-in (150 -> 160).
  const bellEnd = h.object(p, O.BELL_2, 'Ring');
  assert.equal(bellEnd.handled, true);
  h.finish(p);
  assert.equal(stage(), COMPLETE);
  assert.equal(p.items.get(I.WIZARDS_HEAD) ?? 0, 0);
  assert.equal(p.varbits.get(VARBIT), COMPLETE, 'the completion value reaches cache varbit 1527');
  // New connection, same durable attributes: replay the earned helper facts.
  p.wire = new PacketSender(p);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: p });
  runtime.sendQuestVarps({ player: p });
  h.api.emitCustomEvent('player:bootstrap-complete', { player: p });
  assert.equal(p.getPacketSender().getVarbit(VARBIT), COMPLETE);
  assert.equal(p.getPacketSender().getVarbit(1531), 1);
  assert.equal(p.getPacketSender().getVarbit(1532), 6);
  assert.equal(p.getPacketSender().getVarbit(1537), 0);
  assert.deepEqual(p.xp, [[core.Skill.CRAFTING.getIndex(), 9000], [core.Skill.THIEVING.getIndex(), 1000]]);
  assert.equal(p.attrs.get('quest.points'), 1);
  assert.ok(p.messages.some(text => text.includes('completed a quest')));

  // Repeat hand-in does not pay twice.
  h.events['npc-dialogue:action'].forEach(fn => fn({ player: p, npcId: N.ZAVISTIC_RARVE, stepId: 'q_UjQ0', handled: false }));
  assert.deepEqual(p.xp, [[core.Skill.CRAFTING.getIndex(), 9000], [core.Skill.THIEVING.getIndex(), 1000]]);
  assert.equal(p.attrs.get('quest.points'), 1);
});

test('the shared Wizards\' Guild bell is claimed only for this quest\'s Zavistic steps', () => {
  const h = harness({ captureTranscripts: true });
  const p = player();
  const expected = new Map([
    [20, 'talking-to-zavistic-rarve'],
    [60, 'returning-back-to-zavistic'],
    [70, 'returning-back-to-zavistic-talking-to-zavistic-again'],
    [120, 'returning-back-to-zavistic-with-the-magical-orb'],
    [130, 'returning-back-to-zavistic-with-the-magical-orb-talking-to-zavistic-rarve-again'],
    [150, 'checking-the-entrana-sandpit-if-the-player-has-not-checked-the-entrana-sandpit'],
  ]);
  for (const [stage, variant] of expected) {
    h.quest.setStage(p, stage);
    const event = h.object(p, O.BELL_2, 'Ring');
    assert.equal(event.handled, true, `bell is handled at stage ${stage}`);
    assert.deepEqual(h.starts.at(-1), { npcId: N.ZAVISTIC_RARVE, page: h.quest.name, variant });
  }
  for (const stage of [0, 10, 30, 40, 50, 80, 90, 100, 110, 140]) {
    h.quest.setStage(p, stage);
    assert.equal(h.object(p, O.BELL_2, 'Ring').handled, false, `bell is left to Zogre Flesh Eaters at stage ${stage}`);
  }
  assert.equal(h.object(p, O.SANDYS_DESK, 'Search').handled, true, 'the desk handler still owns its object');
});

test('the bell is left to Zogre Flesh Eaters while its evidence conversation is still needed', () => {
  const h = harness({ captureTranscripts: true });
  const p = player();
  const zogre = (stage, progress) => {
    p.attrs.set('quest.zogre_flesh_eaters.stage', stage);
    p.attrs.set('quest.zogre_flesh_eaters.search', progress);
  };
  h.quest.setStage(p, 20);

  // Zogre started, evidence not shown yet: only the bell can reach its evidence
  // conversation, so Hand leaves the bell alone.
  for (const stage of [2, 3]) {
    for (const progress of [0, 1, 3]) {
      zogre(stage, progress);
      assert.equal(h.object(p, O.BELL_2, 'Ring').handled, false,
        `the bell belongs to Zogre at stage ${stage} with evidence progress ${progress}`);
    }
  }

  // Zogre has shown its evidence, or has moved on: the bell is Hand's again.
  zogre(2, 4);
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true, 'the bell returns to Hand once the evidence is gathered');
  zogre(4, 0);
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true, 'the bell returns to Hand once Zogre handed the evidence in');
  zogre(0, 0);
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true, 'the bell is Hand\'s when Zogre is not started');
});

test('both registered quests share the bell and Zavistic in server dispatch order', () => {
  const h = harness({ captureTranscripts: true });
  const zogreStarts = [];
  const realStartTranscript = runtime.startTranscript;
  runtime.startTranscript = (_api, _player, npcId, page, variant) => {
    zogreStarts.push({ npcId, page, variant });
    return true;
  };
  const pluginPath = require.resolve('../plugins/quests/quests/ZogreFleshEaters.Quest');
  delete require.cache[pluginPath];
  try {
    require(pluginPath)(h.api);
  } finally {
    runtime.startTranscript = realStartTranscript;
  }
  const p = player();
  h.quest.setStage(p, 20);
  p.attrs.set('quest.zogre_flesh_eaters.stage', 2);
  p.attrs.set('quest.zogre_flesh_eaters.search', 0);
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true);
  assert.equal(h.starts.length, 0, 'Hand leaves the pending evidence conversation to Zogre');
  assert.equal(zogreStarts.at(-1).variant,
    'investigating-b-vahn-ringing-the-bell-outside-the-wizards-guild');

  p.attrs.set('quest.zogre_flesh_eaters.search', 4);
  assert.equal(h.variantFor(p, N.ZAVISTIC_RARVE),
    'investigating-b-vahn-talking-to-zavistic-rarve-after-gathering-evidence');
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true);
  assert.equal(h.starts.length, 1, 'Hand can use its bell after Zogre gathers evidence');
  assert.equal(zogreStarts.length, 1, 'a handled Hand click never also reaches Zogre');
});

test('Zavistic keeps the wizard while Zogre Flesh Eaters owes him the evidence hand-in', () => {
  const h = harness({ captureTranscripts: true });
  const p = player();
  const zogre = (stage, progress) => {
    p.attrs.set('quest.zogre_flesh_eaters.stage', stage);
    p.attrs.set('quest.zogre_flesh_eaters.search', progress);
  };
  h.quest.setStage(p, 20);

  zogre(2, 3);
  assert.equal(h.variantFor(p, N.ZAVISTIC_RARVE), 'talking-to-zavistic-rarve',
    'Hand keeps Zavistic while Zogre still has to show its evidence');

  zogre(2, 4);
  assert.equal(h.variantFor(p, N.ZAVISTIC_RARVE), null,
    'Zavistic is left to Zogre while it owes him the evidence hand-in');

  zogre(4, 4);
  assert.equal(h.variantFor(p, N.ZAVISTIC_RARVE), 'talking-to-zavistic-rarve',
    'Hand takes Zavistic back once Zogre handed the evidence in');
});

test('Hand keeps its Zavistic step while the bell is left to Zogre Flesh Eaters', () => {
  const h = harness();
  const p = player();
  p.attrs.set('quest.zogre_flesh_eaters.stage', 2);
  p.attrs.set('quest.zogre_flesh_eaters.search', 0);
  p.items.set(I.BEER_SOAKED_HAND, 1);
  h.quest.setStage(p, 20);

  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, false, 'the bell is Zogre\'s while it needs its evidence');

  // Hand still hands the beer-soaked hand to Zavistic inside the guild.
  const hand = h.itemOnNpc(p, N.ZAVISTIC_RARVE, I.BEER_SOAKED_HAND);
  assert.equal(hand.handled, true);
  h.finish(p);
  assert.equal(h.quest.getStage(p), 30, 'the Hand in the Sand step still completes');
  assert.equal(p.items.get(I.BEER_SOAKED_HAND) ?? 0, 0, 'the beer-soaked hand is handed over');
});

test('a lost activated orb is reclaimed from Zavistic without changing the interrogation stage', () => {
  const h = harness();
  const p = player();
  h.quest.setStage(p, 110);
  h.talk(p, N.ZAVISTIC_RARVE);
  h.nextPrompt(p);
  h.choose(p, 'I have a rather sandy problem that I\'d like to palm off on you.');
  h.nextPrompt(p);
  h.choose(p, 'I\'ve lost my magical scrying orb!');
  h.finish(p);
  assert.equal(p.items.get(I.MAGICAL_ORB_A_), 1, 'stage 110 returns the activated orb');
  assert.equal(h.quest.getStage(p), 110);
});

test('a full bag refuses the Zavistic orb replacement without losing the interrogation stage', () => {
  const h = harness();
  const p = player();
  h.quest.setStage(p, 110);
  for (let i = 0; i < 28; i++) p.items.set(900000 + i, 1);
  assert.equal(p.getInventory().getFreeSlots(), 0);
  h.talk(p, N.ZAVISTIC_RARVE);
  h.nextPrompt(p);
  h.choose(p, 'I have a rather sandy problem that I\'d like to palm off on you.');
  h.nextPrompt(p);
  h.choose(p, 'I\'ve lost my magical scrying orb!');
  h.finish(p);
  assert.equal(p.items.get(I.MAGICAL_ORB_A_), undefined);
  assert.equal(h.quest.getStage(p), 110);
});

test('the sandpit enchantment spends 5 earth runes and one bucket of sand once', () => {
  const h = harness();
  const p = player();
  p.localNpcs = h.npcs;
  h.api.spawnNpc({ id: N.BERT, name: 'Bert', x: 2551, y: 3099, z: 0 });
  p.items.set(I.EARTH_RUNE, 10);
  p.items.set(I.BUCKET_OF_SAND, 2);
  h.quest.setStage(p, 130);
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true);
  h.nextPrompt(p);
  h.choose(p, 'I have a rather sandy problem that I\'d like to palm off on you.');
  h.finish(p);
  assert.equal(h.quest.getStage(p), 140);
  assert.equal(p.items.get(I.EARTH_RUNE), 5, 'only the 5 required earth runes are spent');
  assert.equal(p.items.get(I.BUCKET_OF_SAND), 1, 'only one bucket of sand is spent');
});

test('the neighbouring steps do not spend the sandpit runes or bucket', () => {
  const h = harness();
  const p = player();
  p.items.set(I.EARTH_RUNE, 10);
  p.items.set(I.BUCKET_OF_SAND, 2);
  p.items.set(I.MAGICAL_ORB_A_, 1);
  h.quest.setStage(p, 120);
  assert.equal(h.object(p, O.BELL_2, 'Ring').handled, true);
  h.nextPrompt(p);
  h.choose(p, 'I have a rather sandy problem that I\'d like to palm off on you.');
  h.finish(p);
  assert.equal(h.quest.getStage(p), 130);
  assert.equal(p.items.get(I.EARTH_RUNE), 10, 'stage 120 does not spend earth runes');
  assert.equal(p.items.get(I.BUCKET_OF_SAND), 2, 'stage 120 does not spend the bucket');
});

test('Bert\'s intro requirements marker refuses 16 Thieving or 48 Crafting and accepts 17/49', () => {
  const h = harness();
  const p = player();
  const marker = () => {
    const event = { player: p, npcId: N.BERT, stepId: 'Jw8a7L', handled: false };
    h.events['npc-dialogue:action'].forEach(fn => fn(event));
    return event;
  };
  p.levels[core.Skill.THIEVING.getIndex()] = 16;
  p.levels[core.Skill.CRAFTING.getIndex()] = 49;
  assert.equal(marker().handled, false);
  assert.match(p.messages.at(-1), /requirements/);

  p.levels[core.Skill.THIEVING.getIndex()] = 17;
  p.levels[core.Skill.CRAFTING.getIndex()] = 48;
  assert.equal(marker().handled, false);

  p.levels[core.Skill.CRAFTING.getIndex()] = 49;
  assert.equal(marker().handled, true, 'the accept choice after the marker stays reachable');
});

test('lost hand, rota and head recovery stay on the quest page and preserve the stage', () => {
  const h = harness();
  const p = player();
  h.quest.setStage(p, 10);
  h.talk(p, N.BERT);
  h.finish(p);
  assert.equal(p.items.get(I.SANDY_HAND), 1, 'Bert replaces a lost sandy hand');
  assert.equal(h.quest.getStage(p), 10);

  h.quest.setStage(p, 20);
  h.talk(p, N.BERT);
  h.finish(p);
  assert.equal(p.items.get(I.BEER_SOAKED_HAND), 1, 'Bert replaces a lost beer-soaked hand');
  assert.equal(h.quest.getStage(p), 20);

  h.quest.setStage(p, 40);
  p.items.delete(I.BERTS_ROTA);
  h.talk(p, N.BERT);
  h.finish(p);
  assert.equal(p.items.get(I.BERTS_ROTA), 1, 'Bert replaces a lost rota');
  assert.equal(h.quest.getStage(p), 40);

  h.quest.setStage(p, 150);
  p.items.delete(I.WIZARDS_HEAD);
  h.talk(p, N.MAZION);
  h.nextPrompt(p);
  h.choose(p, 'I\'ve lost my head!');
  h.finish(p);
  assert.equal(p.items.get(I.WIZARDS_HEAD), 1, 'Mazion replaces a lost head');
  assert.equal(h.quest.getStage(p), 150);
});


test('auxiliary wire replays only earned state and preserves parent siblings and WGS counter ownership', () => {
  for (const [id, baseVar, startBit, endBit] of [[1531,635,12,12],[1532,635,13,15],[1537,636,9,10]]) {
    const actual = CacheDefinitions.getVarbit(id);
    assert.deepEqual([actual.baseVar,actual.startBit,actual.endBit], [baseVar,startBit,endBit]);
  }
  const h = harness(), p = player({ realWire: true });
  const sender = p.getPacketSender();
  sender.sendConfig(635, (1 << 9) | (1 << 10) | (1 << 11));
  sender.sendConfig(636, 0x40001);
  h.quest.setStage(p, 70);
  h.api.emitCustomEvent('npc-dialogue:line', { player: p, npcId: N.BETTY, text: 'I have one here!' });
  assert.equal(sender.getVarbit(1532), 1);
  sender.sendVarbit(1537, 2);
  h.api.emitCustomEvent('npc-dialogue:action', { player: p, stepId: 'sB80ti', kind: 'message' });
  assert.equal(sender.getVarbit(1537), 1, 'actual Hand vial placement owns its form');
  assert.equal(sender.getVarp(635) & 0xe00, 0xe00);
  assert.equal(sender.getVarp(636) & ~0x600, 0x40001);
  sender.sendVarbit(1532, 0); sender.sendVarbit(1537, 0);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: p });
  h.api.emitCustomEvent('player:bootstrap-complete', { player: p });
  assert.equal(sender.getVarbit(1532), 1);
  assert.equal(sender.getVarbit(1537), 1);
  assert.equal(sender.getVarbit(1531), 0, 'no inferred teleport from stage or serum progress');
  for (const value of [2, 3]) {
    p.attrs.set('quest.while_guthix_sleeps.stage', 250);
    sender.sendVarbit(1537, value);
    for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: p });
    h.api.emitCustomEvent('player:bootstrap-complete', { player: p });
    assert.equal(sender.getVarbit(1537), value, 'active WGS seed counter keeps its owner');
  }
  const fresh = player({ realWire: true });
  h.quest.setStage(fresh, COMPLETE);
  for (const fn of h.hooks.onPlayerLogin ?? []) fn({ player: fresh });
  h.api.emitCustomEvent('player:bootstrap-complete', { player: fresh });
  for (const id of [1531, 1532, 1537]) assert.equal(fresh.getPacketSender().getVarbit(id), 0, 'completion invents no auxiliary actions');
});
