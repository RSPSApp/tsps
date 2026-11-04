const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Item } = require('../dist/game/model/Item');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const diary = require('../plugins/achievements/diaries/ArdougneIbanStaffDiary.plugin');
const core = PluginManager.getCoreApi();

before(async () => {
  await CachePipeline.initialize(process.cwd());
  new NpcDefinitionLoader().load();
});

function fixture(t) {
  const player = new Player(null);
  const messages = [];
  const events = new Map();
  const variants = [];
  const conditions = [];
  let questComplete = true;
  let hitpoints = 99;
  player.setRegistered(true);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(player, 'getHitpoints', () => hitpoints);
  t.mock.method(player, 'isDyingReturn', () => false);
  t.mock.method(player, 'sendMessage', (message) => messages.push(message));
  const api = {
    core,
    onNpcDialogueVariant(handler) { variants.push(handler); },
    onNpcDialogueCondition(handler) { conditions.push(handler); },
    onCustomEvent(name, handler) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') event.complete = questComplete;
      for (const handler of events.get(name) ?? []) handler(event);
    },
    setQuestComplete(value) { questComplete = value; },
  };
  diary.register(api);
  const tasks = [];
  api.onCustomEvent('diary:task', (event) => tasks.push(event));
  return { player, api, messages, tasks, variants, conditions, setHitpoints(value) { hitpoints = value; } };
}

function add(player, id, amount = 1) {
  player.getInventory().add(new core.Item(id, amount), false);
}

function upgrade(f, override = {}) {
  const event = {
    player: f.player,
    npcId: core.NpcIdentifiers.DARK_MAGE_2,
    stepId: diary._test.UPGRADE_ACTION_ID,
    ...override,
  };
  f.api.emitCustomEvent('npc-dialogue:action', event);
  return event;
}

test('Dark Mage dialogue upgrades the staff and charges 200,000 coins once', (t) => {
  const f = fixture(t);
  add(f.player, core.ItemIdentifiers.IBANS_STAFF);
  add(f.player, core.ItemIdentifiers.COINS, diary._test.UPGRADE_COST);

  const action = upgrade(f);

  assert.equal(action.handled, true);
  assert.equal(f.player.getInventory().contains(core.ItemIdentifiers.IBANS_STAFF), false);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.IBANS_STAFF_U_), 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(f.tasks.length, 1);
  assert.equal(f.tasks[0].task, diary._test.TASK);
  assert.match(f.messages.at(-1), /upgrades your Staff of Iban/);

  upgrade(f);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(f.tasks.length, 1);
});

test('the same 400,000-coin action cannot charge twice when the inventory has duplicate staffs and coin stacks', (t) => {
  const f = fixture(t);
  const inventory = f.player.getInventory();
  inventory.setItem(0, new Item(core.ItemIdentifiers.IBANS_STAFF_2));
  inventory.setItem(1, new Item(core.ItemIdentifiers.IBANS_STAFF_2));
  inventory.setItem(2, new Item(core.ItemIdentifiers.COINS, 250000));
  inventory.setItem(3, new Item(core.ItemIdentifiers.COINS, 550000));
  const event = {
    player: f.player,
    npcId: core.NpcIdentifiers.DARK_MAGE_3,
    stepId: diary._test.BROKEN_STAFF_UPGRADE_ACTION_ID,
    handled: false,
  };

  f.api.emitCustomEvent('npc-dialogue:action', event);
  f.api.emitCustomEvent('npc-dialogue:action', event);

  assert.equal(event.handled, true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.IBANS_STAFF_2), 1);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.IBANS_STAFF_U_), 1);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.COINS), 400000);
  assert.equal(f.tasks.length, 1);
});

test('the upgrade action leaves items untouched without the quest, staff, or enough coins', (t) => {
  const f = fixture(t);
  add(f.player, core.ItemIdentifiers.IBANS_STAFF);
  add(f.player, core.ItemIdentifiers.COINS, diary._test.UPGRADE_COST - 1);
  f.api.setQuestComplete(false);
  upgrade(f);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.IBANS_STAFF), 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), diary._test.UPGRADE_COST - 1);
  assert.equal(f.tasks.length, 0);

  f.api.setQuestComplete(true);
  f.player.getInventory().resetItems();
  add(f.player, core.ItemIdentifiers.IBANS_STAFF);
  add(f.player, core.ItemIdentifiers.COINS, diary._test.UPGRADE_COST - 1);
  upgrade(f);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.IBANS_STAFF), 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), diary._test.UPGRADE_COST - 1);
  assert.match(f.messages.at(-1), /200,000 coins/);

  f.player.getInventory().resetItems();
  add(f.player, core.ItemIdentifiers.IBANS_STAFF);
  add(f.player, core.ItemIdentifiers.COINS, diary._test.UPGRADE_COST);
  upgrade(f, { npcId: core.NpcIdentifiers.DARK_MAGE });
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.IBANS_STAFF), 1);
  assert.equal(f.tasks.length, 0);

  f.player.getInventory().resetItems();
  add(f.player, core.ItemIdentifiers.COINS, diary._test.UPGRADE_COST);
  upgrade(f);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.IBANS_STAFF_U_), 0);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), diary._test.UPGRADE_COST);
  assert.equal(f.tasks.length, 0);
  assert.match(f.messages.at(-1), /Iban's staff in your inventory/);
});

test('post-quest Talk-to selection and its conditions only apply to the two tower mages', (t) => {
  const f = fixture(t);
  const event = {
    player: f.player,
    npcId: core.NpcIdentifiers.DARK_MAGE_2,
    pages: [{ page: 'Dark Mage' }],
    stepId: diary._test.NO_STAVES_CONDITION_ID,
  };
  assert.equal(f.variants[0](event), diary._test.POST_QUEST_VARIANT);
  assert.equal(f.conditions[0](event), true);

  add(f.player, core.ItemIdentifiers.IBANS_STAFF);
  assert.equal(f.conditions[0](event), false);
  assert.equal(f.conditions[0]({ ...event, stepId: diary._test.UPGRADE_STAFF_CONDITION_ID }), true);
  assert.equal(f.conditions[0]({ ...event, stepId: diary._test.UPGRADE_COST_CONDITION_ID }), false);
  add(f.player, core.ItemIdentifiers.COINS, diary._test.UPGRADE_COST);
  assert.equal(f.conditions[0]({ ...event, stepId: diary._test.UPGRADE_COST_CONDITION_ID }), true);

  f.player.getInventory().setItem(2, new Item(core.ItemIdentifiers.IBANS_STAFF_2));
  assert.equal(f.conditions[0]({ ...event, stepId: diary._test.BROKEN_STAFF_CONDITION_ID }), true);
  assert.equal(f.conditions[0]({ ...event, stepId: diary._test.BROKEN_STAFF_UPGRADE_COST_CONDITION_ID }), false);
  f.player.getInventory().setItem(3, new Item(core.ItemIdentifiers.COINS, 200000));
  assert.equal(f.conditions[0]({ ...event, stepId: diary._test.BROKEN_STAFF_UPGRADE_COST_CONDITION_ID }), true);
  f.api.setQuestComplete(false);
  assert.equal(f.variants[0](event), null, 'an active quest keeps its own dialogue selection');
  assert.equal(f.conditions[0](event), null, 'the diary does not answer active-quest conditions');
  assert.equal(f.variants[0]({ ...event, npcId: core.NpcIdentifiers.DARK_MAGE }), null);
  assert.equal(f.conditions[0]({ ...event, stepId: diary._test.BROKEN_STAFF_CONDITION_ID }), null,
    'active-quest condition answers remain unavailable');
});

test('a real Dark Mage Talk-to dialogue offers and completes the upgrade', (t) => {
  const previous = {
    interaction: PluginManager.npcAnyInteractionHooks.length,
    variants: PluginManager.npcDialogueVariantHooks.length,
    conditions: PluginManager.npcDialogueConditionHooks.length,
    custom: new Map([...PluginManager.customEventHooks].map(([name, hooks]) => [name, hooks.length])),
  };
  t.after(() => {
    PluginManager.npcAnyInteractionHooks.length = previous.interaction;
    PluginManager.npcDialogueVariantHooks.length = previous.variants;
    PluginManager.npcDialogueConditionHooks.length = previous.conditions;
    for (const [name, hooks] of [...PluginManager.customEventHooks]) {
      hooks.splice(previous.custom.get(name) ?? 0);
      if (!hooks.length) PluginManager.customEventHooks.delete(name);
    }
  });

  const api = PluginManager.createApi('ArdougneIbanStaffDialogueE2E');
  const messages = [];
  const diaryTasks = [];
  let prompt = null;
  api.sendMultiChatboxPrompt = (player, title, ...pairs) => {
    prompt = { player, title, pairs };
    return true;
  };
  api.onCustomEvent('quest:is-complete', (event) => {
    event.complete = event.player.getAttribute('iban-staff-test:upass-complete') === true;
  });
  api.onCustomEvent('diary:task', (event) => diaryTasks.push(event));
  diary.register(api);
  require('../plugins/npcs/NpcDialogues.plugin').register(api);

  const player = new Player(null);
  player.setUsername('iban-staff-dialogue-test');
  player.setIndex(991246);
  player.setRegistered(true);
  player.setAttribute('iban-staff-test:upass-complete', true);
  const sender = new Proxy({
    getVarp: (id) => id === 161 ? 11 : 0,
    getVarbit: () => 0,
  }, { get: (target, key) => target[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.sendMessage = (message) => messages.push(message);
  const npc = core.NPC.create(4558, new core.Location(2457, 3309, 0));
  player.getInventory().setItem(0, new Item(core.ItemIdentifiers.IBANS_STAFF));
  player.getInventory().setItem(1, new Item(core.ItemIdentifiers.COINS, diary._test.UPGRADE_COST));

  const event = {
    player,
    npc,
    npcId: npc.getContentId(player),
    definition: npc.getCurrentDefinition(player),
    clickType: 1,
    handled: false,
  };
  assert.equal(npc.getId(), 4558);
  assert.equal(npc.getCurrentDefinition(player).getName(), 'Dark Mage');
  assert.ok([core.NpcIdentifiers.DARK_MAGE_2, core.NpcIdentifiers.DARK_MAGE_3].includes(event.npcId));
  assert.equal(PluginManager.emitNpcInteraction(event), true);

  function advanceUntilPrompt(target, limit = 100) {
    while (!prompt && target.getDialogueManager().isActive() && limit-- > 0) {
      target.getDialogueManager().advance();
    }
    assert.ok(limit > 0, 'Dark Mage dialogue did not reach an option');
  }
  function choose(target, label) {
    advanceUntilPrompt(target);
    const index = prompt.pairs.findIndex((entry, position) => position % 2 === 0 && entry === label);
    assert.notEqual(index, -1, `missing dialogue option ${label}`);
    const callback = prompt.pairs[index + 1];
    prompt = null;
    callback();
  }

  choose(player, 'Can you upgrade my Staff of Iban?');
  choose(player, "Here's 200,000 coins. Please upgrade the staff.");
  let limit = 100;
  while (player.getDialogueManager().isActive() && limit-- > 0) player.getDialogueManager().advance();
  assert.ok(limit > 0, 'Dark Mage upgrade dialogue did not finish');
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.IBANS_STAFF_U_), 1);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(diaryTasks.length, 1);
  assert.equal(diaryTasks[0].task, diary._test.TASK);
  assert.ok(messages.some((message) => message.includes('upgrades your Staff of Iban')));

  const brokenPlayer = new Player(null);
  brokenPlayer.setUsername('iban-broken-staff-dialogue-test');
  brokenPlayer.setIndex(991247);
  brokenPlayer.setRegistered(true);
  brokenPlayer.setAttribute('iban-staff-test:upass-complete', true);
  const brokenSender = new Proxy({
    getVarp: (id) => id === 161 ? 11 : 0,
    getVarbit: () => 0,
  }, { get: (target, key) => target[key] ?? (() => brokenSender) });
  brokenPlayer.getPacketSender = () => brokenSender;
  brokenPlayer.sendMessage = () => {};
  brokenPlayer.getInventory().setItem(0, new Item(core.ItemIdentifiers.IBANS_STAFF_2));
  brokenPlayer.getInventory().setItem(1, new Item(core.ItemIdentifiers.IBANS_STAFF_2));
  brokenPlayer.getInventory().setItem(2, new Item(core.ItemIdentifiers.COINS, 250000));
  brokenPlayer.getInventory().setItem(3, new Item(core.ItemIdentifiers.COINS, 150000));
  const brokenNpc = core.NPC.create(4558, new core.Location(2457, 3309, 0));
  const brokenEvent = {
    player: brokenPlayer,
    npc: brokenNpc,
    npcId: brokenNpc.getContentId(brokenPlayer),
    definition: brokenNpc.getCurrentDefinition(brokenPlayer),
    clickType: 1,
    handled: false,
  };
  assert.equal(PluginManager.emitNpcInteraction(brokenEvent), true);
  choose(brokenPlayer, 'Can you repair my broken Staff of Iban?');
  choose(brokenPlayer, 'Can you make it hold more than 120 charges?');
  choose(brokenPlayer, "Here's 400,000 coins. Please upgrade the staff.");
  limit = 100;
  while (brokenPlayer.getDialogueManager().isActive() && limit-- > 0) brokenPlayer.getDialogueManager().advance();
  assert.ok(limit > 0, 'broken-staff upgrade dialogue did not finish');
  assert.equal(brokenPlayer.getInventory().getAmount(core.ItemIdentifiers.IBANS_STAFF_2), 1);
  assert.equal(brokenPlayer.getInventory().getAmount(core.ItemIdentifiers.IBANS_STAFF_U_), 1);
  assert.equal(brokenPlayer.getInventory().getAmount(core.ItemIdentifiers.COINS), 0,
    'the 400,000-coin payment consumes coin stacks in aggregate');
  assert.equal(diaryTasks.length, 2);

  assert.match(ItemDefinition.forId(core.ItemIdentifiers.IBANS_STAFF_2).getExamine(), /get this repaired before I can use it/,
    'the cache examine identifies id 1410 as the broken staff');
  assert.equal(ItemDefinition.forId(core.ItemIdentifiers.IBANS_STAFF).getEquipmentType().getSlot(), core.Equipment.WEAPON_SLOT,
    'id 1409 is the equipable staff, not the broken version');

  player.getInventory().delete(core.ItemIdentifiers.IBANS_STAFF_U_, 1);
  player.getEquipment().set(core.Equipment.WEAPON_SLOT, new Item(core.ItemIdentifiers.IBANS_STAFF));
  player.getEquipment().refreshItems();
  assert.equal(diaryTasks.length, 2, 'wearing a regular Iban staff does not satisfy the task');
  player.getPrivateArea = () => ({ id: 'iban-staff-private-test' });
  player.getEquipment().set(core.Equipment.WEAPON_SLOT, new Item(core.ItemIdentifiers.IBANS_STAFF_U_));
  player.getEquipment().refreshItems();
  assert.equal(diaryTasks.length, 3, 'the task has no public-area requirement');
  player.setRegistered(false);
  player.getEquipment().refreshItems();
  assert.equal(diaryTasks.length, 3, 'unregistered players do not advance the diary');
  player.setRegistered(true);
  player.getHitpoints = () => 0;
  player.getEquipment().refreshItems();
  assert.equal(diaryTasks.length, 3, 'dead players do not advance the diary');
});

test('equipping the upgraded staff advances the diary without an extra quest check', (t) => {
  const f = fixture(t);
  f.api.setQuestComplete(false);
  f.player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.IBANS_STAFF_U_));

  f.api.emitCustomEvent('equipment:changed', { player: f.player });

  assert.equal(f.tasks.length, 1);
  assert.equal(f.tasks[0].task, diary._test.TASK);
  f.player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.IBANS_STAFF));
  f.api.emitCustomEvent('equipment:changed', { player: f.player });
  assert.equal(f.tasks.length, 1);
  f.player.setRegistered(false);
  f.player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.IBANS_STAFF_U_));
  f.api.emitCustomEvent('equipment:changed', { player: f.player });
  assert.equal(f.tasks.length, 1);
  f.player.setRegistered(true);
  f.setHitpoints(0);
  f.api.emitCustomEvent('equipment:changed', { player: f.player });
  assert.equal(f.tasks.length, 1);
});
