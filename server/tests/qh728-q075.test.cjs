// From server/: node --test tests/qh728-q075.test.cjs (after yarn build).
//
// Monkey Madness I source-contract test. It dispatches the registered plugin
// handlers for the Quest Helper route from a fresh stage 0 to completion.
// Starting inventory/state is deliberately fixtured where the source route
// needs an item that another plugin or a wait provides; those points are
// labelled. The test does not prove a live packet path, scene transitions or
// the Quest Helper overlay.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;

let nextIndex = 1;
const noop = () => {};
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function harness(names = ['MonkeyMadnessI']) {
  const firstQuest = runtime.getRegisteredQuests().length;
  const hooks = {}, events = {}, npcs = [];
  const api = new Proxy({
    core: { ...core, World: { ...core.World, getNpcsNear: () => npcs } },
    getItemOnGroundManager: () => ({ registerLocation: noop }),
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    persistAttribute: noop,
    spawnNpc(definition) {
      const npc = { ...definition, getId: () => definition.id, getIndex: () => nextIndex++,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        isRegistered: () => !npc.removed, getOwner: () => definition.owner,
        getCombat: () => ({ attack: noop, reset: noop }) };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => { npc.removed = true; },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  for (const name of names) require(`../plugins/quests/quests/${name}.Quest`)(api);
  // The Grand Tree and Tree Gnome Village count as finished unless a test
  // says otherwise (the wiki's requirement list).
  api.onCustomEvent('quest:is-complete', request => {
    if (request.key === 'grand_tree' || request.key === 'tree_gnome_village') request.complete = true;
  });
  const addedQuests = runtime.getRegisteredQuests().slice(firstQuest);
  const h = {
    api, hooks, events, npcs,
    quest: addedQuests.find(quest => quest.key === 'monkey_madness_i') ?? addedQuests.at(-1),
    quests: new Map(addedQuests.map(quest => [quest.key, quest])),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    variant(p, npcId) {
      for (const fn of hooks.onNpcDialogueVariant ?? []) {
        const answer = fn({ player: p, npcId });
        if (typeof answer === 'string') return { variant: answer };
        if (answer) return answer;
      }
      return null;
    },
    condition(p, npcId, stepId) {
      for (const fn of hooks.onNpcDialogueCondition ?? []) {
        const answer = fn({ player: p, npcId, stepId });
        if (answer !== null && answer !== undefined) return answer;
      }
      return null;
    },
    line(p, npcId, text) { const event = { player: p, npcId, text }; h.emit('npc-dialogue:line', event); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId, handled: false }; h.emit('npc-dialogue:action', event); return event; },
    choice(p, npcId, option) { h.emit('npc-dialogue:choice', { player: p, npcId, option }); },
    npc(p, npcId, option = 'Talk-to') {
      const event = { player: p, npcId, clickType: 1, definition: { getActions: () => [option] }, handled: false };
      (hooks.onNpcInteraction ?? []).forEach(fn => fn(event)); return event;
    },
    object(p, objectId, option = 'Open') {
      const event = { player: p, objectId, clickType: 1, definition: { getActions: () => [option] }, handled: false };
      (hooks.onObjectInteraction ?? []).forEach(fn => fn(event)); return event;
    },
    itemOnNpc(p, npcId, itemId) {
      const event = { player: p, npcId, itemId, handled: false };
      (hooks.onItemOnNpc ?? []).forEach(fn => fn(event)); return event;
    },
    itemOnObject(p, itemId, objectId) {
      const event = { player: p, itemId, objectId, handled: false };
      (hooks.onItemOnObject ?? []).forEach(fn => fn(event)); return event;
    },
    itemOnItem(p, usedItemId, usedWithItemId) {
      const event = { player: p, usedItemId, usedWithItemId, handled: false };
      (hooks.onItemOnItem ?? []).forEach(fn => fn(event)); return event;
    },
    zone(p) { (hooks.onZoneEnter ?? []).forEach(fn => fn({ player: p })); },
    death(npc, killer) { (hooks.onNpcDeath ?? []).forEach(fn => fn({ npc, killer })); },
  };
  return h;
}

function container(size) {
  let items = Array.from({ length: size }, () => new core.Item(-1, 0));
  const overflow = [];
  return {
    overflow,
    getItems: () => items,
    getAmount: id => items.filter(item => item.getId() === id).reduce((n, item) => n + item.getAmount(), 0),
    getFreeSlots: () => items.filter(item => item.getId() < 0).length,
    isFull: () => items.every(item => item.getId() >= 0),
    // The engine's forceAdd drops the item at the player's tile when the bag is
    // full (ItemContainer.forceAdd), so a full bag never swallows a reward.
    forceAdd(player, item) {
      const slot = items.findIndex(entry => entry.getId() < 0);
      if (slot >= 0) items[slot] = item;
      else overflow.push(item);
    },
    get: slot => items[slot],
    set(slot, item) { items[slot] = item; },
    adds(id, amount) {
      const stack = items.find(item => item.getId() === id && item.getAmount() > 0);
      if (stack) { stack.setAmount(stack.getAmount() + amount); return; }
      const slot = items.findIndex(item => item.getId() < 0);
      assert.ok(slot >= 0, `inventory full adding ${id}`);
      items[slot] = new core.Item(id, amount);
    },
    deleteNumber(id, amount) {
      let left = amount;
      for (let i = 0; i < items.length && left > 0; i++) {
        const item = items[i];
        if (item.getId() !== id) continue;
        const taken = Math.min(left, item.getAmount());
        left -= taken;
        items[i] = item.getAmount() > taken ? new core.Item(id, item.getAmount() - taken) : new core.Item(-1, 0);
      }
      assert.equal(left, 0, `missing ${amount} of item ${id}`);
    },
  };
}

function player() {
  const attrs = new Map(), varbits = new Map(), messages = [], xp = [];
  let location = new core.Location(2465, 3496, 0), text = '';
  const inventory = container(28), equipment = container(14);
  const packet = new Proxy({
    sendConfig: noop, sendVarbit: (id, value) => varbits.set(id, value), getVarbit: id => varbits.get(id) ?? 0,
    getVarp: () => 0, sendInterfaceRemoval: noop,
  }, { get: (t, key) => t[key] ?? (() => packet) });
  let manager;
  const p = { attrs, varbits, messages, xp, inventory, equipment,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory, getEquipment: () => equipment, getPacketSender: () => packet,
    getDialogueManager: () => manager,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]) }),
    getLocation: () => location, moveTo: to => { location = to; },
    getAppearance: () => ({ isMale: () => true }),
    getUsername: () => 'q075', sendMessage: value => messages.push(value),
    getCombat: () => ({ reset: noop }), getHitpoints: () => 99,
  };
  manager = new DialogueManager(p);
  Object.defineProperty(p, 'text', { get: () => text, set: value => { text = value; } });
  Object.defineProperty(p, 'manager', { value: manager });
  return p;
}

function monkeyMadness() {
  const h = harness(), p = player();
  return { h, p };
}

function equip(p, slot, itemId) {
  p.equipment.set(slot, new core.Item(itemId, 1));
}

/** A map object as the Ladders plugin hands it over: its id and its placement. */
function mapObject(objectId, x, y, z) {
  return {
    getId: () => objectId,
    getLocation: () => new core.Location(x, y, z),
    getFace: () => 0,
    getType: () => 10,
  };
}

/** A ladders:climb request for the object standing at that tile. */
function climbRequest(p, objectId, x, y, z, clickType = 1) {
  return {
    player: p, objectId, clickType, handled: false,
    object: mapObject(objectId, x, y, z),
  };
}

/** The climbs the quest hands to the Ladders plugin. */
function captureClimbs(h) {
  const climbs = [];
  h.api.onCustomEvent('ladders:climbUp', request => climbs.push({ direction: 'up', ...request }));
  h.api.onCustomEvent('ladders:climbDown', request => climbs.push({ direction: 'down', ...request }));
  return climbs;
}

/** The tile a climb lands on. */
function tile(climb) {
  const destination = climb?.destination;
  return destination ? [destination.getX(), destination.getY(), destination.getZ()] : null;
}

test('Monkey Madness I: stage 0 route reaches completion and grants the reward once', () => {
  const { h, p } = monkeyMadness();
  const STAGE = {
    started: 1, shipyard: 2, orders: 3, daero: 4, reinitialised: 5,
    crash: 6, atoll: 7, chapters: 8, complete: 9, training: 10,
  };

  // Fresh stage 0: the transcript's start hook and its seal message.
  h.emit('npc-dialogue:hook', { player: p, npcId: N.KING_NARNODE_SHAREEN, hook: 'quest:monkey-madness-i:start' });
  assert.equal(h.quest.getStage(p), STAGE.started);
  h.action(p, N.KING_NARNODE_SHAREEN, 'AT80aC');
  assert.equal(p.inventory.getAmount(I.GNOME_ROYAL_SEAL), 1);

  // Shipyard: selectors are read-only; the canonical final lines set progress.
  assert.equal(h.variant(p, N.G_L_O_CARANOCK).variant, 'chapter-1-talking-to-g-l-o-caranock');
  assert.equal(h.quest.getStage(p), STAGE.started);
  assert.equal(p.varbits.get(122) ?? 0, 0, 'opening Caranock does not advance Quest Helper');
  h.line(p, N.G_L_O_CARANOCK, 'I shall personally see to the decommission. You should report to the King immediately.');
  assert.equal(h.quest.getStage(p), STAGE.shipyard);
  assert.equal(p.varbits.get(122), 3, 'Quest Helper sees the Caranock conversation');
  assert.equal(h.variant(p, N.KING_NARNODE_SHAREEN).variant, 'chapter-1-returning-to-king-narnode');
  assert.equal(h.quest.getStage(p), STAGE.shipyard, 'opening Narnode does not advance the quest');
  assert.equal(p.varbits.get(121), undefined, 'opening Narnode does not advance Quest Helper');
  h.action(p, N.KING_NARNODE_SHAREEN, '1b-5vN');
  assert.equal(h.quest.getStage(p), STAGE.orders);
  assert.equal(p.varbits.get(121), 7, 'Quest Helper sees the report to Narnode');
  assert.equal(p.inventory.getAmount(I.NARNODES_ORDERS), 1);

  // Daero takes the orders, blindfolds the player, and the hangar introduces the puzzle.
  assert.equal(h.variant(p, N.DAERO).variant, 'chapter-1-speaking-to-daero');
  h.action(p, N.DAERO, 'S_fRY7');
  assert.equal(h.quest.getStage(p), STAGE.daero);
  assert.equal(p.inventory.getAmount(I.NARNODES_ORDERS), 0);
  h.action(p, N.DAERO, 'XnjEtK');
  assert.equal(p.getLocation().getX(), 2394);
  assert.equal(h.variant(p, N.DAERO).variant, 'chapter-1-the-underground-hangar-speaking-to-daero-in-the-underground-hangar');

  const panel = h.object(p, O.REINITIALISATION_PANEL, 'Operate');
  assert.equal(panel.handled, true);
  assert.equal(h.quest.getStage(p), STAGE.reinitialised);
  assert.equal(h.variant(p, N.DAERO).variant, 'chapter-1-the-underground-hangar-speaking-to-daero-in-the-underground-hangar-after-the-puzzle-is-complete');
  assert.equal(p.getAttribute('quest.monkey_madness_i.post-puzzle-talk'), undefined,
    'opening the post-puzzle dialogue does not mark it complete');
  h.line(p, N.DAERO,
    "Well done, adventurer. You have managed to break Glough's code. Now the process of reinitialisation is complete, you can truly begin your journey into the unknown.");
  assert.equal(p.getAttribute('quest.monkey_madness_i.post-puzzle-talk'), true);
  assert.equal(p.varbits.get(123), 7);
  assert.equal(h.variant(p, N.WAYDAR).variant, 'chapter-1-speaking-to-waydar-after-solving-the-puzzle-travelling-with-waydar');
  h.line(p, N.WAYDAR, "Yes, let's go.");
  assert.equal(h.quest.getStage(p), STAGE.crash);
  assert.equal(p.getLocation().getX(), 2892);

  // Crash Island: Waydar persuades Lumdo; Lumdo rows to the atoll.
  assert.equal(h.variant(p, N.WAYDAR).variant, 'chapter-1-landing-on-crash-island-speaking-to-waydar-on-crash-island');
  assert.equal(h.variant(p, N.WAYDAR).variant, 'chapter-1-landing-on-crash-island-returning-to-waydar-on-crash-island');
  h.action(p, N.WAYDAR, '7EU-SF');
  assert.equal(h.quest.getStage(p), STAGE.atoll);
  assert.equal(h.variant(p, N.LUMDO_3).variant, 'chapter-2-talking-to-lumbo-on-crash-island');
  h.line(p, N.LUMDO_3, 'As you wish.');
  assert.equal(p.getLocation().getX(), 2803);

  // The west valley jails a human; the cell door opens by picking its lock.
  h.zone(p);
  assert.equal(p.getAttribute('quest.monkey_madness_i.jail'), 1);
  h.object(p, O.JAIL_DOOR, 'Pick-lock');
  assert.equal(p.getAttribute('quest.monkey_madness_i.jail'), 2);
  assert.equal(p.getLocation().getX(), 2779);

  // Garkor and the amulet parts.
  assert.equal(h.variant(p, N.GARKOR).variant, 'chapter-2-talking-to-garkor');
  assert.equal(p.varbits.get(126) ?? 0, 0, 'opening Garkor does not advance Quest Helper');
  assert.equal(p.getAttribute('quest.monkey_madness_i.garkor-asked'), undefined);
  h.line(p, N.GARKOR, 'Just go and find my squad mage, human.');
  assert.equal(p.varbits.get(126), 2, 'Quest Helper sees Garkor first spoken to');
  h.object(p, O.CRATE_43, 'Search');
  h.action(p, N.ZOOKNOCK, '7s1ZAu');
  assert.equal(p.inventory.getAmount(I.MONKEY_DENTURES), 1);
  h.object(p, O.CRATE_42, 'Search');
  h.action(p, N.ZOOKNOCK, 'bJv66b');
  assert.equal(p.getLocation().getY(), 9165);
  h.object(p, O.CRATE_52, 'Search');
  h.action(p, N.ZOOKNOCK, 'zVVEXd');
  assert.equal(p.inventory.getAmount(I.MAMULET_MOULD), 1);

  // Zooknock: first talk, then the three amulet parts in either order.
  assert.equal(h.variant(p, N.ZOOKNOCK).variant, 'chapter-2-talking-to-zooknock');
  assert.equal(p.varbits.get(127) ?? 0, 0, 'opening Zooknock does not advance Quest Helper');
  assert.equal(p.getAttribute('quest.monkey_madness_i.zooknock-met'), undefined);
  h.line(p, N.ZOOKNOCK,
    'I am Zooknock, the 10th squad mage. These are Bunkwicket and Waymottin, two of our finest sappers. I assume you will want to know how we got here?');
  h.line(p, N.ZOOKNOCK,
    'I have the necessary magic to perform the shapeshifting spell, but we needed a human to transform.');
  assert.equal(p.varbits.get(127), 5, 'Quest Helper advances after the Garkor/Zooknock conversation');
  p.inventory.adds(I.GOLD_BAR, 1);
  // Item-on-NPC starts the transcript, whose message steps run the real
  // hand-over handler (the same code a live dialogue reaches).
  h.itemOnNpc(p, N.ZOOKNOCK, I.MONKEY_DENTURES);
  assert.equal(p.getAttribute('quest.monkey_madness_i.dentures-given'), true);
  assert.equal(p.inventory.getAmount(I.MONKEY_DENTURES), 0);
  h.itemOnNpc(p, N.ZOOKNOCK, I.MAMULET_MOULD);
  assert.equal(p.getAttribute('quest.monkey_madness_i.mould-given'), true);
  assert.equal(p.inventory.getAmount(I.MAMULET_MOULD), 0);
  assert.equal(h.condition(p, N.ZOOKNOCK, 'aH18LQ'), false,
    'the branch is not ready until the gold-bar handover message runs');
  h.itemOnNpc(p, N.ZOOKNOCK, I.GOLD_BAR);
  assert.equal(p.inventory.getAmount(I.GOLD_BAR), 0);
  assert.equal(h.condition(p, N.ZOOKNOCK, 'aH18LQ'), true,
    'the transcript checks the all-items-given condition after FYkajk consumes the bar');
  h.action(p, N.ZOOKNOCK, 'URF9yW');
  assert.equal(p.inventory.getAmount(I.ENCHANTED_BAR), 1);
  assert.equal(p.inventory.getAmount(I.MAMULET_MOULD), 1);

  // Temple trapdoor, wall of flame, then string the amulet and climb out.
  const climbs = captureClimbs(h);
  p.moveTo(new core.Location(2807, 2784, 0)); // teleport out to resupply, as the source route does
  h.object(p, O.TRAPDOOR_20, 'Open');
  assert.deepEqual(tile(climbs.at(-1)), [2808, 9200, 0], 'the trapdoor drops the player into the temple dungeon');
  p.moveTo(new core.Location(2807, 2784, 0)); // the open object's Climb-down is the natural second click
  const trapdoorClimb = climbRequest(p, O.TRAPDOOR_21, 2807, 2785, 0);
  h.emit('ladders:climb', trapdoorClimb);
  assert.equal(trapdoorClimb.handled, true);
  assert.deepEqual(tile(climbs.at(-1)), [2808, 9200, 0]);
  p.inventory.adds(I.BALL_OF_WOOL, 1);
  h.itemOnObject(p, I.ENCHANTED_BAR, O.WALL_OF_FLAME);
  assert.equal(p.inventory.getAmount(I.ENCHANTED_BAR), 0);
  assert.equal(p.inventory.getAmount(I.MSPEAK_AMULET_2), 1);
  h.itemOnItem(p, I.BALL_OF_WOOL, I.MSPEAK_AMULET_2);
  assert.equal(p.inventory.getAmount(I.MSPEAK_AMULET), 1);
  const templeClimb = climbRequest(p, O.CLIMBING_ROPE_7, 2808, 9201, 0);
  h.emit('ladders:climb', templeClimb);
  assert.equal(templeClimb.handled, true);
  assert.deepEqual(tile(climbs.at(-1)), [2807, 2784, 0], 'the rope climbs up to the temple surface');

  // Monkey child: five bananas, then the talisman after the source wait.
  p.inventory.adds(I.BANANA, 5);
  h.variant(p, N.MONKEY_CHILD);
  h.choice(p, N.MONKEY_CHILD, "Well I'll be a monkey's uncle!");
  h.choice(p, N.MONKEY_CHILD, 'How many bananas did Aunty want?');
  h.action(p, N.MONKEY_CHILD, 'QOZti5');
  assert.equal(p.inventory.getAmount(I.BANANA), 0);
  p.setAttribute('quest.monkey_madness_i.child-bananas-at', Date.now() - 60000); // elapsed aunt round
  assert.equal(h.variant(p, N.MONKEY_CHILD).variant, 'chapter-2-monkey-talisman-talking-to-the-monkey-child-after-he-receives-the-toy');
  h.action(p, N.MONKEY_CHILD, '795Rk5');
  assert.equal(p.inventory.getAmount(I.MONKEY_TALISMAN), 1);

  // Zooknock turns the talisman and monkey remains into the greegree.
  p.inventory.adds(I.MONKEY_BONES, 1);
  h.itemOnNpc(p, N.ZOOKNOCK, I.MONKEY_TALISMAN);
  h.action(p, N.ZOOKNOCK, 'RiFs2s');
  h.itemOnNpc(p, N.ZOOKNOCK, I.MONKEY_BONES);
  h.action(p, N.ZOOKNOCK, '-wRWky');
  h.action(p, N.ZOOKNOCK, 'hOYpYN');
  assert.equal(p.inventory.getAmount(I.KARAMJAN_MONKEY_GREEGREE), 1);
  assert.equal(h.quest.getStage(p), STAGE.chapters);
  equip(p, core.Equipment.WEAPON_SLOT, I.KARAMJAN_MONKEY_GREEGREE);

  // Ardougne Zoo: talk the minder as a monkey, take a monkey, then leave.
  p.moveTo(new core.Location(2602, 3280, 0));
  h.npc(p, N.MONKEY_MINDER);
  assert.equal(p.getAttribute('quest.monkey_madness_i.monkey-captured'), true);
  assert.equal(h.variant(p, N.MONKEY_7).variant, 'chapter-3-talking-to-a-monkey-in-the-cage');
  assert.equal(p.inventory.getAmount(I.MONKEY), 1);
  equip(p, core.Equipment.WEAPON_SLOT, -1);
  h.npc(p, N.MONKEY_MINDER);
  assert.equal(p.getAttribute('quest.monkey_madness_i.monkey-captured'), false);

  // Disguise: Garkor, the guard, Kruk's teleport, Awowogei, then the sigil.
  equip(p, core.Equipment.WEAPON_SLOT, I.KARAMJAN_MONKEY_GREEGREE);
  assert.equal(h.variant(p, N.GARKOR).variant, 'chapter-3-talking-to-garkor-while-disguised');
  assert.equal(p.varbits.get(126), 2, 'opening the disguise dialogue does not advance Quest Helper');
  h.line(p, N.GARKOR,
    'I need you now to seek audience with Awowogei. Claim you are an envoy from the monkeys of Karamja and are seeking an alliance.');
  assert.equal(p.varbits.get(126), 3, 'Quest Helper sees Garkor spoken to while disguised');
  assert.equal(h.variant(p, N.GARKOR).variant, 'chapter-3-talking-to-garkor-again-after-showing-him-a-karamjam-monkey-disguise');
  assert.equal(h.variant(p, N.ELDER_GUARD).variant, 'chapter-3-talking-to-an-elder-guard');
  const bridgeClimb = climbRequest(p, O.BAMBOO_LADDER_7, 2729, 2766, 2);
  h.emit('ladders:climb', bridgeClimb);
  assert.equal(bridgeClimb.handled, true);
  assert.deepEqual(tile(climbs.at(-1)), [2730, 2766, 0], 'the watchtower ladder comes down next to Kruk');
  assert.equal(h.variant(p, N.KRUK).variant, 'chapter-3-talking-to-kruk');
  h.action(p, N.KRUK, 'AhUbiz');
  assert.equal(p.getLocation().getX(), 2800);
  h.object(p, O.AWOWOGEI, 'Talk-to');
  assert.equal(p.getAttribute('quest.monkey_madness_i.awowogei-met'), true);
  h.object(p, O.AWOWOGEI, 'Talk-to');
  assert.equal(p.getAttribute('quest.monkey_madness_i.monkey-delivered'), true);
  assert.equal(p.inventory.getAmount(I.MONKEY), 0);
  assert.equal(h.variant(p, N.GARKOR).variant, 'chapter-3-returning-to-garkor');
  h.action(p, N.GARKOR, 'NP0anE');
  assert.equal(h.variant(p, N.GARKOR).variant, 'chapter-4');
  h.action(p, N.GARKOR, '1ZViOR');
  assert.equal(p.varbits.get(126), 6, 'Quest Helper sees the squad sigil handover');
  assert.equal(p.inventory.getAmount(I._10TH_SQUAD_SIGIL), 1);

  // Sigil: spawn and fight the owner-only demon, then report to Narnode.
  h.action(p, N.GARKOR, 'vEetSW');
  const demon = h.npcs.find(npc => npc.getId() === N.JUNGLE_DEMON);
  assert.ok(demon, 'owner-only Jungle Demon spawned');
  assert.equal(p.getLocation().getZ(), 1);
  h.death(demon, p);
  assert.equal(p.getAttribute('quest.monkey_madness_i.demon-killed'), true);
  assert.equal(h.variant(p, N.KING_NARNODE_SHAREEN).variant, 'chapter-4-returning-to-king-narnode');
  h.action(p, N.KING_NARNODE_SHAREEN, 'iKXnuQ');
  assert.equal(h.quest.getStage(p), STAGE.complete);
  assert.equal(p.inventory.getAmount(I.COINS), 10000);
  assert.equal(p.inventory.getAmount(I.DIAMOND), 3);
  assert.ok(p.messages.some(text => text.includes('Congratulations')));

  p.varbits.clear();
  (h.hooks.onPlayerLogin ?? []).forEach(fn => fn({ player: p }));
  assert.deepEqual([121, 122, 126, 127].map(id => p.varbits.get(id)), [7, 3, 6, 5],
    'login restores the Quest Helper milestones from persisted quest state');

  // Repeating the completion action must not grant a second reward.
  h.action(p, N.KING_NARNODE_SHAREEN, 'iKXnuQ');
  assert.equal(p.inventory.getAmount(I.COINS), 10000);
  assert.equal(p.inventory.getAmount(I.DIAMOND), 3);

  // Post-quest Daero training is once only.
  h.action(p, N.DAERO, 'KpGxV1');
  assert.equal(h.quest.getStage(p), STAGE.training);
  assert.equal(p.xp.length, 4);
  h.action(p, N.DAERO, '2R3K5Y');
  assert.equal(p.xp.length, 4, 'training cannot be claimed twice');
});

test('Monkey Madness I recovery: lost seal and lost orders are reissued, Waymottin replaces a lost sigil', () => {
  const { h, p } = monkeyMadness();
  h.quest.setStage(p, 2);
  assert.equal(h.variant(p, N.KING_NARNODE_SHAREEN).variant, 'chapter-1-talking-to-king-narnode-shareen');
  h.action(p, N.KING_NARNODE_SHAREEN, 'AT80aC');
  assert.equal(p.inventory.getAmount(I.GNOME_ROYAL_SEAL), 1);

  h.quest.setStage(p, 3);
  p.inventory.adds(I.NARNODES_ORDERS, 1);
  h.npc(p, N.KING_NARNODE_SHAREEN);
  p.inventory.deleteNumber(I.NARNODES_ORDERS, 1);
  h.npc(p, N.KING_NARNODE_SHAREEN);
  h.action(p, N.KING_NARNODE_SHAREEN, 'g-Kuxc');
  assert.equal(p.inventory.getAmount(I.NARNODES_ORDERS), 1);

  h.quest.setStage(p, 8);
  p.setAttribute('quest.monkey_madness_i.sigil-given', true);
  assert.equal(h.variant(p, N.WAYMOTTIN).variant, 'chapter-4-talking-to-waymottin-without-a-sigil');
  h.action(p, N.WAYMOTTIN, '5DPD9f');
  assert.equal(p.inventory.getAmount(I._10TH_SQUAD_SIGIL), 1);
});

test('Monkey Madness I temple: the already-open trapdoor (4880) also descends', () => {
  const { h, p } = monkeyMadness();
  const climbs = captureClimbs(h);
  h.quest.setStage(p, 7);
  p.moveTo(new core.Location(2807, 2784, 0));
  const event = h.object(p, O.TRAPDOOR_21, 'Climb-down');
  assert.equal(event.handled, true);
  assert.deepEqual(tile(climbs.at(-1)), [2808, 9200, 0], 'the open trapdoor drops into the temple dungeon');
});

test('Monkey Madness I login does not spawn a second Grand Tree Daero', () => {
  const { h, p } = monkeyMadness();
  const before = h.npcs.length;
  (h.hooks.onPlayerLogin ?? []).forEach(fn => fn({ player: p }));
  assert.equal(h.npcs.length, before, 'the existing npc 2020 spawn at 2484,3486 is enough');
  assert.equal(p.varbits.get(123), 0, 'login still sends the mm_daero transform varbit');
});

test('Monkey Madness I claims only its own climbs, in the direction the option names', () => {
  const { h, p } = monkeyMadness();
  const climbs = captureClimbs(h);

  // The temple trapdoor on the surface: Climb-down drops into the dungeon.
  const trapdoor = climbRequest(p, O.TRAPDOOR_21, 2807, 2785, 0);
  h.emit('ladders:climb', trapdoor);
  assert.equal(trapdoor.handled, true);
  assert.deepEqual(tile(climbs.at(-1)), [2808, 9200, 0]);

  // The trapdoor's other option (Close) is not a climb.
  const close = climbRequest(p, O.TRAPDOOR_21, 2807, 2785, 0, 2);
  h.emit('ladders:climb', close);
  assert.equal(close.handled, false, 'Close is left to the Doors plugin');
  assert.equal(climbs.length, 1);

  // The temple rope in the dungeon: the bare "Climb" option leads up.
  const rope = climbRequest(p, O.CLIMBING_ROPE_7, 2808, 9201, 0);
  h.emit('ladders:climb', rope);
  assert.equal(rope.handled, true);
  assert.equal(climbs.at(-1).direction, 'up');
  assert.deepEqual(tile(climbs.at(-1)), [2807, 2784, 0]);

  // The mould-room rope in the cavern climbs up to the denture house.
  const mouldRope = climbRequest(p, O.CLIMBING_ROPE_8, 2764, 9165, 0);
  h.emit('ladders:climb', mouldRope);
  assert.equal(mouldRope.handled, true);
  assert.deepEqual(tile(climbs.at(-1)), [2770, 2767, 0]);

  // The watchtower's top ladder is on the tower's upper floor and climbs down.
  const watchtower = climbRequest(p, O.BAMBOO_LADDER_7, 2729, 2766, 2);
  h.emit('ladders:climb', watchtower);
  assert.equal(watchtower.handled, true);
  assert.equal(climbs.at(-1).direction, 'down');
  assert.deepEqual(tile(climbs.at(-1)), [2730, 2766, 0]);

  // The same object id somewhere else in the world is not the quest's climb.
  const elsewhere = climbRequest(p, O.CLIMBING_ROPE_7, 2800, 2800, 0);
  h.emit('ladders:climb', elsewhere);
  assert.equal(elsewhere.handled, false, 'the claim is scoped to the object placement');
  assert.equal(climbs.length, 4);
});

test('Narnode stage and orders survive cancel/reopen through the imported transcript runner', () => {
  const { h, p } = monkeyMadness();
  h.quest.setStage(p, 2);
  p.inventory.adds(I.GNOME_ROYAL_SEAL, 1);
  const variant = h.variant(p, N.KING_NARNODE_SHAREEN).variant;
  assert.equal(variant, 'chapter-1-returning-to-king-narnode');

  assert.equal(runtime.startTranscript(h.api, p, N.KING_NARNODE_SHAREEN, 'Monkey Madness I', variant), true);
  p.manager.reset();
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.inventory.getAmount(I.NARNODES_ORDERS), 0);
  assert.equal(p.varbits.get(121) ?? 0, 0);

  assert.equal(h.variant(p, N.KING_NARNODE_SHAREEN).variant, variant);
  assert.equal(runtime.startTranscript(h.api, p, N.KING_NARNODE_SHAREEN, 'Monkey Madness I', variant), true);
  let guard = 100;
  while (p.manager.getCurrent() && guard-- > 0) p.manager.advance();
  assert.ok(guard > 0, 'transcript runner finishes');
  assert.equal(h.quest.getStage(p), 3);
  assert.equal(p.inventory.getAmount(I.NARNODES_ORDERS), 1);
  assert.equal(p.varbits.get(121), 7);
});

test('Monkey Madness I start: The Grand Tree and Tree Gnome Village are required', () => {
  const { h, p } = monkeyMadness();
  const done = { grand_tree: false, tree_gnome_village: false };
  h.api.onCustomEvent('quest:is-complete', request => {
    if (request.key in done) request.complete = done[request.key];
  });

  h.emit('npc-dialogue:hook', { player: p, npcId: N.KING_NARNODE_SHAREEN, hook: 'quest:monkey-madness-i:start' });
  assert.equal(h.quest.getStage(p), 0, 'the quest does not start without the prerequisites');
  assert.equal(h.action(p, N.KING_NARNODE_SHAREEN, 'AT80aC').handled, true,
    'the refused handover suppresses the transcript message');
  assert.equal(p.inventory.getAmount(I.GNOME_ROYAL_SEAL), 0, 'no royal seal while the start is refused');
  assert.ok(p.messages.some(text => text.includes('The Grand Tree')));

  done.grand_tree = true;
  h.emit('npc-dialogue:hook', { player: p, npcId: N.KING_NARNODE_SHAREEN, hook: 'quest:monkey-madness-i:start' });
  assert.equal(h.quest.getStage(p), 0, 'one prerequisite is not enough');

  done.tree_gnome_village = true;
  h.emit('npc-dialogue:hook', { player: p, npcId: N.KING_NARNODE_SHAREEN, hook: 'quest:monkey-madness-i:start' });
  assert.equal(h.quest.getStage(p), 1);
  h.action(p, N.KING_NARNODE_SHAREEN, 'AT80aC');
  assert.equal(p.inventory.getAmount(I.GNOME_ROYAL_SEAL), 1);
});

test('Monkey Madness I reward: a full inventory drops the reward instead of losing it', () => {
  const { h, p } = monkeyMadness();
  for (let slot = 0; slot < 28; slot++) p.inventory.adds(1000 + slot, 1);
  assert.equal(p.inventory.isFull(), true);

  h.quest.setStage(p, 8);
  h.action(p, N.KING_NARNODE_SHAREEN, 'iKXnuQ');
  assert.equal(h.quest.getStage(p), 9);

  const dropped = p.inventory.overflow;
  const coins = dropped.filter(item => item.getId() === I.COINS)
    .reduce((sum, item) => sum + item.getAmount(), 0);
  const diamonds = dropped.filter(item => item.getId() === I.DIAMOND)
    .reduce((sum, item) => sum + item.getAmount(), 0);
  assert.equal(coins, 10000, 'the whole 10,000 coin reward is recoverable');
  assert.equal(diamonds, 3, 'the three diamonds are recoverable');
  assert.equal(p.inventory.getAmount(I.COINS), 0, 'nothing was squeezed into the full bag');

  // A second hand-in must not pay the reward twice.
  h.action(p, N.KING_NARNODE_SHAREEN, 'iKXnuQ');
  assert.equal(p.inventory.overflow.length, dropped.length, 'the reward is granted once');
});

test('MM1 yields throne object 4771 once MM2 is complete; MM2 canonical dialogue remains reachable', () => {
  const calls = [];
  const originalStartTranscript = runtime.startTranscript;
  runtime.startTranscript = function (...args) {
    calls.push({ npcId: args[2], page: args[3], variant: args[4] });
    return originalStartTranscript.apply(this, args);
  };
  let h;
  try {
    h = harness(['MonkeyMadnessI', 'MonkeyMadnessII']);
  } finally {
    runtime.startTranscript = originalStartTranscript;
  }
  const mm1 = h.quests.get('monkey_madness_i');
  const mm2 = h.quests.get('monkey_madness_ii');
  assert.ok(mm1 && mm2, 'both original quest plugins are registered');
  // QuestRuntime registers its quest:is-complete answer once per process; this
  // isolated test bus answers from the real registered MM2 handle instead.
  h.api.onCustomEvent('quest:is-complete', request => {
    if (request.key === 'monkey_madness_ii') request.complete = mm2.isComplete(request.player);
  });

  // Before MM2 completion, MM1 still owns the throne object and starts its route.
  const before = player();
  mm1.setStage(before, 8);
  const beforeEvent = h.object(before, O.AWOWOGEI, 'Talk-to');
  assert.equal(beforeEvent.handled, true);
  assert.equal(before.getAttribute('quest.monkey_madness_i.awowogei-met'), true);

  // After real MM2 completion the throne object plays MM2's canonical page.
  const after = player();
  mm1.setStage(after, 8);
  mm2.complete(after);
  assert.equal(mm2.isComplete(after), true);
  calls.length = 0;
  const afterEvent = h.object(after, O.AWOWOGEI, 'Talk-to');
  assert.equal(afterEvent.handled, true);
  assert.equal(after.getAttribute('quest.monkey_madness_i.awowogei-met'), undefined);
  assert.ok(
    calls.some(call => call.page === 'Awowogei' && call.variant === 'after-completing-monkey-madness-ii'),
    `expected MM2's canonical variant, got ${JSON.stringify(calls)}`,
  );

  // MM2's own after-completion Awowogei conversation is still selected.
  const talk = h.npc(after, N.AWOWOGEI_4, 'Talk-to');
  assert.equal(talk.handled, true);
  assert.ok(
    calls.some(call => call.page === 'Awowogei' && call.variant === 'after-completing-monkey-madness-ii'),
    `expected MM2 canonical variant, got ${JSON.stringify(calls)}`
  );
});
