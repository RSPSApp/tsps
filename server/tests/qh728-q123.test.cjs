// Wanted! (q123) source-contract audit against Quest Helper 06da90f.
// From server/: node --test tests/qh728-q123.test.cjs
//
// The route test fixture-sets only the Quest Helper prerequisites, supplies and
// a starting stage where stated. It then dispatches the registered handlers with
// the generated transcript's real variant names, condition ids and action /
// message ids. It proves handler contracts and the durable-stage -> wire
// mapping; it is not a live dialogue walkthrough or the Java QH overlay.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PacketSender } = require('../dist/net/packet/PacketSender');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const runtime = require('../plugins/quests/QuestRuntime');
const originalStartTranscript = runtime.startTranscript;
const dialogues = require('../data/definitions/npc-dialogues.json');
const dialogueIndex = require('../data/definitions/npc-dialogue-index.json');
const core = PluginManager.getCoreApi();
const noop = () => {};

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const bank = new Map();
  const messages = [];
  const moves = [];
  const skills = new Map();
  const equipment = new Map();
  const log = [];
  const varbits = new Map();
  let full = false;
  let location = new core.Location(0, 0, 0);
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter((amount) => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    full: () => messages.push('Not enough space in your inventory.'),
    forceAdd: (_player, item) => {
      items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount());
      return true;
    },
    getItems: () => [],
  };
  const sender = new Proxy({
    sendConfig(id, value) { log.push(['sendConfig', id, value]); return sender; },
    sendVarbit(id, value) { varbits.set(id, value); log.push(['sendVarbit', id, value]); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    getVarp() { return 0; },
  }, { get: (target, prop) => (prop in target ? target[prop] : () => sender) });
  return {
    attrs, items, bank, messages, moves, skills, equipment, log, varbits,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({
      get: (slot) => equipment.get(slot) ?? null,
      getValidItems: () => [...equipment.values()],
    }),
    getBank: () => ({ getAmount: (id) => bank.get(id) ?? 0 }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => skills.get(skill) ?? 99,
      addExperiences: (skill, amount) => skills.set(skill, (skills.get(skill) ?? 0) + amount),
    }),
    getUsername: () => 'qh728-q123', getDisplayName: () => 'qh728-q123',
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: (next) => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
    isPlayer: () => true,
    isPlayerBot: () => false,
  };
}

function harness({ realTranscript = false } = {}) {
  const events = {};
  const variants = [];
  const conditions = [];
  const itemActions = [];
  const npcInteractions = [];
  const registeredNpcHooks = [];
  const npcDeaths = [];
  const logins = [];
  const logouts = [];
  const playerDeaths = [];
  const zoneHandlers = [];
  const spawns = [];
  const removed = [];
  const transcripts = [];
  const completed = new Set();
  const api = new Proxy({
    core,
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onNpcInteraction(name, actions) {
      npcInteractions.push({ name, actions });
      if (realTranscript) {
        const start = PluginManager.npcInteractionHooks.length;
        PluginManager.createApi('q123-real-dispatch').onNpcInteraction(name, actions);
        registeredNpcHooks.push(...PluginManager.npcInteractionHooks.splice(start));
      }
    },
    onItemAction: (handler) => itemActions.push(handler),
    onNpcDeath: (handler) => npcDeaths.push(handler),
    onPlayerLogin: (handler) => logins.push(handler),
    onPlayerLogout: (handler) => logouts.push(handler),
    onPlayerDeath: (handler) => playerDeaths.push(handler),
    onZoneEnter: (zone, handler) => zoneHandlers.push({ zone, handler }),
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach((handler) => handler(event)),
    spawnNpc(definition) {
      if (!realTranscript) { spawns.push(definition); return definition; }
      const npc = new NPC(definition.id, new core.Location(definition.x, definition.y, definition.z));
      npc.setOwner(definition.owner);npc.setOwnerOnly(definition.ownerOnly === true);
      spawns.push(npc);return npc;
    },
    removeNpc: (npc) => removed.push(npc),
    sendMultiChatboxPrompt(p, title, ...pairs) {
      p.prompt = { title, pairs, options: pairs.filter((_, index) => index % 2 === 0) };
      return true;
    },
  }, { get: (target, key) => target[key] ?? noop });

  runtime.startTranscript = realTranscript ? originalStartTranscript : (_api, _player, npcId, page, variant) => {
    transcripts.push({ npcId, page, variant });
    return true;
  };
  (events['quest:is-complete'] ??= []).push((request) => {
    if (completed.has(request.key)) request.complete = true;
  });

  try { require('../plugins/quests/quests/Wanted.Quest')(api); } finally { runtime.startTranscript = originalStartTranscript; }
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'wanted');
  if (!logins.includes(runtime.sendQuestVarps)) logins.push(runtime.sendQuestVarps);
  const player = makePlayer();
  const emit = (key, event) => (events[key] ?? []).forEach((handler) => handler(event));

  return {
    api, quest, player, transcripts, variants, conditions, spawns, removed, completed, logins,
    setRequirements() {
      player.attrs.set('quest.points', 32);
      for (const key of ['the_lost_tribe', 'recruitment_drive', 'priest_in_peril']) completed.add(key);
    },
    hook(hook, npcId) {
      const event = { player, npcId, hook, handled: false };
      emit('npc-dialogue:hook', event);
      return event;
    },
    dispatchNpc(parentId) {
      const npc = new NPC(parentId, player.getLocation().clone());
      const definition = npc.getCurrentDefinition(player);
      const event = { player, npc, npcId: definition.getId(), definition, clickType: 1, handled: false };
      PluginManager.npcInteractionHooks.push(...registeredNpcHooks);
      try { PluginManager.emitNpcInteraction(event); } finally {
        for (const hook of registeredNpcHooks) PluginManager.npcInteractionHooks.splice(PluginManager.npcInteractionHooks.indexOf(hook), 1);
      }
      return event;
    },
    talk(name, npcId) {
      const entry = npcInteractions.find((candidate) => candidate.name === name);
      const action = entry?.actions?.['Talk-to'];
      const event = { player, npcId, clickType: 1, handled: false, definition: { getName: () => name } };
      if (!action) return event;
      if (action(event) !== false) event.handled = true;
      return event;
    },
    variant(npcId) {
      return variants.at(-1)({ player, npcId });
    },
    answer(npcId, stepId) {
      return conditions.at(-1)({ player, npcId, stepId, pages: [{ page: 'Wanted!' }] });
    },
    choice(npcId, option) {
      const event = { player, npcId, option, handled: false };
      emit('npc-dialogue:choice', event);
      return event;
    },
    line(npcId, text) {
      const event = { player, npcId, text, handled: false };
      emit('npc-dialogue:line', event);
      return event;
    },
    action(stepId, kind = 'action', npcId) {
      const event = { player, npcId, stepId, kind, handled: false };
      emit('npc-dialogue:action', event);
      return event;
    },
    itemAction(clickType) {
      const event = { player, itemId: I.COMMORB, slot: 0, clickType, handled: false };
      itemActions.forEach((handler) => handler(event));
      return event;
    },
    death(npcId, npc) {
      npcDeaths.forEach((handler) => handler({ killer: player, npc, npcId }));
    },
    zoneEnter() {
      zoneHandlers.forEach(({ handler }) => handler({ player }));
    },
    login() {
      logins.forEach((handler) => handler({ player }));
    },
    bootstrap() {
      emit('player:bootstrap-complete', { player });
    },
    varbit(id) { return player.getPacketSender().getVarbit(id); },
    setVarbit(id, value) { player.getPacketSender().sendVarbit(id, value); },
  };
}

const MISSION = {
  CANIFIS: 1,
  CHAMPIONS_GUILD: 2,
  DORGESHUUN_MINE: 3,
  RUNE_ESSENCE_MINE: 4,
  MUSA_POINT: 5,
  DRAYNOR_MARKET: 6,
  GOBLIN_VILLAGE: 7,
  ARDOUGNE_MARKET: 8,
  GRAND_TREE: 9,
  SCORPIUS_SHRINE: 10,
  ALI_MORRISANE: 11,
  WIZARDS_TOWER: 12,
  BRIMHAVEN_PUB: 13,
  CASTLE_WARS: 14,
  RELLEKKA: 15,
  MCGRUBORS_WOOD: 16,
  SLAYER_TOWER: 17,
  YANILLE_PUB: 18,
  LUMBRIDGE_SWAMP: 19,
};
const RANDOM_MISSIONS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const missionVarbit = (mission) => 1065 + (mission - 1) * 2;
const completeVarbit = (mission) => missionVarbit(mission) + 1;

// QH destinations, clue condition/message ids and the QH marker tile used to
// scan there. This is fixture data for the registered-handler test.
const RANDOM_DESTINATIONS = {
  [MISSION.MUSA_POINT]: { tile: [2916, 3160], condition: 'j5Pacg', step: 'NZOIUt', item: I.BANANA },
  [MISSION.DRAYNOR_MARKET]: { tile: [3082, 3249], condition: 'fvpmF5', step: 'DjOVBv', item: I.BROWN_TOY_HORSEY },
  [MISSION.GOBLIN_VILLAGE]: { tile: [2956, 3506], condition: 'xsrPZk', step: 's_gm2c', item: I.GOBLIN_MAIL },
  [MISSION.ARDOUGNE_MARKET]: { tile: [2662, 3305], condition: 'TgXuG7', step: 'sjgyQZ', item: I.BEAR_FUR },
  [MISSION.GRAND_TREE]: { tile: [2465, 3496], condition: 'ORbz7w', step: 'YCBBF7', item: I.CREAM_HAT },
  [MISSION.SCORPIUS_SHRINE]: { tile: [2465, 3227], condition: 'A4f-N_', step: 'f3dlmQ', item: I.UNHOLY_SYMBOL },
  [MISSION.ALI_MORRISANE]: { tile: [3304, 3211], condition: 'HZgS0z', step: 'X-jLCw', item: I.FAKE_BEARD },
  [MISSION.WIZARDS_TOWER]: { tile: [3109, 3164], condition: 'YnbS1i', step: 'VTgt8I', item: I.BLUE_WIZARD_HAT },
  [MISSION.BRIMHAVEN_PUB]: { tile: [2795, 3162], condition: 'CAIvwn', step: 'yzrPqL', item: I.RIGHT_EYE_PATCH },
  [MISSION.CASTLE_WARS]: { tile: [2441, 3090], condition: 'DPRk5N', step: 'yCYScL', item: I.CASTLE_WARS_TICKET },
  [MISSION.RELLEKKA]: { tile: [2660, 3657], condition: 'Xhbln-', step: 'WB1yMP', item: I.FREMENNIK_PURPLE_CLOAK },
  [MISSION.MCGRUBORS_WOOD]: { tile: [2662, 3500], condition: 'ErFows', step: 'o_opbE', item: I.RED_VINE_WORM },
  [MISSION.SLAYER_TOWER]: { tile: [3428, 3537], condition: 'jdDxg7', step: 'Cv9NjI', item: I.EARMUFFS },
  [MISSION.YANILLE_PUB]: { tile: [2551, 3081], condition: 'WhEdiy', step: 'sH7QJd', item: I.GREENMANS_ALE },
  [MISSION.LUMBRIDGE_SWAMP]: { tile: [3218, 9548], condition: '2ZR-Ny', step: 'idUV-w', item: I.GIANT_FROG_LEGS },
};

function setTrail(h, position, destination, pending = 0) {
  const p = h.player;
  p.attrs.set('quest.wanted.stage', 11);
  p.attrs.set('quest.wanted.mission', position);
  p.attrs.set('wanted:destination', destination);
  p.attrs.set('wanted:pending-destination', pending);
  if (destination) h.setVarbit(missionVarbit(destination), 1);
}

function wireValue(player, id = 1051) {
  const entry = [...player.log].reverse().find(([name, wireId]) => (name === 'sendVarbit' || name === 'sendConfig') && wireId === id);
  return entry?.[2];
}

test('Wanted starts at Abyss492 zero with its actual quest prerequisites and 32 points', () => {
  const h = harness();
  const p = h.player;
  assert.equal(h.quest.getStage(p), 0, 'fresh stage 0');

  // The pre-fix plugin accepted Lost Tribe + Recruitment Drive only.
  h.completed.add('the_lost_tribe');
  h.completed.add('recruitment_drive');
  p.attrs.set('quest.points', 32);
  h.hook('quest:wanted:start', N.SIR_TIFFY_CASHIEN);
  assert.equal(h.quest.getStage(p), 0, 'Priest in Peril is required');
  assert.equal(h.talk('Sir Tiffy Cashien', N.SIR_TIFFY_CASHIEN).handled, false, 'unmet requirements fall through');

  h.completed.add('priest_in_peril');
  p.attrs.set('quest.points', 31);
  h.hook('quest:wanted:start', N.SIR_TIFFY_CASHIEN);
  assert.equal(h.quest.getStage(p), 0, '31 quest points is not enough');

  p.attrs.set('quest.points', 32);
  h.hook('quest:wanted:start', N.SIR_TIFFY_CASHIEN);
  assert.equal(h.quest.getStage(p), 1, 'actual prerequisites start Wanted without fabricated Abyss progress');
  assert.equal(wireValue(p), 3, 'durable stage 1 is QH key 3 (go to Sir Amik)');
});

test('registered handlers drive every mandatory leg and transmit canonical completion 11', () => {
  const h = harness();
  const p = h.player;
  h.setRequirements();
  h.player.items.set(I.LAW_RUNE, 1);
  h.player.items.set(I.ENCHANTED_GEM, 1);
  h.player.items.set(I.MOLTEN_GLASS, 1);
  h.player.items.set(I.PURE_ESSENCE, 20);

  h.hook('quest:wanted:start', N.SIR_TIFFY_CASHIEN);
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(wireValue(p), 3);

  // Sir Amik's squireship offer -> decline path -> Tiffy's crisis plan.
  assert.equal(h.talk('Sir Amik Varze', N.SIR_AMIK_VARZE_4).handled, true);
  assert.equal(h.transcripts.at(-1).variant, 'falador-castle-first-visit-to-sir-amik');
  h.choice(N.SIR_AMIK_VARZE_4, 'No, not right now...');
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(wireValue(p), 4, 'durable stage 2 is QH key 4 (see Tiffy)');

  assert.equal(h.talk('Sir Tiffy Cashien', N.SIR_TIFFY_CASHIEN).handled, true);
  assert.equal(h.transcripts.at(-1).variant, 'falador-park-the-crisis-talking-to-sir-tiffy-after-declining-to-be-amik-s-squire');
  assert.equal(h.quest.getStage(p), 3);
  assert.equal(wireValue(p), 5, 'durable stage 3 is QH key 5 (see Sir Amik again)');

  assert.equal(h.talk('Sir Amik Varze', N.SIR_AMIK_VARZE_4).handled, true);
  assert.equal(h.transcripts.at(-1).variant, 'falador-castle-second-visit-to-sir-amik');
  h.choice(N.SIR_AMIK_VARZE_4, "Sure, I'll help you!");
  assert.equal(h.quest.getStage(p), 4);
  assert.equal(wireValue(p), 6, 'durable stage 4 is QH key 6 (see Tiffy for the orb)');

  // CommOrb components are consumed when the made-to-order branch is taken.
  assert.equal(h.talk('Sir Tiffy Cashien', N.SIR_TIFFY_CASHIEN).handled, true);
  h.choice(N.SIR_TIFFY_CASHIEN, 'Have One Made');
  h.choice(N.SIR_TIFFY_CASHIEN, 'Yes');
  assert.equal(p.items.get(I.COMMORB), 1, 'Tiffy gives the CommOrb');
  for (const id of [I.LAW_RUNE, I.ENCHANTED_GEM, I.MOLTEN_GLASS]) {
    assert.equal(p.items.get(id) ?? 0, 0, `component ${id} is consumed`);
  }
  assert.equal(h.quest.getStage(p), 5);
  assert.equal(wireValue(p), 8, 'orb already obtained: helper must say Contact Savant');

  // Contact Savant, then Daquarius and the Black Knight.
  assert.equal(h.itemAction(2).handled, true);
  assert.equal(h.transcripts.at(-1).variant, 'falador-park-mission-details-contacting-savant');
  assert.equal(h.quest.getStage(p), 6);
  assert.equal(wireValue(p), 8);

  assert.equal(h.talk('Lord Daquarius', N.LORD_DAQUARIUS).handled, true);
  assert.equal(h.transcripts.at(-1).variant, 'lord-daquarius');
  assert.equal(h.quest.getStage(p), 7);

  h.death(N.BLACK_KNIGHT_2, {});
  assert.equal(p.attrs.get('quest.wanted.black-knight-dead'), 1);
  assert.equal(h.transcripts.at(-1).variant, 'lord-daquarius-after-killing-a-black-knight');

  assert.equal(h.talk('Lord Daquarius', N.LORD_DAQUARIUS).handled, true);
  assert.equal(h.transcripts.at(-1).variant, 'lord-daquarius-talking-to-lord-daquarius-after-killing-a-black-knight');
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(wireValue(p), 8, 'all investigation stages carry QH key 8');
  assert.equal(h.spawns.some(npc => npc.id === N.MAGE_OF_ZAMORAK_3), false, 'map transform owns the chapel mage; no duplicate child');

  // Mage price: 20 pure essence.
  assert.equal(h.variant(N.MAGE_OF_ZAMORAK_3).variant, 'zamorakian-mage');
  h.choice(N.MAGE_OF_ZAMORAK_3, 'Solus Dellagar.');
  assert.equal(h.quest.getStage(p), 9);
  assert.equal(wireValue(p), 8);
  h.line(N.MAGE_OF_ZAMORAK_3, 'I have your essences right here, take them.');
  assert.equal(h.quest.getStage(p), 10);
  assert.equal(p.items.get(I.PURE_ESSENCE) ?? 0, 0, '20 essence is consumed');
  assert.equal(wireValue(p), 9, 'durable stage 10 is QH key 9 (hunt)');

  // Canifis -> Rellekka -> Champions' Guild -> Wizards' Tower ->
  // Dorgesh-Kaan -> Castle Wars -> rune essence mine.
  p.setLocation(3485, 3481, 0);
  h.zoneEnter();
  assert.equal(h.quest.getStage(p), 11);
  assert.equal(p.attrs.get('quest.wanted.mission'), 1);
  assert.equal(h.transcripts.at(-1).variant, 'approaching-canifis');
  assert.equal(wireValue(p), 9, 'durable stage 11 must stay below native completion 11');

  assert.equal(p.attrs.get('wanted:destination'), MISSION.CANIFIS);
  assert.equal(h.varbit(missionVarbit(MISSION.CANIFIS)), 1, 'Canifis mission bit is set');

  // Fixture: Rellekka is the first random destination.
  p.attrs.set('wanted:pending-destination', MISSION.RELLEKKA);
  assert.equal(h.itemAction(1).handled, true);
  assert.equal(h.transcripts.at(-1).variant, 'approaching-canifis-scanning-in-canifis');
  assert.equal(h.answer(N.SOLUS_DELLAGAR, 'Xhbln-'), true);
  h.action('WB1yMP', 'message');
  assert.equal(p.items.get(I.FREMENNIK_PURPLE_CLOAK), 1);
  assert.equal(p.attrs.get('quest.wanted.mission'), 2);
  assert.equal(p.attrs.get('wanted:destination'), MISSION.RELLEKKA);
  assert.equal(h.varbit(missionVarbit(MISSION.RELLEKKA)), 1);
  assert.equal(h.varbit(completeVarbit(MISSION.CANIFIS)), 1);
  assert.equal(h.varbit(missionVarbit(MISSION.CANIFIS)), 0);

  p.setLocation(2660, 3657, 0);
  h.itemAction(1);
  assert.equal(h.transcripts.at(-1).variant, 'scanning-the-second-location');
  h.action('qUGLsM', 'message');
  assert.equal(p.items.get(I.BLUE_CAPE), 1);
  assert.equal(p.attrs.get('quest.wanted.mission'), 3);
  assert.equal(p.attrs.get('wanted:destination'), MISSION.CHAMPIONS_GUILD);
  assert.equal(h.varbit(missionVarbit(MISSION.CHAMPIONS_GUILD)), 1);
  assert.equal(h.varbit(completeVarbit(MISSION.RELLEKKA)), 1);
  assert.equal(h.varbit(missionVarbit(MISSION.RELLEKKA)), 0);

  // Fixture: Wizards' Tower is the second random destination.
  p.setLocation(3190, 3359, 0);
  p.attrs.set('wanted:pending-destination', MISSION.WIZARDS_TOWER);
  h.itemAction(1);
  assert.equal(h.transcripts.at(-1).variant, 'scanning-at-champion-s-guild');
  const guildClue = h.action('BO-ZlI', 'action');
  assert.equal(guildClue.handled, true, 'the reference is expanded to the clue branch');
  assert.ok(guildClue.steps.length > 0);
  assert.equal(h.answer(N.SOLUS_DELLAGAR, 'YnbS1i'), true);
  h.action('VTgt8I', 'message');
  assert.equal(p.items.get(I.BLUE_WIZARD_HAT), 1);
  assert.equal(p.attrs.get('quest.wanted.mission'), 4);
  assert.equal(p.attrs.get('wanted:destination'), MISSION.WIZARDS_TOWER);
  assert.equal(h.varbit(missionVarbit(MISSION.WIZARDS_TOWER)), 1);
  assert.equal(h.varbit(completeVarbit(MISSION.CHAMPIONS_GUILD)), 1);

  p.setLocation(3109, 3164, 0);
  h.itemAction(1);
  assert.equal(h.transcripts.at(-1).variant, 'scanning-the-fourth-location');
  h.action('mdADDD', 'message');
  assert.equal(p.items.get(I.BONE_SPEAR), 1);
  assert.equal(p.attrs.get('quest.wanted.mission'), 5);
  assert.equal(p.attrs.get('wanted:destination'), MISSION.DORGESHUUN_MINE);
  assert.equal(h.varbit(missionVarbit(MISSION.DORGESHUUN_MINE)), 1);
  assert.equal(h.varbit(completeVarbit(MISSION.WIZARDS_TOWER)), 1);

  // Fixture: Castle Wars is the third random destination.
  p.setLocation(3317, 9612, 0);
  p.attrs.set('wanted:pending-destination', MISSION.CASTLE_WARS);
  h.itemAction(1);
  assert.equal(h.transcripts.at(-1).variant, 'scanning-in-dorgeshuun-mines');
  const mineClue = h.action('WF7PuA', 'action');
  assert.equal(mineClue.handled, true);
  assert.equal(h.answer(N.SOLUS_DELLAGAR, 'DPRk5N'), true);
  h.action('yCYScL', 'message');
  assert.equal(p.items.get(I.CASTLE_WARS_TICKET), 1);
  assert.equal(p.attrs.get('quest.wanted.mission'), 6);
  assert.equal(p.attrs.get('wanted:destination'), MISSION.CASTLE_WARS);
  assert.equal(h.varbit(missionVarbit(MISSION.CASTLE_WARS)), 1);
  assert.equal(h.varbit(completeVarbit(MISSION.DORGESHUUN_MINE)), 1);

  p.setLocation(2441, 3090, 0);
  h.itemAction(1);
  assert.equal(h.transcripts.at(-1).variant, 'scanning-the-sixth-location');
  h.action('CfRFgE', 'action');
  const knight = h.spawns.at(-1);
  assert.equal(knight.id, N.BLACK_KNIGHT_6);
  h.death(N.BLACK_KNIGHT_6, knight);
  assert.equal(h.transcripts.at(-1).variant, 'scanning-the-sixth-location-after-the-black-knight-is-defeated');
  h.action('3AZ4ZV', 'message');
  assert.equal(p.items.get(I.RUNE_ESSENCE_2), 20, '20 noted rune essence is the sixth clue');
  assert.equal(p.attrs.get('quest.wanted.mission'), 7);
  assert.equal(p.attrs.get('wanted:destination'), MISSION.RUNE_ESSENCE_MINE);
  assert.equal(h.varbit(missionVarbit(MISSION.RUNE_ESSENCE_MINE)), 1);
  assert.equal(h.varbit(completeVarbit(MISSION.CASTLE_WARS)), 1);

  p.setLocation(2900, 4830, 0);
  h.itemAction(1);
  assert.equal(h.transcripts.at(-1).variant, 'rune-essence-mine-ending-the-hunt');
  h.action('UK6zld', 'action');
  const solus = h.spawns.at(-1);
  assert.equal(solus.id, N.SOLUS_DELLAGAR_3);
  h.death(N.SOLUS_DELLAGAR_3, solus);
  assert.equal(h.quest.getStage(p), 12);
  assert.equal(p.items.get(I.SOLUSS_HAT), 1);
  assert.equal(h.transcripts.at(-1).variant, 'rune-essence-mine-ending-the-hunt-after-defeating-solus');
  assert.equal(h.varbit(completeVarbit(MISSION.RUNE_ESSENCE_MINE)), 1, 'the final mission is complete');
  assert.equal(h.varbit(missionVarbit(MISSION.RUNE_ESSENCE_MINE)), 0);
  assert.equal(wireValue(p), 10, 'durable stage 12 is QH key 10 (hand in the hat)');

  // Final hand-in: the hat is consumed and the completion wire is 11.
  assert.equal(h.talk('Sir Amik Varze', N.SIR_AMIK_VARZE_4).handled, true);
  assert.equal(h.transcripts.at(-1).variant, 'completing-the-quest-talking-to-sir-amik');
  assert.equal(h.answer(N.SIR_AMIK_VARZE_4, 'OUdNKz'), true);
  h.action('iDVsvn', 'action', N.SIR_AMIK_VARZE_4);
  assert.equal(h.quest.getStage(p), 13);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.items.get(I.SOLUSS_HAT) ?? 0, 0, 'the hat is handed over');
  assert.equal(wireValue(p), 11, 'completion transmits the cache threshold 11');
  assert.equal(p.attrs.get('quest.points'), 33, 'one quest point on top of the fixture prerequisites');
  assert.equal(p.skills.get(core.Skill.SLAYER), 5000);

  // Repeat hand-in must not pay twice, and login replays the completion wire.
  h.action('iDVsvn', 'action', N.SIR_AMIK_VARZE_4);
  assert.equal(p.skills.get(core.Skill.SLAYER), 5000);
  assert.equal(p.attrs.get('quest.points'), 33, 'one quest point on top of the fixture prerequisites');
  p.log.length = 0;
  h.login();
  assert.equal(wireValue(p), 11, 'bootstrap/login re-sends varbit 1051 = 11');
  h.setVarbit(completeVarbit(MISSION.RELLEKKA), 0);
  h.bootstrap();
  assert.equal(h.varbit(completeVarbit(MISSION.RELLEKKA)), 1, 'bootstrap restores completed mission bits');
  assert.equal(h.varbit(completeVarbit(MISSION.RUNE_ESSENCE_MINE)), 1);
});

test('every canonical random destination hands over its clue and scans at position two', () => {
  for (const mission of RANDOM_MISSIONS) {
    const info = RANDOM_DESTINATIONS[mission];
    const h = harness();
    setTrail(h, 1, MISSION.CANIFIS, mission);
    h.player.setLocation(3485, 3481, 0);
    h.itemAction(1);
    assert.equal(h.transcripts.at(-1).variant, 'approaching-canifis-scanning-in-canifis');
    assert.equal(h.answer(N.SOLUS_DELLAGAR, info.condition), true, `mission ${mission} clue condition`);
    const other = RANDOM_MISSIONS.find((candidate) => candidate !== mission);
    assert.equal(h.answer(N.SOLUS_DELLAGAR, RANDOM_DESTINATIONS[other].condition), false, 'only the chosen clue branch is true');
    h.action(info.step, 'message');
    assert.equal(h.player.items.get(info.item), 1, `mission ${mission} clue item`);
    assert.equal(h.player.attrs.get('quest.wanted.mission'), 2);
    assert.equal(h.player.attrs.get('wanted:destination'), mission);
    assert.equal(h.varbit(missionVarbit(mission)), 1, `mission ${mission} current varbit`);
    assert.equal(h.varbit(completeVarbit(MISSION.CANIFIS)), 1);

    h.player.setLocation(info.tile[0], info.tile[1], 0);
    h.itemAction(1);
    assert.equal(h.transcripts.at(-1).variant, 'scanning-the-second-location', `mission ${mission} zone scan`);
    h.action('qUGLsM', 'message');
    assert.equal(h.player.items.get(I.BLUE_CAPE), 1);
    assert.equal(h.player.attrs.get('quest.wanted.mission'), 3);
    assert.equal(h.player.attrs.get('wanted:destination'), MISSION.CHAMPIONS_GUILD);
    assert.equal(h.varbit(completeVarbit(mission)), 1, `mission ${mission} completion varbit`);
    assert.equal(h.varbit(missionVarbit(mission)), 0);
  }
});

test('every canonical random destination scans at positions four and six', () => {
  for (const mission of RANDOM_MISSIONS) {
    const info = RANDOM_DESTINATIONS[mission];
    const h = harness();
    setTrail(h, 4, mission);
    h.player.setLocation(info.tile[0], info.tile[1], 0);
    h.itemAction(1);
    assert.equal(h.transcripts.at(-1).variant, 'scanning-the-fourth-location', `mission ${mission} fourth scan`);
    h.action('mdADDD', 'message');
    assert.equal(h.player.items.get(I.BONE_SPEAR), 1);
    assert.equal(h.player.attrs.get('quest.wanted.mission'), 5);
    assert.equal(h.player.attrs.get('wanted:destination'), MISSION.DORGESHUUN_MINE);
    assert.equal(h.varbit(completeVarbit(mission)), 1);
  }
  for (const mission of RANDOM_MISSIONS) {
    const info = RANDOM_DESTINATIONS[mission];
    const h = harness();
    setTrail(h, 6, mission);
    h.player.setLocation(info.tile[0], info.tile[1], 0);
    h.itemAction(1);
    assert.equal(h.transcripts.at(-1).variant, 'scanning-the-sixth-location', `mission ${mission} sixth scan`);
    h.action('CfRFgE', 'action');
    const knight = h.spawns.at(-1);
    h.death(N.BLACK_KNIGHT_6, knight);
    h.action('3AZ4ZV', 'message');
    assert.equal(h.player.items.get(I.RUNE_ESSENCE_2), 20);
    assert.equal(h.player.attrs.get('quest.wanted.mission'), 7);
    assert.equal(h.player.attrs.get('wanted:destination'), MISSION.RUNE_ESSENCE_MINE);
    assert.equal(h.varbit(completeVarbit(mission)), 1);
  }
});

test('the random picker uses only canonical unused destinations', () => {
  const h = harness();
  setTrail(h, 1, MISSION.CANIFIS, 0);
  for (const mission of RANDOM_MISSIONS) {
    if (mission !== MISSION.MUSA_POINT) h.setVarbit(completeVarbit(mission), 1);
  }
  h.player.setLocation(3485, 3481, 0);
  h.itemAction(1);
  assert.equal(h.player.attrs.get('wanted:pending-destination'), MISSION.MUSA_POINT, 'only unused mission is chosen');
  assert.equal(h.answer(N.SOLUS_DELLAGAR, 'j5Pacg'), true);
});

test('wrong zone, retry, relog and full-bag clues keep the trail recoverable', () => {
  // Recap conditions describe the current destination, not the pending one.
  const recap = harness();
  setTrail(recap, 2, MISSION.MUSA_POINT);
  recap.itemAction(2);
  assert.equal(recap.transcripts.at(-1).variant, 'approaching-canifis-talking-to-savant-again');
  assert.equal(recap.answer(N.SAVANT, 'HFiKqm'), true, 'Musa Point recap is shown');
  assert.equal(recap.answer(N.SAVANT, 'z3YtI9'), false, 'another destination recap stays hidden');

  // Wrong zone at position 2: failing scan, no state change.
  const wrong = harness();
  setTrail(wrong, 2, MISSION.MUSA_POINT);
  wrong.player.setLocation(2660, 3657, 0);
  wrong.itemAction(1);
  assert.equal(wrong.transcripts.at(-1).variant, 'approaching-canifis-failing-scans');
  assert.equal(wrong.player.attrs.get('quest.wanted.mission'), 2);
  assert.equal(wrong.player.attrs.get('wanted:destination'), MISSION.MUSA_POINT);

  // Retry/re-entry reuses the pending destination, even across login.
  const retry = harness();
  setTrail(retry, 1, MISSION.CANIFIS, 0);
  retry.player.setLocation(3485, 3481, 0);
  retry.itemAction(1);
  const pending = retry.player.attrs.get('wanted:pending-destination');
  assert.ok(RANDOM_MISSIONS.includes(pending), 'the first scan picks a canonical destination');
  retry.itemAction(1);
  assert.equal(retry.player.attrs.get('wanted:pending-destination'), pending, 'rescan keeps the pick');
  retry.login();
  assert.equal(retry.player.attrs.get('wanted:pending-destination'), pending, 'relog keeps the pick');
  retry.setVarbit(missionVarbit(MISSION.CANIFIS), 0);
  retry.bootstrap();
  assert.equal(retry.varbit(missionVarbit(MISSION.CANIFIS)), 1, 'bootstrap restores the current mission bit');
  retry.itemAction(1);
  assert.equal(retry.player.attrs.get('wanted:pending-destination'), pending);
  assert.equal(retry.answer(N.SOLUS_DELLAGAR, RANDOM_DESTINATIONS[pending].condition), true);

  // Full bag still advances the trail and writes the mission varbit.
  const full = harness();
  setTrail(full, 1, MISSION.CANIFIS, MISSION.YANILLE_PUB);
  full.player.setLocation(3485, 3481, 0);
  full.player.setFull(true);
  full.itemAction(1);
  assert.equal(full.answer(N.SOLUS_DELLAGAR, 'WhEdiy'), true);
  full.action('sH7QJd', 'message');
  assert.equal(full.player.items.get(I.GREENMANS_ALE) ?? 0, 0);
  assert.ok(full.player.messages.some((message) => message.includes('no room')));
  assert.equal(full.player.attrs.get('quest.wanted.mission'), 2);
  assert.equal(full.player.attrs.get('wanted:destination'), MISSION.YANILLE_PUB);
  assert.equal(full.varbit(missionVarbit(MISSION.YANILLE_PUB)), 1);
});

test('legacy and native hunt saves migrate to canonical mission varbits', () => {
  const missing = harness();
  missing.player.attrs.set('quest.wanted.stage', 11);
  missing.player.attrs.set('quest.wanted.mission', 0);
  missing.player.log.length = 0;
  missing.login();
  assert.equal(wireValue(missing.player), 9, 'stage 11 (hunt) must not read as native complete');
  assert.equal(missing.player.attrs.get('quest.wanted.mission'), 1, 'missing hunt checkpoint restarts at Canifis');
  assert.equal(missing.player.attrs.get('wanted:destination'), MISSION.CANIFIS);
  assert.equal(missing.varbit(missionVarbit(MISSION.CANIFIS)), 1);

  const oldPositions = [
    [2, MISSION.RELLEKKA, [MISSION.CANIFIS]],
    [4, MISSION.WIZARDS_TOWER, [MISSION.CANIFIS, MISSION.RELLEKKA, MISSION.CHAMPIONS_GUILD]],
    [6, MISSION.CASTLE_WARS, [MISSION.CANIFIS, MISSION.RELLEKKA, MISSION.CHAMPIONS_GUILD, MISSION.WIZARDS_TOWER, MISSION.DORGESHUUN_MINE]],
  ];
  for (const [position, destination, completed] of oldPositions) {
    const h = harness();
    h.player.attrs.set('quest.wanted.stage', 11);
    h.player.attrs.set('quest.wanted.mission', position);
    h.login();
    assert.equal(h.player.attrs.get('wanted:destination'), destination, `old position ${position} destination`);
    assert.equal(h.varbit(missionVarbit(destination)), 1, `old position ${position} mission bit`);
    for (const mission of completed) {
      assert.equal(h.varbit(completeVarbit(mission)), 1, `old position ${position} completed ${mission}`);
    }
  }

  // A native save with a mission bit but no plugin attribute keeps that pick.
  const native = harness();
  native.player.attrs.set('quest.wanted.stage', 11);
  native.player.attrs.set('quest.wanted.mission', 2);
  native.setVarbit(missionVarbit(MISSION.MUSA_POINT), 1);
  native.login();
  assert.equal(native.player.attrs.get('wanted:destination'), MISSION.MUSA_POINT);

  const defeated = harness();
  defeated.player.attrs.set('quest.wanted.stage', 12);
  defeated.player.log.length = 0;
  defeated.login();
  assert.equal(wireValue(defeated.player), 10, 'defeated stage 12 is still below completion');

  defeated.player.attrs.set('quest.wanted.stage', 13);
  defeated.player.log.length = 0;
  defeated.login();
  assert.equal(wireValue(defeated.player), 11, 'existing completed saves replay 11');
  assert.equal(defeated.quest.isComplete(defeated.player), true);
});

test('lost-hat recovery, bank gating and full-bag handling use the canonical dialogue', () => {
  const h = harness();
  const p = h.player;
  p.attrs.set('quest.wanted.stage', 12);
  p.setFull(true);

  assert.equal(h.itemAction(2).handled, true);
  assert.equal(h.transcripts.at(-1).variant, 'rune-essence-mine-ending-the-hunt-communicating-with-savant-after-defeating-solus');
  assert.equal(h.answer(N.SAVANT, '6G5sML'), true);
  h.line(N.SAVANT, 'I have sent you a duplicate, try not to lose it.');
  assert.equal(p.items.get(I.SOLUSS_HAT) ?? 0, 0, 'a full bag keeps the hat pending');
  assert.ok(p.messages.some((message) => message.includes('free inventory slot')));

  p.setFull(false);
  h.line(N.SAVANT, 'I have sent you a duplicate, try not to lose it.');
  assert.equal(p.items.get(I.SOLUSS_HAT), 1, 'the duplicate arrives once there is room');

  // Banked hat: Amik's bank condition is true, but the hand-in cannot complete.
  p.items.delete(I.SOLUSS_HAT);
  p.bank.set(I.SOLUSS_HAT, 1);
  assert.equal(h.talk('Sir Amik Varze', N.SIR_AMIK_VARZE_4).handled, true);
  assert.equal(h.answer(N.SIR_AMIK_VARZE_4, 'T0nCk0'), true);
  h.action('iDVsvn', 'action', N.SIR_AMIK_VARZE_4);
  assert.equal(h.quest.getStage(p), 12, 'the banked hat must be brought in person');

  p.bank.delete(I.SOLUSS_HAT);
  p.items.set(I.SOLUSS_HAT, 1);
  h.action('iDVsvn', 'action', N.SIR_AMIK_VARZE_4);
  assert.equal(h.quest.getStage(p), 13);
  assert.equal(p.items.get(I.SOLUSS_HAT) ?? 0, 0);
});

test('post-quest Sir Amik and Sir Tiffy pages exist for the fall-through dialogue', () => {
  assert.ok(dialogues['Sir Amik Varze'].variants['after-completing-wanted'], 'Sir Amik post-quest variant exists');
  assert.ok(dialogues['Sir Tiffy Cashien'].variants['after-wanted'], 'Sir Tiffy post-quest variant exists');
  assert.ok(
    dialogueIndex[String(N.MAGE_OF_ZAMORAK_3)].some((entry) => entry.page === 'Transcript:Wanted!'),
    'the canonical Varrock mage id indexes the Wanted! page'
  );
});


test('earned investigation auxiliaries and the accepted-squire helper branch replay through actual PacketSender', () => {
  const h = harness(), p = h.player;
  p.getSession = () => ({ sendClientPacket() { } });
  let sender = new PacketSender(p); p.getPacketSender = () => sender;
  sender.sendConfig(571, 1 << 13); sender.sendConfig(572, 1 << 24);
  h.quest.setStage(p, 1);
  h.choice(N.SIR_AMIK_VARZE_4, 'Yes please!');
  assert.equal(sender.getVarbit(1052), 1);
  assert.equal(sender.getVarbit(1051), 3, 'accepted squire goes back to Tiffy via helper key3');
  h.talk('Sir Tiffy Cashien', N.SIR_TIFFY_CASHIEN);
  assert.equal(sender.getVarbit(1052), 0);
  h.quest.setStage(p, 6);
  h.line(N.SAVANT, 'From the look of the record, he would be worth talking to as well.');
  assert.equal(sender.getVarbit(1053), 1);
  h.talk('Lord Daquarius', N.LORD_DAQUARIUS);
  h.line(N.LORD_DAQUARIUS, "You're going to have to find some other way to intimidate him into giving you the information we need.");
  assert.equal(sender.getVarbit(1055), 1);
  h.death(N.BLACK_KNIGHT_2, new NPC(N.BLACK_KNIGHT_2, new core.Location(2926, 9706, 0)));
  assert.equal(sender.getVarbit(1055), 2);
  h.talk('Lord Daquarius', N.LORD_DAQUARIUS);
  h.line(N.LORD_DAQUARIUS, 'All I know is that he left behind some fur when he left, I would expect him to be in an area with furred creatures of some sort.');
  assert.equal(sender.getVarbit(1058), 1);
  h.choice(N.MAGE_OF_ZAMORAK_3, 'Solus Dellagar.');
  h.line(N.MAGE_OF_ZAMORAK_3, 'Twenty parts of rune essence is my price for my information. You may take it or leave it...');
  assert.equal(sender.getVarbit(1056), 1);
  assert.equal(sender.getVarp(571) & (1 << 13), 1 << 13);
  assert.equal(sender.getVarp(572) & (1 << 24), 1 << 24);
  sender = new PacketSender(p); h.login(); h.bootstrap();
  for (const [id, value] of [[1052, 0], [1053, 1], [1055, 2], [1056, 1], [1058, 1]]) assert.equal(sender.getVarbit(id), value);
});


function realRunner(h) {
  const p = h.player, fallback = p.getPacketSender();
  p.getSession = () => ({ sendClientPacket() { } });
  let wire = new PacketSender(p);
  const sender = new Proxy(fallback, {
    get(target, key) {
      if (['sendVarbit', 'getVarbit', 'sendConfig', 'getVarp'].includes(key)) return wire[key].bind(wire);
      return target[key];
    }
  });
  p.getPacketSender = () => sender;
  p.manager = new DialogueManager(p); p.getDialogueManager = () => p.manager;
  const previous = PluginManager.emitNpcDialogueCondition;
  PluginManager.emitNpcDialogueCondition = event => {
    for (const handler of h.conditions) { const result = handler(event); if (result != null) return result; }
    return null;
  };
  return {
    sender,
    reconnect() { wire = new PacketSender(p); h.login(); h.bootstrap(); },
    finish() {
      for (let count = 0;count < 300 && p.manager.isActive() && !p.prompt;count++) p.manager.advance();
    },
    choose(text) {
      const prompt = p.prompt; assert.ok(prompt, 'expected dialogue menu');
      const index = prompt.options.indexOf(text); assert.ok(index >= 0, `missing ${text}`);
      p.prompt = null; prompt.pairs[index * 2 + 1]();
      this.finish();
    },
    cleanup() { PluginManager.emitNpcDialogueCondition = previous; p.manager.reset(); },
  };
}

test('real investigation dialogue earns helper facts and the wilderness meeting unlocks only chapel discovery', () => {
  const h = harness({ realTranscript: true }), p = h.player, r = realRunner(h);
  try {
    h.setRequirements();
    h.hook('quest:wanted:start', N.SIR_TIFFY_CASHIEN);
    assert.equal(h.quest.getStage(p), 1);
    assert.equal(r.sender.getVarp(492), 0, 'Wanted starts before the wilderness meeting');
    // Labelled checkpoint: Tiffy's equipment conversation has given the CommOrb.
    h.quest.setStage(p, 5); p.items.set(I.COMMORB, 1);
    h.itemAction(2); r.finish(); r.choose('Current Assignment');
    assert.equal(r.sender.getVarbit(1053), 1, 'actual Savant briefing earns intel');
    h.dispatchNpc(N.LORD_DAQUARIUS); r.finish();
    assert.equal(r.sender.getVarbit(1055), 1);
    h.death(N.BLACK_KNIGHT_2, new NPC(N.BLACK_KNIGHT_2, new core.Location(2926, 9706, 0))); r.finish();
    assert.equal(r.sender.getVarbit(1055), 2);
    h.dispatchNpc(N.LORD_DAQUARIUS); r.finish();
    assert.equal(r.sender.getVarbit(1058), 1);
    const wilderness = new NPC(3228, new core.Location(3106, 3558, 0));
    assert.equal(CacheDefinitions.resolveNpc(wilderness.getId(), r.sender).id, 2580);
    assert.equal(CacheDefinitions.resolveNpc(3229, r.sender), undefined, 'chapel parent is hidden before invitation');
    assert.equal(h.dispatchNpc(3228).handled, true);
    assert.equal(r.sender.getVarp(492), 0, 'showing instruction does not grant discovery');
    p.manager.reset();
    assert.equal(r.sender.getVarp(492), 0, 'cancellation grants no invitation');
    h.dispatchNpc(3228);
    p.manager.advance();
    assert.equal(r.sender.getVarp(492), 1, 'final instruction Continue earns only partial discovery');
    assert.equal(CacheDefinitions.resolveNpc(3229, r.sender).id, 2582);
    p.manager.reset(); p.prompt = null;
    h.dispatchNpc(3229); r.finish(); r.choose('Solus Dellagar.');
    assert.equal(r.sender.getVarbit(1056), 1, 'actual essence price earns mage hint');
    assert.equal(h.quest.getStage(p), 9);
    p.items.set(I.PURE_ESSENCE, 20);
    h.dispatchNpc(3229); r.finish();
    assert.equal(h.quest.getStage(p), 10);
    assert.equal(p.items.get(I.PURE_ESSENCE), 0);
    r.sender.sendConfig(492, 4); h.login(); h.bootstrap();
    assert.equal(r.sender.getVarp(492), 4, 'discovery never resets later Abyss progress');
    r.reconnect();
    assert.equal(r.sender.getVarp(492), 1, 'saved invitation survives a new connection');
    for (const [id, value] of [[1053, 1], [1055, 2], [1056, 1], [1058, 1]]) assert.equal(r.sender.getVarbit(id), value);
    assert.equal(r.sender.getVarbit(279), 0, 'Wanted does not invent the shared swamp rope');
  } finally { r.cleanup(); }
});


test('tracked final combat actor uses a real attackable cache definition and only its attributed death wins', () => {
  const h = harness({ realTranscript: true }), p = h.player, r = realRunner(h);
  try {
    h.quest.setStage(p, 11);
    p.attrs.set('quest.wanted.mission', 7);
    p.attrs.set('wanted:destination', 4);
    h.action('UK6zld');
    const solus = h.spawns.at(-1);
    assert.ok(solus instanceof NPC);
    assert.equal(solus.getId(), 4962);
    assert.ok(solus.getCurrentDefinition(p).getActions().includes('Attack'));
    assert.ok(solus.getHitpoints() > 0);
    h.death(4962, new NPC(4962, new core.Location(2911, 4834, 0)));
    assert.equal(h.quest.getStage(p), 11, 'another Solus actor cannot win this encounter');
    h.death(4962, solus); r.finish();
    assert.equal(h.quest.getStage(p), 12);
    assert.equal(p.items.get(I.SOLUSS_HAT), 1);
    assert.equal(r.sender.getVarbit(1051), 10);
  } finally { r.cleanup(); }
});


test('completed saves do not manufacture investigation, invitation or shared rope facts', () => {
  const h = harness(), p = h.player;
  p.getSession = () => ({ sendClientPacket() { } });
  const sender = new PacketSender(p); p.getPacketSender = () => sender;
  sender.sendVarbit(279, 1);
  h.quest.setStage(p, 13); h.login(); h.bootstrap();
  assert.equal(sender.getVarbit(1051), 11);
  for (const id of [1052, 1053, 1055, 1056, 1058]) assert.equal(sender.getVarbit(id), 0);
  assert.equal(sender.getVarp(492), 0);
  assert.equal(sender.getVarbit(279), 1, 'pre-existing rope belongs to its actual world owner');
});

test('Musa Point QH coordinate correction accepts the marker and rejects the lower outside tile', () => {
  const h = harness();
  setTrail(h, 2, MISSION.MUSA_POINT);
  h.player.setLocation(2916, 3157, 0);
  h.itemAction(1);
  assert.equal(h.transcripts.at(-1).variant, 'approaching-canifis-failing-scans');
  assert.equal(h.player.attrs.get('quest.wanted.mission'), 2);
  assert.equal(h.player.attrs.get('wanted:destination'), MISSION.MUSA_POINT);
  h.player.setLocation(2916, 3160, 0);
  h.itemAction(1);
  assert.equal(h.transcripts.at(-1).variant, 'scanning-the-second-location');
  h.action('qUGLsM', 'message');
  assert.equal(h.player.attrs.get('quest.wanted.mission'), 3);
  assert.equal(h.player.attrs.get('wanted:destination'), MISSION.CHAMPIONS_GUILD);
});
