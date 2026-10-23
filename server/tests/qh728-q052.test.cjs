// The Great Brain Robbery (q052) registered-dispatch contract.
// From server/: node --test tests/qh728-q052.test.cjs
//
// Fixture start: fresh stage 0. Every stage below is reached by dispatching the
// registered NPC/object/item/dialogue handlers and the transcript's own condition
// and action ids; only travel, combat damage and supplies are fixture-set. This
// proves the handler graph, not a live playthrough or the Quest Helper overlay.
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
const core = PluginManager.getCoreApi();

const transcripts = [];
runtime.startTranscript = (_api, _player, npcId, page, variant, select) => {
  transcripts.push({ npcId, page, variant, select });
  return true;
};

function setup({ mockRescueStatus = true, registerRecipeForDisaster = false } = {}) {
  transcripts.length = 0;
  const custom = new Map();
  let piratePeteRescueComplete = true;
  const npcHandlers = [];
  const npcDeathHandlers = [];
  const objectHandlers = [];
  const routeHandlers = [];
  const itemOnObjectHandlers = [];
  const itemOnItemHandlers = [];
  const itemActions = new Map();
  const groundHandlers = [];
  const conditionAnswerHandlers = [];
  const zoneHandlers = [];
  const objects = [];
  const dropped = [];
  const spawned = [];
  const loginHandlers = [];
  const logoutHandlers = [];
  const completedQuests = new Set(['creature_of_fenkenstrain', 'cabin_fever']);
  const messages = [];
  let lastXpReward = null;
  const varbits = new Map();
  const configs = new Map();

  const questCore = {
    ...core,
    ObjectManager: {
      objectsAt: (tile) => objects.filter((o) => {
        const at = o.getLocation();
        return at.getX() === tile.getX() && at.getY() === tile.getY() && at.getZ() === tile.getZ();
      }),
      exists: (id, tile) => objects.some((o) => {
        const at = o.getLocation();
        return o.getId() === id && at.getX() === tile.getX() && at.getY() === tile.getY() && at.getZ() === tile.getZ();
      }),
      register: (object) => objects.push(object),
      deregister: (object) => {
        const index = objects.indexOf(object);
        if (index >= 0) objects.splice(index, 1);
      },
    },
    RegionManager: { blocked: () => false },
  };

  const api = new Proxy({
    core: questCore,
    persistAttribute() {},
    spawnNpc(definition) {
      const npc = { id: definition.id, definition, removed: false };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) {
      npc.removed = true;
    },
    getItemOnGroundManager() {
      return { registerLocation: (player, item, location) => dropped.push({ player, item, location }) };
    },
    onNpcInteraction(handler) { npcHandlers.push(handler); },
    onNpcDeath(handler) { npcDeathHandlers.push(handler); },
    onObjectInteraction(handler) { objectHandlers.push(handler); },
    onObjectRoute(handler) { routeHandlers.push(handler); },
    onItemOnObject(handler) { itemOnObjectHandlers.push(handler); },
    onItemOnItem(handler) { itemOnItemHandlers.push(handler); },
    onItemAction(name, actions) { itemActions.set(name, actions); },
    onGroundItemPickup(handler) { groundHandlers.push(handler); },
    onNpcDialogueCondition(handler) { conditionAnswerHandlers.push(handler); },
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, payload) {
      if (name === 'xpreward:open') lastXpReward = payload;
      if (name === 'quest:is-complete' && completedQuests.has(payload.key)) payload.complete = true;
      if (mockRescueStatus && name === 'recipe-for-disaster:rescue-status'
        && payload.rescue === 'pirate-pete' && piratePeteRescueComplete) payload.complete = true;
      for (const handler of custom.get(name) ?? []) handler(payload);
    },
    onZoneEnter(_zone, handler) { zoneHandlers.push(handler); },
    onPlayerLogin(handler) { loginHandlers.push(handler); },
    onPlayerLogout(handler) { logoutHandlers.push(handler); },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });

  require('../plugins/quests/quests/GreatBrainRobbery.Quest')(api);
  if (registerRecipeForDisaster) require('../plugins/quests/quests/RecipeForDisaster.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'great_brain_robbery');

  const attributes = new Map();
  const skills = new Map();
  const xpGained = [];
  const slots = new Array(28).fill(null);
  let location = new core.Location(3681, 2963, 0);

  const inventory = {
    getAmount: (id) => slots.reduce((sum, slot) => sum + (slot?.id === id ? slot.amount : 0), 0),
    adds(id, amount = 1) {
      let slot = slots.find((entry) => entry?.id === id);
      if (!slot) {
        const free = slots.indexOf(null);
        if (free < 0) return false;
        slot = { id, amount: 0, getId() { return this.id; }, getAmount() { return this.amount; } };
        slots[free] = slot;
      }
      slot.amount += amount;
      return true;
    },
    deleteNumber(id, amount = 1) {
      let left = amount;
      for (let i = 0; i < slots.length && left > 0; i++) {
        const slot = slots[i];
        if (slot?.id !== id) continue;
        const take = Math.min(slot.amount, left);
        slot.amount -= take;
        left -= take;
        if (slot.amount === 0) slots[i] = null;
      }
      return left === 0;
    },
    getFreeSlots: () => slots.filter((slot) => slot === null).length,
    isFull: () => slots.every((slot) => slot !== null),
    forceAdd(_player, item) {
      if (this.isFull()) {
        dropped.push({ player, item, location });
      } else {
        this.adds(item.getId(), item.getAmount());
      }
      return true;
    },
    get(slot) {
      return slots[slot] ?? null;
    },
    deleteAtSlot(slot, amount = 1) {
      const entry = slots[slot];
      if (!entry) return false;
      entry.amount -= amount;
      if (entry.amount <= 0) slots[slot] = null;
      return true;
    },
  };

  const equipment = new Map();
  attributes.set('recipe-for-disaster:rescues', 4);
  const skillManager = {
    getCurrentLevel: (skill) => skills.get(skill) ?? 99,
    getMaxLevel: (skill) => skills.get(skill) ?? 99,
    getExperience: (skill) => xpGained.filter((entry) => entry.skill === skill).reduce((sum, e) => sum + e.amount, 0),
    addExperience(skill, amount) { xpGained.push({ skill, amount }); },
    addExperiences(skill, amount) { xpGained.push({ skill, amount }); },
    setCurrentLevel(skill, value) { skills.set(skill, value); },
  };

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: (slot) => equipment.get(slot) ?? null, set: () => {} }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null }),
    getSkillManager: () => skillManager,
    getLocation: () => location,
    moveTo(next) { location = next; },
    getPrivateArea: () => null,
    getUsername: () => 'qh728-q052',
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    isPlayer: () => true,
    isPlayerBot: () => false,
  };

  const objectEvent = (objectId, action, at) => {
    const tile = at ?? location;
    const object = new core.GameObject(objectId, new core.Location(tile.getX(), tile.getY(), tile.getZ()), 10, 0, null);
    return {
      player,
      objectId,
      object,
      clickType: 1,
      location: object.getLocation(),
      definition: { getInteractions: () => [action] },
      handled: false,
    };
  };

  const dispatchObject = (objectId, action, at) => {
    const event = objectEvent(objectId, action, at);
    for (const handler of objectHandlers) handler(event);
    return event;
  };
  const npc = (npcId, action = 'Talk-to', at) => {
    const event = {
      player, npcId, clickType: 1, location: at ?? location,
      definition: { getActions: () => [action] }, handled: false,
    };
    for (const handler of npcHandlers) handler(event);
    return event;
  };
  const action = (stepId, npcId = core.NpcIdentifiers.BROTHER_TRANQUILITY) => {
    const event = { player, npcId, stepId, handled: false };
    for (const handler of custom.get('npc-dialogue:action') ?? []) handler(event);
    return event;
  };
  const condition = (stepId) => {
    for (const handler of custom.get('npc-dialogue:condition') ?? []) handler({ player, npcId: core.NpcIdentifiers.BROTHER_TRANQUILITY, stepId });
  };
  const answer = (stepId) => {
    for (const handler of conditionAnswerHandlers) {
      const result = handler({ player, npcId: core.NpcIdentifiers.BROTHER_TRANQUILITY, stepId });
      if (result !== null && result !== undefined) return result;
    }
    return null;
  };
  const itemOnObject = (itemId, objectId, at) => {
    const tile = at ?? location;
    const event = {
      player, itemId, objectId, location: tile,
      object: new core.GameObject(objectId, new core.Location(tile.getX(), tile.getY(), tile.getZ()), 10, 0, null),
      handled: false,
    };
    for (const handler of itemOnObjectHandlers) handler(event);
    return event;
  };
  const itemOnItem = (usedItemId, usedWithItemId) => {
    const event = { player, usedItemId, usedWithItemId, handled: false };
    for (const handler of itemOnItemHandlers) handler(event);
    return event;
  };
  const itemAction = (name, itemId, option) => {
    const entry = itemActions.get(name);
    const handler = entry?.[option];
    if (!handler) return false;
    const slot = slots.findIndex((s) => s?.id === itemId);
    return handler({ player, itemId, option, item: inventory.get(slot), slot });
  };
  const ground = (itemId) => {
    const event = { player, groundItemId: itemId, location };
    for (const handler of groundHandlers) handler(event);
    return event;
  };
  const death = (npcId) => {
    for (const handler of npcDeathHandlers) handler({ player, npcId, killer: player, location });
  };
  const stage = (value) => quest.setStage(player, value);
  const put = (id, amount = 1) => inventory.adds(id, amount);
  const equip = (slot, id) => equipment.set(slot, { getId: () => id });
  const setLocation = (x, y, z = 0) => { location = new core.Location(x, y, z); };
  const doorToggle = (objectId, at = location) => {
    const event = { player, objectId, location: at, handled: false };
    for (const handler of custom.get('door:toggle') ?? []) handler(event);
    return event;
  };
  const ladder = (objectId, action, at) => {
    const event = objectEvent(objectId, action, at);
    for (const handler of custom.get('ladders:climb') ?? []) handler(event);
    return event;
  };

  return {
    quest, player, attributes, slots, dropped, spawned, objects, messages, varbits, configs, xpGained, transcripts,
    get lastXpReward() { return lastXpReward; },
    dispatchObject, doorToggle, ladder, npc, action, condition, answer, itemOnObject, itemOnItem, itemAction, ground, death,
    stage, put, equip, setLocation, inventory,
    loginAs: (target) => { for (const handler of loginHandlers) handler({ player: target }); },
    logoutAs: (target) => { for (const handler of logoutHandlers) handler({ player: target }); },
    zoneEnter: () => { for (const handler of zoneHandlers) handler({ player }); },
    playerLogin: () => {
      for (const handler of loginHandlers) handler({ player });
      runtime.sendQuestVarps({ player });
    },
    closeInterface: (interfaceId) => {
      for (const handler of custom.get('interface:closed') ?? []) handler({ player, interfaceId });
    },
    setLevel: (skill, level) => skills.set(skill, level),
    setQuestComplete: (key, complete) => complete ? completedQuests.add(key) : completedQuests.delete(key),
    setRescueComplete: (complete) => { piratePeteRescueComplete = complete; },
  };
}

function startQuest(h) {
  h.setLocation(3681, 2963, 0);
  h.playerLogin();
  h.npc(core.NpcIdentifiers.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.transcripts.at(-1).variant, 'starting-off');
  h.action('rsYDSe');
  assert.equal(h.quest.getStage(h.player), 1);
}

test('fresh stage 0 reaches the Barrelchest hand-in through the registered handler graph', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  const O = core.ObjectIdentifiers;
  const N = core.NpcIdentifiers;
  const E = core.Equipment;

  startQuest(h);

  // Statue, flooded stairs and peephole.
  h.put(I.HAMMER, 1);
  h.put(I.PLANK, 8);
  h.put(I.BRONZE_NAILS, 38);
  h.equip(E.HEAD_SLOT, I.FISHBOWL_HELMET);
  h.equip(E.CAPE_SLOT, I.DIVING_APPARATUS);
  h.dispatchObject(O.STATUE_76, 'Pull', new core.Location(3796, 2845, 0));
  h.dispatchObject(O.STATUE_77, 'Climb-down', new core.Location(3796, 2845, 0));
  assert.equal(h.player.getLocation().getZ(), 0, 'the dive teleports to the tunnel entrance');
  h.dispatchObject(O.STAIRS_101, 'Repair', new core.Location(3785, 9254, 0));
  assert.equal(h.transcripts.at(-1).variant, 'starting-off-exploring-the-island-before-investigating-the-statue-interacting-with-the-stairs-while-underwater');
  h.condition('ifiDXn');
  assert.equal(h.inventory.getAmount(I.PLANK), 4);
  const climbToSecretRoom = h.ladder(O.STAIRS_102, 'Climb', new core.Location(3785, 9254, 0));
  assert.equal(climbToSecretRoom.handled, true, 'the named ladder hook owns the fixed stairs click');
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3818, 2844, 0], 'the repaired stairs take the player back to the secret-room entrance');
  h.dispatchObject(O.PEEPHOLE, 'Peer-through', new core.Location(3817, 2844, 0));
  h.condition('MRxv-w');
  assert.equal(h.quest.getStage(h.player), 2);

  // Report, fetch and read the prayer book, then ward the gas.
  h.setLocation(3786, 2824, 0);
  h.npc(N.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.transcripts.at(-1).variant, 'reporting-back-to-brother-tranquility');
  h.action('HRJL7U');
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.player.getLocation().getX(), 3681);
  h.setLocation(3049, 3483, 0);
  h.dispatchObject(O.BOOKCASE_4, 'Search', new core.Location(3049, 3483, 0));
  assert.equal(h.transcripts.at(-1).variant, 'finding-the-book-of-prayers');
  assert.equal(h.answer('xbT4_u'), true);
  h.action('DjDfxn');
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.inventory.getAmount(I.PRAYER_BOOK_2), 1);
  assert.equal(h.itemAction('Prayer book', I.PRAYER_BOOK_2, 'Read'), true);
  assert.equal(h.attributes.get('quest.great_brain_robbery.book-read'), true);
  h.setLocation(3681, 2963, 0);
  h.npc(N.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.transcripts.at(-1).variant, 'reporting-back-to-brother-tranquility-talking-to-brother-tranquility-at-mos-le-harmless');
  assert.equal(h.answer('pQtKI-'), false);
  assert.equal(h.answer('2fPj_D'), true);
  h.equip(E.AMULET_SLOT, I.HOLY_SYMBOL);
  h.npc(N.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.answer('XVf9lp'), true);
  h.action('RzcjDw');
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.itemAction('Prayer book', I.PRAYER_BOOK_2, 'Recite-prayer'), true);
  assert.equal(h.answer('x-JYH8'), true);
  h.action('9qzrXT');
  h.setLocation(3786, 2824, 0);
  h.npc(N.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.transcripts.at(-1).variant, 'at-harmony-island-cursed-with-poison-gas-talking-to-brother-tranquility-after-reciting-the-prayer');
  h.action('UoQUsd');
  assert.equal(h.quest.getStage(h.player), 7);

  // Fenkenstrain, Rufus, crate, cats, whistle and shipping order.
  h.setLocation(3548, 3554, 2);
  h.npc(N.DR_FENKENSTRAIN, 'Talk-to');
  assert.equal(h.quest.getStage(h.player), 8);
  h.equip(E.RING_SLOT, I.RING_OF_CHAROS);
  h.setLocation(3507, 3494, 0);
  h.npc(N.RUFUS_2, 'Talk-to');
  assert.equal(h.answer('66qPLS'), false);
  h.condition('VqdO2N');
  h.condition('zAYiRc');
  assert.equal(h.quest.getStage(h.player), 9);
  assert.equal(h.inventory.getAmount(I.CRATE_PART), 6);
  assert.equal(h.inventory.getAmount(I.WOLF_WHISTLE), 1);
  h.setLocation(3550, 3554, 2);
  h.dispatchObject(O.CRATE_202, 'Build', new core.Location(3550, 3554, 2));
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(h.inventory.getAmount(I.CRATE_PART), 0);
  h.dispatchObject(O.CRATE_198, 'Add-bottom', new core.Location(3550, 3554, 2));
  h.condition('VDkh8H');
  assert.equal(h.quest.getStage(h.player), 11);
  h.put(I.WOODEN_CAT, 10);
  for (let i = 0; i < 10; i++) {
    h.itemOnObject(I.WOODEN_CAT, O.CRATE_199, new core.Location(3550, 3554, 2));
    if (i === 9) h.condition('1WI7yE');
  }
  assert.equal(h.quest.getStage(h.player), 12);
  assert.equal(h.inventory.getAmount(I.WOODEN_CAT), 0);
  assert.equal(h.itemAction('Wolf whistle', I.WOLF_WHISTLE, 'Blow'), true);
  h.condition('rUSl3k');
  h.action('0ckhw5');
  assert.equal(h.quest.getStage(h.player), 13);
  assert.equal(h.inventory.getAmount(I.SHIPPING_ORDER), 1);
  assert.equal(h.inventory.getAmount(I.WOLF_WHISTLE), 0);
  h.itemOnObject(I.SHIPPING_ORDER, O.CRATE_228, new core.Location(3550, 3554, 2));
  h.action('A61QHe');
  assert.equal(h.quest.getStage(h.player), 14);

  // Doctor on Harmony, fuse and keg, door, Sorebones and the operation.
  h.setLocation(3681, 2963, 0);
  h.npc(N.BROTHER_TRANQUILITY, 'Talk-to');
  h.action('JfLzr7');
  assert.equal(h.quest.getStage(h.player), 15);
  h.setLocation(3785, 9225, 0);
  h.npc(N.DR_FENKENSTRAIN, 'Talk-to');
  assert.equal(h.transcripts.at(-1).variant, 'talking-to-dr-fenkenstrain-at-harmony-island');
  h.setLocation(3791, 2873, 0);
  h.dispatchObject(O.LOCKER_5, 'Open', new core.Location(3791, 2873, 0));
  h.dispatchObject(O.LOCKER_6, 'Search', new core.Location(3791, 2873, 0));
  h.condition('zfNp3_');
  h.action('5iPKK_');
  assert.equal(h.inventory.getAmount(I.FUSE_2), 1);
  h.setLocation(3801, 2870, 0);
  h.ground(I.KEG);
  h.condition('NlnahY');
  h.action('I3miMQ');
  assert.equal(h.inventory.getAmount(I.KEG), 1);
  h.put(I.TINDERBOX, 1);
  h.setLocation(3805, 2844, 0);
  assert.equal(h.doorToggle(22119).handled, true, 'the monastery entrance stays shut before the blast');
  h.itemOnItem(I.FUSE_2, I.KEG);
  assert.equal(h.transcripts.at(-1).variant, 'retrieving-the-items-for-dr-fenkenstrain-lighting-the-fuse');
  assert.equal(h.answer('tX9fK6'), false);
  assert.equal(h.answer('CnQmqi'), false);
  h.condition('QgHr_7');
  h.action('LvauA0');
  assert.equal(h.quest.getStage(h.player), 16);
  assert.equal(h.varbits.get(3393), 5, 'the entrance transforms into the blasted opening');
  assert.equal(h.doorToggle(22119).handled, false, 'the blasted entrance is passable');
  assert.equal(h.doorToggle(O.DOOR_446, new core.Location(3817, 2841, 0)).handled, false,
    'the unrelated secret-room doors are not blocked as the monastery entrance');
  h.varbits.delete(3393);
  h.playerLogin();
  assert.equal(h.varbits.get(3393), 5, 'login restores the blasted entrance transform');
  assert.equal(h.inventory.getAmount(I.FUSE_2), 0);
  assert.equal(h.inventory.getAmount(I.KEG), 0);

  h.setLocation(3815, 2843, 0);
  for (let i = 0; i < 4; i++) {
    h.death(N.SOREBONES);
    const drop = h.dropped.at(-1).item;
    h.put(drop.getId(), drop.getAmount());
  }
  assert.equal(h.inventory.getAmount(I.CRANIAL_CLAMP), 1);
  assert.equal(h.inventory.getAmount(I.BRAIN_TONGS), 1);
  assert.equal(h.inventory.getAmount(I.BELL_JAR), 3);
  assert.equal(h.inventory.getAmount(I.SKULL_STAPLE), 30);
  h.setLocation(3785, 9225, 0);
  h.npc(N.DR_FENKENSTRAIN, 'Talk-to');
  assert.equal(h.transcripts.at(-1).variant, 'retrieving-the-items-for-dr-fenkenstrain-retrieving-the-items-for-dr-fenkenstrain-checking-the-requirements');
  assert.equal(h.answer('5XpYrd'), true);
  h.condition('5XpYrd');
  assert.equal(h.quest.getStage(h.player), 17);
  assert.equal(h.inventory.getAmount(I.HAMMER), 0);

  // Good news, Mi-Gor, Barrelchest and the final hand-in.
  h.setLocation(3786, 2824, 0);
  h.npc(N.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.quest.getStage(h.player), 18);
  h.zoneEnter();
  const migor = h.spawned.find((npc) => npc.id === N.MI_GOR && !npc.removed);
  assert.ok(migor, 'Mi-Gor is spawned at stage 18');
  h.npc(N.MI_GOR, 'Confront', new core.Location(3819, 2844, 0));
  h.action('ib-nyK');
  assert.ok(migor.removed, 'confronting Mi-Gor removes him');
  assert.ok(h.spawned.some((npc) => npc.id === N.BARRELCHEST && !npc.removed), 'Barrelchest is spawned');
  h.setLocation(3815, 2844, 0);
  h.death(N.BARRELCHEST);
  assert.equal(h.quest.getStage(h.player), 19);
  const anchor = h.dropped.at(-1).item;
  assert.equal(anchor.getId(), I.BARRELCHEST_ANCHOR);
  h.setLocation(3786, 2824, 0);
  h.npc(N.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.quest.getStage(h.player), 20);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.inventory.getAmount(I.BLESSED_LAMP), 1);
  assert.deepEqual(
    h.xpGained.map((entry) => [entry.skill, entry.amount]),
    [[core.Skill.PRAYER, 6000], [core.Skill.CRAFTING, 3000], [core.Skill.CONSTRUCTION, 2000]]
  );
  assert.equal(h.varbits.get(980) ?? h.configs.get(980), 130, 'completion sends native varp 980 = 130');

  // Post-quest talk offers the cross-page transport, and repeat hand-in grants no lamp.
  h.npc(N.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.transcripts.at(-1).variant, 'post-quest-dialogue-talking-to-brother-tranquility');
  h.action('F6MVz8');
  assert.equal(h.player.getLocation().getX(), 3681);
  h.npc(N.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.inventory.getAmount(I.BLESSED_LAMP), 1);
});

test('start transcript gates on native skill and prerequisite requirements', () => {
  const h = setup();
  assert.equal(h.answer('zsGywr'), false);
  assert.equal(h.answer('jfYyLX'), true);
  h.setLevel(core.Skill.CRAFTING, 15);
  assert.equal(h.answer('zsGywr'), true);
  assert.equal(h.answer('jfYyLX'), false);
  h.setLevel(core.Skill.CRAFTING, 16);
  for (const [skill, level] of [[core.Skill.CONSTRUCTION, 29], [core.Skill.PRAYER, 49]]) {
    h.setLevel(skill, level);
    assert.equal(h.answer('zsGywr'), true, `${skill.getName()} ${level} is below its start requirement`);
    h.setLevel(skill, 99);
  }
  h.setQuestComplete('cabin_fever', false);
  assert.equal(h.answer('zsGywr'), true);
  h.setQuestComplete('cabin_fever', true);
  h.setQuestComplete('creature_of_fenkenstrain', false);
  assert.equal(h.answer('zsGywr'), true, 'Creature of Fenkenstrain is a required quest');
  h.setQuestComplete('creature_of_fenkenstrain', true);
  h.setRescueComplete(false);
  assert.equal(h.answer('zsGywr'), true, 'Pirate Pete is a required RFD subquest');
  h.setRescueComplete(true);
  assert.equal(h.answer('zsGywr'), false);
  assert.equal(h.answer('jfYyLX'), true);
});

test('RFD public rescue status satisfies the real Pirate Pete prerequisite query', () => {
  const h = setup({ mockRescueStatus: false, registerRecipeForDisaster: true });
  h.player.setAttribute('recipe-for-disaster:rescues', 0);
  assert.equal(h.answer('zsGywr'), true, 'RFD reports Pirate Pete incomplete');
  h.player.setAttribute('recipe-for-disaster:rescues', 4);
  assert.equal(h.answer('zsGywr'), false, 'RFD exposes the saved Pirate Pete completion flag');
});

test('a worn Medallion of the Deep replaces the fishbowl and diving apparatus', () => {
  const h = setup();
  h.put(core.ItemIdentifiers.FISHBOWL_HELMET, 1);
  h.put(core.ItemIdentifiers.DIVING_APPARATUS, 1);
  assert.equal(h.answer('STglHL'), false, 'without diving equipment the tunnel is unsafe');
  h.equip(core.Equipment.AMULET_SLOT, core.ItemIdentifiers.MEDALLION_OF_THE_DEEP);
  assert.equal(h.answer('STglHL'), true, 'the canonical necklace counts as both pieces of breathing equipment');
});

test('the gas knockout action returns the player to Harmony granary', () => {
  const h = setup();
  h.setLocation(3795, 2825, 0);
  const event = h.action('l0AWhd');
  assert.equal(event.handled, true);
  assert.deepEqual(
    [h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3786, 2824, 0],
    'the transcript says the player wakes inside the windmill granary; this is its Harmony NPC tile',
  );
});

test('a full-bag completion keeps the blessed lamp pending until the next Tranquility talk', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  h.stage(19);
  for (let itemId = 2000; itemId < 2028; itemId++) assert.equal(h.put(itemId, 1), true);
  assert.equal(h.inventory.isFull(), true);
  h.npc(core.NpcIdentifiers.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.quest.getStage(h.player), 20);
  assert.equal(h.attributes.get('great-brain-robbery:pending-lamp-reward'), true);
  assert.equal(h.inventory.getAmount(I.BLESSED_LAMP), 0);
  assert.equal(h.dropped.some(({ item }) => item.getId() === I.BLESSED_LAMP), false,
    'the lamp is not dropped and lost by the generic completion reward path');

  h.inventory.deleteNumber(2000, 1);
  h.npc(core.NpcIdentifiers.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.inventory.getAmount(I.BLESSED_LAMP), 1, 'the post-quest talk reclaims the lamp');
  assert.equal(h.attributes.get('great-brain-robbery:pending-lamp-reward'), false);
  h.npc(core.NpcIdentifiers.BROTHER_TRANQUILITY, 'Talk-to');
  assert.equal(h.inventory.getAmount(I.BLESSED_LAMP), 1, 'the pending reward clears after one claim');
});

test('Sorebones repeats the first missing implement when a drop was not collected', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  h.stage(16);
  h.death(core.NpcIdentifiers.SOREBONES);
  assert.equal(h.dropped.at(-1).item.getId(), I.CRANIAL_CLAMP);
  h.death(core.NpcIdentifiers.SOREBONES_2);
  assert.equal(h.dropped.at(-1).item.getId(), I.CRANIAL_CLAMP,
    'an uncollected first drop is duplicated instead of advancing the lost-item sequence');
  h.put(I.CRANIAL_CLAMP, 1);
  h.death(core.NpcIdentifiers.SOREBONES);
  assert.equal(h.dropped.at(-1).item.getId(), I.BRAIN_TONGS,
    'after pickup, the next missing item becomes the next drop');
});

test('saved compact stages replay to the canonical varp 980 scale', () => {
  const h = setup();
  h.stage(19);
  h.configs.clear();
  h.playerLogin();
  assert.equal(h.configs.get(980), 120, 'boss-killed saves map below the 130 completion floor');
  h.stage(20);
  h.configs.clear();
  h.playerLogin();
  assert.equal(h.configs.get(980), 130, 'old stage-20 saves replay as native completion');
});

test('a full bag does not swallow the shipping order at the whistle hand-in', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  h.stage(12);
  h.attributes.set('quest.great_brain_robbery.cats', 10);
  h.put(I.WOLF_WHISTLE, 1);
  for (let id = 1000; id < 1030 && !h.inventory.isFull(); id++) h.put(id, 1);
  assert.equal(h.inventory.isFull(), true);
  h.equip(core.Equipment.RING_SLOT, I.RING_OF_CHAROS);
  h.itemAction('Wolf whistle', I.WOLF_WHISTLE, 'Blow');
  h.action('0ckhw5');
  assert.equal(h.inventory.getAmount(I.WOLF_WHISTLE), 0);
  assert.equal(h.inventory.getAmount(I.SHIPPING_ORDER), 1, 'the freed whistle slot receives the order');
  assert.equal(h.quest.getStage(h.player), 13);
});

test('Rufus replaces a lost shipping order before the doctor is sent', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  h.stage(13);
  h.setLocation(3507, 3494, 0);
  h.npc(core.NpcIdentifiers.RUFUS_2, 'Talk-to');
  assert.equal(h.inventory.getAmount(I.SHIPPING_ORDER), 1);
  h.inventory.deleteNumber(I.SHIPPING_ORDER, 1);
  h.stage(13);
  h.npc(core.NpcIdentifiers.RUFUS_2, 'Talk-to');
  assert.equal(h.inventory.getAmount(I.SHIPPING_ORDER), 1, 'the order is reobtained from Rufus');
});

test('relog restores the crate transform the saved stage expects', () => {
  const O = core.ObjectIdentifiers;
  const crateIds = [O.CRATE_202, O.CRATE_198, O.CRATE_199, O.CRATE_200, O.CRATE_228];
  for (const [stage, expected] of [
    [10, O.CRATE_198],
    [11, O.CRATE_199],
    [12, O.CRATE_200],
    [13, O.CRATE_228],
    [14, null],
  ]) {
    const h = setup();
    h.stage(stage);
    h.playerLogin();
    const present = crateIds.filter((id) => h.objects.some((object) => object.getId() === id));
    if (expected === null) assert.deepEqual(present, [], `stage ${stage} relog leaves no crate behind`);
    else assert.deepEqual(present, [expected], `stage ${stage} relog restores crate ${expected}`);
  }
});

test('quest map objects are isolated when players log in at different saved stages', () => {
  const h = setup();
  const O = core.ObjectIdentifiers;
  h.stage(14);
  h.attributes.set('quest.great_brain_robbery.stairs-fixed', true);
  h.playerLogin();

  const otherAttributes = new Map([['quest.great_brain_robbery.stage', 0]]);
  const otherSender = new Proxy({ sendVarbit() { return otherSender; } }, {
    get(target, key) { return key in target ? target[key] : () => otherSender; },
  });
  const otherPlayer = {
    getAttribute: (key) => otherAttributes.get(key),
    setAttribute: (key, value) => otherAttributes.set(key, value),
    getPacketSender: () => otherSender,
    getUsername: () => 'qh728-q052-other',
  };
  h.loginAs(otherPlayer);

  const owned = (player, id) => h.objects.some((object) => object.getOwner() === player && object.getId() === id);
  assert.equal(owned(h.player, O.STATUE_77), true, "the completed player's pulled statue remains theirs");
  assert.equal(owned(otherPlayer, O.STATUE_76), true, 'the fresh player receives their own unpulled statue');
  assert.equal(owned(h.player, O.STAIRS_102), true, 'the repaired stairs stay with the first player');
  assert.equal(owned(otherPlayer, O.STAIRS_101), true, 'the second player sees broken stairs');
  assert.equal(owned(h.player, O.CRATE_202), false, 'the shipped crate stays absent for the first player');
  assert.equal(owned(otherPlayer, O.CRATE_202), true, 'the second player gets their own buildable crate');

  h.logoutAs(h.player);
  assert.equal(owned(h.player, O.STATUE_77), false, 'logout removes the first player’s owned scenery');
  assert.equal(owned(otherPlayer, O.STATUE_76), true, 'logout preserves the other player’s scenery');
  h.loginAs(h.player);
  assert.equal(owned(h.player, O.STATUE_77), true, 'relogin reconstructs the saved statue form');
  assert.equal(owned(h.player, O.STAIRS_102), true, 'relogin reconstructs the repaired stairs');
  assert.equal(owned(h.player, O.CRATE_202), false, 'relogin leaves the completed shipment absent');
  assert.equal(owned(otherPlayer, O.STATUE_76), true, 'relogin leaves the other player unchanged');
});

test('early and shared-NPC interactions are not claimed by this quest', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  assert.equal(h.npc(N.RUFUS_2, 'Talk-to').handled, false);
  assert.equal(h.npc(N.DR_FENKENSTRAIN, 'Pickpocket').handled, false, 'Creature of Fenkenstrain keeps pickpocket');
  assert.equal(h.transcripts.length, 0);
  assert.equal(h.npc(N.BROTHER_TRANQUILITY, 'Talk-to').handled, true);
});

test('the blessed lamp Pray-over grants 5,000 XP once and consumes the lamp', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  h.quest.setStage(h.player, 20);
  h.put(I.BLESSED_LAMP, 1);
  const slot = h.slots.findIndex((entry) => entry?.id === I.BLESSED_LAMP);
  const before = h.xpGained.length;
  assert.equal(h.itemAction('Blessed lamp', I.BLESSED_LAMP, 'Pray-over'), true);
  const open = h.lastXpReward;
  assert.ok(open, 'the shared xpreward interface is opened');
  assert.equal(open.minLevel, 30);
  h.closeInterface(240);
  assert.equal(h.itemAction('Blessed lamp', I.BLESSED_LAMP, 'Pray-over'), true,
    'closing the XP choice releases the pending lamp so it can be opened again');
  const reopened = h.lastXpReward;
  assert.ok(reopened);
  const message = reopened.onConfirm(core.Skill.PRAYER, 'Prayer');
  assert.match(message, /5,000 Prayer/);
  assert.equal(h.inventory.getAmount(I.BLESSED_LAMP), 0);
  assert.equal(h.slots[slot], null);
  assert.equal(h.xpGained.length, before + 1);
  assert.equal(h.xpGained.at(-1).amount, 5000);
  assert.equal(h.itemAction('Blessed lamp', I.BLESSED_LAMP, 'Pray-over'), false, 'no lamp left to use');
});
