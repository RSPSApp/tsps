// At First Light (Quest Helper 06da90f) full-route and Kiko catspeak regressions.
// Run from server/: node --test tests/qh728-q004.test.cjs
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

function harness(name) {
  const hooks = {}, events = {}, tasks = [], npcs = [], namedNpcs = new Map(), itemActions = new Map();
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
    core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: taskManager,
      MultiChatboxPrompt: { getPending: p => p.prompt } },
    getTaskManager: () => taskManager,
    onNpcsInteraction: (names, actions) => names.forEach(n => attach(namedNpcs, n, actions)),
    onItemAction: (item, actions) => itemActions.set(item, actions),
    onNpcInteraction: (npc, actions) => attach(namedNpcs, npc, actions),
    onObjectInteraction: (fn) => (hooks.onObjectInteraction ??= []).push(fn),
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
  const h = { api, hooks, events, tasks, npcs, namedNpcs, itemActions, quest: runtime.getRegisteredQuests().at(-1),
    talk(p, npcId) {
      const choice = (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean);
      assert.ok(choice, `no variant for ${npcId}`);
      runtime.startTranscript(api, p, npcId, typeof choice === 'string' ? h.quest.name : choice.page,
        typeof choice === 'string' ? choice : choice.variant);
    },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    choose(p, text) {
      const prompt = p.prompt; assert.ok(prompt, `no menu for ${text}`);
      const index = prompt.options.indexOf(text); assert.ok(index >= 0, `missing ${text} in ${prompt.options}`);
      p.prompt = null; prompt.pairs[index * 2 + 1]();
    },
    continueUntil(p, predicate, limit = 100) {
      while (!predicate()) {
        assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`);
        assert.ok(p.manager.getCurrent(), `dialogue ended at ${p.text}`);
        p.manager.advance();
      }
    },
    finish(p) { h.continueUntil(p, () => !p.manager.getCurrent() && !p.prompt); },
  }; return h;
}

function player() {
  const attrs = new Map(), items = new Map(), varbits = new Map(), log = [], xp = [];
  const inv = { getAmount: id => items.get(id) ?? 0, isFull: () => Boolean(p.full), getFreeSlots: () => p.full ? 0 : 28,
    contains: id => (items.get(id) ?? 0) > 0,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) { assert.ok((items.get(id) ?? 0) >= amount); items.set(id, items.get(id) - amount); },
  };
  const packet = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return packet; }, getVarbit: id => varbits.get(id) ?? 0,
    sendString(text, uid) { if ([6, 3, 2].some(child => [217, 231, 229, 193].some(group => uid === (group << 16 | child)))) p.text = text; log.push(['text', uid, text]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const equipment = new Map();
  const p = { attrs, items, varbits, log, xp, messages: [], animations: [], prompt: null, text: '', amulet: undefined, equipment, full: false, index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inv,
    getBanks: () => [{ getAmount: () => 0 }],
    getEquipment: () => ({ get: slot => {
      const id = slot === core.Equipment.AMULET_SLOT ? p.amulet : equipment.get(slot);
      return id ? { getId: () => id } : null;
    } }),
    getPacketSender: () => packet, getDialogueManager: () => p.manager,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), getCombatLevel: () => 3,
      getCurrentLevel: () => 99, getMaxLevel: () => 99 }),
    getLocation: () => new core.Location(3210, 3220, 0), moveTo: noop,
    getUsername: () => 'Afl728', sendMessage: text => p.messages.push(text),
    performAnimation: a => p.animations.push(a.getId()), isRegistered: () => true, isPlayerBot: () => false,
  };
  p.manager = new DialogueManager(p);
  return p;
}

function afl({ ds2 = false } = {}) {
  const h = harness('AtFirstLight'), p = player();
  const complete = new Set(['children_of_the_sun', 'eagles_peak']);
  if (ds2) complete.add('dragon_slayer_ii');
  (h.events['quest:is-complete'] ??= []).push(event => { if (complete.has(event.key)) event.complete = true; });
  p.attrs.set('at-first-light:stage-version', 1);
  return { h, p };
}

const at = (p, x, y) => p.moveTo(new core.Location(x, y, 0));
const talkName = (h, p, name, npcId) => h.namedNpcs.get(name)['Talk-to']({ player: p, npcId, npc: null });
const objectClick = (h, p, id) => h.hooks.onObjectInteraction.forEach(fn => fn({ player: p, objectId: id, clickType: 1,
  definition: { id, getActions: () => ({ 53020: ['Pick'], 53022: ['Pick'], 53011: ['Check'], 50880: ['Set-up'] })[id] ?? [] } }));
const continueToMenu = (h, p) => h.continueUntil(p, () => Boolean(p.prompt));

test('AFL mandatory route runs stage 0 to 12 through the real NPC, object, item and dialogue handlers', () => {
  const { h, p } = afl();

  h.talk(p, N.GUILDMASTER_APATURA); continueToMenu(h, p); h.choose(p, 'Can I help you with anything?');
  continueToMenu(h, p); h.choose(p, 'Yes.');
  assert.equal(h.quest.getStage(p), 1); assert.equal(p.varbits.get(9841), 1);
  assert.ok(p.messages.includes("You've started a new quest: <col=081190>At First Light</col>"));
  h.finish(p);

  talkName(h, p, 'Guild Scribe Verity', N.GUILD_SCRIBE_VERITY);
  h.continueUntil(p, () => p.text.startsWith('If anyone did')); assert.equal(h.quest.getStage(p), 2);
  h.finish(p);

  talkName(h, p, 'Guild Hunter Wolf (Master)', N.GUILD_HUNTER_WOLF_MASTER_);
  h.continueUntil(p, () => p.text.startsWith("He's very easy to distract")); assert.equal(h.quest.getStage(p), 3);
  h.continueUntil(p, () => /small toy mouse/.test(p.text)); assert.equal(p.items.get(I.TOY_MOUSE), 1); assert.equal(p.varbits.get(9843), 1);
  h.finish(p);

  h.itemActions.get('Toy mouse').Wind({ player: p, itemId: I.TOY_MOUSE });
  assert.equal(p.items.get(I.TOY_MOUSE_WOUND_), 1); assert.ok(p.messages.includes('You wind up the mouse.'));
  h.hooks.onItemOnNpc[0]({ player: p, itemId: I.TOY_MOUSE_WOUND_, npcId: N.GUILD_HUNTER_KIKO });
  assert.equal(p.items.get(I.TOY_MOUSE_WOUND_), 0); assert.equal(p.varbits.get(9839), 1);
  h.continueUntil(p, () => p.text === 'A mouse? Fantastic!'); h.finish(p);

  objectClick(h, p, 53011);
  assert.match(p.text, /You check the cat's bed/); assert.equal(p.varbits.get(9837), 1); assert.equal(h.quest.getStage(p), 3);
  h.finish(p);

  talkName(h, p, 'Guild Hunter Wolf (Master)', N.GUILD_HUNTER_WOLF_MASTER_);
  h.continueUntil(p, () => p.text.startsWith('Why not?')); assert.equal(h.quest.getStage(p), 3);
  p.manager.advance(); assert.equal(h.quest.getStage(p), 4);
  assert.ok(h.npcs.some(npc => npc.id === N.GUILD_HUNTER_FOX && !npc.removed));
  h.finish(p);

  talkName(h, p, 'Guild Hunter Fox', N.GUILD_HUNTER_FOX);
  h.continueUntil(p, () => p.text.startsWith("Don't forget")); assert.equal(h.quest.getStage(p), 5);
  h.finish(p);

  objectClick(h, p, 53020); assert.ok(p.animations.includes(10094)); h.tick(2);
  assert.equal(p.items.get(I.SMOOTH_LEAF), 1); h.finish(p);
  objectClick(h, p, 53022); h.tick(2); assert.equal(p.items.get(I.STICKY_LEAF), 1); h.finish(p);

  p.items.set(I.JERBOA_TAIL, 2);
  h.hooks.onItemOnItem[0]({ player: p, usedItemId: I.SMOOTH_LEAF, usedWithItemId: I.JERBOA_TAIL });
  assert.equal(p.items.get(I.MAKESHIFT_POULTICE), 1); assert.equal(p.items.get(I.JERBOA_TAIL), 1);
  h.finish(p);
  h.hooks.onItemOnNpc[0]({ player: p, itemId: I.MAKESHIFT_POULTICE, npcId: N.GUILD_HUNTER_FOX });
  h.continueUntil(p, () => /give the poultice/.test(p.text)); assert.equal(h.quest.getStage(p), 6);
  h.continueUntil(p, () => p.text.startsWith("Well it's your lucky day! Take")); assert.equal(h.quest.getStage(p), 7);
  h.continueUntil(p, () => /fur sample/.test(p.text)); assert.equal(p.items.get(I.FUR_SAMPLE), 1); assert.equal(p.varbits.get(9842), 1);
  h.finish(p);

  talkName(h, p, 'Atza', N.ATZA);
  h.continueUntil(p, () => /give the fur sample/.test(p.text)); assert.equal(h.quest.getStage(p), 8);
  h.continueUntil(p, () => p.text.startsWith("It's all in that pile")); assert.equal(p.varbits.get(9840), 1);
  h.finish(p);

  p.items.set(I.HAMMER, 1);
  objectClick(h, p, 50880); assert.ok(p.animations.includes(3676)); h.tick(2);
  h.continueUntil(p, () => p.text === 'All done!'); assert.equal(p.varbits.get(9840), 2);
  h.continueUntil(p, () => /trimmed fur/.test(p.text)); assert.equal(h.quest.getStage(p), 9); assert.equal(p.items.get(I.TRIMMED_FUR), 1);
  h.finish(p);

  talkName(h, p, 'Guild Hunter Fox', N.GUILD_HUNTER_FOX);
  h.continueUntil(p, () => /gives you a report/.test(p.text)); assert.equal(h.quest.getStage(p), 10); assert.equal(p.items.get(I.FOXS_REPORT), 1);
  h.finish(p);

  h.hooks.onItemOnNpc[0]({ player: p, itemId: I.FOXS_REPORT, npcId: N.GUILD_SCRIBE_VERITY });
  assert.match(p.text, /give Fox's report/); assert.equal(p.varbits.get(9836), 1); assert.equal(p.items.get(I.FOXS_REPORT), 0);
  assert.equal(h.quest.getStage(p), 10); h.finish(p);

  p.items.set(I.JERBOA_TAIL, 1); p.items.set(I.NEEDLE, 1);
  h.hooks.onItemOnObject[0]({ player: p, itemId: I.JERBOA_TAIL, objectId: 53011 });
  assert.match(p.text, /carefully fix up/); assert.equal(h.quest.getStage(p), 11); assert.equal(p.varbits.get(9838), 1);
  assert.equal(p.items.get(I.JERBOA_TAIL), 0); assert.equal(p.items.get(I.TRIMMED_FUR), 0);
  assert.deepEqual(p.xp, [[core.Skill.CRAFTING.getIndex(), 10]]); h.finish(p);

  h.talk(p, N.GUILDMASTER_APATURA);
  h.continueUntil(p, () => p.text.startsWith('Actually...')); assert.equal(h.quest.isComplete(p), false);
  p.manager.advance(); assert.equal(h.quest.getStage(p), 12); assert.equal(h.quest.isComplete(p), true);
  assert.deepEqual(p.xp, [
    [core.Skill.CRAFTING.getIndex(), 10], [core.Skill.HUNTER.getIndex(), 4500],
    [core.Skill.CONSTRUCTION.getIndex(), 800], [core.Skill.HERBLORE.getIndex(), 500],
  ]);
  assert.ok(!h.npcs.some(npc => npc.id === N.GUILD_HUNTER_FOX && !npc.removed), 'the owner-only Fox is removed on completion');
});

function petKiko(h, p) {
  p.manager.reset(); p.prompt = null; p.text = ''; p.messages.length = 0;
  h.namedNpcs.get('Guild Hunter Kiko').Pet({ player: p, npcId: N.GUILD_HUNTER_KIKO, npc: null });
  for (let guard = 20; guard-- > 0 && p.manager.getCurrent() && !p.text.startsWith('Can you scratch my belly');) p.manager.advance();
}

test('AFL Kiko petting understands inventory and equipped catspeak amulets during the quest', () => {
  const { h, p } = afl();
  h.quest.setStage(p, 3);
  const petMessage = 'You pet the cat, who leans into your hand in return.';

  petKiko(h, p); assert.ok(p.messages.includes(petMessage), 'no amulet shows the ordinary pet message');
  for (const id of [I.CATSPEAK_AMULET, I.CATSPEAK_AMULET_E_, I.CATSPEAK_AMULET_2, I.CATSPEAK_AMULET_E__2]) {
    p.items.set(id, 1); p.amulet = undefined;
    petKiko(h, p); assert.ok(!p.messages.includes(petMessage), `inventory amulet ${id} understands Kiko`);
    p.items.delete(id);
  }
  for (const id of [I.CATSPEAK_AMULET, I.CATSPEAK_AMULET_E_, I.CATSPEAK_AMULET_2, I.CATSPEAK_AMULET_E__2]) {
    p.items.clear(); p.amulet = id;
    petKiko(h, p); assert.ok(!p.messages.includes(petMessage), `equipped amulet ${id} understands Kiko`);
  }
});

test('AFL Kiko petting treats Dragon Slayer II as catspeak access during and after the quest', () => {
  const { h, p } = afl({ ds2: true });
  const petMessage = 'You pet the cat, who leans into your hand in return.';
  h.quest.setStage(p, 3);
  petKiko(h, p); assert.ok(!p.messages.includes(petMessage), 'Dragon Slayer II replaces the amulet during the quest');
  h.quest.setStage(p, 12);
  petKiko(h, p); assert.ok(!p.messages.includes(petMessage), 'post-quest petting uses the catspeak variant');
});

test('AFL post-quest Kiko petting picks the with-amulet page variant from inventory or equipment', () => {
  const { h, p } = afl();
  const petMessage = 'You pet the cat, who leans into your hand in return.';
  h.quest.setStage(p, 12);
  petKiko(h, p); assert.ok(p.messages.includes(petMessage), 'no amulet still shows the ordinary pet message');
  p.items.set(I.CATSPEAK_AMULET_2, 1);
  petKiko(h, p); assert.ok(!p.messages.includes(petMessage), 'the post-quest page uses the catspeak variant');
  p.items.clear(); p.amulet = I.CATSPEAK_AMULET_E__2;
  petKiko(h, p); assert.ok(!p.messages.includes(petMessage), 'an equipped amulet also uses the catspeak variant');
});

test('AFL recovery branches replace the lost mouse advice, sample, trimmed fur and report naturally', () => {
  const { h, p } = afl();

  h.quest.setStage(p, 3); p.attrs.set('at-first-light:vars', 1 << 13);
  talkName(h, p, 'Guild Hunter Wolf (Master)', N.GUILD_HUNTER_WOLF_MASTER_);
  h.continueUntil(p, () => p.text.startsWith("I already gave it to you"));
  assert.equal(p.items.get(I.TOY_MOUSE), undefined, 'the lost mouse is not replaced by Wolf');
  h.finish(p);

  h.quest.setStage(p, 7); p.attrs.set('at-first-light:vars', 1 << 12);
  talkName(h, p, 'Guild Hunter Fox', N.GUILD_HUNTER_FOX);
  h.continueUntil(p, () => /fur sample/.test(p.text));
  assert.equal(p.items.get(I.FUR_SAMPLE), 1, 'Fox replaces the lost fur sample');
  assert.equal(p.varbits.get(9842), 1); h.finish(p);

  h.quest.setStage(p, 9);
  talkName(h, p, 'Atza', N.ATZA);
  h.continueUntil(p, () => /trimmed fur/.test(p.text));
  assert.equal(p.items.get(I.TRIMMED_FUR), 1, 'Atza replaces the lost trimmed fur');
  h.finish(p);

  h.quest.setStage(p, 10); p.items.delete(I.TRIMMED_FUR);
  talkName(h, p, 'Guild Hunter Fox', N.GUILD_HUNTER_FOX);
  h.continueUntil(p, () => /another one/.test(p.text));
  h.finish(p);
  assert.equal(p.items.get(I.FOXS_REPORT), 1, "Fox replaces the lost report");
});

test('AFL full-inventory recovery stops the sample, trimmed fur and report hand-outs', () => {
  const { h, p } = afl();

  h.quest.setStage(p, 7); p.full = true;
  talkName(h, p, 'Guild Hunter Fox', N.GUILD_HUNTER_FOX);
  h.continueUntil(p, () => /Any success with Atza yet/.test(p.text));
  h.finish(p);
  assert.equal(p.items.get(I.FUR_SAMPLE), undefined, 'a full bag blocks the replacement sample');

  h.quest.setStage(p, 9); p.full = true;
  talkName(h, p, 'Atza', N.ATZA);
  h.continueUntil(p, () => /don't have (enough room|space)/.test(p.text));
  assert.equal(p.items.get(I.TRIMMED_FUR), undefined);
  h.finish(p);

  p.full = false; p.items.delete(I.FOXS_REPORT);
  h.quest.setStage(p, 10); p.full = true;
  talkName(h, p, 'Guild Hunter Fox', N.GUILD_HUNTER_FOX);
  h.continueUntil(p, () => /adventuring way/.test(p.text));
  h.finish(p);
  assert.equal(p.items.get(I.FOXS_REPORT), undefined);
});

test('AFL Atza pile accepts ordinary, Imcando and off-hand hammers from inventory or equipment', () => {
  const { h } = afl();
  const cases = [
    { name: 'ordinary hammer in inventory', items: [I.HAMMER] },
    { name: 'Imcando hammer in inventory', items: [I.IMCANDO_HAMMER] },
    { name: 'off-hand hammer in inventory', items: [I.IMCANDO_HAMMER_OFF_HAND_] },
    { name: 'Imcando hammer equipped', equip: [core.Equipment.WEAPON_SLOT, I.IMCANDO_HAMMER] },
    { name: 'off-hand hammer equipped', equip: [core.Equipment.SHIELD_SLOT, I.IMCANDO_HAMMER_OFF_HAND_] },
  ];
  for (const entry of cases) {
    const p = player();
    h.quest.setStage(p, 8);
    p.attrs.set('at-first-light:vars', 1 << 9);
    for (const id of entry.items ?? []) p.items.set(id, 1);
    if (entry.equip) p.equipment.set(entry.equip[0], entry.equip[1]);
    objectClick(h, p, 50880);
    assert.ok(p.animations.includes(3676), entry.name);
    h.tick(2); h.finish(p);
  }
});

test('AFL stage 11 with no report keeps out-of-order bed repair and recovers through Fox and Verity', () => {
  const { h, p } = afl();
  h.quest.setStage(p, 9);
  p.items.set(I.TRIMMED_FUR, 1); p.items.set(I.JERBOA_TAIL, 1); p.items.set(I.NEEDLE, 1);

  h.hooks.onItemOnObject[0]({ player: p, itemId: I.JERBOA_TAIL, objectId: 53011 });
  assert.equal(h.quest.getStage(p), 11, 'the canonical out-of-order repair is not blocked');
  assert.equal(p.varbits.get(9838), 1);
  assert.equal(p.items.get(I.FOXS_REPORT), undefined);
  h.finish(p);

  talkName(h, p, 'Guild Hunter Fox', N.GUILD_HUNTER_FOX);
  h.continueUntil(p, () => /another one/.test(p.text));
  h.finish(p);
  assert.equal(p.items.get(I.FOXS_REPORT), 1, 'Fox replaces the not-yet-obtained report at stage 11');
  assert.equal(h.quest.getStage(p), 11);

  h.hooks.onItemOnNpc[0]({ player: p, itemId: I.FOXS_REPORT, npcId: N.GUILD_SCRIBE_VERITY });
  assert.equal(p.varbits.get(9836), 1);
  assert.equal(p.items.get(I.FOXS_REPORT), 0);
  h.finish(p);

  h.talk(p, N.GUILDMASTER_APATURA);
  h.continueUntil(p, () => p.text.startsWith('Actually...'));
  p.manager.advance();
  assert.equal(h.quest.getStage(p), 12);
  assert.equal(h.quest.isComplete(p), true);
});

test('AFL interrupted Atza hand-in recovers the pile through the registered Atza talk', () => {
  const { h, p } = afl();
  h.quest.setStage(p, 7);
  p.items.set(I.FUR_SAMPLE, 1);

  // The natural hand-in: Atza takes the sample and the stage moves on.
  talkName(h, p, 'Atza', N.ATZA);
  h.continueUntil(p, () => /give the fur sample/.test(p.text));
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.items.get(I.FUR_SAMPLE), 0);

  // The chatbox is closed before Atza's "It's all in that pile..." line, so the
  // pile flag is never set.
  p.getPacketSender().sendInterfaceRemoval();
  assert.equal(p.varbits.get(9840) ?? 0, 0, 'the interrupted hand-in left the pile locked');

  // Talking to Atza again must release the pile.
  talkName(h, p, 'Atza', N.ATZA);
  assert.equal(p.varbits.get(9840), 1, 'Atza did not re-ask for the pile');
  h.continueUntil(p, () => p.text.startsWith('Don\'t forget'));
  h.finish(p);

  p.items.set(I.HAMMER, 1);
  objectClick(h, p, 50880);
  assert.ok(p.animations.includes(3676), 'the pile object stayed locked after the recovery');
  h.tick(2);
  h.continueUntil(p, () => p.text === 'All done!'); assert.equal(p.varbits.get(9840), 2);
  h.continueUntil(p, () => /trimmed fur/.test(p.text));
  assert.equal(h.quest.getStage(p), 9);
  assert.equal(p.items.get(I.TRIMMED_FUR), 1);
  h.finish(p);
});

test('AFL interrupted pile completion recovers the canonical trimmed fur hand-out', () => {
  const { h, p } = afl();
  h.quest.setStage(p, 8);
  p.attrs.set('at-first-light:vars', 1 << 9); // housetrapped = 1, the pile is open
  p.items.set(I.HAMMER, 1);

  objectClick(h, p, 50880);
  h.tick(2);
  h.continueUntil(p, () => p.text === 'All done!');
  assert.equal(p.varbits.get(9840), 2);
  assert.equal(h.quest.getStage(p), 8, 'the stage only moves on with the fur');

  // The chatbox is closed between "All done!" and Atza's trimmed fur hand-out.
  p.getPacketSender().sendInterfaceRemoval();
  assert.equal(p.items.get(I.TRIMMED_FUR), undefined, 'the interrupted pile gave no fur');

  talkName(h, p, 'Atza', N.ATZA);
  h.continueUntil(p, () => /trimmed fur/.test(p.text));
  assert.equal(p.items.get(I.TRIMMED_FUR), 1, 'Atza did not hand over the trimmed fur');
  assert.equal(h.quest.getStage(p), 9);
  h.finish(p);
});

test('AFL keeps the interrupted pile recovery across a relog', () => {
  const { h, p } = afl();
  h.quest.setStage(p, 7);
  p.items.set(I.FUR_SAMPLE, 1);

  talkName(h, p, 'Atza', N.ATZA);
  h.continueUntil(p, () => /give the fur sample/.test(p.text));
  assert.equal(h.quest.getStage(p), 8);
  p.getPacketSender().sendInterfaceRemoval();

  // Log out and back in: the stage and the packed flags have to survive.
  h.hooks.onPlayerLogout[0]({ player: p });
  h.hooks.onPlayerLogin[0]({ player: p });
  h.events['player:bootstrap-complete'][0]({ player: p });
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.varbits.get(9840), 0, 'the relog left the pile flag as it was');

  talkName(h, p, 'Atza', N.ATZA);
  assert.equal(p.varbits.get(9840), 1, 'the relog lost the pile recovery');
  h.finish(p);
});

test('AFL does not hand out a second trimmed fur after the bed is repaired', () => {
  const { h, p } = afl();
  h.quest.setStage(p, 11);
  p.attrs.set('at-first-light:vars', 1 << 7); // bedRepair = 1

  // The imported guard the transcript uses, answered through the registered dispatch.
  const condition = stepId => PluginManager.emitNpcDialogueCondition({ player: p, stepId, text: '', npcId: N.ATZA });
  assert.equal(condition('t0t5aX'), false, 'the guard still offers a replacement after the repair');
  p.attrs.set('at-first-light:vars', 0);
  assert.equal(condition('t0t5aX'), true, 'the guard offers a replacement before the repair');
  p.attrs.set('at-first-light:vars', 1 << 7);

  talkName(h, p, 'Atza', N.ATZA);
  h.finish(p);
  assert.equal(p.items.get(I.TRIMMED_FUR), undefined, 'Atza handed out a duplicate trimmed fur');
  assert.equal(h.quest.getStage(p), 11);
});

test('AFL imported leaf-pick guards answer the real transcript conditions', () => {
  const { h, p } = afl();
  const condition = stepId => PluginManager.emitNpcDialogueCondition({ player: p, stepId, text: '', npcId: N.GUILD_HUNTER_FOX });
  assert.equal(condition('c-avW4'), true, 'no smooth leaf');
  assert.equal(condition('aXen1A'), false);
  assert.equal(condition('khCtCH'), true, 'no sticky leaf');
  assert.equal(condition('DM1ufw'), false);
  p.items.set(I.SMOOTH_LEAF, 1); p.items.set(I.STICKY_LEAF, 1);
  assert.equal(condition('c-avW4'), false);
  assert.equal(condition('aXen1A'), true);
  assert.equal(condition('khCtCH'), false);
  assert.equal(condition('DM1ufw'), true);
});
