// From server/: node --test tests/ides-of-milk-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
const noop = () => {};

function harness() {
  const hooks = {}, events = {}, tasks = [], transcripts = [], objects = [], npcs = [];
  class PrivateArea {
    constructor() { this.entities = []; this.destroyed = false; }
    add(actor) { this.entities.push(actor); actor.setArea(this); }
    enter(actor) { this.add(actor); }
    leave(actor, logout) { this.postLeave(actor, logout); }
    postLeave(actor) { this.entities = this.entities.filter(value => value !== actor); actor.setArea(null); this.destroy(); }
    destroy() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const api = new Proxy({
    core: { ...core, PrivateArea, TaskManager: {
      submit: task => { task.setRunning(true); tasks.push(task); },
      cancelTasks: key => tasks.filter(task => task.key === key).forEach(task => task.stop()),
    }, ObjectManager: { register: object => objects.push(object) } },
    persistAttribute: noop,
    onCustomEvent: (name, handler) => (events[name] ??= []).push(handler),
    emitCustomEvent: (name, event) => (events[name] ?? []).forEach(handler => handler(event)),
    registerNpcCombatMethodProvider: (ids, method) => { api.combat = method; },
    spawnNpc: definition => {
      let area, at = new core.Location(definition.x, definition.y, definition.z);
      const npc = { ...definition, getId: () => definition.id, getArea: () => area, setArea: value => { area = value; },
        getHitpoints: () => 58, getLocation: () => at, moveTo: value => { at = value; },
        getCombat: () => ({ reset: noop }), getDefinition: () => ({ getRespawn: () => 36 }),
        setCombatXpMultiplier: value => { npc.xpMultiplier = value; }, setPositionToFace: noop, performAnimation: noop, performGraphic: noop, forceChat: noop };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => { npc.removed = true; },
  }, { get: (target, key) => target[key] ?? ((handler) => (hooks[key] ??= []).push(handler)) });
  const original = runtime.startTranscript;
  runtime.startTranscript = (...args) => { transcripts.push(args); return true; };
  try { require('../plugins/quests/quests/IdesOfMilk.Quest')(api); }
  finally { runtime.startTranscript = original; }
  return { api, hooks, tasks, transcripts, objects, npcs, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(handler => handler(event)),
    line(player, npcId, text) { const event = { player, npcId, text }; this.emit('npc-dialogue:line', event); event.before?.(); },
    action(player, npcId, stepId) { const event = { player, npcId, stepId }; this.emit('npc-dialogue:action', event); return event; },
    item(player, itemId, option, item, slot) { const event = { player, itemId, option, item, slot }; hooks.onItemAction[0](event); return event; },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
  };
}

function player() {
  const attributes = new Map(), items = new Map(), varbits = new Map(), strings = new Map(), animations = [], damage = [], messages = [], graphics = [];
  let area = null, location = new core.Location(3254, 3274, 0);
  const packet = new Proxy({ sendVarbit: (id, value) => { varbits.set(id, value); return packet; },
    sendString: (text, id) => { strings.set(id, text); return packet; },
    sendGraphic: (graphic, at) => { graphics.push([at.getX(), at.getY()]); return packet; } }, { get: (target, key) => target[key] ?? (() => packet) });
  const inventory = { getAmount: id => items.get(id) ?? 0, getFreeSlots: () => p.full ? 0 : 28,
    isFull: () => Boolean(p.full), adds: (id, amount) => items.set(id, (items.get(id) ?? 0) + amount),
    deleteNumber: (id, amount) => { assert.ok((items.get(id) ?? 0) >= amount); items.set(id, items.get(id) - amount); },
    get: () => p.lamp, deleteAtSlot: () => { p.lamp = null; } };
  const p = { attributes, items, varbits, strings, animations, damage, messages,
    graphics, getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory, getPacketSender: () => packet,
    getDialogueManager: () => ({ startDialogues: noop, reset: noop }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }), setUntargetable: noop,
    getLocation: () => location, moveTo: value => { location = value; },
    getArea: () => area, setArea: value => { area = value; },
    getHitpoints: () => p.hp ?? 10, getCombat: () => ({ reset: noop, getHitQueue: () => ({ addPendingDamage: hits => damage.push(...hits) }) }),
    performAnimation: animation => animations.push(animation.getId()), sendMessage: text => messages.push(text),
    getSkillManager: () => ({ getMaxLevel: () => p.maxHp ?? 10, getCombatLevel: () => 99, getExperience: () => p.xp ?? 0, addExperience: (skill, amount) => { p.xp = (p.xp ?? 0) + amount; } }),
  };
  return p;
}

test('4153 quest states and Groats information follow the actual dialogue milestones', () => {
  const h = harness(), p = player();
  h.emit('npc-dialogue:hook', { player: p, npcId: N.CASSIUS_2, hook: 'quest:the-ides-of-milk:start' });
  assert.equal(p.varbits.get(20106), 1);
  h.line(p, N.CASSIUS_2, 'Of milk.'); assert.equal(h.quest.getStage(p), 2);
  h.line(p, N.CASSIUS_2, 'Not to mention, my associate Brutus is already embedded in the Groats operation to work a different angle. That will prove most lucrative.');
  assert.equal(h.quest.getStage(p), 3);
  h.emit('npc-dialogue:condition', { player: p, stepId: 'UGwoXz' });
  assert.equal(p.varbits.get(20107), 1);
  assert.equal(h.quest.getStage(p), 3);
  h.line(p, N.SETH_GROATS, 'Anyway, feel free to grab me book on the topic from the shelf over there.');
  assert.equal(p.varbits.get(20108), 1); assert.equal(h.quest.getStage(p), 4);
  h.action(p, N.SETH_GROATS, 'y7Vpgm'); assert.equal(h.quest.getStage(p), 4);
  h.action(p, N.CASSIUS_2, 'CPf4Gm'); assert.equal(h.quest.getStage(p), 5);
  h.action(p, N.CASSIUS_2, 'Z5eNNH'); assert.equal(h.quest.getStage(p), 6);
  assert.equal(p.items.get(I.THE_GROATS_PRINCIPLES), 0);
  assert.equal(p.items.get(I.MILK_SAMPLE), 1);
});

test('first sample starts the reaction immediately and coughs three ticks later without killing', () => {
  for (const hp of [1, 10]) {
    const h = harness(), p = player(); p.hp = hp; p.items.set(I.MILK_SAMPLE, 1); h.quest.setStage(p, 6);
    h.item(p, I.MILK_SAMPLE, 'Drink');
    assert.equal(h.quest.getStage(p), 8); assert.deepEqual(p.animations, [829]); assert.equal(p.damage.length, 0);
    h.tick(2); assert.equal(p.damage.length, 0);
    h.tick(1); assert.deepEqual(p.animations, [829, 11267]);
    assert.equal(p.damage.length, hp === 1 ? 0 : 1);
    h.action(p, N.CASSIUS_2, '9FVdU5');
    assert.equal(p.damage.length, hp === 1 ? 0 : 1, 'restarting the conversation never repeats the poison hit');
    assert.equal(h.hooks.onNpcDialogueVariant[0]({ player: p, npcId: N.CASSIUS_2 }), 'returning-to-cassius-after-sampling-the-milk-resume');
    h.tick(2); assert.equal(h.transcripts.length, 2);
    h.action(p, N.CASSIUS_2, 'gAirRb'); assert.equal(h.quest.getStage(p), 10);
  }
});

test('Duke referral, second drink, bull agreement and Gillie report keep their captured states', () => {
  const h = harness(), p = player(); h.quest.setStage(p, 10);
  h.line(p, N.DUKE_HORACIO, "Why not speak to Gillie Groats? She seems to handle the milk side of the business now. Maybe she'll get you set up under their permit.");
  assert.equal(h.quest.getStage(p), 12);
  h.line(p, N.GILLIE_GROATS, "It definitely won't hurt your chances."); assert.equal(h.quest.getStage(p), 14);
  p.items.set(I.MILK_SAMPLE_3, 1); p.moveTo(new core.Location(3254, 3274, 1));
  h.item(p, I.MILK_SAMPLE_3, 'Drink'); assert.equal(h.quest.getStage(p), 14);
  p.moveTo(new core.Location(3254, 3274, 0)); h.item(p, I.MILK_SAMPLE_3, 'Drink');
  assert.equal(h.quest.getStage(p), 16); assert.equal(p.damage.length, 0);
  h.line(p, N.GILLIE_GROATS, "Perhaps you'd be interested in dealing with him? I'd owe you a fairly large favour.");
  assert.equal(h.quest.getStage(p), 18);
  h.quest.setStage(p, 20); h.action(p, N.CASSIUS_2, 'O4owU9'); assert.equal(h.quest.getStage(p), 20);
  h.line(p, N.GILLIE_GROATS, "Why don't you go and talk to him about it! He may appreciate knowing the Brutus was bad for business.");
  assert.equal(h.quest.getStage(p), 21);
  h.action(p, N.CASSIUS_2, 'O4owU9'); assert.equal(h.quest.getStage(p), 22);
  assert.equal(p.attributes.get('quest.points'), 1);
});

test('bull release is private, uses the captured bull and cleans up pending or active fights', () => {
  const h = harness(), p = player(), other = player(); h.quest.setStage(p, 18);
  h.action(p, N.BULL, 'kaznTu'); assert.equal(p.varbits.get(20160), 1);
  h.tick(2); const arena = p.getArea();
  assert.ok(arena); assert.equal(h.npcs[0].id, N.BRUTUS);
  assert.equal(h.npcs[0].getArea(), arena); assert.equal(h.npcs[0].xpMultiplier, 2); assert.equal(other.getArea(), null);
  assert.deepEqual(h.objects.map(object => object.getId()), [60762, 60761, 60764, 60765]);
  assert.ok(h.objects.every(object => object.getArea() === arena));
  h.hooks.onPlayerLogout[0]({ player: p }); assert.equal(p.getArea(), null); assert.equal(h.npcs[0].removed, true);
  const pending = player(); h.quest.setStage(pending, 18); h.action(pending, N.BULL, 'mKQNRL');
  h.hooks.onPlayerLogout[0]({ player: pending }); h.tick(4); assert.equal(h.npcs.length, 1);
});

test('the bull tag has one game message and one continued message box', () => {
  const h = harness(), p = player(); h.quest.setStage(p, 18); h.action(p, N.BULL, 'mKQNRL'); h.tick(2);
  h.hooks.onNpcDeath[0]({ killer: p, npc: h.npcs[0], npcId: N.BRUTUS });
  assert.equal(h.quest.getStage(p), 20); assert.equal(p.messages.length, 1);
  assert.deepEqual(h.action(p, N.BULL, 'HSM347').box, { statement: true });
  assert.equal(h.action(p, N.BULL, 'fc4Kit').handled, true);
});

test('lamp offers only combat skills including Prayer and rejects forged noncombat confirmations', () => {
  const h = harness(), p = player(); h.quest.setStage(p, 22); p.lamp = {};
  let request; h.api.onCustomEvent('xpreward:open', value => { request = value; });
  h.item(p, I.MAGIC_LAMP, 'Rub', p.lamp, 0);
  assert.ok(request.skills.includes(core.Skill.PRAYER)); assert.ok(!request.skills.includes(core.Skill.COOKING));
  assert.equal(request.onConfirm(core.Skill.COOKING, 'Cooking'), null); assert.equal(p.xp, undefined);
  assert.match(request.onConfirm(core.Skill.PRAYER, 'Prayer'), /1,000 Prayer experience/);
  assert.equal(p.xp, 1000); assert.equal(p.varbits.get(20110), 1); assert.equal(p.lamp, null);
  assert.equal(request.onConfirm(core.Skill.PRAYER, 'Prayer'), null); assert.equal(p.xp, 1000);
});

test('simultaneous bulls choose their own next attack and cooldown before its animation starts', () => {
  const h = harness(), a = player(), b = player();
  for (const p of [a, b]) { h.quest.setStage(p, 18); h.action(p, N.BULL, 'mKQNRL'); }
  h.tick(2);
  const [first, second] = h.npcs;
  a.moveTo(new core.Location(3261, 3286, 0)); b.moveTo(new core.Location(3261, 3286, 0));
  first.getCombat = () => ({ getTarget: () => a }); second.getCombat = () => ({ getTarget: () => b });
  first.getArea().meleeRemaining = 0;
  const method = new h.api.combat();
  assert.equal(method.attackSpeed(first), 8, 'the special after three melee attacks has eight-tick recovery');
  assert.equal(method.attackSpeed(second), 5, 'other player starts with a normal five-tick attack');
  method.start(first, a);
  assert.equal(first.getArea().special, 'charge');
  assert.equal(method.attackSpeed(second), 5, 'the first bull cannot change the second cooldown');
  method.start(second, b);
  assert.equal(second.getArea().special, null);
  assert.equal(method.hits(first, a).length, 0, 'specials use delayed tile damage instead of an instant melee hit');
});

test('legacy saves migrate once and restore all client sibling fields', () => {
  const h = harness(), p = player(); p.attributes.set('quest.the_ides_of_milk.stage', 7);
  p.attributes.set('quest.the_ides_of_milk.gillie', 1); p.attributes.set('quest.the_ides_of_milk.seth', 1);
  h.hooks.onPlayerLogin[0]({ player: p }); assert.equal(h.quest.getStage(p), 12);
  assert.equal(p.varbits.get(20107), 1); assert.equal(p.varbits.get(20108), 1);
  h.hooks.onPlayerLogin[0]({ player: p }); assert.equal(h.quest.getStage(p), 12);
});

test('the Groats book opens the captured four-page book without advancing quest state', () => {
  const h = harness(), p = player(); p.items.set(I.THE_GROATS_PRINCIPLES, 1); h.quest.setStage(p, 4);
  h.item(p, I.THE_GROATS_PRINCIPLES, 'Read');
  assert.equal(p.strings.get((392 << 16) | 6), 'The Groats Principles');
  assert.equal(p.strings.get((392 << 16) | 44), 'The Groats Principles.');
  assert.equal(p.strings.get((392 << 16) | 9), '1');
  assert.equal(h.quest.getStage(p), 4);
  const spreads = require('../plugins/quests/data/ides-of-milk-book.json');
  assert.equal(spreads.length, 2); assert.equal(spreads[1][48], 'Always squirrel money away');
});

function fight(stage = 18) {
  const h = harness(), p = player(); h.quest.setStage(p, stage);
  h.action(p, N.BULL, 'mKQNRL'); h.tick(4);
  return { h, p, npc: h.npcs[0], arena: p.getArea(), method: new h.api.combat() };
}

test('stomp freezes the captured L footprint and misses a player who steps back', () => {
  const { h, p, npc, arena, method } = fight();
  npc.moveTo(new core.Location(3260, 3286, 0));
  p.moveTo(new core.Location(3260, 3289, 0));
  arena.meleeRemaining = 0; arena.nextSpecial = 'stomp';
  method.start(npc, p); h.tick(4);
  assert.deepEqual(p.graphics.slice().sort(), [[3259, 3287], [3259, 3288], [3259, 3289], [3260, 3289], [3261, 3289]].sort());
  assert.ok(p.damage[0].getDamage() >= 3 && p.damage[0].getDamage() <= 4, 'low-level quest damage scales to base Hitpoints');
  p.damage.length = 0; p.graphics.length = 0;
  arena.stompsRemaining = 1;
  p.moveTo(new core.Location(3263, 3289, 0));
  method.start(npc, p); h.tick(4);
  assert.equal(p.damage.length, 0, 'later stomps retain the selected footprint after the player moves');
  assert.ok(p.graphics.some(([x, y]) => x === 3259 && y === 3287));
  arena.stompsRemaining = 0; arena.meleeRemaining = 0; arena.nextSpecial = 'stomp';
  p.moveTo(new core.Location(3261, 3289, 0));
  method.start(npc, p); p.moveTo(new core.Location(3261, 3290, 0)); h.tick(4);
  assert.deepEqual(p.graphics.slice(-3).sort(), [[3260, 3289], [3261, 3289], [3262, 3289]].sort());
  assert.equal(p.damage.length, 0, 'one tile backwards dodges a cardinal stomp');
});

test('charge dashes four tiles on its facing axis and allows a two-tile sidestep', () => {
  for (const [at, target, dodge, end] of [
    [[3260, 3290], [3260, 3289], [3258, 3289], [3260, 3286]],
    [[3260, 3290], [3260, 3289], [3261, 3291], [3260, 3286]],
    [[3260, 3286], [3263, 3287], [3263, 3289], [3264, 3286]],
  ]) {
    const { h, p, npc, arena, method } = fight();
    npc.moveTo(new core.Location(...at, 0)); p.moveTo(new core.Location(...target, 0));
    arena.meleeRemaining = 0; arena.nextSpecial = 'charge';
    method.start(npc, p); p.moveTo(new core.Location(...dodge, 0)); h.tick(4);
    assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], end);
    assert.equal(p.damage.length, 0);
  }
});

test('postquest kills preserve the private field and Ring restarts respawn without spawning duplicates', () => {
  const { h, p, npc, arena } = fight(22);
  h.hooks.onNpcDeath[0]({ killer: p, npc });
  assert.equal(p.getArea(), arena); assert.equal(arena.isDestroyed(), false);
  assert.equal(arena.bull, null); assert.equal(npc.__skipDefaultRespawn, true);
  h.emit('ides-of-milk:cowbell-ring', { player: p }); h.tick(5);
  h.emit('ides-of-milk:cowbell-ring', { player: p }); h.tick(12);
  assert.equal(h.npcs.length, 1);
  h.tick(1); assert.equal(h.npcs.length, 2);
  h.hooks.onNpcDeath[0]({ killer: p, npc: h.npcs[1] });
  h.tick(23); assert.equal(h.npcs.length, 2, 'cancelled original respawn cannot replace a later kill');
  h.tick(13); assert.equal(h.npcs.length, 3);
  h.hooks.onPlayerLogout[0]({ player: p });
  assert.equal(arena.isDestroyed(), true);
});
