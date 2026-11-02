// From server/: node --test tests/lumbridge-vampyre-parity.test.cjs (after server build)
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const data = require('../data/definitions/npc-dialogues.json');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
const noop = () => {};

test('canonical Brutus rows load the Wiki respawn without losing cache combat animations or stats', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  for (const id of [15626, 15627]) {
    const definition = NpcDefinition.forId(id);
    assert.equal(definition.getRespawn(), 36);
    assert.equal(definition.getHitpoints(), 58);
    assert.equal(definition.getAttackSpeed(), 5);
    assert.equal(definition.getMaxHit(), 3);
    assert.deepEqual(definition.getStats().slice(0, 5), [12, 25, 10, 1, 8]);
    assert.deepEqual([definition.getAttackAnim(), definition.getDefenceAnim(), definition.getDeathAnim()], [13783, 13787, 13784]);
  }
  assert.equal(NpcDefinition.forId(1).getRespawn(), 25, 'unconfigured NPCs keep the standard respawn');
});

function harness(name) {
  const hooks = {}, events = {}, tasks = [];
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: (task) => tasks.push(task) } },
    onCustomEvent: (name, handler) => (events[name] ??= []).push(handler),
    emitCustomEvent: (name, event) => (events[name] ?? []).forEach(handler => handler(event)),
    persistAttribute: noop,
  }, { get: (target, key) => target[key] ?? ((...args) => { (hooks[key] ??= []).push(args.find(arg => typeof arg === 'function')); }) });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  const quest = getRegisteredQuests().at(-1);
  return { api, hooks, events, tasks, quest,
    emit: (name, event) => (events[name] ?? []).forEach(handler => handler(event)),
    line(p, npcId, text) { const event = { player: p, npcId, text }; this.emit('npc-dialogue:line', event); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId }; this.emit('npc-dialogue:action', event); return event; },
  };
}

function player() {
  const attrs = new Map(), items = new Map(), xp = [], messages = [], configs = [], animations = [];
  const packet = new Proxy({ sendCreationMenu: (menu) => { p.menu = menu; }, sendConfig: (...args) => configs.push(args) }, { get: (t, k) => t[k] ?? noop });
  const inv = {
    getAmount: id => items.get(id) ?? 0,
    adds: (id, amount) => items.set(id, (items.get(id) ?? 0) + amount),
    deleteNumber: (id, amount) => { assert.ok((items.get(id) ?? 0) >= amount); items.set(id, items.get(id) - amount); },
    isFull: () => p.full === true,
  };
  const p = {
    items, attrs, xp, messages, configs, animations,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inv, getBanks: () => [], getPacketSender: () => packet,
    getSkillManager: () => ({ addExperiences: (...args) => xp.push(args), getCombatLevel: () => 3 }),
    sendMessage: message => messages.push(message), performAnimation: animation => animations.push(animation.getId()),
    getLocation: () => new core.Location(3209, 3213, 1), isRegistered: () => true,
  };
  return p;
}

function start(h, p, npcId, hook) {
  h.emit('npc-dialogue:hook', { player: p, npcId, hook });
  const line = hook === 'quest:cook-s-assistant:start' ? "Yes, I'll help you."
    : hook === 'quest:sheep-shearer:start' ? "Yes, okay. I can do that." : null;
  if (line) h.line(p, npcId, line).after?.();
}

test('Cook exchanges the captured ingredients box, then rewards only after the final line', () => {
  const h = harness('CooksAssistant'), p = player();
  for (const id of [I.BUCKET_OF_MILK, I.POT_OF_FLOUR, I.EGG]) p.items.set(id, 2);
  start(h, p, N.COOK_7, 'quest:cook-s-assistant:start');
  const message = h.action(p, N.COOK_7, 'qPWhXs');
  assert.deepEqual(message.box.items, [I.POT_OF_FLOUR, I.BUCKET_OF_MILK]);
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(p.xp.length, 0);
  const last = h.line(p, N.COOK_7, "Maybe, but I won't be holding my breath.");
  assert.equal(h.quest.getStage(p), 1, 'displaying the last line must not complete early');
  last.after();
  assert.equal(h.quest.getStage(p), 2);
  assert.deepEqual(p.xp, [[core.Skill.COOKING, 300]]);
  assert.equal(p.items.get(I.CAKE), undefined, 'the cake is a scroll model, never a reward');
  for (const id of [I.BUCKET_OF_MILK, I.POT_OF_FLOUR, I.EGG]) assert.equal(p.items.get(id), 1);
  start(h, p, N.COOK_7, 'quest:cook-s-assistant:start');
  last.after();
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.xp.length, 1);
});

test('Cook remembers partial deliveries and does not ask for or consume duplicates', () => {
  const h = harness('CooksAssistant'), p = player();
  start(h, p, N.COOK_7, 'quest:cook-s-assistant:start');
  p.items.set(I.EGG, 2);
  h.line(p, N.COOK_7, "Here's a fresh egg.").after();
  assert.equal(p.items.get(I.EGG), 1);
  assert.equal(h.line(p, N.COOK_7, "Here's a fresh egg.").skip, true);
  assert.match(h.action(p, N.COOK_7, 'UxCH5X').text, /milk.*flour/);
  assert.ok(!h.action(p, N.COOK_7, 'UxCH5X').text.includes('egg'));
  assert.ok(h.quest.buildJournal(p, h.quest).includes('<str>an egg</str>'));
  p.items.set(I.BUCKET_OF_MILK, 1); p.items.set(I.POT_OF_FLOUR, 1);
  h.line(p, N.COOK_7, "Here's a bucket of milk.").after();
  h.line(p, N.COOK_7, "Here's a pot of flour.").after();
  assert.equal(h.hooks.onNpcDialogueCondition[0]({ npcId: N.COOK_7, player: p, text: 'If the player has the ingredients:' }), true,
    'reopening an interrupted final conversation can still finish');
  h.line(p, N.COOK_7, "Maybe, but I won't be holding my breath.").after();
  assert.equal(h.quest.getStage(p), 2);
});

test('Sheep starts through Yes even with 20 balls and plays the captured final dialogue', () => {
  const steps = data['Sheep Shearer'].variants['starting-off'][1].options[0].steps;
  assert.equal(steps.some(step => step.id === 'JlC38d'), false);
  const yes = steps.find(step => step.type === 'choice').options[0];
  const fast = yes.steps.find(step => step.id === 'JlC38d').steps;
  assert.ok(fast.some(step => step.player === "That's the last of them."));
  const h = harness('SheepShearer'), p = player();
  p.items.set(I.BALL_OF_WOOL, 21);
  start(h, p, N.FRED_THE_FARMER, 'quest:sheep-shearer:start');
  h.action(p, N.FRED_THE_FARMER, 'sheep-shearer:finish-handover');
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(p.items.get(I.BALL_OF_WOOL), 1);
  h.action(p, N.FRED_THE_FARMER, 'MW-4c0');
  assert.equal(h.quest.getStage(p), 21);
  assert.equal(p.items.get(I.COINS), 60);
  assert.equal(h.quest.scrollItemId, I.SHEARS);
  h.action(p, N.FRED_THE_FARMER, 'MW-4c0');
  assert.equal(p.items.get(I.COINS), 60);
});

test('Sheep accepts smaller deliveries and recovers an interrupted final delivery', () => {
  const h = harness('SheepShearer'), p = player();
  start(h, p, N.FRED_THE_FARMER, 'quest:sheep-shearer:start');
  p.items.set(I.BALL_OF_WOOL, 7);
  h.action(p, N.FRED_THE_FARMER, 'XaM2d6');
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(h.line(p, N.FRED_THE_FARMER, 'You need to collect 20 more balls of wool.').text, 'You need to collect 13 more balls of wool.');
  p.items.set(I.BALL_OF_WOOL, 13);
  h.action(p, N.FRED_THE_FARMER, 'sheep-shearer:finish-handover');
  assert.equal(h.hooks.onNpcDialogueVariant[0]({ npcId: N.FRED_THE_FARMER, player: p }).variant, 'finishing-up');
  assert.equal(h.action(p, N.FRED_THE_FARMER, 'sheep-shearer:finish-handover').handled, true);
  h.action(p, N.FRED_THE_FARMER, 'l--V3R');
  assert.equal(h.quest.getStage(p), 21);
});

test('shearing makes a sheep bald for 50 ticks and never yields wool twice', () => {
  const h = harness('SheepShearer'), p = player();
  p.items.set(I.SHEARS, 1);
  const transforms = [], chat = [];
  const sheep = { getDefinition: () => ({ getId: () => N.SHEEP_18 }), setNpcTransformationId: id => transforms.push(id), forceChat: text => chat.push(text), isRegistered: () => true };
  const event = { player: p, npc: sheep, npcId: N.SHEEP_18, clickType: 1, definition: { getActions: () => ['Shear'] } };
  h.hooks.onNpcInteraction[0](event); h.hooks.onNpcInteraction[0](event);
  assert.deepEqual(chat, ['Baa!'], 'a sheep being shorn is already shorn');
  const shorn = h.tasks.at(-1); assert.equal(shorn.getDelay(), 2); shorn.execute();
  assert.equal(p.items.get(I.WOOL), 1);
  assert.deepEqual(transforms, [N.SHEEP_2]);
  const regrow = h.tasks.at(-1); assert.equal(regrow.getDelay(), 50); regrow.execute();
  h.hooks.onNpcInteraction[0](event);
  h.tasks.at(-1).execute();
  assert.equal(p.items.get(I.WOOL), 2);
});

test('Harlow requests beer before advancing, then exchanges one beer for one stake', () => {
  const h = harness('VampyreSlayer'), p = player(); p.items.set(I.BEER, 1);
  start(h, p, N.MORGAN, 'quest:vampyre-slayer:start');
  assert.equal(h.hooks.onNpcDialogueVariant[0]({ npcId: N.DR_HARLOW, player: p }).variant, 'dr-harlow');
  h.line(p, N.DR_HARLOW, "Huh? No, I don't think ssho. Now, buy ush a beer.").after();
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(h.hooks.onNpcDialogueVariant[0]({ npcId: N.DR_HARLOW, player: p }).variant, 'dr-harlow-talking-to-him-again');
  assert.deepEqual(h.action(p, N.DR_HARLOW, 'BokFvm').box.items, [I.BEER]);
  assert.equal(p.items.get(I.BEER), 0);
  h.action(p, N.DR_HARLOW, 'jJK9QV'); h.action(p, N.DR_HARLOW, 'jJK9QV');
  assert.equal(p.items.get(I.STAKE), 1);
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(h.hooks.onItemOnNpc, undefined, 'using beer directly on Harlow has no shortcut');
  p.items.delete(I.STAKE); p.getBanks = () => [{ getAmount: id => id === I.STAKE ? 1 : 0 }];
  assert.equal(h.hooks.onNpcDialogueCondition[0]({ npcId: N.DR_HARLOW, player: p, text: 'If the player lost the stake:' }), false);
});

test('the Count regenerates without both tools; the correct killing blow consumes the stake once', () => {
  const h = harness('VampyreSlayer'), p = player(); h.quest.setStage(p, 2);
  const npc = { getId: () => N.COUNT_DRAYNOR, getCombat: () => ({ getKiller: () => p }), getDefinition: () => ({ getHitpoints: () => 35 }), setHitpoints: hp => { npc.hp = hp; } };
  const death = { npc }; h.hooks.onNpcBeforeDeath[0](death);
  assert.equal(death.preventDeath, true); assert.equal(npc.hp, 35);
  p.items.set(I.STAKE, 1); p.items.set(I.HAMMER, 1);
  h.hooks.onNpcDeath[0]({ npcId: N.COUNT_DRAYNOR, npc, killer: p });
  assert.equal(h.quest.getStage(p), 3);
  assert.equal(p.items.get(I.STAKE), 0); assert.equal(p.items.get(I.HAMMER), 1);
  assert.deepEqual(p.animations, [806]); assert.deepEqual(p.xp, [[core.Skill.ATTACK, 4825]]);
});

test('Count coffin controls the private fight, garlic stats, timed regeneration and basement exit', () => {
  const tasks = [], spawned = [], removed = [], objects = [], hooks = {}, events = {};
  let cycle = 0;
  class PrivateArea {
    constructor() { this.entities = []; }
    enter(entity) { entity.area = this; }
    add(entity) { this.entities.push(entity); entity.area = this; }
    isDestroyed() { return this.destroyed === true; }
    postLeave() {}
    destroy() { this.destroyed = true; }
  }
  const p = player(); let target;
  p.getCombat = () => ({ getTarget: () => target, getAutocastSpell: () => ({}) });
  p.getPacketSender = () => ({ sendObject: object => objects.push(object.getId()), sendObjectRemoval: () => objects.push('removed') });
  const api = new Proxy({
    core: { ...core, PrivateArea, World: { getProcessCycle: () => cycle }, TaskManager: { submit: task => tasks.push(task) } },
    getWorld: () => ({ getAddNPCQueue: () => [] }),
    emitCustomEvent: (name, request) => { if (name === 'quest:is-started') request.started = true; if (name === 'quest:is-complete') request.complete = false; },
    onCustomEvent: (name, handler) => { events[name] = handler; },
    spawnNpc: definition => {
      const stats = [30, 25, 30, 1, 1];
      const npc = { definition, hp: 35, anims: [],
        getId: () => definition.id, getHitpoints: () => npc.hp, getMaxHitpoints: () => 35,
        heal: hp => { npc.hp = Math.min(35, npc.hp + hp); },
        performAnimation: anim => npc.anims.push(anim.getId()),
        setCombatXpMultiplier: amount => { npc.xpRate = amount; },
        getCurrentDefinition: () => ({ getStats: () => stats }),
        setCombatOverride: override => { npc.override = override; },
        getCombat: () => ({ attack: player => { npc.target = player; }, getHitQueue: () => ({ addPendingDamage: hits => { for (const hit of hits) npc.hp -= hit.getDamage(); } }) }),
      };
      spawned.push(npc); return npc;
    },
    removeNpc: npc => removed.push(npc),
  }, { get: (t, key) => t[key] ?? ((...args) => { hooks[key] = args.find(arg => typeof arg === 'function'); }) });
  require('../plugins/bosses/CountDraynor.plugin').register(api);
  assert.equal(hooks.onPlayerProcess, undefined, 'the encounter never polls every player');
  const coffin = new core.GameObject(O.COFFIN_46, new core.Location(3077, 9775, 0), 10, 3, null);
  hooks.onObjectFirstClick({ player: p, object: coffin });
  assert.deepEqual(objects, [O.COFFIN_9]);
  assert.equal(spawned.length, 0, 'the Count rises four ticks after opening');
  tasks.find(task => task.getDelay() === 4).execute();
  assert.equal(spawned[0].definition.id, N.COUNT_DRAYNOR_2);
  assert.deepEqual(spawned[0].anims, [3114]);
  assert.deepEqual(objects, [O.COFFIN_9, 'removed'], 'the rising Count holds the coffin, so the loc goes (rsprox 1710, 3275)');
  tasks.find(task => task.getDelay() === 8).execute();
  assert.deepEqual(objects, [O.COFFIN_9, 'removed', O.COFFIN_46]);
  tasks.find(task => task.getDelay() === 9).execute();
  const count = target = spawned[1];
  assert.equal(count.definition.id, N.COUNT_DRAYNOR);
  assert.equal(count.definition.owner, p); assert.equal(count.definition.ownerOnly, true);
  assert.equal(count.target, p); assert.equal(count.xpRate, 0.025);
  assert.deepEqual(removed, [spawned[0]]);
  assert.deepEqual(count.anims, [3115]);
  p.items.set(I.GARLIC, 1);
  hooks.onCombatHitRoll({ attacker: p, target: count, combatType: core.CombatType.MELEE });
  assert.equal(count.hp, 25); assert.deepEqual(count.override.stats, [20, 15, 0, 1, 1]);
  assert.equal(hooks.registerMeleeHitModifier(p, 6), 7);
  hooks.onCombatHitRoll({ attacker: p, target: count, combatType: core.CombatType.MELEE });
  assert.equal(count.hp, 25, 'garlic never repeats during its active effect');
  cycle = 5; p.area.process(count); assert.equal(count.hp, 26);
  cycle = 50; p.area.process(count); assert.equal(count.override, null);
  hooks.onNpcDeath({ npc: count });
  assert.equal(count.__skipDefaultRespawn, true);
  assert.equal(p.area.owner, p, 'death leaves the player in the basement');
});

test("Cook's special range enforces the quest unlock and applies its food-specific burn levels", () => {
  const Cooking = require('../plugins/skills/Cooking.plugin');
  let complete = false;
  const objectHooks = {};
  Cooking.register(new Proxy({ core, getTaskManager: () => ({ submit: noop }),
    emitCustomEvent: (name, request) => { if (name === 'quest:is-complete') request.complete = complete; },
    onObjectInteraction: (name, actions) => { objectHooks[name] = actions; },
  }, { get: (t, k) => t[k] ?? noop }));
  const p = player(), sessions = new Map();
  const inv = p.getInventory(); inv.contains = id => inv.getAmount(id) > 0;
  p.getInventory = () => inv; p.items.set(I.BREAD_DOUGH, 1);
  const skills = p.getSkillManager(); skills.getCurrentLevel = () => 34; p.getSkillManager = () => skills;
  const range = { getId: () => O.COOKING_RANGE, getDefinition: () => ({ getName: () => 'Cooking range' }),
    getLocation: () => new core.Location(3212, 3215, 0), getPrivateArea: () => null };
  const bread = Cooking.COOKABLE_BY_RAW.get(I.BREAD_DOUGH);
  assert.equal(Cooking._test.startCooking(p, range, bread, sessions), false);
  assert.equal(p.items.get(I.BREAD_DOUGH), 1);
  complete = true;
  assert.equal(Cooking._test.startCooking(p, range, bread, sessions), true);
  assert.equal(Cooking._test.stopBurnLevel(p, bread, O.COOKING_RANGE), 34);
  assert.equal(Cooking._test.isSuccess(p, bread, O.COOKING_RANGE), true);
  for (const recipe of Cooking.COOKABLE_BY_RAW.values()) {
    if (recipe.lumbridgeStopBurn !== undefined) assert.ok(recipe.lumbridgeStopBurn <= recipe.stopBurn, `the special range must improve ${recipe.name}`);
  }
  const shark = Cooking.COOKABLE_BY_RAW.get(I.RAW_SHARK);
  assert.equal(Cooking._test.stopBurnLevel(p, shark, O.COOKING_RANGE), shark.stopBurn);
  assert.ok(objectHooks['Cooking range'].Cook);
});
