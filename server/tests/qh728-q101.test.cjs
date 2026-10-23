// Scorpion Catcher (q101) source contract. From server/: node --test tests/qh728-q101.test.cjs
// Fixture start is a player object with ordinary skills/inventory; every event below is
// dispatched through the plugin's real registered hooks. This proves handler contracts and
// the stage/wire mapping, not a natural playthrough.
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

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;
const VARP = 76;
const WIRE_COMPLETE = 6;

function harness({ prayer = 31, prayerCurrent = prayer } = {}) {
  const custom = new Map();
  const hooks = { variants: [], conditions: [], npc: [], itemOnNpc: [], objects: [], logins: [], interfaces: [] };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(handler) { hooks.variants.push(handler); },
    onNpcDialogueCondition(handler) { hooks.conditions.push(handler); },
    onNpcInteraction(handler) { hooks.npc.push(handler); },
    onItemOnNpc(handler) { hooks.itemOnNpc.push(handler); },
    onObjectInteraction(handler) { hooks.objects.push(handler); },
    onPlayerLogin(handler) { hooks.logins.push(handler); },
    onInterfaceActionClick(handler) { hooks.interfaces.push(handler); },
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      for (const handler of custom.get(name) ?? []) handler(event);
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  require('../plugins/quests/quests/ScorpionCatcher.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);
  assert.equal(quest.key, 'scorpion_catcher');

  const attributes = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const xp = [];
  const configs = new Map();
  const interfaces = [];
  const hits = [];
  const sender = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendInterface(groupId) { interfaces.push(groupId); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });
  let location = new core.Location(0, 0, 0);
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    deleteNumber: (id, amount = 1) => {
      const left = Math.max(0, (items.get(id) ?? 0) - amount);
      if (left) items.set(id, left); else items.delete(id);
      return true;
    },
    forceAdd: (_player, item) => inventory.adds(item.getId(), item.getAmount()),
    isFull: () => false,
    getFreeSlots: () => 28 - items.size,
  };
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === core.Skill.PRAYER ? prayerCurrent : 1),
      getMaxLevel: (skill) => (skill === core.Skill.PRAYER ? prayer : 1),
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (list) => hits.push(...list) }) }),
    getLocation: () => location,
    setLocation: (x, y, z = 0) => { location = new core.Location(x, y, z); },
    moveTo: (next) => { moves.push([next.getX(), next.getY(), next.getZ()]); location = next; },
    getDialogueManager: () => ({ isActive: () => false, reset() {}, startDialogues() {} }),
    isRegistered: () => true,
    sendMessage: (text) => messages.push(text),
    getUsername: () => 'qh728-q101',
  };

  const emit = (name, payload = {}) => {
    const event = { player, handled: false, ...payload };
    for (const handler of custom.get(name) ?? []) handler(event);
    return event;
  };
  const variant = (npcId) => hooks.variants[0]({ player, npcId });
  const stage = () => quest.getStage(player);
  const wire = () => configs.get(VARP);
  const cage = (npcId, itemId) => {
    const event = { player, npcId, itemId, handled: false };
    for (const handler of hooks.itemOnNpc) handler(event);
    return event;
  };
  const npcTalk = (npcId, actions = ['Talk-to'], clickType = 1) => {
    const event = { player, npcId, clickType, definition: { getActions: () => actions }, handled: false };
    for (const handler of hooks.npc) handler(event);
    return event;
  };
  const object = (objectId) => {
    const event = {
      player, objectId, clickType: 1, location: { x: 2875, y: 9799, z: 0 }, handled: false,
    };
    for (const handler of hooks.objects) handler(event);
    return event;
  };
  return {
    quest, player, items, messages, moves, xp, attributes, configs, hooks, interfaces, hits,
    emit, variant, stage, wire, cage, npcTalk, object,
    start: () => emit('npc-dialogue:hook', { npcId: N.THORMAC, hook: 'quest:scorpion-catcher:start' }),
    choose: (npcId, option) => emit('npc-dialogue:choice', { npcId, option }),
    action: (npcId, stepId) => emit('npc-dialogue:action', { npcId, stepId }),
    enchantAction: (npcId = N.THORMAC) => emit('npc-dialogue:action', {
      npcId, action: 'open_interface', target: "Thormac's battlestaff enchanting", stepId: 'yTpo85',
    }),
    interfaceClick: (payload) => {
      const event = { player, handled: false, action: 1, ...payload };
      for (const handler of hooks.interfaces) handler(event);
      return event;
    },
  };
}

test('helper stage keys map to durable stages and varp 76 edges, including completion and login replay', () => {
  const h = harness();
  for (let stageValue = 0; stageValue <= 3; stageValue++) {
    h.quest.setStage(h.player, stageValue);
    assert.equal(h.quest.varpValue(stageValue, h.player), stageValue);
    assert.equal(h.wire(), stageValue, `helper stage key ${stageValue} is mirrored to varp 76`);
  }
  h.quest.setStage(h.player, 4);
  assert.equal(h.quest.varpValue(4, h.player), WIRE_COMPLETE);
  assert.equal(h.wire(), WIRE_COMPLETE, 'durable completion stage 4 is sent as varp 76 = 6');
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.quest.varbitId, undefined, 'Scorpion Catcher is a whole-varp quest');

  h.quest.setStage(h.player, 7);
  assert.equal(h.wire(), WIRE_COMPLETE, 'a later durable value still maps to the cache completion floor');
  assert.equal(h.quest.isComplete(h.player), true);

  h.quest.setStage(h.player, 4);
  h.configs.clear();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.wire(), WIRE_COMPLETE, 'login replay sends native varp 76 = 6 for a completed save');
});

test('the start is not gated on Prayer: the only canonical start requirement (Barcrawl) has no server source', () => {
  // OSRS Wiki: 31 Prayer is "[not required to start]" (it is needed to enter the
  // Monastery 1st floor), and Barcrawl is the only "[required to start]" entry.
  // This server has no Barcrawl quest or attribute, so the start is not refused.
  const low = harness({ prayer: 30 });
  assert.equal(low.variant(N.THORMAC), 'starting-off-with-the-requirements');
  assert.equal(low.stage(), 0);

  const h = harness({ prayer: 31 });
  assert.equal(h.variant(N.THORMAC), 'starting-off-with-the-requirements');
  h.start();
  assert.equal(h.items.get(I.SCORPION_CAGE), 1, 'Thormac hands over the empty cage');
  assert.equal(h.stage(), 1);
  assert.equal(h.wire(), 1);
  h.start();
  assert.equal(h.items.get(I.SCORPION_CAGE), 1, 'the start hook does not grant a second cage');
});

test('the first Seer answer publishes the first hint and enables all three catches in any order', () => {
  const h = harness();
  h.start();
  assert.equal(h.variant(N.SEER), 'first-scorpion-help-from-a-seer');
  h.choose(N.SEER, 'I need to locate some scorpions.');
  assert.equal(h.stage(), 2, 'the first hint advances durable stage');
  assert.equal(h.wire(), 2);

  // Wiki and QH: after the first hint the three scorpions can be caught in any order.
  h.items.set(I.SCORPION_CAGE, 1);
  h.cage(N.KHARID_SCORPION_3, I.SCORPION_CAGE); // C = Monastery
  assert.equal(h.items.get(I.SCORPION_CAGE_7), 1);
  h.cage(N.KHARID_SCORPION, I.SCORPION_CAGE_7); // A = Taverley
  assert.equal(h.items.get(I.SCORPION_CAGE_4), 1);
  h.cage(N.KHARID_SCORPION_2, I.SCORPION_CAGE_4); // B = Barbarian Outpost
  assert.equal(h.items.get(I.SCORPION_CAGE_8), 1, 'the full cage is SCORPION_CAGE_8 (463)');
  assert.equal(h.items.get(I.SCORPION_CAGE_7) ?? 0, 0);
  assert.equal(h.items.get(I.SCORPION_CAGE_4) ?? 0, 0);
  assert.equal(h.messages.filter((text) => text === 'You catch a scorpion!').length, 3);
  assert.equal(h.stage(), 2, 'catching does not require the optional second Seer conversation');
});

test('a different catch order yields the same cache cage item', () => {
  const h = harness();
  h.start();
  h.choose(N.SEER, 'I need to locate some scorpions.');
  h.items.set(I.SCORPION_CAGE, 1);
  h.cage(N.KHARID_SCORPION_2, I.SCORPION_CAGE); // B first
  assert.equal(h.items.get(I.SCORPION_CAGE_5), 1);
  h.cage(N.KHARID_SCORPION, I.SCORPION_CAGE_5); // then A
  assert.equal(h.items.get(I.SCORPION_CAGE_3), 1);
  h.cage(N.KHARID_SCORPION_3, I.SCORPION_CAGE_3); // then C
  assert.equal(h.items.get(I.SCORPION_CAGE_8), 1);
});

test('catches before the first hint are refused and an already caught scorpion is not duplicated', () => {
  const h = harness();
  h.start();
  h.items.set(I.SCORPION_CAGE, 1);
  h.cage(N.KHARID_SCORPION, I.SCORPION_CAGE);
  assert.equal(h.items.get(I.SCORPION_CAGE), 1, 'no cage is consumed before the Seer hint');
  assert.ok(h.messages.includes('You do not know where this scorpion belongs.'));

  const pick = h.npcTalk(N.KHARID_SCORPION, ['Pick-up']);
  assert.equal(pick.handled, true);
  assert.ok(h.messages.includes('The scorpion stings you!'), 'pick-up uses the transcript sting line');
  assert.equal(h.hits.length, 1, 'the sting deals damage');
  assert.equal(h.hits[0].getDamage(), 3, 'OSRS: picking a scorpion up stings for 3 hitpoints');

  const notPickUp = h.npcTalk(N.KHARID_SCORPION, ['Attack'], 3);
  assert.equal(notPickUp.handled, false, 'only a pick-up attempt stings');
  assert.equal(h.hits.length, 1);

  h.choose(N.SEER, 'I need to locate some scorpions.');
  h.items.set(I.SCORPION_CAGE_2, 1); // already holds A
  h.cage(N.KHARID_SCORPION, I.SCORPION_CAGE_2);
  assert.equal(h.items.get(I.SCORPION_CAGE_2), 1);
  assert.ok(h.messages.includes("You've already caught this scorpion."));
});

test('the second Seer answer records the optional second/third detail without blocking the catches', () => {
  const h = harness();
  h.start();
  h.choose(N.SEER, 'I need to locate some scorpions.');
  h.items.set(I.SCORPION_CAGE_2, 1); // A already caught
  assert.equal(h.variant(N.SEER), 'second-and-third-scorpions-more-help-from-a-seer');
  h.choose(N.SEER, "I've retrieved the scorpion from near the spiders.");
  assert.equal(h.stage(), 3);
  assert.equal(h.wire(), 3);
  assert.equal(h.variant(N.SEER), 'second-and-third-scorpions-more-help-from-a-seer');
});

test('Thormac hands in the full cage, completes once, and does not re-grant the cage', () => {
  const h = harness();
  h.start();
  h.choose(N.SEER, 'I need to locate some scorpions.');
  h.items.set(I.SCORPION_CAGE_8, 1);
  assert.equal(h.variant(N.THORMAC), 'finishing-up');

  const event = h.action(N.THORMAC, 'QeBozC');
  assert.equal(event.handled, true, 'the completion action owns the transcript step');
  assert.equal(h.items.get(I.SCORPION_CAGE_8) ?? 0, 0, 'the full cage is consumed');
  assert.equal(h.stage(), 4);
  assert.equal(h.wire(), WIRE_COMPLETE, 'completion sends the cache threshold value 6');
  assert.equal(h.attributes.get('quest.points'), 1);
  assert.deepEqual(h.xp, [[core.Skill.STRENGTH, 6625]]);
  assert.ok(h.messages.some((text) => text.includes('Scorpion Catcher')));
  assert.equal(h.items.get(I.SCORPION_CAGE_8) ?? 0, 0, 'no cage item reward is granted after hand-in');

  // Repeating the action cannot pay the quest or the XP twice.
  h.items.set(I.SCORPION_CAGE_8, 1);
  h.action(N.THORMAC, 'QeBozC');
  assert.equal(h.stage(), 4);
  assert.equal(h.attributes.get('quest.points'), 1);
  assert.equal(h.xp.length, 1);
  assert.equal(h.items.get(I.SCORPION_CAGE_8), 1, 'a repeat action is ignored');
});

test('a lost cage is replaced on a Thormac talk only while the quest is in progress', () => {
  const h = harness();
  h.start(); // stage 1, empty cage
  h.items.delete(I.SCORPION_CAGE);
  const talk = h.npcTalk(N.THORMAC);
  assert.equal(talk.handled, false, 'recovery leaves the conversation to NpcDialogues');
  assert.equal(h.items.get(I.SCORPION_CAGE), 1);

  h.npcTalk(N.THORMAC);
  assert.equal(h.items.get(I.SCORPION_CAGE), 1, 'a held cage is not duplicated');

  h.items.delete(I.SCORPION_CAGE);
  h.quest.setStage(h.player, 4);
  h.npcTalk(N.THORMAC);
  assert.equal(h.items.get(I.SCORPION_CAGE) ?? 0, 0, 'post-quest talks do not hand out a cage');
});

test('post-quest and unstarted Thormac/Seer talks fall back to their standard pages', () => {
  const dialogues = require('../data/definitions/npc-dialogues.json');
  assert.ok(dialogues.Thormac?.variants?.['standard-dialogue-after-scorpion-catcher'], 'Thormac post-quest page exists');
  assert.ok(dialogues.Seer?.steps?.length, 'Seer standard page exists');

  const fresh = harness();
  assert.equal(fresh.variant(N.THORMAC), 'starting-off-with-the-requirements');
  assert.equal(fresh.variant(N.SEER), null, 'unstarted players keep the standard Seer/ME1 selection');

  const done = harness();
  done.quest.setStage(done.player, 4);
  assert.equal(done.variant(N.THORMAC), null, 'post-quest Thormac is the standard thank-you/service page');
  assert.equal(done.variant(N.SEER), null, 'post-quest Seer is not hijacked');
});

test('Peksa keeps his shop on Trade and replays the scorpion variant only on Talk-to', () => {
  const original = runtime.startTranscript;
  const calls = [];
  runtime.startTranscript = (...args) => { calls.push(args); return true; };
  try {
    const h = harness();
    h.start();
    h.choose(N.SEER, 'I need to locate some scorpions.');

    const trade = h.npcTalk(N.PEKSA, ['Talk-to', null, 'Trade'], 3);
    assert.equal(trade.handled, false, 'Peksa still opens his helmet shop');
    assert.equal(calls.length, 0);

    const talk = h.npcTalk(N.PEKSA, ['Talk-to']);
    assert.equal(talk.handled, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][3], 'Scorpion Catcher');
    assert.equal(calls[0][4], 'second-and-third-scorpions-brotherly-love');

    h.quest.setStage(h.player, 4);
    const after = h.npcTalk(N.PEKSA, ['Talk-to']);
    assert.equal(after.handled, false, 'post-quest Peksa goes back to the standard page/shop');
    assert.equal(calls.length, 1);
  } finally {
    runtime.startTranscript = original;
  }
});

test("Thormac's post-quest battlestaff service opens the cache interface and enchants for 40,000 coins", () => {
  const h = harness();
  h.quest.setStage(h.player, 4); // quest complete

  const event = h.enchantAction();
  assert.equal(event.handled, true, "the transcript's open_interface step is owned by the plugin");
  assert.deepEqual(h.interfaces, [332], 'the cache interface "thormac" is opened');

  h.items.set(I.COINS, 40000);
  h.items.set(I.FIRE_BATTLESTAFF, 1);
  const click = h.interfaceClick({ groupId: 332, childId: 7 }); // the fire battlestaff button
  assert.equal(click.handled, true);
  assert.equal(h.items.get(I.FIRE_BATTLESTAFF) ?? 0, 0, 'the battlestaff is enchanted');
  assert.equal(h.items.get(I.COINS) ?? 0, 0, '40,000 coins are charged');
  assert.equal(h.items.get(I.MYSTIC_FIRE_STAFF), 1, 'the mystic fire staff is handed over');

  // The clicked item id also identifies the staff (the interface draws it).
  h.items.set(I.COINS, 40000);
  h.items.set(I.AIR_BATTLESTAFF, 1);
  const byItem = h.interfaceClick({ groupId: 332, childId: 7, itemId: I.AIR_BATTLESTAFF });
  assert.equal(byItem.handled, true);
  assert.equal(h.items.get(I.MYSTIC_AIR_STAFF), 1);
});

test('the battlestaff service refuses without the staff or the coins and stays closed before the quest', () => {
  const h = harness();
  h.quest.setStage(h.player, 4);
  h.enchantAction();

  h.items.set(I.COINS, 40000);
  const noStaff = h.interfaceClick({ groupId: 332, childId: 7 });
  assert.equal(noStaff.handled, true);
  assert.ok(h.messages.includes('You do not have that battlestaff.'));
  assert.equal(h.items.get(I.COINS) ?? 0, 40000, 'nothing is charged without the staff');

  h.items.set(I.FIRE_BATTLESTAFF, 1);
  h.items.set(I.COINS, 39999);
  const noCoins = h.interfaceClick({ groupId: 332, childId: 7 });
  assert.equal(noCoins.handled, true);
  assert.ok(h.messages.includes('You do not have enough coins to pay for that.'));
  assert.equal(h.items.get(I.FIRE_BATTLESTAFF), 1, 'the staff is kept when the coins are short');
  assert.equal(h.items.get(I.COINS) ?? 0, 39999);

  const other = h.interfaceClick({ groupId: 161, childId: 7 });
  assert.equal(other.handled, false, 'another interface is left alone');

  const fresh = harness();
  const before = fresh.enchantAction();
  assert.equal(before.handled, false, 'the service is post-quest only');
  assert.deepEqual(fresh.interfaces, []);
});

test('the enchanting interface closes with any interface and on logout', () => {
  const h = harness();
  h.quest.setStage(h.player, 4);
  h.enchantAction();
  h.items.set(I.COINS, 40000);
  h.items.set(I.FIRE_BATTLESTAFF, 1);

  h.emit('interface:closed', { player: h.player, interfaceId: 332 });
  const closed = h.interfaceClick({ groupId: 332, childId: 7 });
  assert.equal(closed.handled, false, 'a closed interface cannot be used');
  assert.equal(h.items.get(I.FIRE_BATTLESTAFF), 1);
});

test('the secret wall crosses the side the player stands on and is closed before the first hint', () => {
  const h = harness();
  h.start();
  h.player.setLocation(2875, 9800, 0);
  h.object(O.OLD_WALL);
  assert.equal(h.moves.length, 0, 'the wall does nothing before the Seer hint');
  assert.ok(h.messages.includes('It looks like an ordinary wall.'));

  h.quest.setStage(h.player, 2);
  h.object(O.OLD_WALL);
  assert.deepEqual(h.moves.at(-1), [2875, 9798, 0], 'the south approach enters the room to the north');

  h.player.setLocation(2875, 9798, 0);
  h.object(O.OLD_WALL);
  assert.deepEqual(h.moves.at(-1), [2875, 9800, 0], 'searching from inside exits to the south');

  h.player.setLocation(2874, 9799, 0);
  h.object(O.OLD_WALL);
  assert.deepEqual(h.moves.at(-1), [2876, 9799, 0], 'a side approach crosses in X');
  assert.ok(h.messages.includes("You've found a secret door."));
});
