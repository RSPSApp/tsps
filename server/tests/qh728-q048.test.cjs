// Source-contract checks for Gertrude's Cat (Quest Helper q048).
// Run from server/: node --test tests/qh728-q048.test.cjs
//
// These dispatch the plugin's registered handlers with fixture-set starting
// stage/inventory (labelled per test). They prove handler contracts and the
// varp-180 stage graph, not a natural playthrough or the visual QH overlay.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');

let productionLines;
let productionOrder;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.getCoreApi().ObjectDefinition.init();
  new NpcDefinitionLoader().load();

  const api = PluginManager.createApi('qh728-q048-production-routing');
  productionLines = [];
  api.onCustomEvent('npc-dialogue:line', (event) => productionLines.push(String(event.text ?? '')));
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
  const { QUESTS } = require('../plugins/quests/Quests.plugin');
  productionOrder = QUESTS.filter((name) => ['ARuffSituation', 'GertrudesCat', 'TailOfTwoCats'].includes(name));
  for (const name of productionOrder) {
    require(`../plugins/quests/quests/${name}.Quest`)(PluginManager.createApi(name));
  }
});

const transcripts = [];
let useActualTranscripts = false;
const startTranscript = runtime.startTranscript;
runtime.startTranscript = (api, player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  if (useActualTranscripts) return startTranscript(api, player, npcId, page, variant);
  return true;
};

function setup() {
  const core = {
    ...PluginManager.getCoreApi(),
    CountdownTask: class { constructor(player, ticks, run) { Object.assign(this, { player, ticks, run }); } },
    TaskManager: { submit() {}, cancelTasks() {} },
    MultiChatboxPrompt: { getPending: () => null },
  };
  const hooks = { variants: [], conditions: [], objects: [], itemOnNpc: [], itemOnItem: [], npcs: [], login: [] };
  const events = new Map();
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(handler, actions) { hooks.npcs.push({ handler, actions }); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onItemOnItem(fn) { hooks.itemOnItem.push(fn); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onCustomEvent(name, fn) { const list = events.get(name) ?? []; list.push(fn); events.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of events.get(name) ?? []) fn(event); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });

  require('../plugins/quests/quests/GertrudesCat.Quest')(api);
  const quest = runtime.getRegisteredQuests().find((entry) => entry.key === 'gertrudes_cat');

  const attrs = new Map(), configs = new Map(), varbits = new Map(), xp = [], messages = [];
  let items = Array.from({ length: 28 }, () => new core.Item(-1, 0));
  let jingles = 0;
  const inventory = {
    getAmount: (id) => items.filter((item) => item.getId() === id).reduce((n, item) => n + item.getAmount(), 0),
    isFull() { return this.getFreeSlots() === 0; },
    getFreeSlots: () => items.filter((item) => item.getId() < 0).length,
    getItems: () => items,
    adds(id, amount) { const slot = items.findIndex((item) => item.getId() < 0); assert.ok(slot >= 0, 'inventory full'); items[slot] = new core.Item(id, amount); },
    forceAdd(_player, item) { const slot = items.findIndex((entry) => entry.getId() < 0); assert.ok(slot >= 0, 'inventory full'); items[slot] = new core.Item(item.getId(), item.getAmount()); },
    deleteNumber(id, amount) {
      const slot = items.findIndex((item) => item.getId() === id);
      assert.ok(slot >= 0, `missing item ${id}`);
      const left = items[slot].getAmount() - amount;
      items[slot] = left > 0 ? new core.Item(id, left) : new core.Item(-1, 0);
    },
    clear() { items = Array.from({ length: 28 }, () => new core.Item(-1, 0)); },
  };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendJingle() { jingles++; return packet; },
    sendInterfaceRemoval() { return packet; },
  }, { get(target, key) { return target[key] ?? (() => packet); } });
  const player = {
    getUsername: () => 'qh728-q048',
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getInventory: () => inventory,
    getPacketSender: () => packet,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]) }),
    getDialogueManager: () => ({ isActive: () => false, reset() {} }),
    getLocation: () => new core.Location(3148, 3413, 0),
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
  };

  const fire = (name, payload = {}) => api.emitCustomEvent(name, { player, ...payload });
  return {
    core, quest, player, attrs, configs, varbits, inventory, messages, hooks,
    fire,
    xp, jingles: () => jingles,
    variant(npcId) {
      for (const fn of hooks.variants) {
        const result = fn({ player, npcId });
        if (result) return result;
      }
      return null;
    },
    action(npcId, stepId, extra = {}) {
      const event = { npcId, stepId, text: '', kind: 'action', handled: false, ...extra };
      for (const fn of events.get('npc-dialogue:action') ?? []) fn({ player, ...event });
      return event;
    },
    itemOnNpc(itemId, npcId) {
      const event = { player, npcId, itemId, target: { getId: () => npcId }, handled: false };
      for (const fn of hooks.itemOnNpc) fn(event);
      return event;
    },
    itemOnItem(usedItemId, usedWithItemId) {
      const event = { player, usedItemId, usedWithItemId, handled: false };
      for (const fn of hooks.itemOnItem) fn(event);
      return event;
    },
    object(objectId, x, y, z = 0, option = 'Search') {
      const event = { player, objectId, clickType: 1, option, location: new core.Location(x, y, z), handled: false };
      for (const fn of hooks.objects) fn(event);
      return event;
    },
    npc(npcId, x, y, z = 0, clickType = 1) {
      const definition = core.NpcDefinition.forId(npcId);
      const npc = { getId: () => npcId, getLocation: () => new core.Location(x, y, z) };
      const event = { player, npc, npcId, definition, clickType, handled: false };
      for (const entry of hooks.npcs) {
        if (typeof entry.handler === 'function') entry.handler(event);
        else if (entry.handler === definition.getName()) {
          const action = definition.getActions()?.[clickType - 1];
          entry.actions?.[action]?.(event);
        }
      }
      return event;
    },
    login() {
      if (hooks.login.length) for (const fn of hooks.login) fn({ player });
      else runtime.sendQuestVarps({ player });
    },
  };
}

const START_HOOK = 'quest:gertrude-s-cat:start';

test('stage 0 start hook, varp bootstrap and stage-selected dialogue', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  assert.equal(h.quest.getStage(h.player), 0);
  h.login();
  assert.equal(h.configs.get(180), 0, 'login resends the unstarted varp');
  assert.equal(h.variant(N.GERTRUDE), 'starting-off');

  h.fire('npc-dialogue:hook', { npcId: N.GERTRUDE, hook: START_HOOK });
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(h.configs.get(180), 1, 'start writes varp 180');
  assert.equal(h.variant(N.GERTRUDE), 'starting-off-talking-to-gertrude-again');
  assert.equal(h.variant(N.SHILOP), 'talking-to-shilop-and-wilough');
  assert.equal(h.variant(N.WILOUGH), 'talking-to-shilop-and-wilough');

  h.inventory.adds(I.COINS, 150);
  h.action(N.WILOUGH, 'YQId7G');
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.configs.get(180), 2);
  assert.equal(h.inventory.getAmount(I.COINS), 50, 'the 100-coin hand-in consumes coins');
  assert.deepEqual(h.variant(N.WILOUGH), {
    page: "Gertrude's Cat",
    variant: 'talking-to-shilop-and-wilough-talking-to-them-again',
  }, 'after paying, Wilough repeats the location hint, not the pay menu');
  assert.deepEqual(h.variant(N.SHILOP), {
    page: 'Shilop',
    variant: 'standard-dialogue-after-paying-him',
  });

  h.action(N.WILOUGH, 'YQId7G');
  assert.equal(h.inventory.getAmount(I.COINS), 50, 'repeating the action never charges twice');
});

test('mandatory route: pay, milk, seasoned sardine, all Lumber Yard crates, kitten, completion', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers, O = h.core.ObjectIdentifiers;
  h.inventory.adds(I.COINS, 100);
  h.inventory.adds(I.BUCKET_OF_MILK, 1);
  h.inventory.adds(I.RAW_SARDINE, 1);
  h.inventory.adds(I.DOOGLE_LEAVES, 1);

  h.fire('npc-dialogue:hook', { npcId: N.GERTRUDE, hook: START_HOOK });
  h.action(N.WILOUGH, 'YQId7G');
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.inventory.getAmount(I.COINS), 0);

  h.itemOnNpc(I.BUCKET_OF_MILK, N.GERTRUDES_CAT_2);
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.configs.get(180), 3);
  assert.equal(h.inventory.getAmount(I.BUCKET_OF_MILK), 0);
  assert.equal(h.inventory.getAmount(I.BUCKET), 1, 'the empty bucket is returned');

  h.itemOnItem(I.DOOGLE_LEAVES, I.RAW_SARDINE);
  assert.equal(h.inventory.getAmount(I.DOOGLE_LEAVES), 0);
  assert.equal(h.inventory.getAmount(I.RAW_SARDINE), 0);
  assert.equal(h.inventory.getAmount(I.SEASONED_SARDINE), 1);

  h.itemOnNpc(I.SEASONED_SARDINE, N.GERTRUDES_CAT_2);
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.configs.get(180), 4);
  assert.equal(h.inventory.getAmount(I.SEASONED_SARDINE), 0);

  const crateSpawns = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/definitions/npc-spawns.json'), 'utf8'))
    .filter((spawn) => spawn.id === N.CRATE && spawn.level === 0 && spawn.x >= 3298 && spawn.x <= 3315 && spawn.y >= 3499 && spawn.y <= 3515);
  assert.equal(crateSpawns.length, 6, 'the cache-backed Lumber Yard crate NPC spawns are present');
  assert.equal(h.core.NpcDefinition.forId(N.CRATE).getName(), 'Crate');
  assert.ok(h.core.NpcDefinition.forId(N.CRATE).getActions().includes('Search'));
  for (const { x, y, level } of crateSpawns) {
    h.npc(N.CRATE, x, y, level);
    assert.equal(h.inventory.getAmount(I.FLUFFS_KITTEN), 1, `NPC crate at ${x},${y} finds the kitten`);
    h.inventory.deleteNumber(I.FLUFFS_KITTEN, 1);
  }

  for (const [objectId, x, y] of [
    [O.CRATE_59, 3302, 3502],
    [O.CRATE_60, 3302, 3500],
    [O.CRATE_18, 3302, 3503],
  ]) {
    assert.equal(h.object(objectId, x, y).handled, false, `scenery crate ${objectId} is not the helper-marked NPC target`);
  }

  assert.equal(h.npc(N.CRATE, 3200, 3400).handled, false, 'a crate NPC outside the Lumber Yard is not claimed');
  h.quest.setStage(h.player, 3);
  h.npc(N.CRATE, crateSpawns[0].x, crateSpawns[0].y);
  assert.equal(h.inventory.getAmount(I.FLUFFS_KITTEN), 0, 'crates give no kitten before the sardine stage');
  h.quest.setStage(h.player, 4);

  h.npc(N.CRATE, crateSpawns[0].x, crateSpawns[0].y);
  h.itemOnNpc(I.FLUFFS_KITTEN, N.GERTRUDES_CAT_2);
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.configs.get(180), 5);
  assert.equal(h.inventory.getAmount(I.FLUFFS_KITTEN), 0);

  h.action(N.GERTRUDE, 'Rf4BAK');
  assert.equal(h.quest.getStage(h.player), 6);
  assert.equal(h.configs.get(180), 6, 'completion reaches the cache threshold');
  assert.equal(Number(h.attrs.get(runtime.QUEST_POINTS_ATTRIBUTE)), 1);
  assert.deepEqual(h.xp, [[h.core.Skill.COOKING.getIndex(), 1525]]);
  assert.equal(h.inventory.getAmount(I.PET_KITTEN), 1);
  assert.equal(h.inventory.getAmount(I.CHOCOLATE_CAKE), 1);
  assert.equal(h.inventory.getAmount(I.STEW), 1);
  assert.equal(h.jingles(), 1);

  h.action(N.GERTRUDE, 'Rf4BAK');
  assert.equal(h.quest.getStage(h.player), 6);
  assert.deepEqual(h.xp, [[h.core.Skill.COOKING.getIndex(), 1525]], 'repeat hand-in grants no extra XP');
  assert.equal(h.inventory.getAmount(I.PET_KITTEN), 1, 'repeat hand-in grants no extra kitten');
  assert.equal(h.inventory.getAmount(I.CHOCOLATE_CAKE), 1);
  assert.equal(h.inventory.getAmount(I.STEW), 1);

  h.login();
  assert.equal(h.configs.get(180), 6, 'login replays the completed varp');
});

test('bottomless milk bucket advances the milk leg without being consumed', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 2); // fixture: the boys have already been paid.
  h.inventory.adds(I.BOTTOMLESS_MILK_BUCKET, 1);
  h.itemOnNpc(I.BOTTOMLESS_MILK_BUCKET, N.GERTRUDES_CAT_2);
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.inventory.getAmount(I.BOTTOMLESS_MILK_BUCKET), 1);
  assert.equal(h.inventory.getAmount(I.BUCKET), 0);
});

test('completion waits until all advertised reward items fit', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 5);
  for (let i = 0; i < 26; i++) h.inventory.adds(I.COINS, 1);
  h.action(N.GERTRUDE, 'Rf4BAK');
  assert.equal(h.quest.getStage(h.player), 5);
  assert.deepEqual(h.xp, [], 'no completion XP is awarded while the reward hand-out is blocked');
  assert.equal(Number(h.attrs.get(runtime.QUEST_POINTS_ATTRIBUTE)) || 0, 0);
  assert.ok(h.messages.some((message) => message.includes('three free inventory slots')));
  assert.equal(h.inventory.getAmount(I.PET_KITTEN), 0);
  assert.equal(h.inventory.getAmount(I.CHOCOLATE_CAKE), 0);
  assert.equal(h.inventory.getAmount(I.STEW), 0);
});

test('production quest order routes Gertrude and the cache-backed mewing crate to Gertrude\'s Cat', () => {
  const core = PluginManager.getCoreApi();
  const N = core.NpcIdentifiers;
  useActualTranscripts = true;
  const lines = productionLines;
  assert.deepEqual(productionOrder, ['ARuffSituation', 'GertrudesCat', 'TailOfTwoCats']);

  const registered = runtime.getRegisteredQuests();
  const quest = registered.findLast((entry) => entry.key === 'gertrudes_cat');
  const ruff = registered.findLast((entry) => entry.key === 'a_ruff_situation');
  const tail = registered.findLast((entry) => entry.key === 'a_tail_of_two_cats');
  const attrs = new Map(), items = [];
  const inventory = {
    getAmount(id) { return items.filter((item) => item.id === id).reduce((sum, item) => sum + item.amount, 0); },
    getFreeSlots() { return 28 - items.length; },
    isFull() { return this.getFreeSlots() === 0; },
    adds(id, amount) { if (this.isFull()) return false; items.push({ id, amount }); return true; },
    deleteNumber(id, amount) { const index = items.findIndex((item) => item.id === id); if (index >= 0) items.splice(index, 1); },
  };
  const packet = new Proxy({}, { get: () => () => packet });
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getLocation: () => new core.Location(3148, 3413, 0),
    getPacketSender: () => packet,
    getSkillManager: () => ({ addExperiences() {} }),
    getDialogueManager: () => ({ reset() {}, startDialogues() {}, getCurrent() { return null; }, advance() {} }),
    getUsername: () => 'qh728-q048-production',
    sendMessage() {},
    isRegistered: () => true,
  };
  function talk(npcId) {
    lines.length = 0;
    const definition = core.NpcDefinition.forId(npcId);
    const npc = {
      getId: () => npcId,
      getCurrentDefinition: () => definition,
      getDefinition: () => definition,
      getName: () => definition.getName(),
      getLocation: () => player.getLocation(),
      isRegistered: () => true,
      isVisible: () => true,
    };
    const event = { player, npc, npcId, definition, clickType: 1, handled: false };
    assert.equal(PluginManager.emitNpcInteraction(event), true);
    return lines.slice();
  }

  quest.setStage(player, 0);
  const startLines = talk(N.GERTRUDE);
  assert.ok(startLines.some((line) => line.includes('Fluffs, poor Fluffs.')), 'fresh stage 0 reaches the real start transcript');

  quest.setStage(player, 5);
  ruff.setStage(player, 10);
  tail.setStage(player, 3);
  const handinLines = talk(N.GERTRUDE);
  assert.ok(handinLines.some((line) => line.includes('You\'re back! Thank you!')), `the active q048 hand-in wins in production registration order: ${JSON.stringify(handinLines)} ${JSON.stringify(transcripts.at(-1))}`);

  quest.setStage(player, 4);
  const crateDefinition = core.NpcDefinition.forId(N.CRATE);
  assert.equal(crateDefinition.getName(), 'Crate');
  assert.ok(crateDefinition.getActions().includes('Search'));
  const crateSpawns = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/definitions/npc-spawns.json'), 'utf8'))
    .filter((spawn) => spawn.id === N.CRATE && spawn.level === 0 && spawn.x >= 3298 && spawn.x <= 3315 && spawn.y >= 3499 && spawn.y <= 3515);
  assert.equal(crateSpawns.length, 6);
  const spawn = crateSpawns[0];
  const crate = { getId: () => N.CRATE, getLocation: () => new core.Location(spawn.x, spawn.y, spawn.level) };
  const npcEvent = { player, npc: crate, npcId: N.CRATE, definition: crateDefinition, clickType: crateDefinition.getActions().indexOf('Search') + 1, handled: false };
  assert.equal(PluginManager.emitNpcInteraction(npcEvent), true, 'the real registered NPC Search handler claims the cache-backed crate');
  assert.equal(inventory.getAmount(core.ItemIdentifiers.FLUFFS_KITTEN), 1);
  const elsewhere = { getId: () => N.CRATE, getLocation: () => new core.Location(3200, 3400, 0) };
  const outsideEvent = { player, npc: elsewhere, npcId: N.CRATE, definition: crateDefinition, clickType: crateDefinition.getActions().indexOf('Search') + 1, handled: false };
  assert.equal(PluginManager.emitNpcInteraction(outsideEvent), false, 'the Lumber Yard hook yields for unrelated Crate NPCs');

  const objectId = core.ObjectIdentifiers.CRATE_59;
  const objectDefinition = core.ObjectDefinition.forId(objectId);
  assert.ok(objectDefinition?.getInteractions().includes('Search'), 'the cache scenery definition is searchable');
  const objectLocation = new core.Location(3302, 3502, 0); // cache dump: loc 5106 Crate, Search.
  const object = { getId: () => objectId, getDefinition: () => objectDefinition, getLocation: () => objectLocation };
  const objectEvent = { player, object, objectId, clickType: objectDefinition.getInteractions().indexOf('Search') + 1, handled: false };
  assert.equal(PluginManager.emitObjectInteraction(objectEvent), false, 'ordinary scenery crates do not grant the helper-marked kitten');
  assert.equal(inventory.getAmount(core.ItemIdentifiers.FLUFFS_KITTEN), 1);
});

test('post-quest Gertrude standard dialogue routes the kitten purchase action', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 6); // fixture: completed.
  assert.deepEqual(h.variant(N.GERTRUDE), {
    page: 'Gertrude',
    variant: 'standard-dialogue-on-pay-to-play-worlds',
  });
  h.inventory.adds(I.COINS, 100);
  h.action(N.GERTRUDE, 'Q44J0B');
  assert.equal(h.inventory.getAmount(I.COINS), 0);
  assert.equal(h.inventory.getAmount(I.PET_KITTEN), 1);
  assert.ok(h.messages.includes('Gertrude gives you another kitten.'));
});

test('real NpcDialogues resolves Wilough on the Gertrude page at stage 2 and keeps neighbouring stages distinct', () => {
  const core = PluginManager.getCoreApi();
  const N = core.NpcIdentifiers;
  const api = PluginManager.createApi('qh728-q048-real-dialogue');
  const lines = [];
  api.onCustomEvent('npc-dialogue:line', (event) => {
    lines.push({ speaker: event.step?.speaker, text: String(event.text ?? '') });
  });
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
  require('../plugins/quests/quests/GertrudesCat.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'gertrudes_cat');

  function realPlayer(stage) {
    const attributes = new Map();
    const messages = [];
    const sender = new Proxy({}, { get: () => () => sender });
    const inventory = {
      getAmount: () => 0,
      isFull: () => false,
      adds: () => true,
      deleteNumber: () => true,
    };
    const player = {
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      getInventory: () => inventory,
      getEquipment: () => ({ get: () => null }),
      getLocation: () => new core.Location(3148, 3413, 0),
      getPacketSender: () => sender,
      getDialogueManager: () => ({ reset() {}, startDialogues() {}, getCurrent() { return null; }, advance() {} }),
      getUsername: () => 'qh728-q048-real',
      sendMessage: (message) => messages.push(message),
      isRegistered: () => true,
    };
    quest.setStage(player, stage);
    return player;
  }

  function talk(player, npcId) {
    lines.length = 0;
    const definition = core.NpcDefinition.forId(npcId);
    const npc = {
      getId: () => npcId,
      getCurrentDefinition: () => definition,
      getDefinition: () => definition,
      getName: () => definition.getName(),
      getLocation: () => new core.Location(3148, 3413, 0),
      isRegistered: () => true,
      isVisible: () => true,
    };
    PluginManager.emitNpcInteraction({ player, npc, npcId, definition, clickType: 1, handled: false });
    return lines.map((line) => line.text);
  }

  // Stage 1 is still the boys' first conversation (the 100-coin menu branch).
  assert.ok(talk(realPlayer(1), N.WILOUGH).includes("I didn't mean to take it! I just forgot to pay."));
  assert.ok(!talk(realPlayer(1), N.WILOUGH).some((text) => text.startsWith("Weren't you listening?")));

  // Stage 2 picks the canonical after-paying follow-up from the Gertrude's Cat
  // page, not Wilough's own standard page (which would say "Hello youngster!").
  const paid = talk(realPlayer(2), N.WILOUGH);
  assert.ok(paid.some((text) => text.includes('I saw the flea bag in the old lumber mill')),
    'Wilough repeats the location hint after paying');
  assert.ok(!paid.some((text) => text.includes('Hello youngster!')),
    'Wilough does not fall back to his standard page');

  // Wrong NPC: Shilop has his own after-paying page.
  const shilop = talk(realPlayer(2), N.SHILOP);
  assert.ok(shilop.includes('Hello again.'));
  assert.deepEqual(lines.find((line) => line.text === 'You think you\'re tough do you?')?.speaker, 'Wilough',
    'stage 2 Shilop plays his standard after-paying page');

  // Neighbouring stages: 3 still repeats the location hint, while 4 selects the
  // finding-Fluffs follow-up, whose first taunt is spoken by Shilop, not Wilough.
  for (const stage of [2, 3]) {
    const repeated = talk(realPlayer(stage), N.WILOUGH);
    assert.ok(repeated.some((text) => text.includes('I saw the flea bag in the old lumber mill')),
      `stage ${stage} repeats the location hint`);
  }
  lines.length = 0;
  const searching = talk(realPlayer(4), N.WILOUGH);
  assert.ok(searching.includes('Hello again.'), 'stage 4 keeps talking to the boys');
  assert.deepEqual(lines.find((line) => line.text === 'You think you\'re tough do you?')?.speaker, 'Shilop',
    'stage 4 Wilough plays the finding-Fluffs page');

  // After the rescue the quest defers to Wilough's own standard dialogue.
  assert.ok(talk(realPlayer(5), N.WILOUGH).some((text) => text.includes('Hello youngster!')));
});

