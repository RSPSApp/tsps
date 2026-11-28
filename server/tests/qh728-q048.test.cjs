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

function setup(options = {}) {
  const tasks = [], spawned = [], areas = [], sounds = [], persisted = new Map();
  const core = {
    ...PluginManager.getCoreApi(),
    ...(options.random ? { Misc: { randomInclusive: options.random } } : {}),
    Sounds: { playAreaSound(sound) { sounds.push(sound); } },
    CountdownTask: class { constructor(player, ticks, run) { Object.assign(this, { player, ticks, run }); } },
    TaskManager: { submit(task) { tasks.push(task); }, cancelTasks() {} },
    MultiChatboxPrompt: { getPending: () => null },
  };
  const hooks = { variants: [], conditions: [], objects: [], itemOnNpc: [], itemOnItem: [], npcs: [], login: [] };
  const events = new Map();
  const api = new Proxy({
    core,
    persistAttribute(key, value) { persisted.set(key, value); },
    registerArea(area) { areas.push(area); },
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(handler, actions) { hooks.npcs.push({ handler, actions }); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onItemOnItem(fn) { hooks.itemOnItem.push(fn); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onCustomEvent(name, fn) { const list = events.get(name) ?? []; list.push(fn); events.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of events.get(name) ?? []) fn(event); },
    spawnNpc(definition) { const npc = { definition, removed: false }; spawned.push(npc); return npc; },
    removeNpc(npc) { npc.removed = true; },
  }, { get(target, key) { return target[key] ?? (() => {}); } });

  require('../plugins/quests/quests/GertrudesCat.Quest')(api);
  const quest = runtime.getRegisteredQuests().find((entry) => entry.key === 'gertrudes_cat');

  const attrs = options.attrs ?? new Map();
  const configs = new Map(), varbits = new Map(), xp = [], messages = [];
  let items = Array.from({ length: 28 }, () => new core.Item(-1, 0));
  let jingles = 0;
  const typed = [];
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
    refreshItems() {},
  };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendJingle() { jingles++; return packet; },
    sendTypedMessage(type, text) { typed.push([type, text]); return packet; },
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
  /** Like fire, but the handlers' changes to the payload stay visible to the caller. */
  const emit = (name, payload) => { payload.player ??= player; api.emitCustomEvent(name, payload); return payload; };
  return {
    api, core, quest, player, attrs, configs, varbits, inventory, messages, typed, hooks, tasks, spawned, areas, sounds, persisted,
    fire, emit,
    xp, jingles: () => jingles,
    variant(npcId) {
      for (const fn of hooks.variants) {
        const result = fn({ player, npcId });
        if (result) return result;
      }
      return null;
    },
    action(npcId, stepId, extra = {}) {
      const event = { player, npcId, stepId, text: '', kind: 'action', handled: false, ...extra };
      for (const fn of events.get('npc-dialogue:action') ?? []) fn(event);
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
      for (const fn of hooks.login) fn({ player });
      runtime.sendQuestVarps({ player });
    },
  };
}

const START_HOOK = 'quest:gertrude-s-cat:start';

test('stage 0 start hook, varp bootstrap and stage-selected dialogue', () => {
  const h = setup();
  const N = h.core.NpcIdentifiers;
  const page = (variant) => ({ page: "Gertrude's Cat", variant });
  assert.equal(h.quest.getStage(h.player), 0);
  h.login();
  assert.equal(h.configs.get(180), 0, 'login resends the unstarted varp');
  assert.equal(h.variant(N.GERTRUDE), 'starting-off');
  assert.equal(h.variant(N.SHILOP), null, 'the boys keep their own page before the quest');

  h.fire('npc-dialogue:hook', { npcId: N.GERTRUDE, hook: START_HOOK });
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(h.configs.get(180), 1, 'start writes varp 180');
  assert.equal(h.variant(N.GERTRUDE), 'starting-off-talking-to-gertrude-again');
  // The talk is worded from the clicked boy's side (the revision 242 capture, ticks 148-290).
  assert.deepEqual(h.variant(N.SHILOP), page('talking-to-shilop-and-wilough'));
  assert.deepEqual(h.variant(N.WILOUGH), page('talking-to-shilop-and-wilough-talking-to-wilough'));
  h.quest.setStage(h.player, 2);
  assert.deepEqual(h.variant(N.SHILOP), page('talking-to-shilop-and-wilough-talking-to-them-again'));
  assert.deepEqual(h.variant(N.WILOUGH), page('talking-to-shilop-and-wilough-talking-to-wilough-again'));
  for (const stage of [3, 4, 5, 6]) {
    h.quest.setStage(h.player, stage);
    assert.deepEqual(h.variant(N.SHILOP), page('finding-fluffs-talking-to-shilop-and-wilough-again'), `stage ${stage}`);
    assert.deepEqual(h.variant(N.WILOUGH), page('finding-fluffs-talking-to-wilough-again'), `stage ${stage}`);
  }
});

test('a bottomless bucket of another kind of milk does not count as milk for Fluffs', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  require('../plugins/items/BottomlessMilkBucket.plugin').register(new Proxy({ onServerStartup: (fn) => fn() }, {
    get: (target, key) => target[key] ?? h.api[key],
  }));
  h.quest.setStage(h.player, 2);
  h.inventory.adds(I.BOTTOMLESS_MILK_BUCKET, 1);
  h.inventory.getItems().find((item) => item.getId() === I.BOTTOMLESS_MILK_BUCKET)
    .setMetaValue('bottomless-milk', { uses: 4, type: I.CHOCOLATEY_MILK });
  h.itemOnNpc(I.BOTTOMLESS_MILK_BUCKET, N.GERTRUDES_CAT_2);
  assert.equal(h.quest.getStage(h.player), 2, 'chocolatey milk is not what Fluffs wants');
  assert.equal(h.messages.length, 0, "the game's own answer, not the quest's");
});

test('production quest order routes both Gertrude forms between her quests and preserves the mewing crate', () => {
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

  tail.setStage(player, 0);
  for (let catStage = 0; catStage <= 6; catStage++) {
    quest.setStage(player, catStage);
    const npcId = catStage === 6 ? N.GERTRUDE_2 : N.GERTRUDE;
    for (const ruffStage of [10, 15]) {
      ruff.setStage(player, ruffStage);
      transcripts.length = 0;
      talk(npcId);
      const transcript = transcripts.at(-1);
      if (catStage > 0 && catStage < 6) {
        assert.equal(transcript?.page, "Gertrude's Cat", `cat stage ${catStage} keeps its active conversation`);
      } else {
        assert.deepEqual(transcript, {
          npcId, page: 'A Ruff Situation',
          variant: ruffStage === 10 ? 'gertrude' : 'gertrude-talking-to-gertrude-again',
        }, `cat stage ${catStage}, Ruff stage ${ruffStage}: lost-dog dialogue uses the current Gertrude form`);
      }
      assert.equal(quest.getStage(player), catStage, 'talking never resets the cat quest');
      assert.equal(ruff.getStage(player), ruffStage, 'opening the menu does not advance Ruff');
    }
  }

  for (const tailStage of [3, 4]) {
    tail.setStage(player, tailStage);
    transcripts.length = 0;
    talk(N.GERTRUDE_2);
    assert.equal(transcripts.at(-1)?.page, 'A Tail of Two Cats', 'the active Bob conversation keeps priority');
    assert.equal(ruff.getStage(player), 15);
  }

  const crateDefinition = core.NpcDefinition.forId(N.CRATE);
  assert.equal(crateDefinition.getName(), 'Crate');
  assert.ok(crateDefinition.getActions().includes('Search'));
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
  assert.equal(inventory.getAmount(core.ItemIdentifiers.FLUFFS_KITTEN), 0);
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
  // Her own page's sale is the Gertrude plugin's (gertrudes-cat-capture.test.cjs plays it); the quest
  // leaves it alone, even with its own page among the NPC's pages (issue 6772).
  const event = h.action(N.GERTRUDE, 'Q44J0B', { kind: 'message', playing: { page: 'Gertrude', variant: 'standard-dialogue-on-pay-to-play-worlds' },
    pages: [{ page: "Gertrude's Cat" }, { page: 'Gertrude' }] });
  assert.equal(event.handled, false);
  assert.equal(event.box, undefined);
  assert.equal(h.inventory.getAmount(I.COINS), 100);
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

  const speakers = (player, npcId) => { talk(player, npcId); return lines.map((line) => [line.speaker ?? null, line.text]); };
  // Stage 1: the clicked boy opens the first conversation.
  assert.ok(talk(realPlayer(1), N.WILOUGH).includes("I didn't mean to take it! I just forgot to pay."));
  assert.ok(!talk(realPlayer(1), N.WILOUGH).some((text) => text.startsWith("Weren't you listening?")));

  // Stage 2: whoever is clicked repeats where Fluffs is (capture ticks 281-290), never the standard page.
  for (const npcId of [N.WILOUGH, N.SHILOP]) {
    const paid = speakers(realPlayer(2), npcId);
    const hint = paid.find(([, text]) => text.includes('I saw the flea bag in the old lumber mill'));
    assert.equal(hint?.[0], core.NpcDefinition.forId(npcId).getName(), 'the clicked boy answers');
    assert.ok(!paid.some(([, text]) => text.includes('Hello youngster!')));
  }

  // Once Fluffs is found the clicked boy boasts and the other backs him up (ticks 765-782).
  for (const stage of [3, 4, 5, 6]) {
    const shilop = speakers(realPlayer(stage), N.SHILOP);
    assert.equal(shilop.find(([, text]) => text === "You think you're tough do you?")?.[0], 'Shilop', `stage ${stage}`);
    assert.equal(shilop.find(([, text]) => text === 'He can you know!')?.[0], 'Wilough', `stage ${stage}`);
    const wilough = speakers(realPlayer(stage), N.WILOUGH);
    assert.equal(wilough.find(([, text]) => text === "You think you're tough do you?")?.[0], 'Wilough', `stage ${stage}`);
    assert.equal(wilough.find(([, text]) => text === 'He can you know!')?.[0], 'Shilop', `stage ${stage}`);
  }
});

test('stationary crate mews and colocated sound run independently of private kitten selection', () => {
  const h = setup({ random: (min) => min });
  const N = h.core.NpcIdentifiers;
  const chats = [];
  const npc = { isNpc: () => true, getId: () => N.CRATE,
    getLocation: () => new h.core.Location(3303, 3506, 0), forceChat: (text) => chats.push(text) };
  const area = h.areas[0];
  for (let tick = 0; tick < 24; tick++) area.process(npc);
  assert.equal(chats.length, 0);
  area.process(npc);
  assert.deepEqual(chats, ['Mew!']);
  assert.deepEqual(h.sounds, [{ soundId: 339, x: 3303, y: 3506, level: 0, radius: 10, source: npc }]);
  h.quest.setStage(h.player, 6);
  for (let tick = 0; tick < 25; tick++) area.process(npc);
  assert.equal(chats.length, 2, 'mews continue after completion as in the captures');
  assert.equal(h.attrs.get('gertrudes-cat:kitten-crate'), undefined, 'public cues never choose or expose a player target');
  for (let tick = 0; tick < 50; tick++) area.process({ ...npc, getLocation: () => new h.core.Location(3200,3400,0) });
  assert.equal(chats.length, 2, 'other Crate NPCs remain silent');
});
