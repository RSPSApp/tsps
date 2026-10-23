// From server/: node --test tests/qh728-q112.test.cjs (after yarn build).
// Focused A Taste of Hope contracts: QH setup requirements, the full handler
// stage graph, the two potion branches, the flail enchant alternatives, full-bag
// recovery on the old notes and Rod of Ivandis, and the final hand-in reward.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

const PAGE = 'A Taste of Hope';
const START_ACTION = 'O2i4uQ';
const SPY_ACTION = 'Sf4pJy';
const HARPPERT_PAID_ACTION = 'u67nbM';
const BLOOD_VIAL_ACTION = 'lZWjHD';
const NOTES_ACTION = '1jhUsU';
const GIVE_NOTES_ACTION = 'nIsw3D';
const VERTIDA_NOTES_ACTION = 'n2DGut';
const FLAIL_ACTION = '4unz2S';
const RANIS_FORM_ACTION = 'GRRtbS';

const NPC = {
  GARTH: 8206,
  SAFALAAN: 8216,
  SAFALAAN_BASE: 8312,
  MERC: 8213,
  VYREWATCH_GUARD: 8251,
  HARPERT: 8212,
  FLAYGIAN: 8224,
  VERTIDA: 8220,
  FLAYGIAN_KAEL: 8230,
  KAEL_VER: 8231,
  RANIS_HUMAN: 8241,
};
const OBJ = {
  HERB: 32564,
  MEAT: 32567,
  VIAL: 32566,
  PESTLE: 32568,
  FOUNTAIN: 32557,
  FOUNTAIN_MULTI: 32651,
  DOOR: 32562,
  SICKLE: 32575,
  CHAIN: 32576,
  STAIRS_DOWN: 32560,
};
const ITEM = {
  COINS: core.ItemIdentifiers.COINS,
  VIAL: core.ItemIdentifiers.VIAL,
  VIAL_OF_WATER: core.ItemIdentifiers.VIAL_OF_WATER,
  HERB: core.ItemIdentifiers.MYSTERIOUS_HERB,
  MEAT: core.ItemIdentifiers.MYSTERIOUS_MEAT,
  CRUSHED_MEAT: core.ItemIdentifiers.MYSTERIOUS_CRUSHED_MEAT,
  PESTLE: core.ItemIdentifiers.PESTLE_AND_MORTAR,
  UNFINISHED_POTION: core.ItemIdentifiers.UNFINISHED_POTION_5,
  POTION: core.ItemIdentifiers.POTION_4,
  VIAL_OF_BLOOD: core.ItemIdentifiers.VIAL_OF_BLOOD,
  UNFINISHED_BLOOD: core.ItemIdentifiers.UNFINISHED_BLOOD_POTION,
  BLOOD_POTION: core.ItemIdentifiers.BLOOD_POTION,
  OLD_NOTES: core.ItemIdentifiers.OLD_NOTES_29,
  FLAYGIAN_NOTES: core.ItemIdentifiers.FLAYGIANS_NOTES,
  SICKLE_B: core.ItemIdentifiers.SILVER_SICKLE_B_,
  EMERALD: core.ItemIdentifiers.EMERALD,
  CHISEL: core.ItemIdentifiers.CHISEL,
  CHAIN: core.ItemIdentifiers.CHAIN,
  AIR_RUNE: core.ItemIdentifiers.AIR_RUNE,
  COSMIC_RUNE: core.ItemIdentifiers.COSMIC_RUNE,
  AIR_STAFF: core.ItemIdentifiers.STAFF_OF_AIR,
  ENCHANT_TABLET: 8017,
  EMERALD_SICKLE: core.ItemIdentifiers.EMERALD_SICKLE_B_,
  ENCHANTED_SICKLE: core.ItemIdentifiers.ENCHANTED_EMERALD_SICKLE_B_,
  ROD: core.ItemIdentifiers.ROD_OF_IVANDIS_10_,
  FLAIL: core.ItemIdentifiers.IVANDIS_FLAIL,
  TOME: core.ItemIdentifiers.TOME_OF_EXPERIENCE,
  MEDALLION: core.ItemIdentifiers.DRAKANS_MEDALLION,
};

let transcriptCalls = [];
const originalStartTranscript = runtime.startTranscript;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
  require('../plugins/items/ElementalStaves.plugin.js').register(
    PluginManager.createApi('QH728TasteSpellRuneSourceTest')
  );
  runtime.startTranscript = (_api, _player, npcId, page, variant) => {
    transcriptCalls.push({ npcId, page, variant });
    return true;
  };
});

function makePlayer(options = {}) {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const dropped = [];
  const log = [];
  const skills = { CRAFTING: 99, AGILITY: 99, ATTACK: 99, HERBLORE: 99, SLAYER: 99 };
  let full = false;
  let weapon = options.weapon ?? -1;
  let spellbook = core.MagicSpellbook.NORMAL;
  let location = new core.Location(0, 0, 0);
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd: (player, item) => { dropped.push(item.id); items.set(item.id, (items.get(item.id) ?? 0) + item.amount); return true; },
    deleteNumber: (id, amount = 1) => { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
    deletes: item => inventory.deleteNumber(item.getId(), item.getAmount()),
    deleteAtSlot: (_slot, amount = 1) => noop(amount),
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter(amount => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    full: () => messages.push("You don't have enough inventory space."),
    get: () => null,
    getItems: () => {
      const slots = Array.from({ length: 28 }, () => new core.Item(-1, 0));
      let slot = 0;
      for (const [id, amount] of items) {
        if (amount > 0) slots[slot++] = new core.Item(id, amount);
      }
      return slots;
    },
    addItem: item => inventory.adds(item.getId(), item.getAmount()),
  };
  const sender = new Proxy({}, { get: (_target, prop) => (...args) => { log.push([String(prop), ...args]); return sender; } });
  return {
    attrs, items, messages, moves, dropped, log, skills,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    setWeapon(id) { weapon = id; },
    setSpellbook(id) { spellbook = id; },
    getSpellbook: () => spellbook,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({
      get: () => ({ getId: () => weapon }),
      getItems: () => Array.from({ length: 14 }, (_, index) => new core.Item(index === core.Equipment.WEAPON_SLOT ? weapon : -1, 1)),
      hasStaffEquipped: () => false,
    }),
    getSkillManager: () => ({
      getMaxLevel: skill => skills[String(skill.getName?.() ?? skill.name).toUpperCase()] ?? 99,
      getCurrentLevel: skill => skills[String(skill.getName?.() ?? skill.name).toUpperCase()] ?? 99,
      addExperiences: (skill, xp) => log.push(['xp', skill.getName?.() ?? skill.name, xp]),
      setCurrentLevel: noop,
      getExperience: () => 0,
      addExperience: noop,
    }),
    getUsername: () => 'q112-test',
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    performGraphic: noop,
    getCombat: () => ({ reset: noop, setCastSpell: noop, setAutocastSpell: noop }),
    setRunEnergy: noop,
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
    isPlayer: () => true,
    isPlayerBot: () => false,
  };
}

function harness() {
  const events = {};
  const variants = [];
  const conditions = [];
  const itemOnObject = [];
  const itemOnItem = [];
  const spellOnItem = [];
  const itemActions = new Map();
  const objectInteraction = [];
  const npcInteraction = new Map();
  const npcDeaths = [];
  const npcHitModify = [];
  const npcs = [];
  const spawn = definition => {
    const npc = {
      id: definition.id,
      removed: false,
      getId: () => definition.id,
      getLocation: () => new core.Location(definition.x, definition.y, definition.z),
      moveTo: noop,
      setMultiCombat: noop,
      getHitpoints: () => definition.hitpoints ?? 100,
      setHitpoints: noop,
      isRegistered() { return !npc.removed; },
    };
    npcs.push(npc);
    return npc;
  };
  const api = new Proxy({
    core: { ...core, CountdownTask: undefined, TaskManager: undefined },
    persistAttribute: noop,
    registerArea: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onNpcInteraction: (name, actions) => { if (typeof name === 'string') npcInteraction.set(name, actions); },
    onItemOnObject: handler => itemOnObject.push(handler),
    onItemOnItem: handler => itemOnItem.push(handler),
    onSpellOnItem: handler => spellOnItem.push(handler),
    onItemAction: (name, actions) => itemActions.set(name, actions),
    onObjectInteraction: handler => objectInteraction.push(handler),
    onNpcDeath: handler => npcDeaths.push(handler),
    onNpcHitModify: handler => npcHitModify.push(handler),
    onPlayerLogin: noop,
    onPlayerLogout: noop,
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(handler => handler(event)),
    spawnNpc: spawn,
    removeNpc: npc => { if (npc) npc.removed = true; },
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/TasteOfHope.Quest')(api);
  // PluginManager registers Quests.plugin.js before skills/EnchantJewellery.plugin.js.
  // Preserve that production hook order so the quest-specific spell path can
  // claim the sickle before generic jewellery rejects it as an unsupported item.
  require('../plugins/skills/EnchantJewellery.plugin.js').register(api);
  return {
    api, events, variants, conditions, itemOnObject, itemOnItem, spellOnItem, itemActions,
    objectInteraction, npcInteraction, npcDeaths, npcHitModify, npcs,
    quest: runtime.getRegisteredQuests().at(-1),
    emit(key, event) { (events[key] ?? []).forEach(handler => handler(event)); },
    castOnItem(player, itemId, spellName = 'Lvl-2 Enchant', slot = null) {
      if (slot === null) slot = player.getInventory().getItems().findIndex(item => item.getId() === itemId);
      const event = { player, itemId, spellName, slot, handled: false };
      spellOnItem.forEach(handler => handler(event));
      return event;
    },
    variant(npcId, npc = null) {
      for (const handler of variants) {
        const result = handler({ player: this.player, npcId, npc });
        if (result) return result;
      }
      return null;
    },
  };
}

function harnessOwners() {
  const events = {};
  const variants = [];
  const conditions = [];
  const namedHooks = [];
  const api = new Proxy({
    core: { ...core, CountdownTask: undefined, TaskManager: undefined },
    persistAttribute: noop,
    registerArea: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onNpcInteraction: (name, actions) => namedHooks.push(typeof name === 'string' ? { name, actions } : { handler: name }),
    onItemOnObject: noop,
    onItemOnItem: noop,
    onItemAction: noop,
    onObjectInteraction: noop,
    onNpcDeath: noop,
    onNpcHitModify: noop,
    onPlayerLogin: noop,
    onPlayerLogout: noop,
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(handler => handler(event)),
    spawnNpc: definition => ({ getId: () => definition.id, getLocation: () => new core.Location(definition.x, definition.y, definition.z), setMultiCombat: noop, getHitpoints: () => 100, setHitpoints: noop, isRegistered: () => true }),
    removeNpc: noop,
  }, { get: (target, key) => target[key] ?? noop });
  // PluginManager.discoverPluginFiles sorts plugin paths; these three quests load
  // DarknessOfHallowvale, then InAidOfTheMyreque, then TasteOfHope.
  require('../plugins/quests/quests/DarknessOfHallowvale.Quest')(api);
  require('../plugins/quests/quests/InAidOfTheMyreque.Quest')(api);
  require('../plugins/quests/quests/TasteOfHope.Quest')(api);
  return {
    api, events, variants, conditions, namedHooks,
    interact(event) {
      for (const entry of namedHooks) {
        if (event.handled) break;
        if (entry.name) {
          if (event.definition.getName() !== entry.name) continue;
          const action = entry.actions?.[event.definition.getActions?.()[event.clickType - 1]];
          if (action && action(event) !== false) event.handled = true;
        } else if (entry.handler) {
          entry.handler(event);
        }
      }
      return event;
    },
    selectVariant(player, npcId) {
      for (const handler of variants) {
        const result = handler({ player, npcId, npc: null });
        if (result) return result;
      }
      return null;
    },
  };
}

function veliafEvent(p) {
  return {
    player: p,
    npcId: 989,
    clickType: 1,
    definition: { getName: () => 'Veliaf Hurtz', getActions: () => ['Talk-to', null, null, null, null], getId: () => 989 },
    handled: false,
  };
}

function action(p, stepId, kind = 'action', npcId = NPC.SAFALAAN) {
  const event = { player: p, npcId, stepId, kind, handled: false };
  // handlers are attached by the caller's harness
  return event;
}

function near(x, y) {
  return { getLocation: () => new core.Location(x, y, 0) };
}

function addQuestCompletion(h, keys) {
  (h.events['quest:is-complete'] ??= []).push(request => {
    if (keys.has(request.key)) request.complete = true;
  });
}

test('QH setup requirements gate the Garth start on Darkness of Hallowvale and all five skills', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  // Darkness unanswered: start action refuses.
  const start = action(p, START_ACTION);
  h.emit('npc-dialogue:action', start);
  assert.equal(h.quest.getStage(p), 0);
  assert.ok(p.messages.some(text => text.includes('Darkness of Hallowvale')));

  addQuestCompletion(h, new Set(['darkness_of_hallowvale']));
  p.skills.CRAFTING = 47;
  const lowCrafting = action(p, START_ACTION);
  h.emit('npc-dialogue:action', lowCrafting);
  assert.equal(h.quest.getStage(p), 0, 'low Crafting cannot start');

  p.skills.CRAFTING = 48;
  p.skills.AGILITY = 45;
  p.skills.ATTACK = 40;
  p.skills.HERBLORE = 40;
  p.skills.SLAYER = 38;
  const started = action(p, START_ACTION);
  h.emit('npc-dialogue:action', started);
  assert.equal(h.quest.getStage(p), 1, 'all QH requirements start the quest at stage 1');
  assert.equal(started.handled, true);
});

test('the old notes are not marked taken when the bag is full, so the chest can be searched again', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  h.quest.setStage(p, 75);
  p.setFull(true);
  const blocked = action(p, NOTES_ACTION, 'message');
  h.emit('npc-dialogue:action', blocked);
  assert.equal(p.items.get(ITEM.OLD_NOTES) ?? 0, 0);
  assert.ok(p.messages.some(text => text.includes('inventory space')));

  p.setFull(false);
  const retry = action(p, NOTES_ACTION, 'message');
  h.emit('npc-dialogue:action', retry);
  assert.equal(p.items.get(ITEM.OLD_NOTES) ?? 0, 1, 'the retry grants the notes');
});

test('the canonical Veliaf hand-over respects a full bag and awards one rod', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  h.quest.setStage(p, 125);
  p.setFull(true);
  const condition = () => ({ player: p, npcId: 989, stepId: 'J8N5DP', text: 'If the player has one free inventory space:', handled: false });
  h.emit('npc-dialogue:condition', condition());
  assert.equal(p.items.get(ITEM.ROD) ?? 0, 0, 'a full bag does not get or claim the rod');

  p.setFull(false);
  h.emit('npc-dialogue:condition', condition());
  assert.equal(p.items.get(ITEM.ROD), 1, 'the canonical condition hands over the rod');
  assert.equal(p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6398).at(-1)?.[2], 1,
    'the native myq4_veliaf_rod bit updates at the receipt action');
  h.emit('npc-dialogue:condition', condition());
  assert.equal(p.items.get(ITEM.ROD), 1, 'a repeated condition does not duplicate the rod');
});

test('an enchant emerald tablet enchants the sickle without runes', () => {
  const h = harness();
  const tablet = makePlayer();
  h.player = tablet;
  h.quest.setStage(tablet, 125);
  tablet.items.set(ITEM.EMERALD_SICKLE, 1);
  tablet.items.set(ITEM.ENCHANT_TABLET, 1);
  const withTablet = { player: tablet, usedItemId: ITEM.EMERALD_SICKLE, usedWithItemId: ITEM.ENCHANT_TABLET, handled: false };
  h.itemOnItem.forEach(handler => handler(withTablet));
  assert.equal(withTablet.handled, true);
  assert.equal(tablet.items.get(ITEM.ENCHANTED_SICKLE), 1);
  assert.equal(tablet.items.get(ITEM.ENCHANT_TABLET) ?? 0, 0);
});

test('the registered Lvl-2 Enchant spell hook consumes runes and checks the equipped staff source', () => {
  const h = harness();
  const p = makePlayer({ weapon: ITEM.AIR_STAFF });
  h.player = p;
  h.quest.setStage(p, 125);
  p.items.set(ITEM.EMERALD_SICKLE, 1);
  p.items.set(ITEM.COSMIC_RUNE, 1);
  const staffCast = h.castOnItem(p, ITEM.EMERALD_SICKLE);
  assert.equal(staffCast.handled, true);
  assert.equal(p.items.get(ITEM.ENCHANTED_SICKLE), 1, 'the actual spell path accepts a wielded air staff');
  assert.equal(p.items.get(ITEM.COSMIC_RUNE), 0, 'the actual spell path consumes the cosmic rune');

  const carried = makePlayer();
  h.player = carried;
  h.quest.setStage(carried, 125);
  carried.items.set(ITEM.AIR_STAFF, 1);
  carried.items.set(ITEM.EMERALD_SICKLE, 1);
  carried.items.set(ITEM.COSMIC_RUNE, 1);
  const bagCast = h.castOnItem(carried, ITEM.EMERALD_SICKLE);
  assert.equal(bagCast.handled, true, 'the quest handles failed canonical casts for clear feedback');
  assert.equal(carried.items.get(ITEM.ENCHANTED_SICKLE) ?? 0, 0, 'an unwielded staff does not supply cast runes');
  assert.equal(carried.items.get(ITEM.COSMIC_RUNE), 1, 'a failed cast does not consume runes');

  carried.items.set(ITEM.AIR_RUNE, 3);
  const runeCast = h.castOnItem(carried, ITEM.EMERALD_SICKLE);
  assert.equal(runeCast.handled, true);
  assert.equal(carried.items.get(ITEM.ENCHANTED_SICKLE), 1, 'three air runes provide the alternate rune source');
  assert.equal(carried.items.get(ITEM.AIR_RUNE), 0);
  assert.equal(carried.items.get(ITEM.COSMIC_RUNE), 0);
});

test('the sickle recipe uses standard spell level, rune, cooldown and XP checks', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  h.quest.setStage(p, 125);
  p.items.set(ITEM.EMERALD_SICKLE, 1);
  p.items.set(ITEM.COSMIC_RUNE, 1);

  h.castOnItem(p, ITEM.EMERALD_SICKLE);
  assert.equal(p.items.get(ITEM.ENCHANTED_SICKLE) ?? 0, 0, 'missing air runes reject the recipe');
  assert.equal(p.items.get(ITEM.COSMIC_RUNE), 1, 'failed rune validation preserves runes');

  p.items.set(ITEM.AIR_RUNE, 3);
  p.skills.MAGIC = 26;
  h.castOnItem(p, ITEM.EMERALD_SICKLE);
  assert.equal(p.items.get(ITEM.ENCHANTED_SICKLE) ?? 0, 0, 'the standard spell level gate rejects the cast');
  assert.equal(p.items.get(ITEM.COSMIC_RUNE), 1, 'failed level validation preserves runes');

  p.skills.MAGIC = 99;
  p.setAttribute('enchant-jewellery:next-cast-at', Date.now() + 10_000);
  h.castOnItem(p, ITEM.EMERALD_SICKLE);
  assert.equal(p.items.get(ITEM.ENCHANTED_SICKLE) ?? 0, 0, 'the standard spell cooldown rejects the cast');
  assert.equal(p.items.get(ITEM.AIR_RUNE), 3, 'failed cooldown preserves runes');

  p.setAttribute('enchant-jewellery:next-cast-at', 0);
  const cast = h.castOnItem(p, ITEM.EMERALD_SICKLE);
  assert.equal(cast.handled, true);
  assert.equal(p.items.get(ITEM.ENCHANTED_SICKLE), 1);
  assert.equal(p.items.get(ITEM.COSMIC_RUNE), 0);
  assert.equal(p.items.get(ITEM.AIR_RUNE), 0);
  assert.ok(p.log.some(([operation, skill, amount]) => operation === 'xp' && skill === 'Magic' && amount === 37));
});

test('the sickle recipe is unavailable before the quest has a reason to enchant it', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  h.quest.setStage(p, 0);
  p.items.set(ITEM.EMERALD_SICKLE, 1);
  p.items.set(ITEM.COSMIC_RUNE, 1);
  p.items.set(ITEM.AIR_RUNE, 3);

  const cast = h.castOnItem(p, ITEM.EMERALD_SICKLE);
  assert.equal(cast.handled, true);
  assert.equal(p.items.get(ITEM.ENCHANTED_SICKLE) ?? 0, 0);
  assert.equal(p.items.get(ITEM.COSMIC_RUNE), 1);
  assert.equal(p.items.get(ITEM.AIR_RUNE), 3);
  assert.ok(p.messages.includes('You have no reason to enchant this yet.'));
});

test('fresh stage 0 reaches completion through every mandatory quest-local handler, paying each reward once', () => {
  transcriptCalls = [];
  const h = harness();
  const p = makePlayer();
  h.player = p;
  p.setLocation(3642, 3207, 1);
  p.items.set(ITEM.COINS, 1000);
  addQuestCompletion(h, new Set(['darkness_of_hallowvale']));

  assert.equal(h.quest.getStage(p), 0, 'fresh stage 0');
  h.emit('npc-dialogue:action', action(p, START_ACTION));
  assert.equal(h.quest.getStage(p), 1, 'Garth action starts stage 1');

  assert.equal(h.variant(NPC.SAFALAAN, near(3627, 9644)), 'starting-out-talking-to-safalaan');
  assert.equal(h.quest.getStage(p), 5, 'north Safalaan briefing');

  assert.equal(h.variant(NPC.MERC), 'vampyric-espionage-talking-to-the-mercenaries');
  assert.equal(h.quest.getStage(p), 10, 'mercenaries spoken');

  h.emit('npc-dialogue:action', action(p, HARPPERT_PAID_ACTION, 'message', NPC.HARPERT));
  assert.equal(h.quest.getStage(p), 20, 'Harpert paid');
  assert.equal(p.items.get(ITEM.COINS) ?? 0, 0, '1,000 coins consumed');

  h.emit('npc-dialogue:action', action(p, SPY_ACTION, 'action', NPC.RANIS_HUMAN));
  assert.equal(h.quest.getStage(p), 26, 'spy cutscene ends');

  assert.equal(h.variant(NPC.SAFALAAN, near(3627, 9644)), 'vampyric-espionage-reporting-back-to-safalaan');
  assert.equal(h.quest.getStage(p), 30, 'reported to Safalaan');

  assert.equal(h.variant(NPC.FLAYGIAN), 'vampyric-espionage-talking-to-flaygian');
  assert.equal(h.quest.getStage(p), 35, 'Flaygian briefed');

  assert.equal(h.variant(NPC.SAFALAAN, near(3627, 9644)), 'vampyric-espionage-talking-to-safalaan');
  assert.equal(h.quest.getStage(p), 45, 'Safalaan directs the house');

  const ladder = { player: p, objectId: OBJ.STAIRS_DOWN, handled: false };
  h.emit('ladders:climb', ladder);
  assert.equal(ladder.handled, true);
  assert.equal(h.quest.getStage(p), 75, 'Serafina stairs set the arrival stage');
  assert.deepEqual(p.moves.at(-1), [3593, 9670, 0]);

  const lastWire = () => p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1)?.[2];
  assert.equal(h.variant(NPC.SAFALAAN, near(3594, 9674)), 'the-myth-of-serafina-talking-to-safalaan');
  assert.equal(lastWire(), 80, 'the first house briefing immediately moves the wire to ingredient step 80');

  const search = objectId => {
    const event = { player: p, objectId, handled: false };
    h.objectInteraction.forEach(handler => handler(event));
    assert.equal(event.handled, true, `object ${objectId} is handled`);
  };
  search(OBJ.HERB);
  search(OBJ.MEAT);
  search(OBJ.VIAL);
  search(OBJ.PESTLE);

  const itemOnObject = (itemId, objectId, definition) => {
    const event = { player: p, itemId, objectId, definition, handled: false };
    h.itemOnObject.forEach(handler => handler(event));
    assert.equal(event.handled, true);
  };
  itemOnObject(ITEM.VIAL, OBJ.FOUNTAIN_MULTI, { id: 32558 });
  assert.equal(p.items.get(ITEM.VIAL_OF_WATER), 1);

  const combine = (a, b) => {
    const event = { player: p, usedItemId: a, usedWithItemId: b, handled: false };
    h.itemOnItem.forEach(handler => handler(event));
    assert.equal(event.handled, true, `combine ${a}+${b}`);
  };
  combine(ITEM.HERB, ITEM.VIAL_OF_WATER);
  combine(ITEM.PESTLE, ITEM.MEAT);
  combine(ITEM.CRUSHED_MEAT, ITEM.UNFINISHED_POTION);
  itemOnObject(ITEM.POTION, OBJ.DOOR);
  assert.equal(p.items.get(ITEM.POTION) ?? 0, 0, 'first potion is consumed on the door');
  assert.equal(lastWire(), 82, 'the first potion check immediately moves the wire to blood ingredients');

  search(OBJ.VIAL);
  assert.equal(h.variant(NPC.SAFALAAN, near(3594, 9674)), 'the-myth-of-serafina-talking-to-safalaan-again-after-using-the-potion-on-the-door');
  h.emit('npc-dialogue:action', action(p, BLOOD_VIAL_ACTION, 'receive', NPC.SAFALAAN));
  assert.equal(p.items.get(ITEM.VIAL_OF_BLOOD), 1, 'Safalaan fills the vial with blood');

  search(OBJ.HERB);
  search(OBJ.MEAT);
  combine(ITEM.HERB, ITEM.VIAL_OF_BLOOD);
  combine(ITEM.PESTLE, ITEM.MEAT);
  combine(ITEM.CRUSHED_MEAT, ITEM.UNFINISHED_BLOOD);
  itemOnObject(ITEM.BLOOD_POTION, OBJ.DOOR);
  assert.equal(p.items.get(ITEM.BLOOD_POTION) ?? 0, 0, 'blood potion is consumed on the door');
  assert.equal(lastWire(), 85, 'opening the door immediately moves the wire to the notes step');

  h.emit('npc-dialogue:action', action(p, NOTES_ACTION, 'message', NPC.SAFALAAN));
  assert.equal(p.items.get(ITEM.OLD_NOTES), 1, 'chest notes granted');
  assert.equal(lastWire(), 85, 'the received notes remain on the notes handover step');
  assert.equal(h.variant(NPC.SAFALAAN, near(3594, 9674)), 'the-myth-of-serafina-talking-to-safalaan-after-obtaining-the-old-notes');
  h.emit('npc-dialogue:action', action(p, GIVE_NOTES_ACTION, 'message', NPC.SAFALAAN));
  assert.equal(p.items.get(ITEM.OLD_NOTES) ?? 0, 0, 'notes given to Safalaan');
  assert.equal(h.quest.getStage(p), 91, 'notes delivered');
  assert.equal(lastWire(), 90, 'the delivered notes immediately move the wire to the next step');

  assert.equal(h.variant(NPC.SAFALAAN, near(3627, 9644)), 'it-s-a-trap-talking-to-safalaan');
  assert.equal(h.quest.getStage(p), 95, 'trap briefing');
  const bait = { player: p, npcId: NPC.SAFALAAN, text: 'He used us as bait.', after: null, handled: false };
  h.emit('npc-dialogue:line', bait);
  assert.equal(h.quest.getStage(p), 100, 'abomination stage');
  const abomination = h.npcs.find(npc => npc.id === 8262 && !npc.removed);
  assert.ok(abomination, 'the abomination is spawned at stage 100');
  h.npcDeaths.forEach(handler => handler({ killer: p, npc: abomination, npcId: 8262 }));
  assert.equal(h.quest.getStage(p), 110, 'abomination death abandons the hideout');

  assert.equal(h.variant(NPC.SAFALAAN, near(3600, 9615)), 'the-legendary-weapon-talking-to-safalaan');
  assert.equal(h.quest.getStage(p), 115, 'new base Safalaan');
  assert.equal(h.variant(NPC.VERTIDA, near(3599, 9611)), 'the-legendary-weapon-talking-to-vertida-after-talking-to-safalaan');
  h.emit('npc-dialogue:action', action(p, VERTIDA_NOTES_ACTION, 'message', NPC.VERTIDA));
  assert.equal(p.items.get(ITEM.FLAYGIAN_NOTES), 1, 'Vertida notes granted');
  assert.equal(h.quest.getStage(p), 120);

  const readNotes = h.itemActions.get("Flaygian's notes")?.Read;
  assert.ok(readNotes, 'notes Read handler registered');
  readNotes({ player: p, itemId: ITEM.FLAYGIAN_NOTES });
  assert.equal(h.quest.getStage(p), 125, 'notes read');

  h.emit('npc-dialogue:choice', { player: p, npcId: NPC.VERTIDA, option: 'I need the Rod of Ivandis.', handled: false });
  assert.equal(p.items.get(ITEM.ROD) ?? 0, 0, 'Vertida only records the request');
  assert.equal((p.attrs.get('quest.taste_of_hope.bits') ?? 0) & (1 << 13), 1 << 13, 'asked-rod bit set');
  h.emit('npc-dialogue:condition', { player: p, npcId: 989, stepId: 'J8N5DP', text: 'If the player has one free inventory space:', handled: false });
  assert.equal(p.items.get(ITEM.ROD), 1, 'Veliaf hands over the rod through the canonical condition');

  search(OBJ.SICKLE);
  search(OBJ.CHAIN);
  p.items.set(ITEM.EMERALD, 1);
  p.items.set(ITEM.CHISEL, 1);
  combine(ITEM.EMERALD, ITEM.SICKLE_B);
  assert.equal(p.items.get(ITEM.EMERALD_SICKLE), 1);
  p.items.set(ITEM.COSMIC_RUNE, 1);
  p.items.set(ITEM.AIR_RUNE, 3);
  const enchant = h.castOnItem(p, ITEM.EMERALD_SICKLE);
  assert.equal(enchant.handled, true, 'the registered spell-on-item hook handles the canonical enchant cast');
  assert.equal(p.items.get(ITEM.ENCHANTED_SICKLE), 1);
  combine(ITEM.CHAIN, ITEM.ENCHANTED_SICKLE);
  assert.equal(p.items.get(ITEM.FLAIL), 1, 'Ivandis flail created');
  assert.equal(h.quest.getStage(p), 130);

  assert.equal(h.variant(NPC.SAFALAAN, near(3600, 9615)), 'the-legendary-weapon-talking-to-safalaan-after-creating-the-ivandis-flail');
  assert.equal(h.quest.getStage(p), 135, 'sent to Ver Sinhaza');

  assert.equal(h.variant(NPC.KAEL_VER), 'the-taste-of-hope-talking-to-kael');
  h.emit('npc-dialogue:choice', { player: p, npcId: NPC.KAEL_VER, option: "I'm ready.", handled: false });
  assert.equal(h.quest.getStage(p), 145, 'Kael speech stage');
  assert.deepEqual(p.moves.at(-1), [3649, 3234, 0]);

  h.emit('npc-dialogue:action', action(p, RANIS_FORM_ACTION, 'action', NPC.RANIS_HUMAN));
  assert.equal(h.quest.getStage(p), 150, 'Ranis fight stage');
  const ranis = h.npcs.find(npc => npc.id === 8244 && !npc.removed);
  assert.ok(ranis, 'Ranis is spawned');
  h.npcDeaths.forEach(handler => handler({ killer: p, npc: ranis, npcId: 8244 }));
  assert.equal(h.quest.getStage(p), 155, 'Ranis killed');

  h.emit('npc-dialogue:line', { player: p, npcId: NPC.RANIS_HUMAN, text: 'Myreque prevail!', handled: false });
  assert.equal(h.quest.getStage(p), 160, 'speech of hope');
  assert.equal(h.variant(NPC.KAEL_VER), 'finishing-up');
  assert.equal(h.variant(NPC.SAFALAAN, near(3600, 9615)), 'finishing-up-returning-to-safalaan');
  assert.equal(h.quest.getStage(p), 165, 'finishing stage');

  h.emit('npc-dialogue:action', action(p, FLAIL_ACTION, 'action', NPC.SAFALAAN));
  assert.equal(h.quest.getStage(p), 166, 'quest complete');
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.items.get(ITEM.TOME), 1, 'tome granted');
  assert.equal(p.items.get(ITEM.MEDALLION), 1, 'medallion granted');

  const tomeBefore = p.items.get(ITEM.TOME);
  const medallionBefore = p.items.get(ITEM.MEDALLION);
  h.emit('npc-dialogue:action', action(p, FLAIL_ACTION, 'action', NPC.SAFALAAN));
  assert.equal(p.items.get(ITEM.TOME), tomeBefore, 'repeat completion does not duplicate the tome');
  assert.equal(p.items.get(ITEM.MEDALLION), medallionBefore, 'repeat completion does not duplicate the medallion');
});

test('post-quest Vertida keeps the flail-reclaim dialogue even while holding Flaygian\'s notes', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  h.quest.setStage(p, 166);
  p.items.set(ITEM.FLAYGIAN_NOTES, 1);
  p.items.set(ITEM.FLAIL, 1);
  assert.equal(
    h.variant(NPC.VERTIDA, near(3599, 9611)),
    'finishing-up-talking-to-vertida',
    'the sent/finished stage wins over the notes-held help variant'
  );

  h.quest.setStage(p, 135);
  assert.equal(
    h.variant(NPC.VERTIDA, near(3599, 9611)),
    'the-legendary-weapon-talking-to-vertida-2'
  );
});

test('completion with a full bag drops the tome and medallion instead of losing them', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  h.quest.setStage(p, 165);
  p.setFull(true);
  h.emit('npc-dialogue:action', action(p, FLAIL_ACTION, 'action', NPC.SAFALAAN));
  assert.equal(h.quest.isComplete(p), true);
  assert.ok(p.dropped.includes(ITEM.TOME), 'tome drops at the reward location');
  assert.ok(p.dropped.includes(ITEM.MEDALLION), 'medallion drops at the reward location');
});

test('registered dialogue conditions match the transcript prose guards', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  const condition = (text, pages) => h.conditions[0]({ player: p, text, pages });

  p.items.set(ITEM.COINS, 999);
  assert.equal(condition("If the player doesn't have 1000 coins:"), true);
  p.items.set(ITEM.COINS, 1000);
  assert.equal(condition("If the player doesn't have 1000 coins:"), false);

  p.setFull(true);
  assert.equal(condition("If the player doesn't have inventory space:"), true);
  assert.equal(condition("If the player has inventory space:"), false);
  assert.equal(condition("If the player has one free inventory space:"), false);
  assert.equal(condition("If the player has no free inventory space:"), true);
  p.setFull(false);
  assert.equal(condition("If the player doesn't have inventory space:"), false);
  assert.equal(condition("If the player has inventory space:"), true);

  assert.equal(condition("If the player does not have the rod of Ivandis:"), true);
  assert.equal(condition("If the player has the rod of Ivandis:"), false);
  p.items.set(ITEM.ROD, 1);
  assert.equal(condition("If the player does not have the rod of Ivandis:"), false);
  assert.equal(condition("If the player has the rod of Ivandis:"), true);
  assert.equal(condition("If the player already have one in the inventory:"), true);

  p.items.set(ITEM.COINS, 19999);
  assert.equal(condition("If the player doesn't have enough coins:"), true);
  p.items.set(ITEM.COINS, 20000);
  assert.equal(condition("If the player has enough coins:"), true);

  assert.equal(condition("If the player has inventory space:", [{ page: 'Other Quest' }]), null, 'foreign-page prose is not answered');
});

test('Ranis rejects the Rod of Ivandis and only accepts the Ivandis flail', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  h.quest.setStage(p, 150);
  const part = { damage: 10, setDamage(value) { this.damage = value; } };
  const hit = {
    parts: [part],
    total: 10,
    getAttacker: () => ({ isPlayer: () => true, getAsPlayer: () => p }),
    getHits: () => hit.parts,
    getTotalDamage: () => hit.total,
    updateTotalDamage: () => { hit.total = hit.parts.reduce((sum, entry) => sum + entry.damage, 0); },
  };
  const npc = { getId: () => 8244, getHitpoints: () => 400, getMaxHitpoints: () => 400 };

  p.setWeapon(ITEM.ROD);
  h.npcHitModify.forEach(handler => handler({ npc, hit }));
  assert.equal(part.damage, 0, 'rod damage is zeroed against Ranis');
  assert.ok(p.messages.some(text => text.includes('only be harmed by the Ivandis flail')));

  part.damage = 10;
  hit.total = 10;
  p.setWeapon(ITEM.FLAIL);
  h.npcHitModify.forEach(handler => handler({ npc, hit }));
  assert.equal(part.damage, 10, 'flail damage passes');
  assert.equal(p.attrs.get('quest.taste_of_hope.ranis.hp'), 390);
});

test('talking to Kael after an interrupted Ranis death replays the speech of hope', () => {
  transcriptCalls = [];
  const h = harness();
  const p = makePlayer();
  h.player = p;
  h.quest.setStage(p, 155);
  const talk = h.npcInteraction.get('Kael Forshaw')?.['Talk-to'];
  assert.ok(talk, 'Kael Talk-to handler is registered');
  const handled = talk({ player: p, npcId: NPC.KAEL_VER, clickType: 1, handled: false });
  assert.equal(handled, true);
  assert.deepEqual(
    transcriptCalls.at(-1),
    { npcId: NPC.RANIS_HUMAN, page: PAGE, variant: 'the-taste-of-hope-a-speech-of-hope' },
    'the speech restarts from the current stage'
  );

  h.quest.setStage(p, 160);
  assert.equal(talk({ player: p, npcId: NPC.KAEL_VER, clickType: 1, handled: false }), false, 'after the speech Kael keeps his normal dialogue');
});

test('actual owner order: Darkness and In Aid yield Veliaf to Taste in the rod-request window', () => {
  transcriptCalls = [];
  const dialogues = require('../data/definitions/npc-dialogues.json');
  const canonicalVariant = dialogues['A Taste of Hope'].variants['the-legendary-weapon-talking-to-veliaf'];
  assert.ok(JSON.stringify(canonicalVariant).includes('J8N5DP'), 'canonical transcript carries the one-free-slot hand-over condition');
  const h = harnessOwners();
  const p = makePlayer();
  p.attrs.set('quest.in_aid_of_the_myreque.stage', 420);
  p.attrs.set('quest.darkness_of_hallowvale.stage', 310);
  p.attrs.set('quest.taste_of_hope.stage', 119);
  p.attrs.set('quest.taste_of_hope.bits', 1 << 13);

  // Before Taste's window, Darkness owns the completed shared Veliaf.
  const before = veliafEvent(p);
  h.interact(before);
  assert.equal(before.handled, true, 'an earlier owner claims outside the Taste window');
  assert.equal(transcriptCalls.at(-1).page, 'Darkness of Hallowvale');

  // In the window but before asking Vertida, the earlier completed DHO page
  // still owns the shared NPC; Taste only takes it for its rod request.
  p.attrs.set('quest.taste_of_hope.stage', 125);
  p.attrs.set('quest.taste_of_hope.bits', 0);
  const notAsked = veliafEvent(p);
  h.interact(notAsked);
  assert.equal(notAsked.handled, true, 'In Aid keeps Veliaf until Taste records the rod request');
  assert.equal(transcriptCalls.at(-1).page, 'Darkness of Hallowvale');

  // After asking Vertida, both earlier owners yield and Taste selects its own page.
  p.attrs.set('quest.taste_of_hope.bits', 1 << 13);
  const canonical = veliafEvent(p);
  h.interact(canonical);
  assert.equal(canonical.handled, true, 'Taste claims the shared Veliaf after both earlier owners yield');
  assert.equal(transcriptCalls.at(-1).page, PAGE);
  assert.equal(transcriptCalls.at(-1).variant, 'the-legendary-weapon-talking-to-veliaf');

  // The transcript's one-free-slot condition is the canonical hand-over.
  const condition = { player: p, npcId: 989, stepId: 'J8N5DP', text: 'If the player has one free inventory space:', handled: false };
  (h.events['npc-dialogue:condition'] ?? []).forEach(handler => handler(condition));
  assert.equal(p.items.get(ITEM.ROD), 1, 'Veliaf hands over exactly one rod');
  (h.events['npc-dialogue:condition'] ?? []).forEach(handler => handler(condition));
  assert.equal(p.items.get(ITEM.ROD), 1, 'the same condition cannot award a second rod');

  const after = veliafEvent(p);
  h.interact(after);
  assert.equal(after.handled, true, 'ownership returns to the earlier NPC owner after the rod claim');
});

test('internal stages map onto the native myq4 wire, including the Serafina sub-state', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  const expected = [
    [0, 0], [1, 15], [5, 20], [10, 30], [20, 40], [26, 45], [30, 55], [35, 65],
    [45, 75], [91, 90], [95, 95], [100, 100], [110, 110], [115, 115], [120, 120],
    [125, 125], [130, 130], [135, 135], [145, 140], [150, 140], [155, 145],
    [160, 150], [165, 160], [166, 165],
  ];
  for (const [stage, wire] of expected) {
    h.quest.setStage(p, stage);
    const sent = p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1);
    assert.equal(sent[2], wire, `internal stage ${stage} sends native ${wire}`);
  }

  p.attrs.set('quest.taste_of_hope.bits', 0);
  h.quest.setStage(p, 75);
  assert.equal(p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1)[2], 75);
  p.attrs.set('quest.taste_of_hope.bits', 1 << 5); // house met
  h.quest.setStage(p, 75);
  assert.equal(p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1)[2], 80);
  p.attrs.set('quest.taste_of_hope.bits', (1 << 5) | (1 << 6)); // first potion done
  h.quest.setStage(p, 75);
  assert.equal(p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1)[2], 82);
  p.attrs.set('quest.taste_of_hope.bits', (1 << 5) | (1 << 7)); // door open
  h.quest.setStage(p, 75);
  assert.equal(p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1)[2], 85);
  p.attrs.set('quest.taste_of_hope.bits', 1 << 10); // notes given
  h.quest.setStage(p, 75);
  assert.equal(p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1)[2], 90);

  h.quest.setStage(p, 135);
  runtime.sendQuestVarps({ player: p });
  assert.equal(
    p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1)[2],
    135,
    'the login bootstrap resend uses the same mapping'
  );

  // The Kael recovery needs the static Ver Sinhaza multi to resolve at 155.
  assert.equal(CacheDefinitions.getNpc(8319).transforms[145], 8231, 'native 145 keeps Kael visible');
  assert.equal(CacheDefinitions.getNpc(8319).transforms[155], -1, 'native 155 hides him again');
});

test('the wire keeps the cache-gated rubble, mercenaries and Kael reachable', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;

  // The rubble only exists as climbable (32549) between native 20 and 40.
  const rubble = CacheDefinitions.getObject(32650);
  assert.equal(rubble.transformVarbit, 6396, 'the rubble multi is gated on the quest varbit');
  assert.equal(rubble.transforms[20], 32549, 'the rubble is climbable from native 20');
  assert.equal(rubble.transforms[40], 32549, 'the rubble is still climbable at native 40');
  assert.equal(rubble.transforms[rubble.transforms.length - 1], 32550, 'the rubble is blocked again after the spy');

  h.quest.setStage(p, 20);
  let sent = p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1);
  assert.equal(sent[2], 40, 'paying Harpert lands in the climbable/spy window');
  h.quest.setStage(p, 26);
  sent = p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1);
  assert.equal(sent[2], 45, 'the finished spy leaves the climbable window');

  // The mercenaries only resolve to their named content id up to native 24.
  const merc = CacheDefinitions.getNpc(8308);
  assert.equal(merc.transformVarbit, 6396, 'the mercenaries are gated on the quest varbit');
  assert.equal(merc.transforms[20], 8213, 'native 20 keeps the mercenaries named');
  assert.equal(merc.transforms[merc.transforms.length - 1], -1, 'native 25 and up hide the mercenaries');
  h.quest.setStage(p, 5);
  sent = p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1);
  assert.equal(sent[2], 20, 'the Safalaan briefing still shows the mercenaries');

  // QH's native-20 instruction is an attempt to climb the rubble. It must
  // reach the imported guarded-attempt scene at stage 5, then the actual
  // mercenary conversation advances to the Harpert step/native 30.
  transcriptCalls = [];
  const attempt = { player: p, objectId: 32650, definition: { id: 32549 }, handled: false };
  h.objectInteraction.forEach(handler => handler(attempt));
  assert.equal(attempt.handled, true, 'the registered rubble handler claims the native climb action');
  assert.deepEqual(transcriptCalls.at(-1), {
    npcId: NPC.VYREWATCH_GUARD,
    page: PAGE,
    variant: 'vampyric-espionage-attempting-to-climb-up-the-rubble-near-the-bank',
  });
  assert.equal(h.quest.getStage(p), 5, 'the guard scene does not invent a mercenary conversation');
  assert.equal(h.variant(NPC.MERC), 'vampyric-espionage-talking-to-the-mercenaries');
  assert.equal(h.quest.getStage(p), 10);
  sent = p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1);
  assert.equal(sent[2], 30, 'the real mercenary step moves the wire to talk to Harpert');

  // The Kael of the speech-of-hope recovery is a world spawn at Ver Sinhaza.
  const spawns = require('../data/definitions/npc-spawns.json');
  const kael = spawns.find(entry => entry.id === 8319);
  assert.ok(kael, 'Kael 8319 is a world spawn at Ver Sinhaza');
  assert.equal(kael.x, 3658);
  assert.equal(kael.y, 3221);
  h.quest.setStage(p, 155);
  sent = p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1);
  assert.equal(sent[2], 145, 'internal 155 resolves Kael 8319 to 8231');
  assert.equal(CacheDefinitions.getNpc(8319).transforms[sent[2]], 8231, 'Kael is visible after a Ranis death');
});

test('Vertida sells another flail mid-quest, through the purchase prompt, and after completion', () => {
  const mid = harness();
  const p = makePlayer();
  mid.player = p;
  mid.quest.setStage(p, 135);
  p.items.set(ITEM.COINS, 20000);
  assert.equal(mid.variant(NPC.VERTIDA, near(3599, 9611)), 'the-legendary-weapon-talking-to-vertida-2');
  mid.emit('npc-dialogue:choice', { player: p, npcId: NPC.VERTIDA, option: 'I need another flail.', handled: false });
  assert.equal(p.items.get(ITEM.FLAIL) ?? 0, 0, 'asking does not buy it before the prompt');
  assert.equal(p.items.get(ITEM.COINS), 20000);
  mid.emit('npc-dialogue:choice', { player: p, npcId: NPC.VERTIDA, option: 'No.', handled: false });
  mid.emit('npc-dialogue:choice', { player: p, npcId: NPC.VERTIDA, option: 'Yes.', handled: false });
  assert.equal(p.items.get(ITEM.FLAIL) ?? 0, 0, 'a cancelled prompt cannot grant the flail later');
  mid.emit('npc-dialogue:choice', { player: p, npcId: NPC.VERTIDA, option: 'I need another flail.', handled: false });
  mid.emit('npc-dialogue:choice', { player: p, npcId: NPC.VERTIDA, option: 'Yes.', handled: false });
  assert.equal(p.items.get(ITEM.FLAIL), 1, 'the canonical purchase prompt grants the flail');
  assert.equal(p.items.get(ITEM.COINS), 0, '20,000 coins are taken');

  const full = harness();
  const fullPlayer = makePlayer();
  full.player = fullPlayer;
  full.quest.setStage(fullPlayer, 135);
  fullPlayer.items.set(ITEM.COINS, 20000);
  fullPlayer.setFull(true);
  full.emit('npc-dialogue:choice', { player: fullPlayer, npcId: NPC.VERTIDA, option: 'I need another flail.', handled: false });
  full.emit('npc-dialogue:choice', { player: fullPlayer, npcId: NPC.VERTIDA, option: 'Yes.', handled: false });
  assert.equal(fullPlayer.items.get(ITEM.FLAIL) ?? 0, 0, 'a full bag cannot buy the flail');
  assert.equal(fullPlayer.items.get(ITEM.COINS), 20000, 'coins are not taken on a full bag');
  assert.ok(fullPlayer.messages.some(text => text.includes('inventory space')));

  const post = harness();
  const postPlayer = makePlayer();
  post.player = postPlayer;
  post.quest.setStage(postPlayer, 166);
  postPlayer.items.set(ITEM.COINS, 20000);
  assert.equal(post.variant(NPC.VERTIDA, near(3599, 9611)), 'finishing-up-talking-to-vertida');
  post.emit('npc-dialogue:choice', { player: postPlayer, npcId: NPC.VERTIDA, option: 'I need another flail', handled: false });
  post.emit('npc-dialogue:choice', { player: postPlayer, npcId: NPC.VERTIDA, option: 'Yes.', handled: false });
  assert.equal(postPlayer.items.get(ITEM.FLAIL), 1, 'the post-quest no-period option also works');
});

test('post-quest Vertida remains at the old base and completed Safalaan cannot regress the stage', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  p.attrs.set('quest.taste_of_hope.bits', 1 << 15); // flail was created
  h.quest.setStage(p, 166);
  assert.ok(h.npcs.some(npc => npc.id === NPC.VERTIDA && !npc.removed), 'post-quest Vertida is spawned');
  assert.ok(!h.npcs.some(npc => npc.id === NPC.SAFALAAN && !npc.removed), 'no stale Safalaan is spawned at completion');
  assert.equal(h.variant(NPC.VERTIDA, near(3599, 9611)), 'finishing-up-talking-to-vertida');
  assert.equal(h.variant(NPC.SAFALAAN_BASE, near(3600, 9615)), null, 'no A Taste of Hope post-quest Safalaan page');
  assert.equal(h.quest.getStage(p), 166, 'talking to a leftover Safalaan cannot rewind completion');
});

test('completion wire stays below the native 165 threshold until the epilogue completes', () => {
  const h = harness();
  const p = makePlayer();
  h.player = p;
  h.quest.setStage(p, 165);
  const atFinishing = p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1);
  assert.equal(atFinishing[2], 160, 'internal finishing stage is not native completion');
  assert.equal(h.quest.isComplete(p), false);

  h.quest.setStage(p, 166);
  const atComplete = p.log.filter(row => row[0] === 'sendVarbit' && row[1] === 6396).at(-1);
  assert.equal(atComplete[2], 165, 'completion sends the cache threshold value');
  assert.equal(h.quest.isComplete(p), true);
});

// ---------------------------------------------------------------------------
// Sins of the Father and A Taste of Hope share the old-base Vertida (8220 at
// 3599,9611). The Sins plugin registers first (Quests.plugin.js), so its
// Talk-to and its variant hook win unless it yields to the Taste reclaim.
// ---------------------------------------------------------------------------

const SINS = {
  PAGE: 'Sins of the Father',
  STAGE_LOGS_GIVEN: 114,
  STAGE_VERTIDA_LOGS: 116,
  STAGE_FLAIL: 120,
  STAGE_SAFALAAN_WALK: 122,
  STAGE_READY: 126,
  STAGE_CASTLE: 130,
  STAGE_VANSTROM_DEAD: 132,
  STAGE_COMPLETE: 138,
  OLD_BASE: { x: 3599, y: 9611, z: 0 },
};

function harnessTwo() {
  const events = {};
  const variants = [];
  const conditions = [];
  const namedHooks = [];
  const api = new Proxy({
    core: { ...core, CountdownTask: undefined, TaskManager: undefined },
    persistAttribute: noop,
    registerArea: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onNpcInteraction: (name, actions) => namedHooks.push({ name, actions }),
    onItemOnObject: noop,
    onItemOnItem: noop,
    onItemAction: noop,
    onObjectInteraction: noop,
    onNpcDeath: noop,
    onNpcHitModify: noop,
    onPlayerLogin: noop,
    onPlayerLogout: noop,
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(handler => handler(event)),
    spawnNpc: definition => ({
      getId: () => definition.id,
      getLocation: () => new core.Location(definition.x, definition.y, definition.z),
      setMultiCombat: noop,
      getHitpoints: () => 100,
      setHitpoints: noop,
      isRegistered: () => true,
    }),
    removeNpc: noop,
  }, { get: (target, key) => target[key] ?? noop });
  // Quests.plugin.js lists Sins of the Father before A Taste of Hope.
  require('../plugins/quests/quests/SinsOfTheFather.Quest')(api);
  require('../plugins/quests/quests/TasteOfHope.Quest')(api);
  const quests = runtime.getRegisteredQuests();
  return {
    api, events, variants, conditions, namedHooks,
    sins: quests.find(entry => entry.key === 'sins_of_the_father'),
    taste: quests.find(entry => entry.key === 'taste_of_hope'),
    emit(key, event) { (events[key] ?? []).forEach(handler => handler(event)); },
    /**
     * The real Talk-to dispatch: the named interaction hooks run first, and an
     * unhandled talk falls through to the dialogue runtime, which asks the
     * variant hooks for the page to play.
     */
    talk(player, npc) {
      transcriptCalls = [];
      const event = {
        player,
        npc,
        npcId: NPC.VERTIDA,
        clickType: 1,
        definition: {
          getName: () => 'Vertida Sefalatis',
          getActions: () => ['Talk-to', null, null, null, null],
          getId: () => NPC.VERTIDA,
        },
        handled: false,
      };
      for (const entry of namedHooks) {
        if (event.handled) break;
        if (entry.name !== 'Vertida Sefalatis') continue;
        const action = entry.actions?.['Talk-to'];
        if (action && action(event) !== false) event.handled = true;
      }
      if (event.handled) return { handled: true, variant: null, transcript: transcriptCalls.at(-1) ?? null };
      for (const handler of variants) {
        const result = handler({ player, npcId: NPC.VERTIDA, npc, pages: [] });
        if (result) return { handled: true, variant: result, transcript: null };
      }
      return { handled: false, variant: null, transcript: null };
    },
  };
}

function makeSinsPlayer(h, options = {}) {
  const p = makePlayer(options);
  p.setLocation(SINS.OLD_BASE.x, SINS.OLD_BASE.y, 0);
  h.events['quest:is-complete'] = (h.events['quest:is-complete'] ?? []);
  h.events['quest:is-complete'].push(request => {
    if (request.key === 'taste_of_hope') request.complete = true;
  });
  h.taste.setStage(p, 166);
  h.sins.setStage(p, options.sinsStage ?? SINS.STAGE_READY);
  return p;
}

test('Sins keeps its own Vertida story while the Taste flail reclaim does not apply', () => {
  const h = harnessTwo();
  const p = makeSinsPlayer(h, { sinsStage: SINS.STAGE_VERTIDA_LOGS });
  p.items.set(ITEM.FLAIL, 1);
  const talk = h.talk(p, near(SINS.OLD_BASE.x, SINS.OLD_BASE.y));
  assert.equal(talk.handled, true, 'Sins answers the talk itself');
  assert.equal(talk.transcript?.page, SINS.PAGE);
  assert.equal(talk.transcript?.variant, 'the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-again');
});

test('Sins keeps the mandatory Vertida crafting conversation, and the reclaim only applies once it is done', () => {
  const h = harnessTwo();
  const p = makeSinsPlayer(h, { sinsStage: SINS.STAGE_VERTIDA_LOGS });
  const crafting = h.talk(p, near(SINS.OLD_BASE.x, SINS.OLD_BASE.y));
  assert.equal(crafting.transcript?.variant, 'the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-again',
    'a missing flail does not steal the Sins crafting conversation');

  const second = harnessTwo();
  const player = makeSinsPlayer(second, { sinsStage: SINS.STAGE_FLAIL });
  const talk = second.talk(player, near(SINS.OLD_BASE.x, SINS.OLD_BASE.y));
  assert.equal(talk.transcript?.variant, 'the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-with-a-blisterwood-flail');
  assert.equal(second.sins.getStage(player), SINS.STAGE_SAFALAAN_WALK, 'the Sins handover still advances the quest');
});

test('the completed Taste reclaim is reachable while Sins owns the old-base Vertida', () => {
  const h = harnessTwo();
  const p = makeSinsPlayer(h, { sinsStage: SINS.STAGE_READY });
  p.items.set(ITEM.COINS, 20000);
  const talk = h.talk(p, near(SINS.OLD_BASE.x, SINS.OLD_BASE.y));
  assert.equal(talk.variant, 'finishing-up-talking-to-vertida', 'the canonical Taste reclaim page answers');

  h.emit('npc-dialogue:choice', { player: p, npcId: NPC.VERTIDA, option: 'I need another flail', handled: false });
  h.emit('npc-dialogue:choice', { player: p, npcId: NPC.VERTIDA, option: 'Yes.', handled: false });
  assert.equal(p.items.get(ITEM.FLAIL), 1, 'the reclaim buys the flail back');
  assert.equal(p.items.get(ITEM.COINS), 0, '20,000 coins are taken');
});

test('a held or wielded flail needs no reclaim, so Sins keeps the talk', () => {
  const held = harnessTwo();
  const heldPlayer = makeSinsPlayer(held, { sinsStage: SINS.STAGE_READY });
  heldPlayer.items.set(ITEM.FLAIL, 1);
  const heldTalk = held.talk(heldPlayer, near(SINS.OLD_BASE.x, SINS.OLD_BASE.y));
  assert.equal(heldTalk.transcript, null, 'Sins answers, not the Taste page');
  assert.equal(heldTalk.variant, null, 'the Taste reclaim page does not take over');
  assert.equal(held.sins.getStage(heldPlayer), SINS.STAGE_READY, 'the Sins stage is unchanged');

  const wielded = harnessTwo();
  const wieldedPlayer = makeSinsPlayer(wielded, { sinsStage: SINS.STAGE_READY, weapon: ITEM.FLAIL });
  const wieldedTalk = wielded.talk(wieldedPlayer, near(SINS.OLD_BASE.x, SINS.OLD_BASE.y));
  assert.equal(wieldedTalk.variant, null, 'a wielded flail needs no reclaim');
  assert.equal(wieldedTalk.transcript, null);
});

test('a banked flail is reclaimed like a destroyed one, and the neighbouring Sins stages keep their story', () => {
  const banked = harnessTwo();
  const p = makeSinsPlayer(banked, { sinsStage: SINS.STAGE_READY });
  p.items.set(ITEM.FLAIL, 1);
  p.items.delete(ITEM.FLAIL); // deposited in the bank
  const talk = banked.talk(p, near(SINS.OLD_BASE.x, SINS.OLD_BASE.y));
  assert.equal(talk.variant, 'finishing-up-talking-to-vertida', 'a banked flail is reclaimed');

  const graveyard = harnessTwo();
  const grave = makeSinsPlayer(graveyard, { sinsStage: SINS.STAGE_READY });
  const otherTile = graveyard.talk(grave, near(3697, 3186));
  assert.equal(otherTile.variant, null, 'another Vertida tile is not the shared old-base one');
  assert.equal(otherTile.transcript, null);

  const complete = harnessTwo();
  const done = makeSinsPlayer(complete, { sinsStage: SINS.STAGE_COMPLETE });
  const after = complete.talk(done, near(SINS.OLD_BASE.x, SINS.OLD_BASE.y));
  assert.equal(after.variant, 'finishing-up-talking-to-vertida', 'after Sins the Taste page answers as before');
});
