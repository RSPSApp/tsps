// Tree Gnome Village (q117) source contracts.
// From server/: node --test tests/qh728-q117.test.cjs
//
// Registered-handler tests: a starting stage and inventory are fixture-set where
// noted, then the plugin's real registered handlers receive the transcript/object
// events. The transcript runner itself is spied so these assert the selected page
// and variant, not a live dialogue playthrough.
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
const noop = () => {};
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;

const PAGE = 'Tree Gnome Village';
const VARP = 111;
const VARBIT_ORBS = 598;
const VARBIT_TRACKER_H = 599;
const VARBIT_TRACKER_Y = 600;
const VARBIT_TRACKER_X = 601;
const VARBIT_BALLISTA = 602;
const WARLORD_SPAWN = 4971;
const ELKOY_OUTSIDE = 6265;

function makePlayer() {
  const attrs = new Map();
  const slots = new Array(28).fill(null);
  const messages = [];
  const varbits = new Map();
  const configs = new Map();
  const experience = [];
  let full = false;
  let location = new core.Location(2541, 3170, 0);
  const used = () => slots.reduce((count, item) => count + (item ? 1 : 0), 0);

  const inventory = {
    getAmount(id) {
      return slots.reduce((total, item) => total + (item?.getId?.() === id ? item.getAmount() : 0), 0);
    },
    adds(id, amount = 1) {
      if (full) return false;
      for (let i = 0; i < amount; i++) {
        const slot = slots.indexOf(null);
        if (slot === -1) return false;
        slots[slot] = new core.Item(id, 1);
      }
      return true;
    },
    forceAdd(_player, item) {
      const slot = slots.indexOf(null);
      if (slot === -1) return false;
      slots[slot] = new core.Item(item.getId(), item.getAmount());
      return true;
    },
    deleteNumber(id, amount = 1) {
      let left = amount;
      for (let i = 0; i < slots.length && left > 0; i++) {
        if (slots[i]?.getId?.() !== id) continue;
        slots[i] = null;
        left--;
      }
      return left === 0;
    },
    getFreeSlots() { return full ? 0 : slots.filter((item) => item === null).length; },
    isFull() { return full || used() >= slots.length; },
    full() { messages.push('Not enough space in your inventory.'); },
  };

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const player = {
    attrs, messages, varbits, configs, experience,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    moveTo(next) { location = next; },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getSkillManager: () => ({
      addExperiences(skill, amount) { experience.push({ skill, amount }); },
    }),
    getUsername: () => 'qh728-q117',
    getPrivateArea: () => null,
    getLocation: () => location,
    isPlayer: () => true,
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
  };
  return player;
}

function harness() {
  const events = new Map();
  const variants = [];
  const conditions = [];
  const objectHooks = [];
  const deathHooks = [];
  const loginHooks = [];
  const transcripts = [];
  const groundItems = [];
  const api = new Proxy({
    core,
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onObjectInteraction: (handler) => objectHooks.push(handler),
    onNpcDeath: (handler) => deathHooks.push(handler),
    onPlayerLogin: (handler) => loginHooks.push(handler),
    onCustomEvent: (name, handler) => {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(handler);
    },
    emitCustomEvent: (name, event) => {
      for (const handler of events.get(name) ?? []) handler(event);
    },
    getItemOnGroundManager: () => ({
      registerLocation(player, item, at) { groundItems.push({ player, itemId: item.getId(), at }); },
      getGroundItem(owner, itemId, at) {
        return groundItems.find((entry) => entry.player.getUsername() === owner && entry.itemId === itemId
          && core.Location.isSameTile(entry.at, at)) ?? null;
      },
    }),
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const originalStart = runtime.startTranscript;
  runtime.startTranscript = (_api, _player, npcId, page, variant) => {
    transcripts.push({ npcId, page, variant });
    return true;
  };
  try {
    require('../plugins/quests/quests/TreeGnomeVillage.Quest')(api);
  } finally {
    runtime.startTranscript = originalStart;
  }
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'tree_gnome_village');
  return { events, variants, conditions, objectHooks, deathHooks, loginHooks, transcripts, groundItems, quest };
}

function emit(h, name, event) {
  for (const handler of h.events.get(name) ?? []) handler(event);
}

function variant(h, player, npcId) {
  for (const handler of h.variants) {
    const choice = handler({ npcId, player });
    if (choice) return choice;
  }
  return null;
}

function choose(h, player, npcId, option) {
  emit(h, 'npc-dialogue:choice', { player, npcId, option });
}

function condition(h, player, npcId, stepId, text) {
  let answer = null;
  for (const handler of h.conditions) {
    const result = handler({ player, npcId, stepId, text });
    if (typeof result === 'boolean') { answer = result; break; }
  }
  // NpcDialogues emits condition_chosen only for the branch it actually picks.
  if (answer === true) emit(h, 'npc-dialogue:condition', { player, npcId, stepId, text });
  return answer;
}

function action(h, player, npcId, stepId) {
  const event = { player, npcId, stepId, handled: false, end: false };
  emit(h, 'npc-dialogue:action', event);
  return event;
}

function object(h, player, objectId, option) {
  const event = {
    player, object: { getId: () => objectId }, objectId, option,
    location: player.getLocation(), handled: false, clickType: 1,
  };
  for (const handler of h.objectHooks) handler(event);
  return event;
}

function death(h, player, npcId) {
  const event = { npcId, killer: player, npc: { getId: () => npcId }, damagers: [player], location: player.getLocation() };
  for (const handler of h.deathHooks) handler(event);
  return event;
}

test('fresh stage 0 to completion follows the helper stage order and canonical wire', () => {
  const h = harness();
  const p = makePlayer();
  assert.equal(h.quest.getStage(p), 0);
  assert.deepEqual(variant(h, p, N.KING_BOLREN), { page: PAGE, variant: 'tree-gnome-king' });

  emit(h, 'npc-dialogue:hook', { player: p, npcId: N.KING_BOLREN, hook: 'quest:tree-gnome-village:start' });
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(p.configs.get(VARP), 1, 'stage 1 is transmitted on varp 111');
  assert.equal(p.varbits.get(VARBIT_ORBS), 0);
  assert.equal(p.varbits.get(VARBIT_TRACKER_H), 0);
  assert.equal(p.getLocation().x, 2504, 'the start transcript guides the player out of the maze');

  assert.equal(variant(h, p, N.COMMANDER_MONTAI).variant, 'battlefield-commander-montai');
  choose(h, p, N.COMMANDER_MONTAI, "Ok, I'll gather some wood.");
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.configs.get(VARP), 2);

  assert.equal(variant(h, p, N.KING_BOLREN).variant,
    'tree-gnome-king-talking-to-king-bolren-again-after-agreeing-to-bring-logs-to-montai');
  p.getInventory().adds(I.LOGS, 6);
  condition(h, p, N.COMMANDER_MONTAI, 'cu5-py', 'If the player has 6 logs in their inventory:');
  assert.equal(h.quest.getStage(p), 3);
  assert.equal(p.getInventory().getAmount(I.LOGS), 0);

  assert.equal(variant(h, p, N.COMMANDER_MONTAI).variant, 'battlefield-talking-to-commander-montai-afterwards');
  choose(h, p, N.COMMANDER_MONTAI, "I'll try my best.");
  assert.equal(h.quest.getStage(p), 4);
  const coordinate = p.getAttribute('tree-gnome-village:ballista-coordinate');
  assert.ok(coordinate >= 0 && coordinate <= 3);
  assert.equal(p.varbits.get(VARBIT_BALLISTA), coordinate);

  assert.equal(variant(h, p, N.TRACKER_GNOME_1).variant, 'battlefield-tracker-gnomes-tracker-gnome-1');
  action(h, p, N.TRACKER_GNOME_1, 'eBZQ_A');
  assert.equal(p.varbits.get(VARBIT_TRACKER_H), 1);
  action(h, p, N.TRACKER_GNOME_2, '8H1UCb');
  assert.equal(p.varbits.get(VARBIT_TRACKER_Y), 1);
  const answers = ['FBaYjB', 'cLo8NW', 'RDXbKP', 'TPAWlA'].map((id, index) =>
    condition(h, p, N.TRACKER_GNOME_3, id,
      `If the coordinate is ${['one', 'two', 'three', 'four'][index]}:`));
  assert.deepEqual(answers, [0, 1, 2, 3].map((value) => value === coordinate));
  assert.equal(p.varbits.get(VARBIT_TRACKER_X), 1);

  object(h, p, 2181, 'Fire');
  assert.deepEqual(h.transcripts.at(-1), { npcId: N.COMMANDER_MONTAI, page: PAGE, variant: 'using-the-ballista' });
  const wrong = coordinate === 3 ? 1 : coordinate + 2;
  choose(h, p, N.COMMANDER_MONTAI, `000${wrong}`);
  assert.equal(condition(h, p, N.COMMANDER_MONTAI, '1G3SE7', 'If the player chooses the correct coordinate:'), false);
  assert.equal(h.quest.getStage(p), 4, 'a wrong coordinate does not advance');
  choose(h, p, N.COMMANDER_MONTAI, `000${coordinate + 1}`);
  assert.equal(condition(h, p, N.COMMANDER_MONTAI, '1G3SE7', 'If the player chooses the correct coordinate:'), true);
  assert.equal(h.quest.getStage(p), 5);
  assert.equal(p.configs.get(VARP), 5);

  object(h, p, 2185, 'Climb-over');
  assert.equal(p.getLocation().y, 3254);
  object(h, p, 2183, 'Open');
  assert.deepEqual(h.transcripts.at(-1), {
    npcId: N.KHAZARD_COMMANDER, page: PAGE,
    variant: 'into-the-stronghold-upon-opening-the-chest-containing-the-orb-of-protection',
  });
  action(h, p, N.KHAZARD_COMMANDER, 'PatYnA');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 1);
  assert.equal(h.quest.getStage(p), 6);

  assert.equal(variant(h, p, N.KING_BOLREN).variant, 'bringing-bolren-the-orb');
  choose(h, p, N.KING_BOLREN, 'I will find the warlord and bring back the orbs.');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 0);
  assert.equal(h.quest.getStage(p), 7);
  assert.equal(variant(h, p, N.KING_BOLREN).variant,
    'into-the-stronghold-talking-to-bolren-without-the-orb-after-finding-it');

  death(h, p, WARLORD_SPAWN);
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 1);
  death(h, p, WARLORD_SPAWN);
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 1, 'a repeat kill grants no second orb set');

  assert.equal(variant(h, p, N.KING_BOLREN).variant, 'return-of-the-orb');
  action(h, p, N.KING_BOLREN, '51Oq7J');
  assert.equal(h.quest.getStage(p), 9);
  assert.equal(p.configs.get(VARP), 9, 'cache completion threshold: varp 111 at 9');
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 0);
  assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 1);
  assert.deepEqual(p.experience, [{ skill: core.Skill.ATTACK, amount: 11450 }]);
  assert.equal(p.varbits.get(VARBIT_ORBS), 2);

  action(h, p, N.KING_BOLREN, '51Oq7J');
  assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 1, 'repeat completion grants nothing');
  assert.equal(p.experience.length, 1);

  p.varbits.clear();
  p.configs.clear();
  for (const handler of h.loginHooks) handler({ player: p });
  for (const quest of [h.quest]) runtime.sendQuestVarps({ player: p });
  assert.equal(p.configs.get(VARP), 9, 'login replays the saved stage on varp 111');
  assert.equal(p.varbits.get(VARBIT_ORBS), 2);
  assert.equal(p.varbits.get(VARBIT_BALLISTA), coordinate);
  assert.equal(p.varbits.get(VARBIT_TRACKER_H), 1);
});

test('early and out-of-order actions do not advance or duplicate quest items', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  p.getInventory().adds(I.LOGS, 6);
  condition(h, p, N.COMMANDER_MONTAI, 'cu5-py', 'If the player has 6 logs in their inventory:');
  assert.equal(h.quest.getStage(p), 1, 'logs are only taken while Montai waits for them');
  assert.equal(p.getInventory().getAmount(I.LOGS), 6);

  h.quest.setStage(p, 4);
  object(h, p, 2183, 'Open');
  action(h, p, N.KHAZARD_COMMANDER, 'PatYnA');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 0, 'the chest needs the ballista stage');

  h.quest.setStage(p, 8);
  action(h, p, N.KING_BOLREN, '51Oq7J');
  assert.equal(h.quest.getStage(p), 8, 'completion requires the orbs in hand');
  assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 0);

  h.quest.setStage(p, 4);
  object(h, p, 2181, 'Fire');
  assert.equal(p.messages.at(-1), 'You need the coordinates from all three tracker gnomes first.');
  assert.equal(h.transcripts.at(-1)?.variant, undefined, 'the ballista transcript waits for all trackers');
});

test('lost first orb is recoverable from the chest and a full bag drops it on the floor', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 6);
  object(h, p, 2183, 'Open');
  action(h, p, N.KHAZARD_COMMANDER, 'PatYnA');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 1, 'the lost orb comes back from the chest');

  const full = makePlayer();
  h.quest.setStage(full, 5);
  full.setFull(true);
  action(h, full, N.KHAZARD_COMMANDER, 'PatYnA');
  assert.equal(full.getInventory().getAmount(I.ORB_OF_PROTECTION), 0);
  assert.equal(h.groundItems.length, 1);
  assert.equal(h.groundItems[0].itemId, I.ORB_OF_PROTECTION);
  assert.equal(h.quest.getStage(full), 6);
});

test('lost orbs after the warlord are recoverable by killing him again', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 8);
  death(h, p, WARLORD_SPAWN);
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 1);

  h.quest.setStage(p, 8);
  p.getInventory().deleteNumber(I.ORBS_OF_PROTECTION, 1);
  death(h, p, WARLORD_SPAWN);
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 1, 'a lost orb set can be regained');
  assert.equal(h.quest.getStage(p), 8);
});

test('post-quest NPCs use their canonical pages, including transformed warlord forms', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 9);
  assert.equal(variant(h, p, N.KING_BOLREN), null, 'Bolren remains available to other indexed quest pages');
  assert.deepEqual(variant(h, p, N.COMMANDER_MONTAI), {
    page: 'Commander Montai', variant: 'after-returning-the-orb-of-protection-to-king-bolren',
  });
  for (const [npcId, npcPage] of [
    [N.TRACKER_GNOME_1, 'Tracker gnome 1'],
    [N.TRACKER_GNOME_2, 'Tracker gnome 2'],
    [N.TRACKER_GNOME_3, 'Tracker gnome 3'],
  ]) {
    assert.deepEqual(variant(h, p, npcId), {
      page: npcPage, variant: 'after-returning-the-orb-of-protection-to-king-bolren',
    });
  }
  p.setLocation(2504, 3191, 0);
  assert.deepEqual(variant(h, p, ELKOY_OUTSIDE), {
    page: 'Elkoy', variant: 'after-the-completion-of-tree-gnome-village-while-at-the-maze-entrance',
  });
  assert.deepEqual(variant(h, p, WARLORD_SPAWN), {
    page: 'Khazard warlord', variant: 'after-killing-him-in-tree-gnome-village',
  });
  for (const npcId of [N.KHAZARD_WARLORD_2, N.KHAZARD_WARLORD_3]) {
    assert.deepEqual(variant(h, p, npcId), {
      page: 'Khazard warlord', variant: 'after-killing-him-in-tree-gnome-village',
    });
  }
  p.setLocation(2520, 3165, 0);
  assert.deepEqual(variant(h, p, ELKOY_OUTSIDE), {
    page: 'Elkoy', variant: 'after-the-completion-of-tree-gnome-village-while-inside-the-village',
  });

  const fresh = makePlayer();
  fresh.setLocation(2504, 3191, 0);
  assert.deepEqual(variant(h, fresh, ELKOY_OUTSIDE), {
    page: 'Elkoy', variant: 'before-starting-tree-gnome-village-while-outside-the-maze',
  });

  const active = makePlayer();
  h.quest.setStage(active, 7);
  active.setLocation(2504, 3191, 0);
  assert.equal(variant(h, active, ELKOY_OUTSIDE).variant,
    'bringing-bolren-the-orb-talking-to-elkoy-after-giving-bolren-the-orb-of-protection-outside-the-maze');
  active.setLocation(2520, 3165, 0);
  assert.equal(variant(h, active, ELKOY_OUTSIDE).variant,
    'bringing-bolren-the-orb-talking-to-elkoy-after-giving-bolren-the-orb-of-protection-inside-the-maze');
});

test('post-quest Bolren recovery only awards the amulet on the canonical loss branch', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 9);
  const conditionIds = ['jhUV9W', 'khpxfY', 'a0UQ7j'];

  for (const stepId of conditionIds) {
    assert.equal(condition(h, p, N.KING_BOLREN, stepId, 'If the player has lost the gnome amulet:'), true);
  }
  action(h, p, N.KING_BOLREN, 'SoVY4z');
  assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 1);
  for (const stepId of conditionIds) {
    assert.equal(condition(h, p, N.KING_BOLREN, stepId, 'If the player has lost the gnome amulet:'), false);
  }
  action(h, p, N.KING_BOLREN, 'SoVY4z');
  assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 1, 'replaying the receipt cannot duplicate the amulet');

  p.getInventory().deleteNumber(I.GNOME_AMULET, 1);
  for (const stepId of ['LUAm8Y', 'wWnJYI']) {
    action(h, p, N.KING_BOLREN, stepId);
    assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 1, `${stepId} restores the missing receipt`);
    p.getInventory().deleteNumber(I.GNOME_AMULET, 1);
  }
  p.setFull(true);
  for (const stepId of ['SoVY4z', 'LUAm8Y', 'wWnJYI']) action(h, p, N.KING_BOLREN, stepId);
  assert.equal(h.groundItems.filter((entry) => entry.itemId === I.GNOME_AMULET).length, 1,
    'a full bag leaves one recoverable amulet across repeated receipt nodes');
});

test('Elkoy travel options move the player between the entrance and the centre', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  p.setLocation(2504, 3191, 0);
  choose(h, p, ELKOY_OUTSIDE, 'Yes please.');
  assert.equal(p.getLocation().x, 2541);
  assert.equal(p.getLocation().y, 3170);
  choose(h, p, ELKOY_OUTSIDE, 'Can you show me out of the village?');
  assert.equal(p.getLocation().x, 2504);
  assert.equal(p.getLocation().y, 3191);
});
