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
    getUsername: () => 'qh728-q017',
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

    assert.ok(lines.some((line) => line.text === (drunk ? 'hic*' : 'Hi.')), 'matching preamble');
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

    assert.ok(lines.some((line) => line.text === (drunk ? 'hic*' : 'Hi.')), 'matching preamble');
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
