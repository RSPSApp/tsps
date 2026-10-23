// From server/: node --test tests/qh728-q061.test.cjs
// Focused In Aid of the Myreque contracts. The route dispatches the plugin's
// registered handlers with the transcript's own condition/action/choice ids;
// it does not drive the live dialogue runner, and no live playthrough is claimed.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

// Record which transcript page/variant each handler asks to play. The wrapper
// still calls the real startTranscript, so dialogue execution is unchanged.
let transcriptCalls = [];
const startTranscript = runtime.startTranscript;
runtime.startTranscript = (...args) => {
  transcriptCalls.push({ npcId: args[2], page: args[3], variant: args[4] });
  return startTranscript(...args);
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
  require('../plugins/items/ElementalStaves.plugin.js').register(
    PluginManager.createApi('QH728MyrequeSpellRuneSourceTest')
  );
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const experience = [];
  const log = [];
  const bonusManager = { attackBonus: [], defenceBonus: [], otherBonus: [] };
  let full = false;
  let location = new core.Location(0, 0, 0);
  let spellbook = core.MagicSpellbook.NORMAL;
  let weapon = -1;
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    deletes: (item) => inventory.deleteNumber(item.getId(), item.getAmount()),
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter((amount) => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    full: () => messages.push('Not enough space in your inventory.'),
    getItems: () => {
      const slots = Array.from({ length: 28 }, () => new core.Item(-1, 0));
      let slot = 0;
      for (const [id, amount] of items) if (amount > 0) slots[slot++] = new core.Item(id, amount);
      return slots;
    },
    addItem: (item) => inventory.adds(item.getId(), item.getAmount()),
  };
  const sender = new Proxy({}, { get: (_target, prop) => (...args) => { log.push([String(prop), ...args]); return sender; } });
  return {
    attrs, items, messages, moves, experience, log,
    setFull(value) { full = value; },
    setSpellbook(value) { spellbook = value; },
    setWeapon(value) { weapon = value; },
    getSpellbook: () => spellbook,
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({
      get: () => weapon < 0 ? null : { getId: () => weapon },
      getItems: () => Array.from({ length: 14 }, (_, index) => new core.Item(index === core.Equipment.WEAPON_SLOT ? weapon : -1, 1)),
      hasStaffEquipped: () => false,
      getWeapon: () => ({ getId: () => weapon }),
    }),
    getUsername: () => 'q061-test',
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: (next) => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences: (skill, amount) => experience.push([skill, amount]) }),
    getFightType: () => ({ getStyle: () => 0 }),
    getBonusManager: () => bonusManager,
    getAppearance: () => ({ isMale: () => true }),
    performAnimation: noop,
    performGraphic: noop,
    getCombat: () => ({ reset: noop, setCastSpell: noop, setAutocastSpell: noop }),
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
    isPlayerBot: () => false,
    isPlayer: () => true,
  };
}

function harness() {
  transcriptCalls = [];
  const events = {};
  let tasteNeedsRod = false;
  let tasteRodQueryCount = 0;
  const conditions = [];
  const itemOnObject = [];
  const itemOnItem = [];
  const spellOnItem = [];
  const itemOnNpc = [];
  const itemAction = [];
  const objectInteraction = [];
  const npcDeath = [];
  const npcInteractions = [];
  const login = [];
  const logout = [];
  const spawned = [];
  const completedQuests = new Set();

  class FakeGameObject {
    constructor(id, location) { this.id = id; this.location = location; }
    getId() { return this.id; }
    getLocation() { return this.location; }
  }
  const objectManager = {
    register: (object) => object,
    deregister: () => {},
  };
  const testCore = Object.create(core);
  testCore.ObjectManager = objectManager;
  testCore.GameObject = FakeGameObject;
  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onItemOnObject: (handler) => itemOnObject.push(handler),
    onItemOnItem: (handler) => itemOnItem.push(handler),
    onSpellOnItem: (handler) => spellOnItem.push(handler),
    onItemOnNpc: (handler) => itemOnNpc.push(handler),
    onItemAction: (handler) => itemAction.push(handler),
    onObjectInteraction: (handler) => objectInteraction.push(handler),
    onNpcDeath: (handler) => npcDeath.push(handler),
    onNpcInteraction: (name, options) => {
      for (const [option, handler] of Object.entries(options)) npcInteractions.push({ name, option, handler });
    },
    onPlayerLogin: (handler) => login.push(handler),
    onPlayerLogout: (handler) => logout.push(handler),
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach((handler) => handler(event)),
    spawnNpc: (data) => {
      const npc = { ...data, getId: () => data.id, getLocation: () => new core.Location(data.x, data.y, data.z) };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => { if (npc) npc.removed = true; },
    sendMultiChatboxPrompt: noop,
  }, { get: (target, key) => target[key] ?? noop });

  // The quest registry asks the other quests whether they are complete.
  (events['quest:is-complete'] ??= []).push((event) => {
    event.complete = completedQuests.has(event.key);
  });
  (events['taste-of-hope:needs-veliaf-rod'] ??= []).push((request) => {
    tasteRodQueryCount += 1;
    request.needsRod = tasteNeedsRod;
  });
  require('../plugins/items/ElementalStaves.plugin.js').register(api);
  require(process.env.Q061_PLUGIN || '../plugins/quests/quests/InAidOfTheMyreque.Quest')(api);
  require('../plugins/skills/EnchantJewellery.plugin.js').register(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const fireEvent = (key, event) => (events[key] ?? []).forEach((handler) => handler(event));
  const talk = (name, npcId) => {
    for (const entry of npcInteractions) {
      if (entry.name === name && entry.option === 'Talk-to') {
        return entry.handler({ player: eventPlayer, npcId, option: 'Talk-to', handled: false });
      }
    }
    return undefined;
  };
  let eventPlayer = null;
  const use = (player) => { eventPlayer = player; };
  const condition = (player, stepId) => {
    const event = { player, stepId, pages: [{ page: 'In Aid of the Myreque' }] };
    conditions.forEach((handler) => handler(event));
    fireEvent('npc-dialogue:condition', { ...event });
  };
  const action = (player, stepId, npcId = -1) => {
    const event = { player, npcId, stepId, handled: false };
    fireEvent('npc-dialogue:action', event);
    return event;
  };
  const choice = (player, option) => fireEvent('npc-dialogue:choice', { player, option, stepId: null });
  const loginPlayer = (player) => {
    login.forEach((handler) => handler({ player }));
    // QuestRuntime registers this once per process; call it explicitly so each
    // test harness gets the same login replay.
    runtime.sendQuestVarps({ player });
  };
  const interact = (player, objectId, location = { x: 0, y: 0, z: 0 }, extra = {}) => {
    const event = { player, objectId, location, ...extra, handled: false };
    objectInteraction.forEach((handler) => handler(event));
    return event;
  };
  const useOnObject = (player, itemId, objectId, extra = {}) => {
    const event = { player, itemId, objectId, ...extra, handled: false };
    itemOnObject.forEach((handler) => handler(event));
    return event;
  };
  const useOnItem = (player, usedItemId, usedWithItemId) => {
    const event = { player, usedItemId, usedWithItemId, handled: false };
    itemOnItem.forEach((handler) => handler(event));
    return event;
  };
  const castOnItem = (player, itemId, spellName = 'Lvl-1 Enchant', slot = null) => {
    if (slot === null) slot = player.getInventory().getItems().findIndex((item) => item.getId() === itemId);
    const event = { player, itemId, spellName, slot, handled: false };
    spellOnItem.forEach((handler) => handler(event));
    return event;
  };
  const kill = (player, npcId) => npcDeath.forEach((handler) => handler({ killer: player, npcId, npc: {} }));

  return { quest, completedQuests, conditions, itemOnNpc, itemAction, spawned,
    use, talk, condition, action, choice, loginPlayer, interact, useOnObject, useOnItem, castOnItem, kill,
    emit: fireEvent, setTasteNeedsRod(value) { tasteNeedsRod = value; },
    tasteRodQueryCount: () => tasteRodQueryCount,
    questStartHook: (event) => fireEvent('npc-dialogue:hook', event),
    transcripts: () => transcriptCalls.slice() };
}

const Q = (h) => h.quest;
const stage = (h, p) => Q(h).getStage(p);
const items = (p, list) => { for (const [id, amount] of list) p.items.set(id, amount); };
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;
const ALL_PREREQUISITES = ['in_search_of_the_myreque', 'nature_spirit', 'priest_in_peril', 'the_restless_ghost'];

test('fresh stage 0 reaches completion through the helper route', () => {
  const h = harness();
  for (const key of ALL_PREREQUISITES) h.completedQuests.add(key);
  const p = makePlayer();
  h.use(p);
  h.loginPlayer(p);

  assert.equal(stage(h, p), 0, 'fresh stage 0');
  const startEvent = { player: p, npcId: N.VELIAF_HURTZ_2, hook: 'quest:in-aid-of-the-myreque:start', handled: false };
  h.questStartHook(startEvent);
  assert.equal(stage(h, p), 20, 'Veliaf start hook');

  // Food on the chest opens Burgh de Rott.
  items(p, [[I.SHRIMPS, 1]]);
  h.useOnObject(p, I.SHRIMPS, O.OPEN_CHEST_21);
  assert.equal(stage(h, p), 30, 'food placed in the gate chest');
  assert.equal(p.items.get(I.SHRIMPS) ?? 0, 0, 'the food is consumed');

  h.choice(p, "Are there any 'out of the way' places here?");
  assert.equal(stage(h, p), 50, 'Razvan points at the inn');

  // Pickaxe on the inn rubble, open the trapdoor, climb down.
  items(p, [[I.BRONZE_PICKAXE, 1]]);
  h.interact(p, O.RUBBLE_7, { x: 3490, y: 3232, z: 0 });
  assert.equal(stage(h, p), 60, 'entrance rubble mined');
  h.interact(p, O.TRAPDOOR_50, { x: 3490, y: 3232, z: 0 });
  assert.equal(stage(h, p), 80, 'trapdoor opened');
  p.setLocation(3490, 3232, 0);

  // Three basement rubble piles, then the pile is scooped with a spade.
  for (const [id, x] of [[O.RUBBLE_8, 3489], [O.RUBBLE_9, 3491], [O.RUBBLE_10, 3493]]) {
    h.interact(p, id, { x, y: 9627, z: 0 });
  }
  items(p, [[I.SPADE, 1], [I.BUCKET, 1]]);
  h.useOnObject(p, I.SPADE, O.PILE_OF_RUBBLE_3, { location: { x: 3492, y: 9627, z: 0 } });
  assert.equal(stage(h, p), 100, 'cellar cleared');
  assert.equal(p.items.get(I.BUCKET_OF_RUBBLE) ?? 0, 1, 'bucket of rubble received');
  assert.equal(p.items.get(I.BUCKET) ?? 0, 0, 'empty bucket used');

  // Aurel: offer to help, repair roof and wall, then take the crate.
  assert.equal(h.talk('Aurel', N.AUREL), true);
  h.choice(p, "I'd like to help fix up the town.");
  assert.equal(stage(h, p), 120, 'store repairs agreed');
  items(p, [[I.PLANK, 3], [I.BRONZE_NAILS, 12], [I.HAMMER, 1]]);
  h.condition(p, 'QvHBD5');
  assert.equal(stage(h, p), 150, 'roof fixed');
  assert.equal(p.items.get(I.PLANK) ?? 0, 0, 'roof planks consumed');
  items(p, [[I.PLANK, 3], [I.BRONZE_NAILS, 12], [I.HAMMER, 1]]);
  h.condition(p, 'JHVR_s');
  assert.equal(stage(h, p), 160, 'shop wall fixed');
  h.condition(p, 'A1yJWY');
  assert.equal(stage(h, p), 165, 'crate handed out');
  assert.equal(p.items.get(I.CRATE) ?? 0, 1, 'empty crate received');

  // Fill the crate with the player's rolled fish type.
  const snail = Number(p.getAttribute('quest.in_aid_of_the_myreque.crate.fishtype')) === 1;
  items(p, [[I.BRONZE_AXE, 10], [I.TINDERBOX, 3], [snail ? I.THIN_SNAIL_MEAT : I.RAW_MACKEREL, 10]]);
  h.useOnItem(p, I.CRATE, I.BRONZE_AXE);
  h.useOnItem(p, I.CRATE, I.TINDERBOX);
  h.useOnItem(p, I.CRATE, snail ? I.THIN_SNAIL_MEAT : I.RAW_MACKEREL);
  assert.equal(p.items.get(I.CRATE_2) ?? 0, 1, 'full crate assembled');
  assert.equal(p.items.get(I.CRATE) ?? 0, 0, 'empty crate consumed');
  h.action(p, 'UsJ9P-', N.AUREL);
  assert.equal(stage(h, p), 170, 'crate handed in');
  assert.equal(p.items.get(I.CRATE_2) ?? 0, 0, 'full crate consumed');

  // Bank: booth, wall, Cornelius.
  items(p, [[I.PLANK, 2], [I.BRONZE_NAILS, 8], [I.HAMMER, 1], [I.SWAMP_PASTE, 1]]);
  h.condition(p, 'EEIDrs');
  assert.equal(stage(h, p), 180, 'bank booth fixed');
  items(p, [[I.PLANK, 3], [I.BRONZE_NAILS, 12], [I.HAMMER, 1]]);
  h.condition(p, '5z92aE');
  assert.equal(stage(h, p), 190, 'bank wall fixed');
  assert.equal(h.talk('Cornelius', N.CORNELIUS), true);
  h.action(p, 'rqRnfa', N.CORNELIUS);
  assert.equal(stage(h, p), 200, 'Cornelius becomes the banker');

  // Furnace: Razvan guidance, hole, fuel, light.
  assert.equal(h.talk('Razvan', N.RAZVAN), true, 'Razvan is talkable at the furnace leg');
  assert.equal(stage(h, p), 200, 'Razvan guidance does not skip the furnace stage');
  items(p, [[I.HAMMER, 1], [I.STEEL_BAR, 2]]);
  h.condition(p, 'h2dEwU');
  assert.equal(stage(h, p), 205, 'furnace hole fixed');
  items(p, [[I.COAL, 1]]);
  h.condition(p, '6cW9G2');
  assert.equal(stage(h, p), 210, 'furnace fuelled');
  items(p, [[I.TINDERBOX, 1]]);
  h.condition(p, 'hnlXcN');
  assert.equal(stage(h, p), 230, 'furnace lit and Gadderanks arrives');

  // Blood tithe: talk to Gadderanks, the juvinate and Wiskit, then fight.
  h.condition(p, 'c4DZLI');
  h.condition(p, 'a-RBs3');
  assert.equal(h.talk('Wiskit', N.WISKIT), true);
  h.action(p, 'p2YbVD', N.GADDERANKS);
  assert.equal(stage(h, p), 240, 'fight starts');
  h.kill(p, N.VAMPYRE_JUVINATE_15);
  h.kill(p, N.VAMPYRE_JUVINATE_16);
  assert.equal(stage(h, p), 260, 'juvinates defeated');
  assert.equal(h.talk('Gadderanks', N.GADDERANKS_3), true, 'wounded Gadderanks is talkable');
  h.action(p, 'G9lEti', N.GADDERANKS_3);
  assert.equal(stage(h, p), 280, 'Gadderanks dies and drops the hammer');
  assert.equal(p.items.get(I.GADDERHAMMER) ?? 0, 1, 'Gadderhammer received');

  // Veliaf in the store, then the hideout; Polmafi releases the escort step.
  assert.equal(h.talk('Veliaf Hurtz', N.VELIAF_HURTZ_2), true);
  h.action(p, 'OCv2XT', N.VELIAF_HURTZ_2);
  assert.equal(stage(h, p), 290, 'Veliaf returns to the Hollows');
  assert.equal(h.talk('Polmafi Ferdygris', N.POLMAFI_FERDYGRIS), true);
  h.condition(p, 'RRQbon');
  assert.equal(stage(h, p), 300, 'Polmafi informs the others and releases the escort');

  // Ivan escort.
  assert.equal(h.talk('Ivan Strom', N.IVAN_STROM_3), true);
  h.action(p, 'l-COOf', N.IVAN_STROM_3);
  assert.equal(stage(h, p), 310, 'escort starts');
  assert.deepEqual(p.moves.at(-1), [2859, 4564, 0], 'moved to the swamp trek tile');
  h.kill(p, N.VAMPYRE_JUVINATE_15);
  h.kill(p, N.VAMPYRE_JUVINATE_16);
  assert.equal(stage(h, p), 320, 'escort finished');
  assert.deepEqual(p.moves.at(-1), [3439, 9896, 0], 'moved to Drezel');

  // Drezel gives the key; the canonical ivandis bookcase supplies the book.
  assert.equal(h.talk('Drezel', N.DREZEL), true);
  h.action(p, 'B_kRtc', N.DREZEL);
  assert.equal(stage(h, p), 350, 'library key received');
  assert.equal(p.items.get(I.TEMPLE_LIBRARY_KEY) ?? 0, 1, 'Temple library key held');
  h.interact(p, O.KEYHOLE, { x: 3443, y: 9898, z: 0 });
  assert.equal(stage(h, p), 360, 'library opened');
  h.interact(p, O.BOOKCASE_52, { x: 3354, y: 9902, z: 0 });
  assert.equal(p.items.get(I.THE_SLEEPING_SEVEN) ?? 0, 1, 'the ivandis bookcase gives The Sleeping Seven');
  const read = { player: p, itemId: I.THE_SLEEPING_SEVEN, option: 'Read', handled: false };
  h.itemAction.forEach((handler) => handler(read));
  assert.equal(stage(h, p), 370, 'book read');

  // Boards, coffin mould, rod at a non-Burgh furnace, enchant, blessing.
  items(p, [[I.HAMMER, 1]]);
  h.useOnObject(p, I.HAMMER, O.WOODEN_BOARDS_2);
  assert.equal(stage(h, p), 380, 'boards removed');
  h.interact(p, O.CAVE_ENTRANCE_47, { x: 3484, y: 9832, z: 0 });
  assert.deepEqual(p.moves.at(-1), [3505, 9863, 0], 'entered the coffin room');
  items(p, [[I.SOFT_CLAY, 1]]);
  h.useOnObject(p, I.SOFT_CLAY, O.COFFIN_16);
  assert.equal(stage(h, p), 390, 'rod mould taken from the coffin');
  assert.equal(p.items.get(I.ROD_MOULD) ?? 0, 1, 'rod mould held');

  items(p, [[I.SILVER_BAR, 1], [I.MITHRIL_BAR, 1], [I.SAPPHIRE, 1]]);
  const furnace = { getDefinition: () => ({ getName: () => 'Furnace' }) };
  h.useOnObject(p, I.SILVER_BAR, 10082, { object: furnace });
  assert.equal(p.items.get(I.SILVTHRILL_ROD_2) ?? 0, 1, 'rod crafted at any furnace');
  assert.equal(p.items.get(I.ROD_MOULD) ?? 0, 1, 'the rod mould is a tool and is kept');
  items(p, [[I.COSMIC_RUNE, 1], [I.WATER_RUNE, 1]]);
  h.castOnItem(p, I.SILVTHRILL_ROD_2);
  assert.equal(stage(h, p), 400, 'rod enchanted');
  assert.equal(p.items.get(I.SILVTHRILL_ROD_3) ?? 0, 1, 'enchanted rod held');
  items(p, [[I.ROPE, 1]]);
  h.useOnObject(p, I.SILVTHRILL_ROD_3, 3485);
  assert.equal(stage(h, p), 410, 'rod blessed');
  assert.equal(p.items.get(I.ROD_OF_IVANDIS_10_) ?? 0, 1, 'Rod of Ivandis held');
  assert.equal(p.items.get(I.ROPE) ?? 0, 1, 'the rope is a tool and is kept');

  // Final hand-in.
  assert.equal(h.talk('Veliaf Hurtz', N.VELIAF_HURTZ_2), true);
  h.action(p, 'ruxiLW', N.VELIAF_HURTZ_2);
  assert.equal(stage(h, p), 420, 'quest complete');
  assert.equal(Q(h).isComplete(p), true);
  assert.equal(p.items.get(I.ROD_OF_IVANDIS_10_) ?? 0, 0, 'the rod is handed to Veliaf');
  assert.equal(p.getAttribute('quest.points'), 2, 'two quest points');
  assert.equal(p.experience.length, 5, 'Lvl-1 Enchant XP plus four 2,000 XP quest rewards');
  assert.deepEqual(p.experience.map(([, amount]) => amount), [17.5, 2000, 2000, 2000, 2000]);
  assert.ok(
    p.log.some(([op, id, value]) => op === 'sendVarbit' && id === 1990 && value === 430),
    'completion writes the canonical varbit 1990 = 430'
  );
  assert.ok(
    !p.log.some(([op, id]) => op === 'sendConfig' && id === 704),
    'the old varp 704 is not the quest wire'
  );
});

test('old completed saves replay as canonical varbit 1990 = 430', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  // Old durable save from the pre-fix plugin: internal stage 420, no wire write yet.
  p.attrs.set('quest.in_aid_of_the_myreque.stage', 420);
  p.log.length = 0;
  h.loginPlayer(p);
  assert.equal(Q(h).isComplete(p), true, 'the durable stage stays complete');
  assert.ok(
    p.log.some(([op, id, value]) => op === 'sendVarbit' && id === 1990 && value === 430),
    'login maps the old 420 save to the canonical 430 wire'
  );

  const mid = makePlayer();
  h.use(mid);
  mid.attrs.set('quest.in_aid_of_the_myreque.stage', 160);
  mid.log.length = 0;
  h.loginPlayer(mid);
  assert.ok(
    mid.log.some(([op, id, value]) => op === 'sendVarbit' && id === 1990 && value === 160),
    'mid-quest stages keep their QH value on the same varbit'
  );
});

test('completed In Aid yields Veliaf to A Taste of Hope\'s rod step', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 420); // fixture: completed In Aid handler contract
  // The public Taste query owns its state. Contradictory private attributes
  // ensure In Aid follows the event response instead of duplicating Taste's bits.
  p.attrs.set('quest.taste_of_hope.stage', 0);
  p.attrs.set('quest.taste_of_hope.bits', 0);
  h.setTasteNeedsRod(true);
  assert.equal(h.talk('Veliaf Hurtz', N.VELIAF_HURTZ_2), false, 'In Aid yields the shared NPC');
  assert.equal(h.tasteRodQueryCount(), 1, 'In Aid asks Taste through its public event');
  assert.ok(
    !h.transcripts().some((call) => call.page === 'In Aid of the Myreque'),
    'yielding does not start the In Aid post-quest transcript'
  );

  p.attrs.set('quest.taste_of_hope.stage', 120);
  p.attrs.set('quest.taste_of_hope.bits', 1 << 13);
  h.setTasteNeedsRod(false);
  assert.equal(h.talk('Veliaf Hurtz', N.VELIAF_HURTZ_2), true, 'In Aid keeps post-quest dialogue once Taste has the rod');
  assert.equal(h.tasteRodQueryCount(), 2);
  assert.ok(
    h.transcripts().some((call) => call.page === 'In Aid of the Myreque'),
    'In Aid post-quest dialogue is preserved when Taste no longer needs the hand-off'
  );

  p.items.set(7639, 1);
  assert.equal(h.talk('Veliaf Hurtz', N.VELIAF_HURTZ_2), true, 'holding any Rod variant keeps In Aid post-quest dialogue');
  assert.equal(h.tasteRodQueryCount(), 3);
});

test('out-of-order rubble work cannot skip the Veliaf/Florin/Razvan start', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  p.items.set(I.BRONZE_PICKAXE, 1);
  h.interact(p, O.RUBBLE_7, { x: 3490, y: 3232, z: 0 });
  assert.equal(stage(h, p), 0, 'stage-0 rubble mining does not start the quest');
  Q(h).setStage(p, 20);
  h.interact(p, O.RUBBLE_7, { x: 3490, y: 3232, z: 0 });
  assert.equal(stage(h, p), 20, 'stage-20 rubble mining still waits for Razvan');
  Q(h).setStage(p, 50);
  h.interact(p, O.RUBBLE_7, { x: 3490, y: 3232, z: 0 });
  assert.equal(stage(h, p), 60, 'the helper stage can mine the entrance');
});

test('the history bookcase is not the quest bookcase', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 360);
  h.interact(p, O.BOOKCASE_51, { x: 3354, y: 9899, z: 0 });
  assert.equal(p.items.get(I.THE_SLEEPING_SEVEN) ?? 0, 0, 'history bookcase gives no quest book');
  h.interact(p, O.BOOKCASE_52, { x: 3354, y: 9902, z: 0 });
  assert.equal(p.items.get(I.THE_SLEEPING_SEVEN) ?? 0, 1, 'ivandis bookcase gives the book');
});

test('a full bag does not consume Drezel\'s key branch', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 320);
  p.setFull(true);
  h.action(p, 'B_kRtc', N.DREZEL);
  assert.equal(stage(h, p), 320, 'stage stays before the key while the bag is full');
  assert.equal(p.items.get(I.TEMPLE_LIBRARY_KEY) ?? 0, 0, 'no key is lost');
  p.setFull(false);
  h.action(p, 'B_kRtc', N.DREZEL);
  assert.equal(stage(h, p), 350, 'retry with space gives the key');
  assert.equal(p.items.get(I.TEMPLE_LIBRARY_KEY) ?? 0, 1);
});

test('a lost or full-bag Gadderhammer uses Aurel\'s canonical recovery page', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 260);
  p.setFull(true);
  h.action(p, 'G9lEti', N.GADDERANKS_3);
  assert.equal(stage(h, p), 280, 'the quest still advances');
  assert.equal(p.items.get(I.GADDERHAMMER) ?? 0, 0, 'the hammer is not dropped into a full bag');
  p.setFull(false);

  assert.equal(h.talk('Aurel', N.AUREL), true);
  assert.ok(
    h.transcripts().some((call) => call.page === 'Aurel' && call.variant === 'if-the-player-has-lost-the-gadderhammer'),
    'Aurel offers the canonical lost-hammer recovery page'
  );

  const noCoins = { player: p, stepId: 'HxmbYb', pages: [{ page: 'Aurel' }] };
  const enoughCoins = { player: p, stepId: 'Z1JkRV', pages: [{ page: 'Aurel' }] };
  assert.equal(h.conditions.at(-1)(noCoins), true, 'not enough coins branch');
  assert.equal(h.conditions.at(-1)(enoughCoins), false, 'enough coins branch is false without coins');

  p.items.set(I.COINS, 3000);
  assert.equal(h.conditions.at(-1)(noCoins), false, 'enough coins branch is now false');
  assert.equal(h.conditions.at(-1)(enoughCoins), true, 'enough coins branch is now true');
  h.action(p, '6qLnJV', N.AUREL);
  assert.equal(p.items.get(I.GADDERHAMMER) ?? 0, 1, 'the hammer is bought back');
  assert.equal(p.items.get(I.COINS) ?? 0, 0, '3000 coins are consumed');
});

test('Aurel\'s post-quest standard page is used when the hammer is held', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 420);
  p.items.set(I.GADDERHAMMER, 1);
  assert.equal(h.talk('Aurel', N.AUREL), true);
  assert.ok(
    h.transcripts().some((call) => call.page === 'Aurel' && call.variant === 'standard-dialogue'),
    'holds the hammer: canonical Aurel page, not the quest repair page'
  );
});

test('a lost Temple library key can be reclaimed from Drezel before the library opens', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 350);
  assert.equal(h.talk('Drezel', N.DREZEL), true);
  assert.ok(
    h.transcripts().some((call) => call.page === 'In Aid of the Myreque' && call.variant === 'asking-drezel-about-ivandis'),
    'Drezel repeats the key conversation when the key is missing'
  );
  h.action(p, 'B_kRtc', N.DREZEL);
  assert.equal(stage(h, p), 350, 'the stage does not go backwards or skip forward');
  assert.equal(p.items.get(I.TEMPLE_LIBRARY_KEY) ?? 0, 1, 'the key is replaced');
});

test('the crate accepts raw snails and cooked snail meat', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 165);
  p.items.set(I.CRATE, 1);
  p.setAttribute('quest.in_aid_of_the_myreque.crate.fishtype', 1);
  items(p, [[I.BRONZE_AXE, 10], [I.TINDERBOX, 3], [I.THIN_SNAIL, 6], [I.FAT_SNAIL_MEAT, 4]]);
  h.useOnItem(p, I.CRATE, I.THIN_SNAIL);
  h.useOnItem(p, I.CRATE, I.FAT_SNAIL_MEAT);
  h.useOnItem(p, I.CRATE, I.BRONZE_AXE);
  h.useOnItem(p, I.CRATE, I.TINDERBOX);
  assert.equal(p.items.get(I.THIN_SNAIL) ?? 0, 0, 'raw snails are consumed');
  assert.equal(p.items.get(I.FAT_SNAIL_MEAT) ?? 0, 0, 'cooked snail meat is consumed');
  assert.equal(p.items.get(I.CRATE) ?? 0, 0, 'the empty crate is consumed');
  assert.equal(p.items.get(I.CRATE_2) ?? 0, 1, 'raw or cooked snails fill the crate');
});

test('completed players are offered post-quest Drezel lost-key recovery', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 420);
  h.loginPlayer(p);
  assert.ok(
    h.spawned.some((npc) => npc.id === N.DREZEL),
    'Drezel is present at the temple after completion'
  );
  assert.equal(h.talk('Drezel', N.DREZEL), true);
  assert.ok(
    h.transcripts().some(
      (call) => call.page === 'Drezel' && call.variant === 'standard-dialogue-after-priest-in-peril'
    ),
    'the canonical post-quest Drezel page runs'
  );
  h.action(p, '7Z6IoI', N.DREZEL);
  assert.equal(p.items.get(I.TEMPLE_LIBRARY_KEY) ?? 0, 1, 'the lost key is replaced');
  assert.equal(h.talk('Drezel', N.DREZEL), false, 'with the key held, other owners keep Drezel');
});

test('post-quest Drezel named page can replace a lost library key', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 420);
  const missingKey = { player: p, stepId: 'P91CrU', pages: [{ page: 'Drezel' }] };
  assert.equal(h.conditions.at(-1)(missingKey), true, 'key-loss condition answers true');
  h.action(p, '7Z6IoI', N.DREZEL);
  assert.equal(p.items.get(I.TEMPLE_LIBRARY_KEY) ?? 0, 1, 'Drezel replaces the key');
  assert.equal(h.conditions.at(-1)(missingKey), false, 'condition answers false once held');

  const early = harness();
  const earlyPlayer = makePlayer();
  early.use(earlyPlayer);
  const earlyCondition = { player: earlyPlayer, stepId: 'P91CrU', pages: [{ page: 'Drezel' }] };
  assert.equal(early.conditions.at(-1)(earlyCondition), false, 'no pre-quest key handout');
});

test('a lost crate can be replaced by asking Aurel what to do now', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 165);
  assert.equal(p.items.get(I.CRATE) ?? 0, 0);
  h.choice(p, 'What should I do now?');
  assert.equal(p.items.get(I.CRATE) ?? 0, 1, 'an empty crate is replaced');
  assert.equal(stage(h, p), 165, 'the stage does not change');
  h.choice(p, 'What should I do now?');
  assert.equal(p.items.get(I.CRATE) ?? 0, 1, 'an existing crate is not duplicated');
});

test('the rod enchantment requires the standard spellbook', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 390);
  p.items.set(I.SILVTHRILL_ROD_2, 1);
  p.items.set(I.COSMIC_RUNE, 1);
  p.items.set(I.WATER_RUNE, 1);
  p.setSpellbook(core.MagicSpellbook.LUNAR);
  const cast = h.castOnItem(p, I.SILVTHRILL_ROD_2);
  assert.equal(cast.handled, true, 'the plugin owns the attempt');
  assert.equal(p.items.get(I.SILVTHRILL_ROD_3) ?? 0, 0, 'no enchant on the wrong spellbook');
  assert.equal(p.items.get(I.COSMIC_RUNE) ?? 0, 1, 'runes are not consumed');
  assert.equal(p.items.get(I.COSMIC_RUNE), 1, 'the standard spell cast rejects a non-standard spellbook without consuming runes');
  p.setSpellbook(core.MagicSpellbook.NORMAL);
  h.castOnItem(p, I.SILVTHRILL_ROD_2);
  assert.equal(p.items.get(I.SILVTHRILL_ROD_3) ?? 0, 1, 'enchant works on the standard spellbook');
});

test('the rod enchantment accepts a wielded water staff through the rune-supply hook', () => {
  const h = harness();
  const p = makePlayer();
  h.use(p);
  Q(h).setStage(p, 390);
  p.items.set(I.SILVTHRILL_ROD_2, 1);
  p.items.set(I.COSMIC_RUNE, 1);
  p.setWeapon(I.WATER_BATTLESTAFF);

  const cast = h.castOnItem(p, I.SILVTHRILL_ROD_2);
  assert.equal(cast.handled, true);
  assert.equal(p.items.get(I.SILVTHRILL_ROD_3), 1, 'the equipped water staff supplies the water rune');
  assert.equal(p.items.get(I.COSMIC_RUNE), 0, 'the required cosmic rune is consumed');
  assert.equal(p.items.get(I.WATER_RUNE) ?? 0, 0, 'no water rune is required from inventory');
});

test('missing The Restless Ghost blocks the start', () => {
  const h = harness();
  for (const key of ['in_search_of_the_myreque', 'nature_spirit', 'priest_in_peril']) h.completedQuests.add(key);
  const p = makePlayer();
  h.use(p);
  const start = { player: p, npcId: N.VELIAF_HURTZ_2, hook: 'quest:in-aid-of-the-myreque:start', handled: false };
  h.questStartHook(start);
  assert.equal(stage(h, p), 0);
  assert.ok(p.messages.some((message) => message.includes('The Restless Ghost')));
});
