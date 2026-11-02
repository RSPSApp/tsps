// Shared Entrana ferry: real transcript runner and current-cache admission policy.
// Run from server/: node --test tests/entrana.test.cjs
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

function harness(nameOrNames) {
  const hooks = {}, events = {}, tasks = [];
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  };
  const api = new Proxy({
    core: { ...core, TaskManager: taskManager,
      MultiChatboxPrompt: { getPending: p => p.prompt } },
    getTaskManager: () => taskManager,
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require('../plugins/npcs/Entrana.plugin').register(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const h = { api, hooks, events, tasks,
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
    getUsername: () => 'EntranaTest', getDisplayName: () => 'EntranaTest', sendMessage: text => p.messages.push(text),
    performAnimation: a => p.animations.push(a.getId()), isRegistered: () => true, isPlayerBot: () => false,
    isPlayer: () => true,
  };
  p.manager = new DialogueManager(p);
  return p;
}


function ferry() {
  const h = harness('Entrana'), p = player(), actions = [];
  h.events['npc-dialogue:action'].push(event => actions.push(event.stepId));
  return { h, p, actions };
}
function talk(h, p, npcId = N.MONK_OF_ENTRANA, answer = "Yes, okay, I'm ready to go.") {
  h.talk(p, npcId);
  h.continueUntil(p, () => Boolean(p.prompt)); h.choose(p, answer); h.finish(p);
}
const arrived = p => p.location && [p.location.x, p.location.y, p.location.z];

test('clean first travel continues after the search; repeat trip skips search and relog resets it', () => {
  const { h, p, actions } = ferry(); p.items.set(I.AIR_RUNE, 50); p.items.set(I.KNIFE, 1);
  talk(h, p); assert.deepEqual(arrived(p), [2834,3331,1]);
  assert.ok(actions.includes('WBEgnZ'), 'canonical first-login search message ran');
  talk(h, p, N.MONK_OF_ENTRANA_4, "Yes, I'm ready to go.");
  assert.deepEqual(arrived(p), [3048,3231,1]);
  actions.length = 0; talk(h, p);
  assert.equal(actions.includes('WBEgnZ'), false, 'successful trip remembered only this login');
  h.hooks.onPlayerLogout.forEach(fn => fn({ player: p }));
  h.hooks.onPlayerLogin.forEach(fn => fn({ player: p }));
  actions.length = 0; talk(h, p);
  assert.ok(actions.includes('WBEgnZ'), 'new login searches again');
});

test('worn and carried weapons refuse; banking gear permits the same natural dialogue retry', () => {
  for (const worn of [false,true]) {
    const { h, p } = ferry();
    if (worn) p.equipment.set(core.Equipment.WEAPON_SLOT, I.RUNE_SCIMITAR);
    else p.items.set(I.RUNE_SCIMITAR, 1);
    talk(h,p); assert.equal(p.location, undefined);
    assert.ok(p.log.some(entry => String(entry).includes('NO WEAPONS')));
    p.items.clear(); p.equipment.clear(); talk(h,p);
    assert.deepEqual(arrived(p), [2834,3331,1]);
  }
});

test('documented wizard robe, jewellery, god book and noted weapons are allowed', () => {
  const { h, p } = ferry();
  p.equipment.set(core.Equipment.BODY_SLOT, I.BLUE_WIZARD_ROBE);
  p.equipment.set(core.Equipment.AMULET_SLOT, I.AMULET_OF_STRENGTH);
  p.equipment.set(core.Equipment.SHIELD_SLOT, I.HOLY_BOOK);
  p.equipment.set(core.Equipment.HANDS_SLOT, I.TORMENTED_BRACELET);
  p.items.set(I.BRACELET_OF_ETHEREUM, 1);
  p.items.set(I.RUNE_SCIMITAR + 1, 1); // Active-cache linked bank note.
  assert.ok(core.CacheDefinitions.getItem(I.RUNE_SCIMITAR + 1).noteTemplate >= 0);
  talk(h,p); assert.deepEqual(arrived(p), [2834,3331,1]);
});

test('Saradomin armour, dangerous impling jars and reward crates use their canonical refusals', () => {
  for (const [name, text] of [['Saradomin platebody','items dedicated'],['Dragon impling jar','strange impling jar'],['Extra supply crate','strange crate']]) {
    const { h, p } = ferry();
    const id = [...core.CacheDefinitions.getObjNames()].find(([id]) => core.CacheDefinitions.getItem(id).name?.toLowerCase() === name.toLowerCase() && core.CacheDefinitions.getItem(id).noteTemplate < 0)?.[0];
    assert.ok(id, name); p.items.set(id,1); talk(h,p);
    assert.equal(p.location, undefined); assert.ok(p.log.some(entry => String(entry).includes(text)), text);
  }
});

test('cancelling does not board; adding a weapon after permission is rechecked at the board action', () => {
  const { h,p } = ferry(); talk(h,p,N.MONK_OF_ENTRANA,'No, not right now.');
  assert.equal(p.location, undefined);
  h.talk(p,N.MONK_OF_ENTRANA); h.continueUntil(p,()=>Boolean(p.prompt)); h.choose(p,"Yes, okay, I'm ready to go.");
  h.continueUntil(p,()=>p.text.includes('All is satisfactory'));
  p.items.set(I.RUNE_SCIMITAR,1); h.finish(p);
  assert.equal(p.location, undefined);
  assert.ok(p.messages.some(text => text.includes('forbidden')));
  p.items.clear(); talk(h,p); assert.deepEqual(arrived(p),[2834,3331,1]);
});


test('storage owners expose actual looting-bag and tackle-box contents to the shared admission check', () => {
  const { h,p } = ferry();
  require('../plugins/items/LootingBag.plugin').register(h.api);
  const storage = require('../plugins/items/storage/Common.StorageItems');
  storage.init(h.api);
  require('../plugins/items/storage/TackleBox.StorageItems')(h.api);
  h.api.onCustomEvent('storage:contents', storage.answerContents);
  const check = () => { const request = { player:p }; h.api.emitCustomEvent('entrana:check-items',request); return request.allowed; };
  const bag = new core.Item(I.LOOTING_BAG,1,{ lootingBag:[{id:I.AIR_RUNE,amount:20}] });
  p.extraItems = [bag];
  assert.equal(check(),true,'permitted contents do not ban an entire looting bag');
  bag.setMetaValue('lootingBag',[{id:I.RUNE_SCIMITAR,amount:1}]);
  assert.equal(check(),false,'actual stored weapon is prohibited');
  p.extraItems = [new core.Item(I.TACKLE_BOX,1)];
  p.attrs.set('storage-items:tackle-box',[[I.HARPOON,1]]);
  assert.equal(check(),true,'ordinary unwieldable harpoon is allowed inside tackle box');
  p.attrs.set('storage-items:tackle-box',[[I.DRAGON_HARPOON,1]]);
  assert.equal(check(),false,'wieldable harpoon inside tackle box is prohibited');
});


test('exceptions do not exempt unrelated robes, armour or tomes; zero-stat cannon parts remain forbidden', () => {
  const {h,p}=ferry();
  for (const name of ['Mystic robe top','Ghostly robe','Tome of fire','Cannon base','Rune gloves']) {
    const id = [...core.CacheDefinitions.getObjNames()].find(([id]) => core.CacheDefinitions.getItem(id).name?.toLowerCase() === name.toLowerCase() && core.CacheDefinitions.getItem(id).noteTemplate < 0)?.[0];
    assert.ok(id, name); p.items.clear(); p.items.set(id,1);
    const request={player:p};h.api.emitCustomEvent('entrana:check-items',request);
    assert.equal(request.allowed,false,name);
  }
});


test('Devious Minds orb and both illuminated pouches cannot bypass intended Abyss access by ferry', () => {
  for (const id of [I.ORB, I.LARGE_POUCH_3, I.COLOSSAL_POUCH_5]) {
    const {h,p}=ferry(); p.items.set(id,1); talk(h,p);
    assert.equal(p.location,undefined,`quest item ${id} is refused`);
    assert.ok(p.log.some(entry=>String(entry).includes('NO WEAPONS')));
  }
  const {h,p}=ferry();p.items.set(I.LARGE_POUCH,1);talk(h,p);
  assert.deepEqual(arrived(p),[2834,3331,1],'ordinary unilluminated essence pouch remains allowed');
});
