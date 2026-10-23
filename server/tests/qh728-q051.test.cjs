// The Grand Tree (q051) source-contract checks.
// From server/: node --test tests/qh728-q051.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const N = core.NpcIdentifiers;

const NARNODE = N.KING_NARNODE_SHAREEN;
const HAZELMERE = N.HAZELMERE;
const GLOUGH = N.GLOUGH;
const CHARLIE = N.CHARLIE;
const ANITA = N.ANITA;
const FOREMAN = N.FOREMAN;
const WORKER = N.SHIPYARD_WORKER;
const ERRDO = N.CAPTAIN_ERRDO;
const FEMI = N.FEMI;
const TRAPDOOR = 2444;
const TWIG_PILLARS = [
  [O.PILLAR_2, I.TWIGS],
  [O.PILLAR_3, I.TWIGS_2],
  [O.PILLAR_4, I.TWIGS_3],
  [O.PILLAR_5, I.TWIGS_4],
];

function inventoryFixture(initial = new Map(), free = 28) {
  const items = new Map(initial);
  let freeSlots = free;
  return {
    items,
    getAmount: (id) => items.get(id) ?? 0,
    isFull: () => freeSlots <= 0,
    getFreeSlots: () => freeSlots,
    adds(id, amount = 1) {
      if (id === I.COINS) {
        items.set(id, (items.get(id) ?? 0) + amount);
        return;
      }
      for (let placed = 0; placed < amount; placed++) {
        if (freeSlots <= 0) return;
        freeSlots--;
        items.set(id, (items.get(id) ?? 0) + 1);
      }
    },
    deleteNumber(id, amount = 1) {
      const current = items.get(id) ?? 0;
      const removed = Math.min(current, amount);
      const left = current - removed;
      if (left === 0) items.delete(id);
      else items.set(id, left);
      if (id !== I.COINS) freeSlots += removed;
    },
  };
}

function playerFixture(inventory = inventoryFixture(), start = { x: 2466, y: 3495, z: 0 }, agility = 99) {
  const attributes = new Map();
  const messages = [];
  const sent = [];
  const xp = [];
  let location = new core.Location(start.x, start.y, start.z);
  const sender = new Proxy({}, {
    get(_target, property) {
      if (property === 'sendConfig') return (id, value) => sent.push({ id, value });
      if (property === 'sendVarbit') return (id, value) => sent.push({ id, value, varbit: true });
      return () => sender;
    },
  });
  return {
    inventory,
    messages,
    sent,
    xp,
    getUsername: () => 'qh728-q051',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getSkillManager: () => ({
      getCombatLevel: () => 99,
      getMaxLevel: (skill) => skill.getIndex() === core.Skill.AGILITY.getIndex() ? agility : 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getLocation: () => location,
    moveTo: (next) => { location = next; },
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
  };
}

function registerPlugin() {
  const before = {
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
  };
  const pluginName = 'GrandTree728Test';
  const objectHooks = [];
  const itemOnObjectHooks = [];
  const npcDeathHooks = [];
  const spawned = [];
  const customEvents = new Set();
  const api = new Proxy({ core }, {
    get(target, key) {
      if (key in target) return target[key];
      switch (key) {
        case 'persistAttribute': return () => {};
        case 'onNpcDialogueVariant': return (handler) => PluginManager.npcDialogueVariantHooks.push({ pluginName, handler });
        case 'onNpcDialogueCondition': return (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName, handler });
        case 'onObjectInteraction': return (names, actions) => objectHooks.push({ names, actions });
        case 'onItemOnObject': return (handler) => itemOnObjectHooks.push(handler);
        case 'onNpcDeath': return (handler) => npcDeathHooks.push(handler);
        case 'onPlayerLogin': return (handler) => PluginManager.loginHooks.push({ pluginName, handler });
        case 'onPlayerLogout': return (handler) => PluginManager.logoutHooks.push({ pluginName, handler });
        case 'onCustomEvent': return (name, handler) => {
          customEvents.add(name);
          const hooks = PluginManager.customEventHooks.get(name) ?? [];
          hooks.push({ pluginName, handler });
          PluginManager.customEventHooks.set(name, hooks);
        };
        case 'emitCustomEvent': return (name, payload) => PluginManager.emitCustomEvent(name, payload);
        case 'spawnNpc': return (def) => {
          const npc = {
            def,
            getId: () => def.id,
            getLocation: () => new core.Location(def.x, def.y, def.z),
            isRegistered: () => true,
          };
          spawned.push(npc);
          return npc;
        };
        case 'removeNpc': return () => {};
        default: return () => {};
      }
    },
  });
  require('../plugins/quests/quests/GrandTree.Quest')(api);
  const quest = getRegisteredQuests().findLast((entry) => entry.key === 'grand_tree');
  return {
    quest,
    spawned,
    itemOnObjectHooks,
    cleanup() {
      PluginManager.npcDialogueVariantHooks.length = before.variant;
      PluginManager.npcDialogueConditionHooks.length = before.condition;
      // QuestRuntime's own login/bootstrap resend registers once for the module;
      // leave the login hooks in place so later tests still observe the wire.
      for (const name of customEvents) {
        const kept = (PluginManager.customEventHooks.get(name) ?? [])
          .filter((hook) => hook.pluginName !== pluginName);
        if (kept.length) PluginManager.customEventHooks.set(name, kept);
        else PluginManager.customEventHooks.delete(name);
      }
    },
    objectOption(player, objectId, objectName, option, extra = {}) {
      const registration = objectHooks.find((entry) => entry.names === objectName);
      assert.ok(registration, `${objectName} has an object registration`);
      const action = registration.actions[option];
      assert.ok(action, `${objectName} registers ${option}`);
      const event = {
        player,
        objectId,
        object: {},
        definition: { getName: () => objectName, getActions: () => [option] },
        handled: false,
        ...extra,
      };
      if (action(event) !== false) event.handled = true;
      return event;
    },
    itemOnObject(player, itemId, objectId, objectName) {
      const event = { player, itemId, objectId, object: {}, definition: { getName: () => objectName }, handled: false };
      for (const handler of itemOnObjectHooks) handler(event);
      return event;
    },
    npcDeath(player, npcId, npc) {
      const event = { killer: player, npcId, npc };
      for (const handler of npcDeathHooks) handler(event);
    },
  };
}

const emit = (name, payload) => PluginManager.emitCustomEvent(name, payload);
const start = (player) => emit('npc-dialogue:hook', { player, npcId: NARNODE, hook: 'quest:the-grand-tree:start' });
const action = (player, npcId, stepId, extra = {}) => {
  const event = { player, npcId, stepId, handled: false, ...extra };
  emit('npc-dialogue:action', event);
  return event;
};
const message = (player, npcId, stepId) => {
  const event = { player, npcId, stepId, kind: 'message', handled: false };
  emit('npc-dialogue:action', event);
  return event;
};
const line = (player, npcId, text) => {
  const event = { player, npcId, text, handled: false };
  emit('npc-dialogue:line', event);
  return event;
};
const choice = (player, npcId, option) => emit('npc-dialogue:choice', { player, npcId, option });
const variant = (player, npcId, npc) => PluginManager.emitNpcDialogueVariant({ player, npcId, npc });
const condition = (player, npcId, text) =>
  PluginManager.emitNpcDialogueCondition({ player, npcId, text });

test('fresh stage 0: early shared-NPC actions cannot skip the mandatory route', () => {
  const plugin = registerPlugin();
  try {
    const player = playerFixture();
    assert.equal(plugin.quest.getStage(player), 0);

    action(player, HAZELMERE, '2lKQYT');
    assert.equal(plugin.quest.getStage(player), 0, 'Hazelmere does not start the quest');
    assert.equal(player.inventory.getAmount(I.HAZELMERES_SCROLL), 0);

    line(player, GLOUGH, "Your type can't be trusted! I'll take care of this! Go back to the King.");
    assert.equal(plugin.quest.getStage(player), 0, 'Glough does not advance an unstarted quest');

    line(player, CHARLIE, 'Good luck!');
    assert.equal(plugin.quest.getStage(player), 0, 'Charlie does not advance an unstarted quest');

    action(player, FOREMAN, 'TXgXt3');
    assert.equal(plugin.quest.getStage(player), 0, 'the Foreman does not hand over the order early');
    assert.equal(player.inventory.getAmount(I.LUMBER_ORDER), 0);

    action(player, ANITA, 'XNT7yS');
    assert.equal(player.inventory.getAmount(I.GLOUGHS_KEY), 0, 'Anita does not give the key early');

    const before = player.getLocation();
    action(player, WORKER, 'CDM9ud');
    assert.deepEqual(
      { x: player.getLocation().getX(), y: player.getLocation().getY() },
      { x: before.getX(), y: before.getY() },
      'the shipyard password does not move an unstarted player'
    );
    action(player, FEMI, '6QWAFm');
    assert.deepEqual(
      { x: player.getLocation().getX(), y: player.getLocation().getY() },
      { x: before.getX(), y: before.getY() },
      'Femi does not sneak an unstarted player inside'
    );
  } finally {
    plugin.cleanup();
  }
});

test('quest start enforces 25 Agility without granting supplies on refusal', () => {
  const plugin = registerPlugin();
  try {
    const player = playerFixture(undefined, undefined, 24);
    start(player);
    assert.equal(plugin.quest.getStage(player), 0);
    assert.equal(player.inventory.getAmount(I.BARK_SAMPLE), 0);
    assert.equal(player.inventory.getAmount(I.TRANSLATION_BOOK), 0);
    assert.ok(player.messages.some(message => /25 Agility/.test(message)));
  } finally {
    plugin.cleanup();
  }
});

test('fresh stage 0 completes the mandatory route through registered handlers and the canonical varp', () => {
  const plugin = registerPlugin();
  try {
    const { quest } = plugin;
    const player = playerFixture();

    assert.equal(quest.varpId, 150, 'cache reader script 4024 reads varp 150');
    assert.equal(quest.completionValue, 160, 'cache quest row 66 completion threshold is 160');

    start(player);
    assert.equal(quest.getStage(player), 10);
    assert.equal(player.inventory.getAmount(I.BARK_SAMPLE), 1);
    assert.equal(player.inventory.getAmount(I.TRANSLATION_BOOK), 1);

    assert.equal(variant(player, HAZELMERE).variant, 'hazelmere-s-island');
    action(player, HAZELMERE, '2lKQYT');
    assert.equal(quest.getStage(player), 20);
    assert.equal(player.inventory.getAmount(I.BARK_SAMPLE), 0);
    assert.equal(player.inventory.getAmount(I.HAZELMERES_SCROLL), 1);

    assert.equal(variant(player, NARNODE).variant, 'a-deadly-plot-bring-back-the-news');
    line(player, NARNODE, "OK! I'll be back soon.");
    assert.equal(quest.getStage(player), 30);

    assert.equal(variant(player, GLOUGH).variant, 'human-sabotage-glough');
    line(player, GLOUGH, "Your type can't be trusted! I'll take care of this! Go back to the King.");
    assert.equal(quest.getStage(player), 40);

    assert.equal(variant(player, NARNODE).variant, 'human-sabotage-reporting-to-the-king');
    line(player, NARNODE, "Certainly. He's on the top level of the tree. Be careful, it's a long way down!");
    assert.equal(quest.getStage(player), 50);

    assert.equal(variant(player, CHARLIE).variant, 'human-sabotage-interrogating-the-prisoner');
    line(player, CHARLIE, 'Good luck!');
    assert.equal(quest.getStage(player), 60);

    plugin.objectOption(player, O.CUPBOARD_14, 'Cupboard', 'Open');
    assert.equal(quest.getStage(player), 70);
    assert.equal(player.inventory.getAmount(I.GLOUGHS_JOURNAL), 1);

    assert.equal(variant(player, GLOUGH).variant, 'searching-glough-s-cupboard-suspicions');
    action(player, GLOUGH, 'pkr5F6');
    assert.deepEqual(
      { x: player.getLocation().getX(), y: player.getLocation().getY(), z: player.getLocation().getZ() },
      { x: 2464, y: 3495, z: 3 },
      'Glough arrests the player into Charlie’s cell'
    );

    assert.equal(variant(player, CHARLIE).variant, 'searching-glough-s-cupboard-imprisoned');
    action(player, CHARLIE, 'GdAMEV');
    assert.equal(quest.getStage(player), 80);
    assert.deepEqual(
      { x: player.getLocation().getX(), y: player.getLocation().getY(), z: player.getLocation().getZ() },
      { x: 2467, y: 3500, z: 3 },
      'the King releases the player from the cell'
    );
    assert.equal(
      variant(player, NARNODE).variant,
      'searching-glough-s-cupboard-imprisoned-when-speaking-to-king-narnode-again',
      'the released King points to the glider instead of replaying the cell'
    );

    const errdo = { getLocation: () => new core.Location(2466, 3495, 3) };
    assert.equal(variant(player, ERRDO, errdo).variant, 'searching-glough-s-cupboard-imprisoned-fleeing-the-grand-tree');
    message(player, ERRDO, 'ucBYLo');
    assert.deepEqual(
      { x: player.getLocation().getX(), y: player.getLocation().getY() },
      { x: 2924, y: 3055 },
      'the glider lands at the Karamja crash site'
    );

    assert.equal(variant(player, FOREMAN).variant, 'treachery-revealed-the-shipyard-foreman');
    action(player, FOREMAN, 'TXgXt3');
    assert.equal(quest.getStage(player), 90);
    assert.equal(player.inventory.getAmount(I.LUMBER_ORDER), 1);
    assert.equal(variant(player, NARNODE).variant, 'treachery-revealed-when-speaking-to-king-narnode');

    assert.equal(variant(player, CHARLIE).variant, 'treachery-revealed-charlie');
    line(player, CHARLIE, "Okay, I'll see what I can find.");
    assert.equal(quest.getStage(player), 100);
    assert.equal(player.inventory.getAmount(I.LUMBER_ORDER), 0, 'Charlie consumes the delivered lumber order');

    assert.equal(variant(player, ANITA).variant, 'treachery-revealed-anita');
    action(player, ANITA, 'XNT7yS');
    assert.equal(player.inventory.getAmount(I.GLOUGHS_KEY), 1);

    plugin.itemOnObject(player, I.GLOUGHS_KEY, O.CLOSED_CHEST_9, 'Closed chest');
    assert.equal(quest.getStage(player), 110);
    assert.equal(player.inventory.getAmount(I.GLOUGHS_KEY), 0);
    assert.equal(player.inventory.getAmount(I.INVASION_PLANS), 1);

    assert.equal(variant(player, NARNODE).variant, 'treachery-revealed-glough-s-plans-talking-to-king-narnode-shareen');
    action(player, NARNODE, 'QV47Iy');
    assert.equal(quest.getStage(player), 120);
    assert.equal(player.inventory.getAmount(I.INVASION_PLANS), 0, 'Narnode consumes the delivered invasion plans');
    for (const twig of Object.values({ T: I.TWIGS, U: I.TWIGS_2, Z: I.TWIGS_3, O: I.TWIGS_4 })) {
      assert.equal(player.inventory.getAmount(twig), 1, 'all four twigs are granted');
    }

    for (const [pillar, twig] of TWIG_PILLARS) {
      plugin.itemOnObject(player, twig, pillar, 'Pillar');
    }
    assert.equal(quest.getStage(player), 130);

    plugin.objectOption(player, TRAPDOOR, 'Trapdoor', 'Climb-down');
    assert.deepEqual(
      { x: player.getLocation().getX(), y: player.getLocation().getY(), z: player.getLocation().getZ() },
      { x: 2491, y: 9861, z: 0 }
    );
    const demon = plugin.spawned.at(-1);
    assert.ok(demon, 'the black demon spawns under the trapdoor');
    plugin.npcDeath(player, N.BLACK_DEMON_2, demon);
    assert.equal(quest.getStage(player), 140);

    assert.equal(variant(player, NARNODE).variant, 'saving-the-tree-the-end-of-the-tunnel');
    line(player, NARNODE, 'A reward will have to wait though, the tree is still dying!');
    assert.equal(quest.getStage(player), 150);

    plugin.objectOption(player, O.ROOT, 'Root', 'Search');
    plugin.objectOption(player, O.ROOT, 'Root', 'Search');
    assert.equal(player.inventory.getAmount(I.DACONIA_ROCK), 1);

    assert.equal(variant(player, NARNODE).variant, 'saving-the-tree-daconia-delivered');
    action(player, NARNODE, 'PJWrB9');
    assert.equal(quest.getStage(player), 160);
    assert.equal(quest.isComplete(player), true);
    assert.equal(player.inventory.getAmount(I.DACONIA_ROCK), 0);
    assert.deepEqual(player.xp, [
      { skill: core.Skill.ATTACK, amount: 18400 },
      { skill: core.Skill.AGILITY, amount: 7900 },
      { skill: core.Skill.MAGIC, amount: 2150 },
    ]);

    player.sent.length = 0;
    PluginManager.emitPlayerLogin({ player });
    assert.ok(
      player.sent.some((entry) => entry.id === 150 && entry.value === 160 && !entry.varbit),
      'login/bootstrap resends stage 160 on varp 150'
    );

    action(player, NARNODE, 'PJWrB9');
    assert.equal(player.xp.length, 3, 'completion cannot reward twice');
    assert.equal(variant(player, NARNODE), null, 'the completed quest defers King Narnode');
  } finally {
    plugin.cleanup();
  }
});

test('the cell release line advances even though it is typed on Charlie', () => {
  const plugin = registerPlugin();
  try {
    const player = playerFixture();
    plugin.quest.setStage(player, 70);
    line(player, CHARLIE, "I'm sorry again Traveller!");
    assert.equal(plugin.quest.getStage(player), 80, 'the King’s closing line releases the player');
  } finally {
    plugin.cleanup();
  }
});

test('stage 120 twigs recovery selects the replacement branch and tops up partial sets', () => {
  const plugin = registerPlugin();
  try {
    const player = playerFixture();
    plugin.quest.setStage(player, 120);

    assert.equal(
      variant(player, NARNODE).variant,
      'treachery-revealed-glough-s-plans-when-speaking-to-king-narnode-again'
    );
    assert.equal(condition(player, NARNODE, 'If the player has lost the twigs:'), true);
    action(player, NARNODE, 'xC2-c6');
    for (const [, twig] of TWIG_PILLARS) assert.equal(player.inventory.getAmount(twig), 1);
    assert.equal(plugin.quest.getStage(player), 120);

    const partial = playerFixture(inventoryFixture(new Map([
      [I.TWIGS, 1],
      [I.TWIGS_2, 1],
    ])));
    plugin.quest.setStage(partial, 120);
    assert.equal(condition(partial, NARNODE, 'If the player has lost the twigs:'), true);
    action(partial, NARNODE, 'xC2-c6');
    for (const [, twig] of TWIG_PILLARS) assert.equal(partial.inventory.getAmount(twig), 1);

    plugin.quest.setStage(partial, 130);
    assert.equal(
      variant(partial, NARNODE).variant,
      'treachery-revealed-glough-s-pet-when-talking-to-king-narnode-without-finishing-the-fight'
    );
  } finally {
    plugin.cleanup();
  }
});

test('Narnode keeps plans and stage retryable when the bag cannot hold the twig set', () => {
  const plugin = registerPlugin();
  try {
    const player = playerFixture(inventoryFixture(new Map([
      [I.INVASION_PLANS, 1],
      [I.BONES, 27],
    ]), 0));
    plugin.quest.setStage(player, 110);
    action(player, NARNODE, 'QV47Iy');
    assert.equal(plugin.quest.getStage(player), 110);
    assert.equal(player.inventory.getAmount(I.INVASION_PLANS), 1);
    assert.ok(player.messages.some(message => /free inventory slots/.test(message)));

    player.inventory.deleteNumber(I.BONES, 4);
    action(player, NARNODE, 'QV47Iy');
    assert.equal(plugin.quest.getStage(player), 120);
    assert.equal(player.inventory.getAmount(I.INVASION_PLANS), 0);
    for (const twig of [I.TWIGS, I.TWIGS_2, I.TWIGS_3, I.TWIGS_4]) {
      assert.equal(player.inventory.getAmount(twig), 1);
    }
  } finally {
    plugin.cleanup();
  }
});

test('full-bag recovery keeps mandatory items obtainable', () => {
  const plugin = registerPlugin();
  try {
    const filler = new Map([[I.BONES, 28]]);
    const player = playerFixture(inventoryFixture(filler, 0));
    plugin.quest.setStage(player, 60);

    plugin.objectOption(player, O.CUPBOARD_14, 'Cupboard', 'Open');
    assert.equal(plugin.quest.getStage(player), 60, 'a full bag does not consume the journal stage');
    assert.equal(player.inventory.getAmount(I.GLOUGHS_JOURNAL), 0);
    assert.ok(player.messages.some((m) => m.includes('inventory space')));
    player.inventory.deleteNumber(I.BONES, 1);
    plugin.objectOption(player, O.CUPBOARD_14, 'Cupboard', 'Open');
    assert.equal(plugin.quest.getStage(player), 70);
    assert.equal(player.inventory.getAmount(I.GLOUGHS_JOURNAL), 1);

    const openCupboard = playerFixture();
    plugin.quest.setStage(openCupboard, 60);
    plugin.objectOption(openCupboard, O.CUPBOARD_15, 'Cupboard', 'Search');
    assert.equal(plugin.quest.getStage(openCupboard), 70, 'the open cupboard is an accepted alternate object');
    assert.equal(openCupboard.inventory.getAmount(I.GLOUGHS_JOURNAL), 1);

    const fullForeman = playerFixture(inventoryFixture(new Map([[I.BONES, 28]]), 0));
    plugin.quest.setStage(fullForeman, 80);
    action(fullForeman, FOREMAN, 'TXgXt3');
    assert.equal(plugin.quest.getStage(fullForeman), 80, 'no lumber order stage without the item');
    assert.equal(fullForeman.inventory.getAmount(I.LUMBER_ORDER), 0);
    fullForeman.inventory.deleteNumber(I.BONES, 1);
    action(fullForeman, FOREMAN, 'TXgXt3');
    assert.equal(plugin.quest.getStage(fullForeman), 90);
    assert.equal(fullForeman.inventory.getAmount(I.LUMBER_ORDER), 1);

    const lostPlans = playerFixture();
    plugin.quest.setStage(lostPlans, 110);
    plugin.objectOption(lostPlans, O.CLOSED_CHEST_9, 'Closed chest', 'Open');
    assert.equal(lostPlans.inventory.getAmount(I.INVASION_PLANS), 1, 'an opened chest re-issues lost plans');

    const fullRoot = playerFixture(inventoryFixture(new Map([[I.BONES, 28]]), 0));
    plugin.quest.setStage(fullRoot, 150);
    plugin.objectOption(fullRoot, O.ROOT, 'Root', 'Search');
    plugin.objectOption(fullRoot, O.ROOT, 'Root', 'Search');
    assert.equal(fullRoot.inventory.getAmount(I.DACONIA_ROCK), 0, 'no rock without a free slot');
    fullRoot.inventory.deleteNumber(I.BONES, 1);
    plugin.objectOption(fullRoot, O.ROOT, 'Root', 'Search');
    assert.equal(fullRoot.inventory.getAmount(I.DACONIA_ROCK), 1);
  } finally {
    plugin.cleanup();
  }
});

test('Femi sneaks the released player inside and takes 1000 coins only for the paid branch', () => {
  const plugin = registerPlugin();
  try {
    const newcomer = playerFixture();
    assert.equal(variant(newcomer, FEMI).page, 'Femi', 'the first-visit variant belongs to Femi\'s own page');
    assert.equal(variant(newcomer, FEMI).variant,
      'attemping-to-enter-the-tree-gnome-stronghold-for-the-first-time',
      'the first conversation offers the canonical box-help choice');
    action(newcomer, FEMI, 'CWsctI');
    plugin.quest.setStage(newcomer, 80);
    assert.equal(variant(newcomer, FEMI).variant,
      'treachery-revealed-sneaking-around-when-talking-to-femi-if-you-helped-her',
      'the persisted help action, not an unrelated quest completion, selects the helped branch');

    const player = playerFixture();
    plugin.quest.setStage(player, 80);
    assert.equal(
      variant(player, FEMI).variant,
      'treachery-revealed-sneaking-around-when-talking-to-femi-if-you-didn-t-help-her'
    );

    action(player, FEMI, 'Op5eXj');
    assert.equal(player.getLocation().getX(), 2466, 'without coins Femi does not move the player');
    assert.ok(player.messages.some((m) => m.includes('1000 coins')));

    player.inventory.adds(I.COINS, 1200);
    action(player, FEMI, 'Op5eXj');
    assert.equal(player.inventory.getAmount(I.COINS), 200, 'the paid sneak consumes 1000 coins');
    assert.deepEqual(
      { x: player.getLocation().getX(), y: player.getLocation().getY() },
      { x: 2466, y: 3495 }
    );

    const helped = playerFixture();
    plugin.quest.setStage(helped, 80);
    assert.equal(variant(helped, FEMI).variant,
      'treachery-revealed-sneaking-around-when-talking-to-femi-if-you-didn-t-help-her');
    action(helped, FEMI, '6QWAFm');
    assert.deepEqual(
      { x: helped.getLocation().getX(), y: helped.getLocation().getY() },
      { x: 2466, y: 3495 }
    );

    plugin.quest.setStage(player, 90);
    assert.equal(variant(player, FEMI).variant, 'treachery-revealed-sneaking-around-when-talking-to-femi-again');
    plugin.quest.setStage(player, 100);
    assert.equal(variant(player, FEMI), null, 'Femi is released after the Charlie clue');
  } finally {
    plugin.cleanup();
  }
});

test('shared NPCs are deferred outside their Grand Tree stage window', () => {
  const plugin = registerPlugin();
  try {
    const player = playerFixture();
    plugin.quest.setStage(player, 0);
    assert.equal(variant(player, HAZELMERE), null);
    assert.equal(variant(player, GLOUGH), null);
    assert.equal(variant(player, ANITA), null);
    assert.equal(variant(player, FOREMAN), null);
    assert.equal(variant(player, WORKER), null);
    assert.equal(variant(player, ERRDO), null);
    assert.equal(variant(player, FEMI).variant,
      'attemping-to-enter-the-tree-gnome-stronghold-for-the-first-time');
    assert.equal(variant(player, CHARLIE), null);

    plugin.quest.setStage(player, 160);
    assert.equal(variant(player, HAZELMERE), null);
    assert.equal(variant(player, ANITA), null);
    assert.equal(variant(player, FOREMAN), null);
    assert.equal(variant(player, WORKER), null);
    assert.equal(variant(player, ERRDO), null);
    assert.equal(variant(player, FEMI), null);
    assert.equal(variant(player, CHARLIE).variant, 'treachery-revealed-glough-s-plans-talking-to-charlie');
    assert.equal(variant(player, NARNODE), null);
    assert.equal(variant(player, GLOUGH).variant, 'post-quest-glough');
  } finally {
    plugin.cleanup();
  }
});

test('shipyard password passes only on the correct Ka.Lu.Min. picks', () => {
  const plugin = registerPlugin();
  try {
    const player = playerFixture();
    plugin.quest.setStage(player, 80);
    choice(player, WORKER, 'Ka.');
    choice(player, WORKER, 'Lu.');
    choice(player, WORKER, 'Min.');
    action(player, WORKER, 'CDM9ud', { npc: { getLocation: () => new core.Location(2945, 3041, 0) } });
    assert.deepEqual(
      { x: player.getLocation().getX(), y: player.getLocation().getY() },
      { x: 2947, y: 3042 }
    );

    const wrong = playerFixture();
    plugin.quest.setStage(wrong, 80);
    choice(wrong, WORKER, 'Ko.');
    choice(wrong, WORKER, 'Le.');
    choice(wrong, WORKER, 'Men.');
    action(wrong, WORKER, 'CDM9ud', { npc: { getLocation: () => new core.Location(2945, 3041, 0) } });
    assert.equal(wrong.getLocation().getX(), 2466, 'a wrong password does not open the gate');
    assert.equal(plugin.spawned.at(-1).def.id, 5457, 'a wrong password spawns the angry worker');
  } finally {
    plugin.cleanup();
  }
});
