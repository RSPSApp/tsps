// Run from server after yarn build: node --test tests/qh-f2p-coastal-parity.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests, startTranscript } = require('../plugins/quests/QuestRuntime');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const core = PluginManager.getCoreApi();

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});

function register(moduleName, key) {
  const hooks = new Map(), custom = new Map(), said = [];
  const add = (name, handler) => {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(handler);
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    registerArea() {},
    onCustomEvent(name, handler) { if (!custom.has(name)) custom.set(name, []); custom.get(name).push(handler); },
    emitCustomEvent(name, payload) { for (const handler of custom.get(name) || []) handler(payload); },
    onNpcDialogueCondition(handler) { add('onNpcDialogueCondition', handler); },
    onItemOnObject(handler) { add('onItemOnObject', handler); },
    onObjectInteraction(handler) { add('onObjectInteraction', handler); },
    sendMultiChatboxPrompt() {},
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        const handler = args.findLast((arg) => typeof arg === 'function')
          || Object.values(args.at(-1) || {}).find((value) => typeof value === 'function');
        if (handler) add(prop, handler);
      };
    },
  });
  require(`../plugins/quests/quests/${moduleName}.Quest`)(api);
  return { api, hooks, said, quest: getRegisteredQuests().findLast((quest) => quest.key === key) };
}

function player() {
  const attributes = new Map(), items = new Map(), equipment = new Map(), messages = [], said = [];
  const inventory = {
    getAmount: (id) => items.get(id) || 0,
    adds: (id, amount) => items.set(id, (items.get(id) || 0) + amount),
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) || 0) - amount)),
    isFull: () => false,
    getFreeSlots: () => 28,
  };
  let current = null;
  const manager = {
    reset() {},
    advance() {},
    isActive: () => false,
    getCurrent: () => current,
    startDialogues(chain) {
      current = chain;
      for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
        if (current !== chain) break;
        const text = entry.getText?.();
        if (text) said.push(String(text));
        if (entry.constructor.name === 'ActionDialogue') entry.send(p);
      }
    },
  };
  const p = {
    attributes, items, equipment, messages, said,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: (slot) => equipment.has(slot) ? { getId: () => equipment.get(slot) } : null }),
    getLocation: () => new core.Location(3228, 3369, 0),
    getPacketSender: () => new Proxy({}, { get: () => () => undefined }),
    getDialogueManager: () => manager,
    getUsername: () => 'QuestTester',
    getAppearance: () => ({ isMale: () => true }),
    getSkillManager: () => ({ getCombatLevel: () => 20 }),
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => p,
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {} }),
    performAnimation() {},
    performGraphic() {},
  };
  return p;
}

test('post-quest Sir Amik defers to Recruitment Drive and still greets when it is complete', () => {
  const api = PluginManager.createApi('qh-shared-amik-test');
  require('../plugins/quests/quests/BlackKnightsFortress.Quest')(api);
  require('../plugins/quests/quests/RecruitmentDrive.Quest')(api);
  const definition = core.NpcDefinition.forId(4771);
  const npc = { getId: () => 4771, getCurrentDefinition: () => definition, getLocation: () => new core.Location(2960, 3336, 2) };

  const active = player();
  active.attributes.set('quest.black_knights_fortress.stage', 4);
  active.attributes.set('quest.recruitment_drive.stage', 0);
  active.attributes.set('quest.points', 60);
  const selected = PluginManager.emitNpcDialogueVariant({ player: active, npc, npcId: 4771, definition, pages: [] });
  assert.equal(selected.variant, 'starting-out-talking-to-sir-amik-varze');
  const activeEvent = { player: active, npc, npcId: 4771, definition, clickType: 1, handled: false };
  assert.equal(PluginManager.emitNpcInteraction(activeEvent), false);
  assert.equal(activeEvent.handled, false);

  const complete = player();
  complete.attributes.set('quest.black_knights_fortress.stage', 4);
  complete.attributes.set('quest.recruitment_drive.stage', 4);
  complete.attributes.set('quest.points', 60);
  const completeEvent = { player: complete, npc, npcId: 4771, definition, clickType: 1, handled: false };
  assert.equal(PluginManager.emitNpcInteraction(completeEvent), true);
  assert.ok(complete.said.includes('Hello, friend!'));
});


test('Black Knights treats a Draynor cabbage like any item before the witch is overheard', () => {
  const { hooks, quest } = register('BlackKnightsFortress', 'black_knights_fortress');
  const p = player();
  quest.setStage(p, 1);
  p.items.set(core.ItemIdentifiers.CABBAGE_3, 1);
  for (const handler of hooks.get('onItemOnObject') || []) {
    handler({ player: p, objectId: core.ObjectIdentifiers.HOLE_2, itemId: core.ItemIdentifiers.CABBAGE_3 });
  }
  assert.ok(p.said.includes('Why exactly would I want to do that?'),
    'the pre-witch any-item transcript must play instead of an ad-hoc message');
  assert.equal(p.items.get(core.ItemIdentifiers.CABBAGE_3), 1);
  assert.equal(quest.getStage(p), 1);
});

test('Prince Ali Lady Keli reports tied-up, not not-ready, after the rope has been used', () => {
  const { api, hooks, quest } = register('PrinceAliRescue', 'prince_ali_rescue');
  const condition = hooks.get('onNpcDialogueCondition')[0];
  const previous = [...PluginManager.npcDialogueConditionHooks];
  PluginManager.npcDialogueConditionHooks.splice(0, previous.length, { pluginName: 'qh-test', handler: condition });
  try {
    const p = player();
    quest.setStage(p, 50);
    startTranscript(api, p, core.NpcIdentifiers.LADY_KELI, 'Prince Ali Rescue', 'executing-the-rescue-dealing-with-lady-keli');
    assert.ok(p.messages.includes('You overpower Keli, tie her up, and put her in a cupboard.'));
    assert.ok(!p.messages.includes('You cannot tie Keli up until you have all equipment and disabled the guard!'));

    const waiting = player();
    quest.setStage(waiting, 40);
    startTranscript(api, waiting, core.NpcIdentifiers.LADY_KELI, 'Prince Ali Rescue', 'executing-the-rescue-dealing-with-lady-keli');
    assert.ok(waiting.messages.includes('You cannot tie Keli up until you have all equipment and disabled the guard!'));
    assert.ok(!waiting.messages.includes('You overpower Keli, tie her up, and put her in a cupboard.'));
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(0, PluginManager.npcDialogueConditionHooks.length, ...previous);
  }
});

test("Pirate's Treasure stock-room crate needs the white apron worn before it gives the rum", () => {
  const { hooks, quest } = register('PiratesTreasure', 'pirates_treasure');
  const search = hooks.get('onObjectInteraction')[0];
  const p = player();
  quest.setStage(p, 1);
  p.attributes.set('pirates-treasure.employment', 2);
  p.attributes.set('pirates-treasure.rum', 2);
  const crate = {
    player: p,
    objectId: core.ObjectIdentifiers.CRATE_14,
    clickType: 1,
    definition: { getInteractions: () => ['Search'] },
  };
  search(crate);
  assert.equal(p.items.get(core.ItemIdentifiers.KARAMJAN_RUM), undefined);
  assert.ok(p.messages.includes('You need to put your white apron on first.'));

  p.messages.length = 0;
  p.equipment.set(core.Equipment.BODY_SLOT, core.ItemIdentifiers.WHITE_APRON);
  search(crate);
  assert.equal(p.items.get(core.ItemIdentifiers.KARAMJAN_RUM), 1);
  assert.equal(p.attributes.get('pirates-treasure.rum'), 0);
  assert.ok(p.messages.includes('You find your bottle of rum in amongst the bananas.'));
});


function rewardPlayer() {
  const p = player();
  const inventory = new Inventory(p);
  p.getInventory = () => inventory;
  return { p, inventory };
}

function fillSlots(inventory, count, coinAmount = 0) {
  for (let slot = 0; slot < count; slot++) inventory.getItems()[slot] = new core.Item(1005, 1);
  if (coinAmount > 0) inventory.getItems()[0] = new core.Item(core.ItemIdentifiers.COINS, coinAmount);
  return inventory;
}

function captureDrops(action) {
  const drops = [];
  const previous = ItemOnGroundManager.registers;
  ItemOnGroundManager.registers = (_player, item) => { drops.push(item); return item; };
  try { action(); } finally { ItemOnGroundManager.registers = previous; }
  return drops;
}

test('Black Knights onReward keeps 2500 coins for a full bag, existing stack and one free slot', () => {
  const { quest } = register('BlackKnightsFortress', 'black_knights_fortress');
  const full = rewardPlayer(); fillSlots(full.inventory, 28);
  const dropped = captureDrops(() => quest.onReward(full.p, quest));
  assert.equal(full.inventory.getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].getId(), core.ItemIdentifiers.COINS);
  assert.equal(dropped[0].getAmount(), 2500);

  const stacked = rewardPlayer(); fillSlots(stacked.inventory, 28, 1);
  const merged = captureDrops(() => quest.onReward(stacked.p, quest));
  assert.equal(merged.length, 0);
  assert.equal(stacked.inventory.getAmount(core.ItemIdentifiers.COINS), 2501);

  const oneFree = rewardPlayer(); fillSlots(oneFree.inventory, 27);
  const fitted = captureDrops(() => quest.onReward(oneFree.p, quest));
  assert.equal(fitted.length, 0);
  assert.equal(oneFree.inventory.getAmount(core.ItemIdentifiers.COINS), 2500);
});

test('Prince Ali onReward keeps 700 coins for a full bag and an existing stack', () => {
  const { quest } = register('PrinceAliRescue', 'prince_ali_rescue');
  const full = rewardPlayer(); fillSlots(full.inventory, 28);
  const dropped = captureDrops(() => quest.onReward(full.p, quest));
  assert.equal(full.inventory.getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].getId(), core.ItemIdentifiers.COINS);
  assert.equal(dropped[0].getAmount(), 700);

  const stacked = rewardPlayer(); fillSlots(stacked.inventory, 28, 20);
  const merged = captureDrops(() => quest.onReward(stacked.p, quest));
  assert.equal(merged.length, 0);
  assert.equal(stacked.inventory.getAmount(core.ItemIdentifiers.COINS), 720);
});

test('Black Knights completion rewards once even when the bag is full', () => {
  const { quest } = register('BlackKnightsFortress', 'black_knights_fortress');
  const full = rewardPlayer(); fillSlots(full.inventory, 28);
  let first, second;
  const dropped = captureDrops(() => {
    first = quest.complete(full.p);
    second = quest.complete(full.p);
  });
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(dropped.length, 1);
  assert.equal(quest.getStage(full.p), 4);
});
