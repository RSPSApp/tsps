// Death Plateau (q017) source-contract checks.
// From server/: node --test tests/qh728-q017.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Item } = require('../dist/game/model/Item');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});

const PAGE = 'Death Plateau';
const VARP = 314;
const STACKABLE = new Set([core.ItemIdentifiers.COINS]);

function inventoryFixture(initial = new Map(), freeSlots = 28) {
  const items = new Map(initial);
  let free = freeSlots;
  for (const id of items.keys()) if (!STACKABLE.has(id)) free--;
  return {
    items,
    getAmount: (id) => items.get(id) ?? 0,
    isFull: () => free <= 0,
    getFreeSlots: () => free,
    adds(id, amount = 1) {
      if (STACKABLE.has(id)) {
        items.set(id, (items.get(id) ?? 0) + amount);
        return;
      }
      for (let placed = 0; placed < amount; placed++) {
        if (free <= 0) return;
        free--;
        items.set(id, (items.get(id) ?? 0) + 1);
      }
    },
    deleteNumber(id, amount = 1) {
      const left = Math.max(0, (items.get(id) ?? 0) - amount);
      if (left === 0) {
        if (items.delete(id) && !STACKABLE.has(id)) free++;
      } else {
        items.set(id, left);
      }
    },
    forceAdd(_player, item) {
      this.adds(item.getId(), item.getAmount());
    },
  };
}

function playerFixture(inventory = inventoryFixture()) {
  const attributes = new Map();
  const messages = [];
  const configs = [];
  let manager;
  let activeInventory = inventory;
  const sender = new Proxy({}, { get: (_target, key) => {
    if (key === 'sendConfig') return (id, value) => { configs.push({ id, value }); return sender; };
    if (key === 'sendVarbit') return (id, value) => { configs.push({ id, value, varbit: true }); return sender; };
    return () => sender;
  } });
  const player = {
    inventory,
    messages,
    configs,
    getUsername: () => 'qh728-q017', getDisplayName: () => 'qh728-q017',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => activeInventory,
    getSkillManager: () => ({ addExperiences: (skill, amount) => player.xp.push({ skill: skill.getIndex?.() ?? skill, amount }) }),
    getLocation: () => new core.Location(2896, 3529, 0),
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    xp: [],
  };
  player.setInventory = (value) => { activeInventory = value; };
  manager = {
    reset() {},
    isActive: () => false,
    getCurrent: () => null,
    startDialogues(chain) {
      for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
        entry.send(player);
      }
    },
  };
  player.getDialogueManager = () => manager;
  return player;
}

function registerQuestPlugin(name, pluginName, questKey) {
  const before = {
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    interaction: PluginManager.npcInteractionHooks.length,
    itemOnNpc: PluginManager.itemOnNpcHooks.length,
    itemOnObject: PluginManager.itemOnObjectHooks.length,
    itemAction: PluginManager.itemActionHooks.length,
    login: PluginManager.loginHooks.length,
    interfaceAction: PluginManager.interfaceActionClickHooks.length,
    logout: PluginManager.logoutHooks.length,
    disconnect: PluginManager.disconnectHooks.length,
  };
  const customEvents = new Set();
  const persistedAttributes = new Map();
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'persistAttribute') return (attribute, defaultValue) => persistedAttributes.set(attribute, defaultValue);
    if (key === 'onNpcDialogueVariant') return (handler) => PluginManager.npcDialogueVariantHooks.push({ pluginName, handler });
    if (key === 'onNpcDialogueCondition') return (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName, handler });
    if (key === 'onNpcInteraction') return (names, actions) => {
      if (typeof names === 'function') {
        PluginManager.npcInteractionHooks.push({ pluginName, handler: names });
        return;
      }
      for (const [action, handler] of Object.entries(actions ?? {})) {
        PluginManager.npcInteractionHooks.push({ pluginName, handler: (event) => {
          if (event.handled || event.definition?.getName?.() !== names) return;
          if (event.definition.getActions?.()[event.clickType - 1] !== action) return;
          if (handler(event) !== false) event.handled = true;
        } });
      }
    };
    if (key === 'onItemOnNpc') return (handler) => PluginManager.itemOnNpcHooks.push({ pluginName, handler });
    if (key === 'onItemOnObject') return (handler) => PluginManager.itemOnObjectHooks.push({ pluginName, handler });
    if (key === 'onItemAction') return (...args) => {
      if (typeof args[0] === 'string') {
        const actions = args[1] ?? {};
        PluginManager.itemActionHooks.push({ pluginName, handler: (event) => {
          const action = actions[event.option];
          if (!action) return;
          if (action(event) !== false) event.handled = true;
        } });
      } else {
        PluginManager.itemActionHooks.push({ pluginName, handler: args[0] });
      }
    };
    if (key === 'onPlayerLogin') return (handler) => PluginManager.loginHooks.push({ pluginName, handler });
    if (key === 'onInterfaceActionClick') return (handler) => PluginManager.interfaceActionClickHooks.push({ pluginName, handler });
    if (key === 'onPlayerLogout') return (handler) => PluginManager.logoutHooks.push({ pluginName, handler });
    if (key === 'onPlayerDisconnect') return (handler) => PluginManager.disconnectHooks.push({ pluginName, handler });
    if (key === 'onCustomEvent') return (eventName, handler) => {
      customEvents.add(eventName);
      const hooks = PluginManager.customEventHooks.get(eventName) ?? [];
      hooks.push({ pluginName, handler });
      PluginManager.customEventHooks.set(eventName, hooks);
    };
    if (key === 'emitCustomEvent') return (eventName, payload) => PluginManager.emitCustomEvent(eventName, payload);
    return () => {};
  } });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  return {
    quest: getRegisteredQuests().findLast((entry) => entry.key === questKey),
    persistedAttributes,
    cleanup() {
      PluginManager.npcDialogueVariantHooks.length = before.variant;
      PluginManager.npcDialogueConditionHooks.length = before.condition;
      PluginManager.npcInteractionHooks.length = before.interaction;
      PluginManager.itemOnNpcHooks.length = before.itemOnNpc;
      PluginManager.itemOnObjectHooks.length = before.itemOnObject;
      PluginManager.itemActionHooks.length = before.itemAction;
      PluginManager.loginHooks.length = before.login;
      PluginManager.interfaceActionClickHooks.length = before.interfaceAction;
      PluginManager.logoutHooks.length = before.logout;
      PluginManager.disconnectHooks.length = before.disconnect;
      for (const eventName of customEvents) {
        const kept = (PluginManager.customEventHooks.get(eventName) ?? [])
          .filter((hook) => hook.pluginName !== pluginName);
        if (kept.length) PluginManager.customEventHooks.set(eventName, kept);
        else PluginManager.customEventHooks.delete(eventName);
      }
    },
  };
}

let registered;
before(() => {
  registered = registerQuestPlugin('DeathPlateau', 'DeathPlateauTest', 'death_plateau');
});

const N = () => core.NpcIdentifiers;
const I = () => core.ItemIdentifiers;

function login(player) {
  for (const hook of PluginManager.loginHooks) hook.handler({ player });
}

function lastConfig(player, id) {
  return [...player.configs].reverse().find((entry) => entry.id === id);
}

function startVariant(player, npcId, variant) {
  const lines = [];
  const api = {
    core,
    emitCustomEvent(name, payload) {
      if (name === 'npc-dialogue:line') lines.push(payload);
      return PluginManager.emitCustomEvent(name, payload);
    },
    sendMultiChatboxPrompt() {
      throw new Error(`unexpected menu in ${variant}`);
    },
  };
  const started = runtime.startTranscript(api, player, npcId, PAGE, variant);
  assert.equal(started, true, `variant ${variant} exists`);
  return lines;
}

function playLostIou(player, { drunk = false, read = false } = {}) {
  const { quest } = registered;
  quest.setStage(player, read ? 60 : 55);
  if (drunk) player.setAttribute('death-plateau:harold-drunk', true);
  const variant = PluginManager.emitNpcDialogueVariant({ player, npcId: N().HAROLD });
  assert.equal(variant, 'finding-the-combination-talking-to-harold-after-losing-the-iou');
  return startVariant(player, N().HAROLD, variant);
}

test('Harold wagers use native NPC, amount, Roll and Continue dispatch', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { quest } = registered, cache = core.CacheDefinitions;
  const component = name => cache.getComponentId(`death_dice:death_gamble_${name}`);
  assert.equal(cache.getInterfaceId('death_dice'), 99);
  assert.equal(component('roll_button'), (99 << 16) | 28);
  assert.equal(component('continue_button'), (99 << 16) | 30);
  assert.equal(cache.getSeqId('dice_roll_1'), 1150);
  assert.equal(cache.getSeqId('dice_roll_6'), 1155);
  require('../plugins/npcs/NpcDialogues.plugin').register(PluginManager.createApi('HaroldNativeDialogueTest'));
  core.RegionManager.loadMapFiles(2905, 3539);
  const npc = PluginManager.spawnNpc({ id: N().HAROLD, x: 2905, y: 3539, z: 1, wanderRadius: 0 });
  let index = 2200;

  function actor(coins = 2000, drunk = false) {
    const channel = { kind: 'test', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel), player = new Player(session, new core.Location(2904, 3539, 1));
    session.setPlayer(player);
    player.setUsername(`haroldtest${index}`);
    player.setIndex(index++);
    player.setRegistered(true);
    player.needsPlacement = false;
    quest.setStage(player, 50);
    player.setAttribute('death-plateau:harold-drunk', drunk);
    player.getInventory().adds(I().COINS, coins);
    const connection = new ClientConnection(channel);
    connection.player = player;
    const messages = [], animations = [];
    const sender = player.getPacketSender();
    const message = sender.sendMessage.bind(sender), animation = sender.sendInterfaceAnimation.bind(sender);
    sender.sendMessage = text => { messages.push(text); return message(text); };
    sender.sendInterfaceAnimation = (uid, seq) => { animations.push({ uid, seq }); return animation(uid, seq); };
    const send = async packet => { await connection.dispatch([packet]); connection.processTurnPackets(); };
    const click = name => send(name === 'continue_button'
      ? { type: 'dialogue_continue', widgetId: component(name), childIndex: -1 }
      : { type: 'widget_action', widgetId: component(name), groupId: 99, childId: component(name) & 65535, buttonNum: 1 });
    async function drain() {
      for (let i = 0; i < 50; i++) {
        if (player.getEnteredAmountAction() || player.getInterfaceId() === 99) return;
        const menu = core.MultiChatboxPrompt.getPending(player);
        if (menu) {
          const option = menu.options.indexOf('Would you like to gamble?');
          assert.ok(option >= 0, menu.options.join(', '));
          await send({ type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: option + 1 });
        } else if (player.getDialogueManager().isActive()) {
          const group = sender.getChatboxGroupId();
          await send({ type: 'dialogue_continue', widgetId: (group << 16) | (group === 229 ? 4 : 5), childIndex: -1 });
        } else return;
      }
      assert.fail('Harold dialogue did not finish');
    }
    async function talk() {
      await send({ type: 'npc_option', index: npc.getIndex(), clickType: 1 });
      await drain();
    }
    async function wager(amount, finishPreamble = true) {
      await talk();
      assert.ok(player.getEnteredAmountAction(), 'native Enter amount prompt remains armed after the transcript action');
      await send({ type: 'dialogue_amount', amount });
      if (finishPreamble) await drain();
    }
    return { player, send, click, drain, talk, wager, messages, animations, coins: () => player.getInventory().getAmount(I().COINS) };
  }

  await t.test('sober loss debits the chosen stake once; Continue cannot skip Roll', async (t) => {
    const f = actor(), rolls = [.99, .99, 0, 0];
    t.mock.method(Math, 'random', () => rolls.shift() ?? 0);
    await f.wager(60);
    assert.equal(f.player.getInterfaceId(), 99);
    assert.equal(f.coins(), 1940);
    assert.equal(f.player.getAttribute('death-plateau:harold-coins'), 160);
    await f.click('continue_button');
    assert.equal(f.player.getInterfaceId(), 99);
    await f.click('roll_button');
    await f.click('roll_button');
    assert.equal(f.coins(), 1940);
    assert.ok(f.animations.some(a => a.uid === component('harold_dice1') && a.seq === 1155));
    assert.ok(f.animations.some(a => a.uid === component('player_dice1') && a.seq === 1150));
    await f.click('continue_button');
    await f.drain();
    await f.click('continue_button');
    assert.equal(f.coins(), 1940);
    assert.equal(quest.getStage(f.player), 50);
    assert.ok(f.messages.includes('You give Harold his winnings.'));
    assert.equal(f.player.getInventory().getAmount(I().IOU), 0);
    assert.equal(registered.persistedAttributes.get('death-plateau:harold-coins'), 100);
    assert.equal(registered.persistedAttributes.get('death-plateau:harold-owes-iou'), false);
  });

  await t.test('sober wins exhaust the same bankroll across repeat games and give one IOU', async (t) => {
    const f = actor(), rolls = [0, 0, .99, .99, 0, 0, .99, .99];
    t.mock.method(Math, 'random', () => rolls.shift() ?? 0);
    await f.wager(60);
    await f.click('roll_button');
    assert.equal(f.coins(), 2060);
    assert.equal(f.player.getAttribute('death-plateau:harold-coins'), 40);
    await f.click('continue_button');
    await f.drain();
    assert.equal(quest.getStage(f.player), 50);
    await f.wager(60);
    await f.click('roll_button');
    assert.equal(f.coins(), 2100, 'Harold can only pay his remaining40 coins');
    assert.equal(f.player.getAttribute('death-plateau:harold-owes-iou'), true);
    await f.click('continue_button');
    await f.drain();
    assert.equal(quest.getStage(f.player), 55);
    assert.equal(f.player.getInventory().getAmount(I().IOU), 1);
    assert.equal(f.player.getAttribute('death-plateau:harold-owes-iou'), false);
    await f.click('roll_button');
    assert.equal(f.coins(), 2100);
  });

  await t.test('Blurberry guarantees a win even on lower dice and 101 immediately earns the IOU', async (t) => {
    const f = actor(1000, true), rolls = [.99, .99, 0, 0];
    t.mock.method(Math, 'random', () => rolls.shift() ?? 0);
    await f.wager(101);
    await f.click('roll_button');
    assert.equal(f.coins(), 1100);
    f.player.getPacketSender().sendInterfaceRemoval();
    PluginManager.emitPlayerDisconnect({ player: f.player, username: f.player.getUsername() });
    const reloaded = actor(f.coins(), true);
    for (const key of ['death-plateau:harold-coins', 'death-plateau:harold-owes-iou']) reloaded.player.setAttribute(key, f.player.getAttribute(key));
    await reloaded.talk();
    assert.equal(reloaded.player.getInventory().getAmount(I().IOU), 1, 'closing and reloading the saved attributes cannot erase the earned IOU');
    assert.equal(quest.getStage(reloaded.player), 55);
    assert.equal(reloaded.coins(), 1100);
  });

  await t.test('zero, negative, insufficient and over 1000 inputs do not wager', async () => {
    for (const [coins, amount, expected] of [[2000, 0, 'offer some money'], [2000, -1, 'offer some money'], [50, 60, 'that much money'], [2000, 1001, null]]) {
      const f = actor(coins);
      await f.wager(amount);
      assert.notEqual(f.player.getInterfaceId(), 99);
      assert.equal(f.coins(), coins);
      assert.equal(quest.getStage(f.player), 50);
      if (expected) assert.ok(f.messages.some(m => m.includes(expected)), f.messages.join('\n'));
      assert.ok(!f.player.getEnteredAmountAction());
    }
  });

  await t.test('a sober tie refunds the wager and 1000 is accepted', async (t) => {
    const f = actor(1000), rolls = [0, 0, 0, 0];
    t.mock.method(Math, 'random', () => rolls.shift() ?? 0);
    await f.wager(1000);
    assert.equal(f.coins(), 0);
    await f.click('roll_button');
    assert.equal(f.coins(), 1000);
    assert.equal(f.player.getAttribute('death-plateau:harold-coins'), 100);
    await f.click('continue_button');
    assert.equal(f.player.getInventory().getAmount(I().IOU), 0);
    assert.equal(quest.getStage(f.player), 50);
  });

  await t.test('winning the last 100 exactly needs another qualifying win for an IOU; a full bag retries', async (t) => {
    const f = actor(1000, true);
    t.mock.method(Math, 'random', () => 0);
    await f.wager(100);
    await f.click('roll_button');
    assert.equal(f.coins(), 1100);
    assert.equal(f.player.getAttribute('death-plateau:harold-owes-iou'), undefined);
    await f.click('continue_button');
    await f.drain();
    for (let slot = 1; slot < 28; slot++) f.player.getInventory().setItem(slot, new Item(I().SANDSTONE_1KG_, 1));
    await f.wager(60);
    await f.click('roll_button');
    await f.click('continue_button');
    await f.drain();
    assert.equal(f.coins(), 1100);
    assert.equal(f.player.getInventory().getAmount(I().IOU), 0);
    assert.equal(f.player.getAttribute('death-plateau:harold-owes-iou'), true);
    f.player.getInventory().deleteAtSlot(1, 1);
    await f.talk();
    assert.equal(f.player.getInventory().getAmount(I().IOU), 1);
    assert.equal(f.player.getAttribute('death-plateau:harold-owes-iou'), false);
  });

  await t.test('a full coin stack preserves the winnings as an owned ground overflow', async (t) => {
    const f = actor(2147483647, true);
    t.mock.method(Math, 'random', () => 0);
    await f.wager(101);
    await f.click('roll_button');
    assert.equal(f.coins(), 2147483647);
    const ground = core.ItemOnGroundManager.getGroundItem(f.player.getUsername(), I().COINS, f.player.getLocation(), f.player.getPrivateArea());
    assert.ok(ground);
    assert.equal(ground.getItem().getAmount(), 100);
    assert.equal(f.player.getAttribute('death-plateau:harold-coins'), 0);
  });

  await t.test('cancelling input is free; leaving after Harold rolls forfeits once', async () => {
    const f = actor(1000);
    await f.talk();
    const stale = f.player.getEnteredAmountAction();
    f.player.getPacketSender().sendInterfaceRemoval();
    stale.execute(60);
    await f.send({ type: 'dialogue_amount', amount: 60 });
    assert.equal(f.coins(), 1000);
    assert.notEqual(f.player.getInterfaceId(), 99);
    await f.wager(60);
    f.player.getPacketSender().sendInterfaceRemoval();
    await f.click('roll_button');
    await f.click('continue_button');
    assert.equal(f.coins(), 940);
    assert.equal(f.player.getAttribute('death-plateau:harold-coins'), 160);
    assert.equal(f.player.getInventory().getAmount(I().IOU), 0);
  });

  await t.test('changing location or spending the stake during the preamble cannot debit it', async () => {
    const moved = actor(1000);
    await moved.talk();
    moved.player.setLocation(new core.Location(2903, 3539, 1));
    await moved.send({ type: 'dialogue_amount', amount: 60 });
    assert.equal(moved.coins(), 1000);
    assert.notEqual(moved.player.getInterfaceId(), 99);
    const spent = actor(1000);
    await spent.wager(60, false);
    spent.player.getInventory().deleteNumber(I().COINS, 1000);
    await spent.drain();
    assert.equal(spent.coins(), 0);
    assert.notEqual(spent.player.getInterfaceId(), 99);
    assert.equal(spent.player.getAttribute('death-plateau:harold-coins'), undefined);
  });

  await t.test('a stale pending IOU cannot reopen gambling before or after its quest stages', () => {
    for (const stage of [0, 40, 60, 80]) {
      const f = actor();
      quest.setStage(f.player, stage);
      f.player.setAttribute('death-plateau:harold-owes-iou', true);
      assert.notEqual(PluginManager.emitNpcDialogueVariant({ player: f.player, npcId: N().HAROLD }), 'finding-the-combination-finishing-a-gamble');
      PluginManager.emitCustomEvent('npc-dialogue:action', { player: f.player, npcId: N().HAROLD, step: { type: 'input' } });
      assert.ok(!f.player.getEnteredAmountAction());
      assert.equal(f.coins(), 2000);
    }
  });
});

test('fresh login sends stage 0 and the start hook advances to the canonical 10 wire value', () => {
  const { quest } = registered;
  const player = playerFixture();
  login(player);
  assert.deepEqual(lastConfig(player, VARP), { id: VARP, value: 0 });

  PluginManager.emitCustomEvent('npc-dialogue:hook', {
    player, npcId: N().DENULTH, hook: 'quest:death-plateau:start',
  });
  assert.equal(quest.getStage(player), 10);
  assert.deepEqual(lastConfig(player, VARP), { id: VARP, value: 10 });

  player.configs.length = 0;
  login(player);
  assert.deepEqual(lastConfig(player, VARP), { id: VARP, value: 10 }, 'login replays the durable stage');
});

test('the imported mUS50D hand-out replaces a lost IOU at the registered message edge', () => {
  // This handler-level assertion checks the once-only item handout edge; the
  // following test separately drives the imported transcript through the runner.
  const { quest } = registered;
  const player = playerFixture();
  quest.setStage(player, 55);

  const variant = PluginManager.emitNpcDialogueVariant({ player, npcId: N().HAROLD });
  assert.equal(variant, 'finding-the-combination-talking-to-harold-after-losing-the-iou');
  const message = { player, npcId: N().HAROLD, stepId: 'mUS50D', kind: 'message', handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:action', message);

  assert.equal(player.inventory.getAmount(I().IOU), 1, 'Harold writes another IOU');
  assert.equal(quest.getStage(player), 55, 'the recovery hand-out does not skip progress');

  const drunkPlayer = playerFixture();
  quest.setStage(drunkPlayer, 55);
  drunkPlayer.setAttribute('death-plateau:harold-drunk', true);
  assert.equal(
    PluginManager.emitNpcDialogueCondition({ player: drunkPlayer, npcId: N().HAROLD, text: 'If Harold is drunk:' }),
    true,
  );
  assert.equal(
    PluginManager.emitNpcDialogueCondition({ player: drunkPlayer, npcId: N().HAROLD, text: 'If Harold is not drunk:' }),
    false,
  );
});

test('the natural lost-IOU transcript hands out a replacement IOU once for sober and drunk states', () => {
  const { quest } = registered;
  for (const drunk of [false, true]) {
    const player = playerFixture();
    const lines = playLostIou(player, { drunk });

    assert.ok(lines.some((line) => line.text === (drunk ? '*hic*' : 'Hi.')), 'matching preamble');
    assert.ok(lines.some((line) => line.text === "I've lost the IOU you gave me."), 'lost-IOU line');
    assert.equal(player.inventory.getAmount(I().IOU), 1, 'one replacement IOU');
    assert.deepEqual(
      player.messages.filter((text) => text === 'Harold has given you an IOU scribbled on some paper.'),
      ['Harold has given you an IOU scribbled on some paper.'],
      'the unread branch runs exactly once',
    );
    assert.ok(!player.messages.some((text) => text.includes('which you know is the combination')), 'the read branch is not selected');
    assert.equal(quest.getStage(player), 55);
  }
});

test('the natural lost-IOU transcript hands out the combination once after the IOU was read', () => {
  const { quest } = registered;
  for (const drunk of [false, true]) {
    const player = playerFixture();
    const lines = playLostIou(player, { drunk, read: true });

    assert.ok(lines.some((line) => line.text === (drunk ? '*hic*' : 'Hi.')), 'matching preamble');
    assert.equal(player.inventory.getAmount(I().COMBINATION), 1, 'one combination');
    assert.equal(player.inventory.getAmount(I().IOU), 0, 'no replacement IOU');
    assert.deepEqual(
      player.messages.filter((text) => text === 'Harold has given you the IOU, which you know is the combination.'),
      ['Harold has given you the IOU, which you know is the combination.'],
      'the read branch runs exactly once',
    );
    assert.equal(quest.getStage(player), 60);
  }
});

test('the while-holding-IOU ale branch consumes the ale without rewinding progress', () => {
  const { quest } = registered;
  const player = playerFixture(inventoryFixture(new Map([[I().ASGARNIAN_ALE, 1], [I().IOU, 1]])));
  quest.setStage(player, 55);
  const variant = PluginManager.emitNpcDialogueVariant({ player, npcId: N().HAROLD });
  assert.equal(variant, 'finding-the-combination-talking-to-harold-while-still-holding-the-iou-if-harold-is-not-drunk');

  const message = { player, npcId: N().HAROLD, stepId: '7gOtrA', kind: 'message', handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:action', message);
  assert.equal(player.inventory.getAmount(I().ASGARNIAN_ALE), 0);
  assert.equal(quest.getStage(player), 55);
});

test('lost climbing boots after Tenzing use the canonical gUxInm recovery branch', () => {
  const { quest } = registered;
  const fresh = playerFixture();
  quest.setStage(fresh, 70);
  assert.equal(
    PluginManager.emitNpcDialogueVariant({ player: fresh, npcId: N().TENZING }),
    'new-route-up-death-plateau-talking-to-tenzing',
    'the first visit still uses the intro branch',
  );

  const player = playerFixture();
  quest.setStage(player, 72);
  const variant = PluginManager.emitNpcDialogueVariant({ player, npcId: N().TENZING });
  assert.equal(variant, 'new-route-up-death-plateau-talking-to-tenzing-without-climbing-or-spiked-boots');
  const lines = startVariant(player, N().TENZING, variant);

  assert.ok(lines.some((line) => line.text === "I've lost the climbing boots."));
  assert.equal(player.inventory.getAmount(I().CLIMBING_BOOTS), 1);
  assert.equal(quest.getStage(player), 72);
});

test('Dunstan replaces spiked boots lost before the Tenzing hand-in', () => {
  const { quest } = registered;
  const player = playerFixture(inventoryFixture(new Map([
    [I().CLIMBING_BOOTS, 1],
    [I().IRON_BAR, 1],
  ])));
  quest.setStage(player, 75);

  const variant = PluginManager.emitNpcDialogueVariant({ player, npcId: N().DUNSTAN });
  assert.equal(variant, 'new-route-up-death-plateau-talking-to-dunstan-before-getting-the-spiked-boots');
  const message = { player, npcId: N().DUNSTAN, stepId: '1TFYaK', kind: 'message', handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:action', message);

  assert.equal(player.inventory.getAmount(I().SPIKED_BOOTS), 1);
  assert.equal(player.inventory.getAmount(I().CLIMBING_BOOTS), 0);
  assert.equal(player.inventory.getAmount(I().IRON_BAR), 0);
  assert.equal(quest.getStage(player), 75);
});

test('Denulth does not reissue the certificate after it was handed to Dunstan', () => {
  const { quest } = registered;
  const player = playerFixture();
  quest.setStage(player, 73);
  player.setAttribute('death-plateau:certificate-delivered', true);

  const variant = PluginManager.emitNpcDialogueVariant({ player, npcId: N().DENULTH });
  assert.equal(variant, 'new-route-up-death-plateau-talking-to-denulth-after-opening-the-equipment-room');
  const message = { player, npcId: N().DENULTH, stepId: 'KZG0PG', kind: 'message', handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:action', message);
  assert.equal(player.inventory.getAmount(I().CERTIFICATE_2), 0, 'no duplicate certificate');
});

test('Denulth uses the imported lost-certificate branch for a genuine replacement', () => {
  const { quest } = registered;
  const player = playerFixture();
  quest.setStage(player, 73);

  const firstIssue = PluginManager.emitNpcDialogueVariant({ player, npcId: N().DENULTH });
  assert.equal(firstIssue, 'new-route-up-death-plateau-talking-to-denulth-after-talking-to-dunstan');
  PluginManager.emitCustomEvent('npc-dialogue:action', {
    player, npcId: N().DENULTH, stepId: 'KZG0PG', kind: 'message', handled: false,
  });
  assert.equal(player.inventory.getAmount(I().CERTIFICATE_2), 1);
  player.inventory.deleteNumber(I().CERTIFICATE_2, 1);

  const recovery = PluginManager.emitNpcDialogueVariant({ player, npcId: N().DENULTH });
  assert.equal(recovery, 'new-route-up-death-plateau-talking-to-denulth-after-losing-the-certificate');
  startVariant(player, N().DENULTH, recovery);
  assert.equal(player.inventory.getAmount(I().CERTIFICATE_2), 1, 'the canonical VuuQKK branch restores one certificate');
  assert.equal(quest.getStage(player), 73);
});

test('a full bag does not mark a certificate issued, and the first-issue branch retries after room opens', () => {
  const { quest } = registered;
  assert.equal(registered.persistedAttributes.get('death-plateau:certificate-issued'), false, 'a new player defaults to not issued');
  const player = playerFixture();
  const inventory = new Inventory(player);
  player.setInventory(inventory);
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new Item(I().SANDSTONE_1KG_, 1));
  assert.equal(inventory.getFreeSlots(), 0, 'the real 28-slot container is full');
  quest.setStage(player, 73);

  const firstIssue = 'new-route-up-death-plateau-talking-to-denulth-after-talking-to-dunstan';
  assert.equal(PluginManager.emitNpcDialogueVariant({ player, npcId: N().DENULTH }), firstIssue);
  assert.equal(player.getAttribute('death-plateau:certificate-issued'), undefined);
  startVariant(player, N().DENULTH, firstIssue);
  assert.equal(inventory.getAmount(I().CERTIFICATE_2), 0, 'the failed add leaves the full inventory unchanged');
  assert.equal(player.getAttribute('death-plateau:certificate-issued'), undefined, 'a failed add does not record an issue');
  assert.ok(!player.messages.includes('Denulth has given you a certificate.'), 'the canonical receipt message is suppressed when the add fails');
  assert.ok(player.messages.includes("You couldn't hold all those items."));

  assert.equal(PluginManager.emitNpcDialogueVariant({ player, npcId: N().DENULTH }), firstIssue, 'retry stays on the genuine first-issue variant');
  inventory.deleteAtSlot(1);
  assert.equal(inventory.getFreeSlots(), 1);
  startVariant(player, N().DENULTH, firstIssue);
  assert.equal(inventory.getAmount(I().CERTIFICATE_2), 1, 'the certificate is delivered when the slot is free');
  assert.equal(player.getAttribute('death-plateau:certificate-issued'), true);
  assert.ok(player.messages.includes('Denulth has given you a certificate.'), 'the receipt is shown after the item is actually delivered');

  inventory.deleteNumber(I().CERTIFICATE_2, 1);
  assert.equal(
    PluginManager.emitNpcDialogueVariant({ player, npcId: N().DENULTH }),
    'new-route-up-death-plateau-talking-to-denulth-after-losing-the-certificate',
    'only a certificate actually received can later be reported lost',
  );
});

test('the imported after-losing-the-map messages restore the map without re-taking supplies', () => {
  const { quest } = registered;
  const player = playerFixture();
  quest.setStage(player, 77);
  player.setAttribute('death-plateau:map-received', true);

  const variant = PluginManager.emitNpcDialogueVariant({ player, npcId: N().TENZING });
  assert.equal(variant, 'new-route-up-death-plateau-talking-to-tenzing-after-losing-the-map');
  startVariant(player, N().TENZING, variant);

  assert.equal(player.inventory.getAmount(I().SECRET_WAY_MAP), 1);
  assert.equal(player.inventory.getAmount(I().SPIKED_BOOTS), 0);
  assert.equal(player.inventory.getAmount(I().BREAD), 0);
  assert.equal(player.inventory.getAmount(I().TROUT), 0);
  assert.equal(quest.getStage(player), 77);
});

test('the final Denulth hand-in completes on the canonical varp 314 value and rewards once', () => {
  const { quest } = registered;
  const player = playerFixture();
  quest.setStage(player, 78);
  player.setAttribute('death-plateau:map-delivered', true);
  player.setAttribute('death-plateau:combination-delivered', true);

  const variant = PluginManager.emitNpcDialogueVariant({ player, npcId: N().DENULTH });
  assert.equal(variant, 'finishing-up-talking-to-denulth-after-opening-the-equipment-room-and-exploring-the-path');
  startVariant(player, N().DENULTH, variant);

  assert.equal(quest.getStage(player), 80);
  assert.deepEqual(lastConfig(player, VARP), { id: VARP, value: 80 });
  assert.deepEqual(player.xp, [{ skill: core.Skill.ATTACK.getIndex(), amount: 3000 }]);
  assert.equal(player.inventory.getAmount(I().STEEL_CLAWS), 1);

  startVariant(player, N().DENULTH, variant);
  assert.equal(player.xp.length, 1, 'repeat hand-in awards no second XP');
  assert.equal(player.inventory.getAmount(I().STEEL_CLAWS), 1, 'repeat hand-in awards no second claws');
  assert.equal(quest.getStage(player), 80);

  player.configs.length = 0;
  login(player);
  assert.deepEqual(lastConfig(player, VARP), { id: VARP, value: 80 }, 'completion persists through login');
});
