// Run after yarn build: node --test tests/qh728-q125.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

// The route test only needs the registered transcript selector to run.
runtime.startTranscript = () => true;

const VARBIT_SUROK_QUEST = 3523;
const VARBIT_FOLDER_CHECK = 3525;
const INVENTORY_SIZE = 28;

function setup() {
  const hooks = {
    custom: new Map(), variants: [], conditions: [], login: [], itemOnItem: [],
    itemOnObject: [], itemOnNpc: [], itemAction: [], objects: [],
  };
  const core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant: (fn) => hooks.variants.push(fn),
    onNpcDialogueCondition: (fn) => hooks.conditions.push(fn),
    onCustomEvent(name, fn) {
      const list = hooks.custom.get(name) ?? [];
      list.push(fn);
      hooks.custom.set(name, list);
    },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
    onItemOnItem: (fn) => hooks.itemOnItem.push(fn),
    onItemOnObject: (fn) => hooks.itemOnObject.push(fn),
    onItemOnNpc: (fn) => hooks.itemOnNpc.push(fn),
    onItemAction: (fn) => hooks.itemAction.push(fn),
    onObjectInteraction: (fn) => hooks.objects.push(fn),
    onNpcInteraction() {},
    onNpcDeath() {},
    onNpcBeforeDeath() {},
    onNpcHitModify() {},
    onPlayerLogin: (fn) => hooks.login.push(fn),
    onPlayerLogout() {},
    onPlayerDeath() {},
    spawnNpc(def) {
      return {
        def,
        getId: () => def.id,
        getOwner: () => def.owner,
        getLocation: () => new core.Location(def.x, def.y, def.z),
        getCombat: () => ({ attack() {} }),
        getHitpoints: () => 75,
        setHitpoints() {},
        isRegistered: () => true,
      };
    },
    removeNpc() {},
    getWorld: () => ({ getNpcs: () => [] }),
    getObjectManager: () => ({ register() {} }),
    getItemOnGroundManager: () => ({ registerLocation() {} }),
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  require('../plugins/quests/quests/WhatLiesBelow.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const attributes = new Map();
  const items = new Map();
  const varbits = new Map();
  const messages = [];
  const bankItems = new Map();
  const equipment = new Map();
  const player = {
    freeSlots: INVENTORY_SIZE,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      isFull: () => player.freeSlots < 1,
      getFreeSlots: () => player.freeSlots,
      adds(id, amount = 1) {
        if (player.freeSlots < amount) return;
        items.set(id, (items.get(id) ?? 0) + amount);
        player.freeSlots -= amount;
      },
      deleteNumber(id, amount) {
        assert.ok((items.get(id) ?? 0) >= amount, 'cannot consume missing item ' + id);
        items.set(id, items.get(id) - amount);
        player.freeSlots += amount;
      },
    }),
    getBank: (tab) => tab === 0 ? { contains: (id) => (bankItems.get(id) ?? 0) > 0 } : null,
    getEquipment: () => ({ get: (slot) => equipment.get(slot) }),
    getPacketSender: () => sender,
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      addExperiences() {},
    }),
    getDialogueManager: () => ({ reset() {}, startDialogues() {}, isActive: () => false, getCurrent: () => null }),
    sendMessage: (message) => messages.push(message),
    getLocation: () => new core.Location(0, 0, 0),
    isRegistered: () => true,
    getUsername: () => 'qh728-q125',
  };
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit: (id) => varbits.get(id) ?? 0,
  }, { get(target, key) { return target[key] ?? (() => sender); } });

  const emit = (name, event = {}) => api.emitCustomEvent(name, { player, ...event });
  const condition = (stepId, npcId = 4158) => {
    for (const fn of hooks.conditions) {
      const answer = fn({ player, npcId, stepId });
      if (typeof answer === 'boolean') return answer;
    }
    return null;
  };
  return { api, core, quest, player, items, bankItems, equipment, attributes, varbits, messages, hooks, emit, condition };
}

test('What Lies Below completion dispatch sends cache varbit 3523 = 150 and survives login replay', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 120);
  assert.equal(h.varbits.get(VARBIT_SUROK_QUEST), 120);
  assert.equal(h.quest.isComplete(h.player), false);

  h.emit('npc-dialogue:action', { npcId: h.core.NpcIdentifiers.RAT_BURGISS, stepId: 'ZJvcFu' });
  assert.equal(h.quest.getStage(h.player), 140, 'durable completion stage is preserved');
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.varbits.get(VARBIT_SUROK_QUEST), 150, 'cache completion threshold');

  h.varbits.clear();
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(h.varbits.get(VARBIT_SUROK_QUEST), 150, 'login resends the completion value');

  // A save written by the old plugin still carries stage 140.
  const legacy = setup();
  legacy.player.setAttribute('quest.what_lies_below.stage', 140);
  legacy.varbits.clear();
  runtime.sendQuestVarps({ player: legacy.player });
  assert.equal(legacy.quest.getStage(legacy.player), 140);
  assert.equal(legacy.quest.isComplete(legacy.player), true);
  assert.equal(legacy.varbits.get(VARBIT_SUROK_QUEST), 150);
  assert.equal(legacy.items.get(I.BEACON_RING) ?? 0, 0, 'replay does not grant rewards again');
});

test('What Lies Below Surok hand-in consumes the infused wand and bowl', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 55);
  h.items.set(I.INFUSED_WAND, 1);
  h.items.set(I.BOWL, 1);
  h.player.freeSlots = 0;
  h.emit('npc-dialogue:action', { npcId: h.core.NpcIdentifiers.SUROK_MAGIS, stepId: 'PepH7r' });
  assert.equal(h.items.get(I.INFUSED_WAND) ?? 0, 0);
  assert.equal(h.items.get(I.BOWL) ?? 0, 0);
  assert.equal(h.items.get(I.SUROKS_LETTER), 1);
  assert.equal(h.quest.getStage(h.player), 60);
});

test("What Lies Below replaces a lost Surok's letter", () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 60);
  assert.equal(h.condition('au4yB2', h.core.NpcIdentifiers.SUROK_MAGIS), true);
  h.emit('npc-dialogue:action', { npcId: h.core.NpcIdentifiers.SUROK_MAGIS, stepId: 'pRyGCh' });
  assert.equal(h.items.get(I.SUROKS_LETTER), 1);
  assert.equal(h.quest.getStage(h.player), 60);
});

test('What Lies Below folder retry branch grants a replacement folder', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 10);
  h.player.setAttribute('what-lies-below:papers', 4);
  assert.equal(h.condition('c2lR7V'), true);
  assert.equal(h.items.get(I.AN_EMPTY_FOLDER) ?? 0, 0, 'checking a branch does not grant its item');
  assert.equal(h.player.getAttribute('what-lies-below:papers'), 4);
  h.emit('npc-dialogue:condition', { npcId: h.core.NpcIdentifiers.RAT_BURGISS, stepId: 'c2lR7V' });
  assert.equal(h.items.get(I.AN_EMPTY_FOLDER), 1);
  assert.equal(h.player.getAttribute('what-lies-below:papers'), 0);
  assert.equal(h.varbits.get(VARBIT_FOLDER_CHECK), 0);
  assert.equal(h.condition('c2lR7V'), false, 'an owned folder is not duplicated');
  assert.equal(h.items.get(I.AN_EMPTY_FOLDER), 1);
});

test('a banked folder keeps its pages and is not replaced by Rat', () => {
  const h = setup();
  h.quest.setStage(h.player, 10);
  h.player.setAttribute('what-lies-below:papers', 4);
  h.bankItems.set(h.core.ItemIdentifiers.USED_FOLDER, 1);
  assert.equal(h.condition('c2lR7V'), false);
  h.emit('npc-dialogue:condition', { npcId: h.core.NpcIdentifiers.RAT_BURGISS, stepId: 'c2lR7V' });
  assert.equal(h.player.getAttribute('what-lies-below:papers'), 4);
  assert.equal(h.items.get(h.core.ItemIdentifiers.AN_EMPTY_FOLDER) ?? 0, 0);
});

test('post-quest Zaff reclaims a missing Beacon ring once, with bank, worn and capacity guards', () => {
  const h = setup();
  const N = h.core.NpcIdentifiers;
  const ring = h.core.ItemIdentifiers.BEACON_RING;
  h.quest.setStage(h.player, 140);
  const select = (npcId) => h.hooks.variants.map(fn => fn({ player: h.player, npcId })).find(value => value != null);
  assert.deepEqual(select(N.ZAFF), { page: 'Zaff', variant: 'standard-dialogue-members-worlds' });
  assert.equal(select(N.ANNA_JONES), 'after-completing-what-lies-below-while-the-statue-is-intact');
  h.bankItems.set(ring, 1);
  assert.equal(h.condition('S2p6HZ', N.ZAFF), true);
  h.emit('npc-dialogue:action', { npcId: N.ZAFF, stepId: '-qkbDJ' });
  assert.equal(h.items.get(ring) ?? 0, 0);
  h.bankItems.clear();
  h.equipment.set(h.core.Equipment.RING_SLOT, new h.core.Item(ring, 1));
  assert.equal(h.condition('hPduM1', N.ZAFF), true);
  h.emit('npc-dialogue:action', { npcId: N.ZAFF, stepId: '-qkbDJ' });
  assert.equal(h.items.get(ring) ?? 0, 0);
  h.equipment.clear();
  h.player.freeSlots = 0;
  assert.equal(h.condition('xgclJB', N.ZAFF), true);
  h.emit('npc-dialogue:action', { npcId: N.ZAFF, stepId: '-qkbDJ' });
  assert.equal(h.items.get(ring) ?? 0, 0);
  h.player.freeSlots = 1;
  h.emit('npc-dialogue:action', { npcId: N.ZAFF, stepId: '-qkbDJ' });
  assert.equal(h.items.get(ring), 1);
  h.emit('npc-dialogue:action', { npcId: N.ZAFF, stepId: '-qkbDJ' });
  assert.equal(h.items.get(ring), 1);
});

test('What Lies Below alternate Surok briefing branch still hands over the wand and diary', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 20);
  h.items.set(I.LETTER_TO_SUROK, 1);
  h.emit('npc-dialogue:line', {
    npcId: h.core.NpcIdentifiers.SUROK_MAGIS,
    text: "I have also given you a copy of a diary I...uh...acquired. It may also help you to find that which you seek.",
  });
  assert.equal(h.items.get(I.LETTER_TO_SUROK) ?? 0, 0);
  assert.equal(h.items.get(I.WAND), 1);
  assert.equal(h.items.get(I.SINKETHS_DIARY), 1);
  assert.equal(h.quest.getStage(h.player), 30);

  const before = h.items.get(I.WAND);
  h.emit('npc-dialogue:line', {
    npcId: h.core.NpcIdentifiers.SUROK_MAGIS,
    text: "I have also given you a copy of a diary I...uh...acquired. It may also help you to find that which you seek.",
  });
  assert.equal(h.items.get(I.WAND), before, 'the first branch action is not repeated');
});

test('What Lies Below accusatory letter answer hands Surok\'s letter to Rat', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 60);
  h.items.set(I.SUROKS_LETTER, 1);
  h.emit('npc-dialogue:line', {
    npcId: h.core.NpcIdentifiers.RAT_BURGISS,
    text: "I'm sure I don't know what you mean. Let me see the letter, please.",
  });
  assert.equal(h.items.get(I.SUROKS_LETTER) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 70);

  const missing = setup();
  missing.quest.setStage(missing.player, 60);
  missing.emit('npc-dialogue:line', {
    npcId: missing.core.NpcIdentifiers.RAT_BURGISS,
    text: "I'm sure I don't know what you mean. Let me see the letter, please.",
  });
  assert.equal(missing.quest.getStage(missing.player), 60, 'no advance without the letter');
});

test('What Lies Below mandatory route handlers run from fresh stage 0 to completion', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  const N = h.core.NpcIdentifiers;
  assert.equal(h.quest.getStage(h.player), 0);

  h.emit('npc-dialogue:hook', { npcId: N.RAT_BURGISS, hook: 'quest:what-lies-below:start' });
  assert.equal(h.quest.getStage(h.player), 10);
  h.emit('npc-dialogue:action', { npcId: N.RAT_BURGISS, stepId: '9OiX8O' });
  assert.equal(h.items.get(I.AN_EMPTY_FOLDER), 1);

  h.items.set(I.RATS_PAPER, 5);
  h.player.freeSlots = 23;
  const itemOnItem = h.hooks.itemOnItem[0];
  for (let page = 0; page < 5; page++) {
    const event = { player: h.player, usedItemId: I.RATS_PAPER, usedWithItemId: page === 0 ? I.AN_EMPTY_FOLDER : I.USED_FOLDER, handled: false };
    itemOnItem(event);
    assert.equal(event.handled, true, 'page ' + (page + 1) + ' added');
  }
  assert.equal(h.items.get(I.RATS_PAPER) ?? 0, 0);
  assert.equal(h.items.get(I.FULL_FOLDER), 1);
  assert.equal(h.varbits.get(VARBIT_FOLDER_CHECK), 5);

  h.emit('npc-dialogue:action', { npcId: N.RAT_BURGISS, stepId: 'hNHQSL' });
  assert.equal(h.items.get(I.FULL_FOLDER) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 20);
  h.emit('npc-dialogue:action', { npcId: N.RAT_BURGISS, stepId: 'PtkroE' });
  assert.equal(h.items.get(I.LETTER_TO_SUROK), 1);

  h.emit('npc-dialogue:action', { npcId: N.SUROK_MAGIS, stepId: 'fO5C1F' });
  assert.equal(h.items.get(I.LETTER_TO_SUROK) ?? 0, 0);
  assert.equal(h.items.get(I.WAND), 1);
  assert.equal(h.items.get(I.SINKETHS_DIARY), 1);
  assert.equal(h.quest.getStage(h.player), 30);

  h.items.set(I.CHAOS_RUNE, 15);
  const altar = { player: h.player, itemId: I.WAND, objectId: h.core.ObjectIdentifiers.ALTAR_55, handled: false };
  h.hooks.itemOnObject[0](altar);
  assert.equal(altar.handled, true);
  assert.equal(h.items.get(I.CHAOS_RUNE) ?? 0, 0);
  assert.equal(h.items.get(I.WAND) ?? 0, 0);
  assert.equal(h.items.get(I.INFUSED_WAND), 1);
  assert.equal(h.quest.getStage(h.player), 55);

  h.items.set(I.BOWL, 1);
  h.emit('npc-dialogue:action', { npcId: N.SUROK_MAGIS, stepId: 'PepH7r' });
  assert.equal(h.items.get(I.INFUSED_WAND) ?? 0, 0);
  assert.equal(h.items.get(I.BOWL) ?? 0, 0);
  assert.equal(h.items.get(I.SUROKS_LETTER), 1);
  assert.equal(h.quest.getStage(h.player), 60);

  h.emit('npc-dialogue:action', { npcId: N.RAT_BURGISS, stepId: 'T1DY8H' });
  assert.equal(h.items.get(I.SUROKS_LETTER) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 70);

  h.emit('npc-dialogue:action', { npcId: N.ZAFF, stepId: 'ZpM2H-' });
  assert.equal(h.items.get(I.BEACON_RING), 1);
  assert.equal(h.items.get(I.ZAFFS_INSTRUCTIONS), 1);
  assert.equal(h.quest.getStage(h.player), 80);

  h.emit('npc-dialogue:action', { npcId: N.SUROK_MAGIS, stepId: 'dkELhA' });
  assert.equal(h.quest.getStage(h.player), 110);
  h.emit('npc-dialogue:action', { npcId: N.SUROK_MAGIS, stepId: 'GG-gcf' });
  assert.equal(h.quest.getStage(h.player), 120);
  h.emit('npc-dialogue:action', { npcId: N.RAT_BURGISS, stepId: 'ZJvcFu' });
  assert.equal(h.quest.getStage(h.player), 140);
  assert.equal(h.varbits.get(VARBIT_SUROK_QUEST), 150);
  assert.equal(h.quest.isComplete(h.player), true);
});
