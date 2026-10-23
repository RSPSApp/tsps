// Client of Kourend (q010) full route contract.
// From server/: node --test tests/qh728-q010.test.cjs
//
// Fixture start: stage 0, X Marks the Spot not completed unless the test says so;
// the inventory and varbits are test doubles. Route actions are delivered through
// the plugin's real npc-dialogue/item handlers, not by calling its local helpers.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const core = PluginManager.getCoreApi();

test('Munty door opens into its matching cache model and clears the blocked approach', () => {
  const { RegionManager, MapObjects, ObjectDefinition, Location } = core;
  RegionManager.init();
  RegionManager.loadMapFiles(1551, 3754, false);
  const tile = new Location(1551, 3754, 0);
  const door = MapObjects.get(28479, tile, null);
  assert.ok(door, 'Munty entrance is the real cache door');
  assert.notDeepEqual(core.CacheDefinitions.getObject(28479).models, core.CacheDefinitions.getObject(28480).models);
  assert.deepEqual(core.CacheDefinitions.getObject(28479).models, core.CacheDefinitions.getObject(28482).models);
  const approaches = [[1550, 3754], [1552, 3754], [1551, 3753], [1551, 3755]];
  const canCross = ([x, y]) => RegionManager.canMovestart(new Location(x, y, 0), tile, 1, 1, null);
  const before = approaches.map(canCross);
  const actions = new Map();
  const registered = [];
  const modulePath = require.resolve('../plugins/objects/Doors.plugin');
  delete require.cache[modulePath];
  require(modulePath).register({
    core: {
      ...core,
      Sounds: { sendSound() {} },
      TaskManager: { cancelTasks() {}, submit() {} },
      ObjectManager: {
        deregister: (...args) => core.ObjectManager.deregister(...args),
        register(object, update) { registered.push(object); core.ObjectManager.register(object, update); },
      },
    },
    emitCustomEvent() {},
    onObjectInteraction: (name, handlers) => actions.set(name, handlers),
    onRegionLoaded() {},
    onServerStartup() {},
  });
  const player = { getPrivateArea: () => null, getPacketSender: () => ({ getVarbit: () => 0, getVarp: () => 0 }) };
  try {
    const open = actions.get('Door').Open({
      player, object: door, objectId: door.getId(), location: tile,
      definition: ObjectDefinition.forPlayer(door.getId(), player), clickType: 1,
    });
    assert.equal(open, true);
    assert.equal(registered.at(-1).getId(), 28482, 'interleaved IDs do not select the neighbouring door model');
    assert.ok(approaches.some((from, index) => !before[index] && canCross(from)), 'opening clears the original blocked edge');
  } finally {
    for (const object of registered) core.ObjectManager.deregister(object, true);
    core.ObjectManager.register(door, true);
    delete require.cache[modulePath];
  }
});

const transcripts = [];
const originalStartTranscript = runtime.startTranscript;
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};

function setup() {
  const questCore = { ...core, CountdownTask: undefined, TaskManager: undefined };
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const itemOnItem = [];
  const itemActions = new Map();
  const completedQuests = new Set();
  const xpreward = [];
  let xp = 0;
  const api = new Proxy({
    core: questCore,
    persistAttribute() {},
    onNpcDialogueVariant(handler) { variants.push(handler); },
    onNpcDialogueCondition(handler) { conditions.push(handler); },
    onItemOnItem(handler) { itemOnItem.push(handler); },
    onItemAction(name, actions) { itemActions.set(name, actions); },
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && completedQuests.has(event.key)) event.complete = true;
      if (name === 'xpreward:open') xpreward.push(event);
      for (const handler of custom.get(name) ?? []) handler(event);
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  require('../plugins/quests/quests/ClientOfKourend.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'client_of_kourend');

  const attributes = new Map();
  const items = new Map();
  const forceAdds = [];
  const messages = [];
  const varbits = new Map();
  const configs = new Map();
  const strings = new Map();
  let full = false;
  let location = new core.Location(0, 0, 0);
  let slotItem = null;

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendString(text, uid) { strings.set(uid, text); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  let inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds(id, amount = 1) {
      if (full) return false;
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber(id, amount = 1) {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    forceAdd(_player, item) {
      forceAdds.push({ id: item.getId(), amount: item.getAmount() });
      if (!full) items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount());
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28),
    isFull: () => full,
    get: () => slotItem,
    deleteAtSlot(_slot, amount) {
      items.set(slotItem.getId(), Math.max(0, (items.get(slotItem.getId()) ?? 0) - amount));
      return true;
    },
  };

  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null }),
    getSkillManager: () => ({
      getExperience: () => xp,
      addExperience: (_skill, amount) => { xp += amount; return true; },
    }),
    getLocation: () => location,
    moveTo(next) { location = next; },
    getBanks: () => [],
    getUsername: () => 'qh728-q010',
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
  };

  const variant = (npcId) => { const result = variants.map((handler) => handler({ player, npcId })).find(Boolean); return typeof result === 'string' ? { variant: result } : result ?? null; };
  const condition = (npcId, stepId) => {
    for (const handler of conditions) {
      const answer = handler({ player, npcId, stepId });
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const message = (npcId, stepId) => {
    for (const handler of custom.get('npc-dialogue:action') ?? []) {
      handler({ player, npcId, stepId, kind: 'message', text: '', handled: false });
    }
  };
  const receive = (npcId, stepId) => {
    const event = { player, npcId, stepId, action: 'receive', handled: false };
    for (const handler of custom.get('npc-dialogue:action') ?? []) handler(event);
    return event;
  };
  const action = (npcId, stepId) => {
    const event = { player, npcId, stepId, handled: false };
    for (const handler of custom.get('npc-dialogue:action') ?? []) handler(event);
    return event;
  };
  const choice = (npcId, option) => {
    for (const handler of custom.get('npc-dialogue:choice') ?? []) {
      handler({ player, npcId, option, stepId: 'test' });
    }
  };
  const line = (npcId, text) => {
    const event = { player, npcId, text };
    for (const handler of custom.get('npc-dialogue:line') ?? []) handler(event);
    return event;
  };
  const conditionChosen = (npcId, stepId) => {
    for (const handler of custom.get('npc-dialogue:condition') ?? []) {
      handler({ player, npcId, stepId });
    }
  };
  const hook = (npcId, name) => {
    for (const handler of custom.get('npc-dialogue:hook') ?? []) {
      handler({ player, npcId, hook: name, handled: false });
    }
  };
  const useFeather = (usedItemId, usedWithItemId) => {
    const event = { player, usedItemId, usedWithItemId, handled: false };
    for (const handler of itemOnItem) handler(event);
    return event;
  };

  return {
    api, quest, player, attributes, items, forceAdds, messages, varbits, configs, strings, xpreward,
    variant, condition, message, receive, action, choice, line, conditionChosen, hook, useFeather,
    itemAction: (name, option, event) => itemActions.get(name)[option]({ player, ...event }),
    setFull(value) { full = value; },
    setInventory(value) { inventory = value; },
    setSlotItem(item) { slotItem = item; },
    getXp() { return xp; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    completeQuest(key) { completedQuests.add(key); },
  };
}

function routeToOrb(h) {
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;
  h.completeQuest('x_marks_the_spot');
  assert.equal(h.variant(N.VEOS_5)?.variant, 'starting-off');
  h.hook(N.VEOS_5, 'quest:client-of-kourend:start');
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(h.varbits.get(5619), 1, 'durable stage 1 keeps wire 1');
  h.message(N.VEOS_5, 'qcqaI2');
  assert.equal(h.items.get(I.ENCHANTED_SCROLL), 1);
  h.items.set(I.FEATHER, 1);
  assert.equal(h.useFeather(I.ENCHANTED_SCROLL, I.FEATHER).handled, true);
  assert.equal(transcripts.at(-1).variant, 'starting-off-using-a-feather-on-enchanted-scroll');
  h.receive(N.VEOS_5, 'BB5wZw');
  assert.equal(h.items.get(I.ENCHANTED_QUILL), 1);
  assert.equal(h.items.get(I.FEATHER) ?? 0, 0);

  const houses = [
    [N.LEENZ, 'wNJVb3', 'pH0iXc', 'R-bhsE', 'X2sNMn', 1],
    [N.REGATH, 'WDvImY', 'DdB4Kn', 'wgj-O3', 'zWo1vb', 2],
    [N.MUNTY, '9RoiXa', 'CX8Or4', 'VGPooZ', 'i22ChP', 4],
    [N.JENNIFER, 'bXrAXE', 'R1Oi1W', 'R1DD-x', '-_CRFq', 8],
    [N.HORACE, 'k-BFhJ', 'isK3zK', '2vhmBN', '6fZqvf', 16],
  ];
  for (const [npcId, notLast, last, done, lastMessage, bit] of houses.slice(0, 4)) {
    assert.equal(h.condition(npcId, notLast), true);
    assert.equal(h.condition(npcId, last), false);
    h.message(npcId, done);
    assert.equal(h.attributes.get('quest.client_of_kourend.houses') & bit, bit);
    assert.equal(h.quest.getStage(h.player), 1, 'four owners do not advance the stage');
  }
  const [horace, horaceNotLast, horaceLast, , horaceLastMessage, horaceBit] = houses[4];
  assert.equal(h.condition(horace, horaceNotLast), false);
  assert.equal(h.condition(horace, horaceLast), true);
  h.message(horace, horaceLastMessage);
  assert.equal(h.attributes.get('quest.client_of_kourend.houses') & horaceBit, horaceBit);
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.varbits.get(5619), 2, 'durable stage 2 keeps wire 2');
  assert.equal(h.varbits.get(5625), 1, 'reveal varbit is set with the fifth owner');

  h.message(N.VEOS_5, '4hbSAK');
  assert.equal(h.items.get(I.ENCHANTED_SCROLL) ?? 0, 0);
  assert.equal(h.items.get(I.ENCHANTED_QUILL) ?? 0, 0);
  h.receive(N.VEOS_5, 'YtCvIQ');
  assert.equal(h.items.get(I.MYSTERIOUS_ORB), 1);
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.varbits.get(5619), 4, 'holding the orb sends Quest Helper wire 4');
}

test('Client of Kourend runs the mandatory Quest Helper route from stage 0 to completion', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  assert.equal(h.variant(N.VEOS_5), null, 'X Marks the Spot gates the start variant');
  assert.equal(h.quest.getStage(h.player), 0);

  routeToOrb(h);

  // Lost-orb recovery branch at stage 3.
  h.items.set(I.MYSTERIOUS_ORB, 0);
  h.setFull(true);
  assert.equal(h.condition(N.VEOS_5, '5IoSGv'), true, 'full backpack refuses the lost-orb reclaim');
  h.setFull(false);
  assert.equal(h.condition(N.VEOS_5, 'mJAvYg'), false);
  assert.equal(h.condition(N.VEOS_5, 'LIGbQM'), true);
  h.message(N.VEOS_5, 'xa0SlA');
  assert.equal(h.items.get(I.MYSTERIOUS_ORB), 1, 'lost orb is replaced');

  // Off-altar activation plays the refusal variant and changes nothing.
  h.setLocation(0, 0);
  h.itemAction('Mysterious orb', 'Activate', { itemId: I.MYSTERIOUS_ORB });
  assert.equal(transcripts.at(-1).variant, 'activating-the-orb-trying-to-activate-the-orb-in-a-different-location');
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.items.get(I.MYSTERIOUS_ORB), 1);

  // Altar activation shatters the orb into broken glass.
  h.setLocation(1715, 3882);
  h.itemAction('Mysterious orb', 'Activate', { itemId: I.MYSTERIOUS_ORB });
  assert.equal(transcripts.at(-1).variant, 'activating-the-orb-using-the-activate-option-on-the-mysterious-orb-by-the-dark-altar');
  h.message(N.VEOS_5, 'vy1GZz');
  assert.equal(h.items.get(I.MYSTERIOUS_ORB) ?? 0, 0);
  assert.equal(h.items.get(I.BROKEN_GLASS), 1);
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.varbits.get(5619), 5, 'activated orb sends Quest Helper wire 5');

  h.action(N.VEOS_5, 'M9w-_K');
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.attributes.get('quest.points'), 1);
  assert.equal(h.items.get(I.KHAREDSTS_MEMOIRS), 1);
  assert.equal(h.items.get(I.ANTIQUE_LAMP_17), 2);
  assert.equal(h.varbits.get(5619), 9, 'completed Client of Kourend unlocks the teleport varbit');
  assert.ok(h.messages.some((text) => text.includes('Client of Kourend')));

  const lampCount = h.items.get(I.ANTIQUE_LAMP_17);
  const forceAddCount = h.forceAdds.length;
  h.action(N.VEOS_5, 'M9w-_K');
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.items.get(I.ANTIQUE_LAMP_17), lampCount, 'repeat completion grants no extra lamps');
  assert.equal(h.forceAdds.length, forceAddCount, 'repeat completion grants no extra items');
});

test('Client of Kourend completion drops both antique lamps from a naturally full backpack', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  routeToOrb(h);
  h.setLocation(1715, 3882);
  h.itemAction('Mysterious orb', 'Activate', { itemId: I.MYSTERIOUS_ORB });
  h.message(N.VEOS_5, 'vy1GZz');
  assert.equal(h.quest.getStage(h.player), 4);

  const inventory = new Inventory(h.player);
  for (let slot = 0; slot < 28; slot++) inventory.getItems()[slot] = new core.Item(I.COINS, 1);
  h.setInventory(inventory);

  const drops = [];
  const previous = ItemOnGroundManager.registers;
  ItemOnGroundManager.registers = (_player, item) => { drops.push(item); return item; };
  try {
    h.action(N.VEOS_5, 'M9w-_K');
  } finally {
    ItemOnGroundManager.registers = previous;
  }

  assert.equal(h.quest.getStage(h.player), 5);
  const dropped = drops.map((item) => item.getId());
  assert.ok(dropped.includes(I.KHAREDSTS_MEMOIRS), 'memoirs use the runtime reward drop path');
  assert.equal(dropped.filter((id) => id === I.ANTIQUE_LAMP_17).length, 2,
    'both lamps use the real forceAdd drop path instead of being lost');
});

test('Client of Kourend normal orb handover refuses a full backpack without advancing stage', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  // Fixture start: durable stage 2 after the five owners, with the scroll/quill
  // banked or dropped so the YcV-DQ removal branch cannot free a slot.
  h.quest.setStage(h.player, 2);
  h.setFull(true);

  const refused = h.receive(N.VEOS_5, 'YtCvIQ');
  assert.equal(refused.end, true, 'the hand-over closes instead of claiming receipt');
  assert.equal(h.quest.getStage(h.player), 2, 'durable stage stays at return-to-Veos');
  assert.equal(h.items.get(I.MYSTERIOUS_ORB) ?? 0, 0);
  assert.ok(h.messages.includes('You need a free inventory space.'));

  h.setFull(false);
  h.receive(N.VEOS_5, 'YtCvIQ');
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.items.get(I.MYSTERIOUS_ORB), 1);
});

test('Client of Kourend post-quest Piscarilius Veos returns lost memoirs exactly once', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  routeToOrb(h);
  h.setLocation(1715, 3882);
  h.itemAction('Mysterious orb', 'Activate', { itemId: I.MYSTERIOUS_ORB });
  h.message(N.VEOS_5, 'vy1GZz');
  h.action(N.VEOS_5, 'M9w-_K');

  assert.equal(h.variant(N.VEOS_5)?.variant, 'standard-dialogue-at-port-piscarilius');
  h.items.set(I.KHAREDSTS_MEMOIRS, 0);
  assert.equal(h.condition(N.VEOS_5, 'K8j5Z5'), false);
  assert.equal(h.condition(N.VEOS_5, 'drsnpy'), true);

  h.setFull(true);
  h.conditionChosen(N.VEOS_5, 'drsnpy');
  assert.equal(h.items.get(I.KHAREDSTS_MEMOIRS) ?? 0, 0, 'full bag adds no memoir');
  const refused = h.line(N.VEOS_5, 'I do have some things for you. Enjoy!');
  assert.equal(refused.skip, true, 'the false receipt line is skipped');
  assert.ok(h.messages.includes('You need a free inventory space.'));
  assert.equal(h.condition(N.VEOS_5, 'drsnpy'), true, 'the missing condition remains retryable');

  h.setFull(false);
  h.conditionChosen(N.VEOS_5, 'drsnpy');
  assert.equal(h.items.get(I.KHAREDSTS_MEMOIRS), 1);
  const receipt = h.line(N.VEOS_5, 'I do have some things for you. Enjoy!');
  assert.equal(receipt.skip, undefined, 'the canonical line plays after a successful retry');
  assert.equal(h.condition(N.VEOS_5, 'K8j5Z5'), true);
  assert.equal(h.condition(N.VEOS_5, 'drsnpy'), false);

  const count = h.items.get(I.KHAREDSTS_MEMOIRS);
  h.conditionChosen(N.VEOS_5, 'drsnpy');
  assert.equal(h.items.get(I.KHAREDSTS_MEMOIRS), count, 'a repeat condition does not duplicate the book');
});

test('Client of Kourend leaves Port Sarim Veos to X Marks and sails to Piscarilius', () => {
  const h = setup();
  const N = core.NpcIdentifiers;

  h.completeQuest('x_marks_the_spot');
  assert.equal(h.variant(N.VEOS_5)?.variant, 'starting-off', 'Piscarilius Veos offers the start');
  assert.equal(h.variant(N.VEOS), null, 'Port Sarim Veos stays with X Marks');
  assert.equal(h.variant(N.VEOS_4), null, 'the completed Port Sarim transform stays with X Marks');

  h.setLocation(3054, 3245);
  const sail = h.action(N.VEOS_4, 'WXJllC');
  assert.equal(sail.handled, true);
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [1825, 3691, 0], 'the canonical sail action lands on the Piscarilius Veos tile');
  assert.equal(h.varbits.get(4897), 1, 'the boat ride marks Zeah visited');

  h.setLocation(3054, 3245);
  h.choice(N.VEOS_4, "I'd like to travel to Port Piscarilius, please.");
  const voyage = h.line(N.VEOS_4, "As you wish, I hope you don't get seasick, it is a long voyage.");
  assert.equal(typeof voyage.after, 'function', 'the post-X-Marks departure line completes the handoff');
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY()], [3054, 3245],
    'the destination is not applied before the departure line completes');
  voyage.after();
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [1825, 3691, 0]);

  h.choice(N.VEOS_4, "I'd like to travel to Land's End, please.");
  const landEnd = h.line(N.VEOS_4, "As you wish, I hope you don't get seasick, it is a long voyage.");
  assert.equal(typeof landEnd.after, 'function');
  landEnd.after();
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [1504, 3401, 0], 'the accepted Port Sarim choice reaches the canonical Land\'s End landing');

  h.choice(N.VEOS_4, "I'd like to travel to Port Piscarilius, please.");
  h.variant(N.VEOS_4); // reopening Talk-to after cancelling the dialogue resets its choice context
  h.choice(N.VEOS_4, "Actually I'd like to stay here.");
  const reopenedStay = h.line(N.VEOS_4, 'As you wish.');
  assert.equal(reopenedStay.after, undefined, 'reopening and taking a non-travel path discards stale travel');

  h.choice(N.VEOS_4, "I'd like to travel to Port Piscarilius, please.");
  h.choice(N.VEOS_4, "I'd like to travel to Land's End, please.");
  h.choice(N.VEOS_4, "Actually I'd like to stay here.");
  const stay = h.line(N.VEOS_4, 'As you wish.');
  assert.equal(stay.after, undefined, 'a cancelled destination choice does not travel');
});

test('post-quest Piscarilius Veos travel reaches Port Sarim and Land\'s End after the departure line', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  h.completeQuest('x_marks_the_spot');
  const origin = [1825, 3691, 0];
  h.setLocation(...origin);

  h.choice(N.VEOS_5, 'Travel to Port Sarim.');
  const portSarim = h.line(N.VEOS_5, "As you wish, I hope you don't get seasick, it is a long voyage.");
  assert.equal(typeof portSarim.after, 'function');
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()], origin);
  portSarim.after();
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3054, 3245, 0]);

  h.setLocation(...origin);
  h.choice(N.VEOS_5, "Travel to Land's End.");
  const landEnd = h.line(N.VEOS_5, 'As you wish.');
  assert.equal(typeof landEnd.after, 'function', 'the referenced transcript branch keeps its canonical short line');
  landEnd.after();
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [1504, 3401, 0]);
});

test('Client of Kourend start-scroll handover with a full backpack is recoverable', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  h.completeQuest('x_marks_the_spot');
  h.setFull(true);
  h.hook(N.VEOS_5, 'quest:client-of-kourend:start');
  assert.equal(h.quest.getStage(h.player), 1);
  h.message(N.VEOS_5, 'qcqaI2');
  assert.equal(h.items.get(I.ENCHANTED_SCROLL) ?? 0, 0, 'full bag gets no scroll');
  assert.equal(h.condition(N.VEOS_5, 'T3xEGO'), true, 'lost-scroll full branch is reachable');
  assert.equal(h.condition(N.VEOS_5, 'kKFnIP'), true);

  h.setFull(false);
  h.message(N.VEOS_5, 'y6wsrd');
  assert.equal(h.items.get(I.ENCHANTED_SCROLL), 1, 'the lost-scroll branch returns the scroll');
});

test('Client of Kourend quill accepts the plain/stripy/coloured feathers and rejects magic gold', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  const feathers = [
    I.FEATHER, I.STRIPY_FEATHER, I.RED_FEATHER, I.BLUE_FEATHER,
    I.YELLOW_FEATHER, I.ORANGE_FEATHER,
  ];

  h.quest.setStage(h.player, 1);
  h.items.set(I.ENCHANTED_SCROLL, 1);
  for (const feather of feathers) {
    const before = transcripts.length;
    h.useFeather(I.ENCHANTED_SCROLL, feather);
    assert.equal(transcripts.length, before + 1, `feather ${feather} starts the quill transcript`);
    assert.equal(transcripts.at(-1).variant, 'starting-off-using-a-feather-on-enchanted-scroll');
  }

  const before = transcripts.length;
  h.useFeather(I.ENCHANTED_SCROLL, I.MAGIC_GOLD_FEATHER);
  assert.equal(transcripts.length, before, 'magic gold feather cannot attune the scroll');
});

test('Client of Kourend wire stages survive setStage and the real login resend', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  const expected = [[0, 0], [1, 1], [2, 2], [3, 4], [4, 5], [5, 9]];

  for (const [durable, wire] of expected) {
    h.quest.setStage(h.player, durable);
    assert.equal(h.varbits.get(5619), wire, `durable stage ${durable} sends wire ${wire}`);
    assert.equal(h.quest.getStage(h.player), durable, 'the durable stage is not rewritten');
  }
  assert.ok(h.varbits.get(5619) >= 7, 'cache table 0 column 19 completion floor is 7');

  h.quest.setStage(h.player, 3);
  h.varbits.clear();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(5619), 4, 'login resend keeps the orb wire value');

  h.quest.setStage(h.player, 4);
  h.varbits.clear();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(5619), 5, 'replay keeps the activated wire value');

  h.quest.setStage(h.player, 5);
  h.varbits.clear();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(5619), 9, 'completion replay keeps the teleport unlock value');
});

test('Client of Kourend antique lamp rub spends one lamp for 500 XP', () => {
  const h = setup();
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;

  routeToOrb(h);
  h.setLocation(1715, 3882);
  h.itemAction('Mysterious orb', 'Activate', { itemId: I.MYSTERIOUS_ORB });
  h.message(N.VEOS_5, 'vy1GZz');
  h.action(N.VEOS_5, 'M9w-_K');
  assert.equal(h.items.get(I.ANTIQUE_LAMP_17), 2);

  const lamp = { getId: () => I.ANTIQUE_LAMP_17 };
  h.setSlotItem(lamp);
  h.itemAction('Antique lamp', 'Rub', { itemId: I.ANTIQUE_LAMP_17, item: lamp, slot: 3 });
  const request = h.xpreward.at(-1);
  assert.ok(request, 'Rub opens the shared xpreward interface');
  const skill = { getName: () => 'Attack' };
  assert.match(request.onConfirm(skill, 'Attack'), /500 Attack XP/);
  assert.equal(h.getXp(), 500);
  assert.equal(h.items.get(I.ANTIQUE_LAMP_17), 1, 'one lamp is consumed');

  h.itemAction('Antique lamp', 'Rub', { itemId: I.ANTIQUE_LAMP_17, item: lamp, slot: 3 });
  assert.match(h.xpreward.at(-1).onConfirm(skill, 'Attack'), /500 Attack XP/);
  assert.equal(h.getXp(), 1000);
  assert.equal(h.items.get(I.ANTIQUE_LAMP_17) ?? 0, 0, 'both lamps are consumed');
});

after(() => {
  runtime.startTranscript = originalStartTranscript;
});
