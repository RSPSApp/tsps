// Run after `yarn build`: node --test tests/port-phasmatys-ghosts.test.cjs
//
// The ghosts of Port Phasmatys against the Wiki (Ghostspeak amulet: needed to talk to any ghost in
// the town; Morytania legs 2+ do the same) and their transcripts (Transcript:Ghost sailor, Ghost
// banker, ...), and the ghost banker's quick-bank box without ghostspeak.
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');

let Ghosts, core;
const hooks = { npcs: {}, objects: {}, custom: {}, variant: null, condition: null };
const state = { started: [] };

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = {
    core,
    getTaskManager: () => core.TaskManager,
    onObjectInteraction: (name, actions) => { (hooks.objects[name] ??= []).push(actions); },
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onNpcDialogueVariant: (handler) => { hooks.variant = handler; },
    onNpcDialogueCondition: (handler) => { hooks.condition = handler; },
    onCustomEvent: (name, handler) => { (hooks.custom[name] ??= []).push(handler); },
    emitCustomEvent: (name, payload) => {
      if (name === 'npc-dialogue:start') { state.started.push(payload); payload.handled = true; }
    },
  };
  require('../plugins/areas/PortPhasmatysBarrier.plugin').register(api);
  Ghosts = require('../plugins/areas/PortPhasmatysGhosts.plugin');
  Ghosts.register(api);
});

beforeEach(() => { state.started.length = 0; });

const I = () => core.ItemIdentifiers;

function player(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setLocation(new Location(3688, 3467, 0));
  p.started = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p.getEquipment(), 'refreshItems', () => p.getEquipment());
  t.mock.method(p.getDialogueManager(), 'startDialogues', (builder) => { p.started.push(builder); });
  return p;
}

const wear = (p, id, slot) => p.getEquipment().setItem(slot, new core.Item(id, 1));
const amulet = (p) => wear(p, I().GHOSTSPEAK_AMULET, core.Equipment.AMULET_SLOT);
const named = (name) => ({ getName: () => name });

const SAILOR_PAGES = [{ page: 'Ghost sailor', variants: ['standard-dialogue', 'standard-dialogue-without-a-ghostspeak-amulet'] }];
const VILLAGER_PAGES = [{ page: 'Ghost villager', variants: [
  'standard-dialogue-if-the-player-wears-either-an-amulet-of-ghostspeak-or-the-morytania-legs-2',
  'standard-dialogue-if-the-player-does-not-wear-either-an-amulet-of-ghostspeak-or-the-morytania-legs-2',
] }];
const METARIALUS_PAGES = [{ page: 'Metarialus', variants: ['without-ghostspeak', 'standard-dialogue-with-ghostspeak'] }];
const BANKER_PAGES = [{ page: 'Ghost banker', variants: ['standard-dialogue', Ghosts.QUICK_BANK_VARIANT] }];

test('without ghostspeak the sailor and villagers play their transcript talk for it', (t) => {
  const p = player(t);
  assert.equal(hooks.variant({ player: p, definition: named('Ghost sailor'), pages: SAILOR_PAGES }),
    'standard-dialogue-without-a-ghostspeak-amulet');
  assert.equal(hooks.variant({ player: p, definition: named('Ghost villager'), pages: VILLAGER_PAGES }),
    'standard-dialogue-if-the-player-does-not-wear-either-an-amulet-of-ghostspeak-or-the-morytania-legs-2');
  assert.equal(hooks.variant({ player: p, definition: named('Metarialus'), pages: METARIALUS_PAGES }), 'without-ghostspeak');
});

test('with a ghostspeak amulet their own talk plays (left to the transcript and quest); Metarialus gets his', (t) => {
  const p = player(t);
  amulet(p);
  assert.equal(hooks.variant({ player: p, definition: named('Ghost sailor'), pages: SAILOR_PAGES }), null);
  assert.equal(hooks.variant({ player: p, definition: named('Ghost villager'), pages: VILLAGER_PAGES }), null);
  assert.equal(hooks.variant({ player: p, definition: named('Metarialus'), pages: METARIALUS_PAGES }), 'standard-dialogue-with-ghostspeak');
});

test('Morytania legs 2 understand the ghosts as the amulet does', (t) => {
  const p = player(t);
  const bankerWith = 'If the player is wearing a ghostspeak amulet or Morytania legs 2 or above:';
  for (const legs of [I().MORYTANIA_LEGS_2, I().MORYTANIA_LEGS_3, I().MORYTANIA_LEGS_4]) {
    wear(p, legs, core.Equipment.LEG_SLOT);
    assert.equal(hooks.variant({ player: p, definition: named('Ghost sailor'), pages: SAILOR_PAGES }), null);
    assert.equal(hooks.condition({ player: p, definition: named('Ghost banker'), text: bankerWith }), true);
  }
  wear(p, I().MORYTANIA_LEGS_1, core.Equipment.LEG_SLOT);
  assert.equal(hooks.condition({ player: p, definition: named('Ghost banker'), text: bankerWith }), false, 'legs 1 are not enough');
});

test('another page\'s no-ghostspeak section (a quest\'s, for someone else) is never played', (t) => {
  const p = player(t);
  const pages = [{ page: 'Animal Magnetism', variants: ['the-alive-undead-chickens-obtaining-the-amulet-speaking-to-the-old-crone-without-a-ghostspeak-amulet'] }, ...SAILOR_PAGES];
  assert.equal(hooks.variant({ player: p, definition: named('Ghost sailor'), pages }), 'standard-dialogue-without-a-ghostspeak-amulet');
  // The ghostship's captain has his own page under his name.
  const captain = [{ page: 'Ghost captain (ghostship)', variants: ['standard-dialogue', 'standard-dialogue-without-a-ghostspeak-amulet'] }];
  assert.equal(hooks.variant({ player: p, definition: named('Ghost captain'), pages: captain }), 'standard-dialogue-without-a-ghostspeak-amulet');
});

test('the banker\'s quick-bank section is never his Talk-to; other NPCs and missing variants are left alone', (t) => {
  const p = player(t);
  assert.equal(hooks.variant({ player: p, definition: named('Ghost banker'), pages: BANKER_PAGES }), null);
  assert.equal(hooks.variant({ player: p, definition: named('Banker'), pages: SAILOR_PAGES }), null);
  // The Dragontooth captain's page has no such variant: his own conditions decide.
  assert.equal(hooks.variant({ player: p, definition: named('Ghost captain'), pages: [{ page: 'Ghost captain', variants: ['standard-dialogue-dragontooth-island'] }] }), null);
});

test('the transcripts\' ghostspeak conditions follow what the player wears', (t) => {
  const p = player(t);
  const ask = (name, text) => hooks.condition({ player: p, definition: named(name), text });
  const bankerWith = 'If the player is wearing a ghostspeak amulet or Morytania legs 2 or above:';
  const bankerWithout = 'If the player is not wearing a ghostspeak amulet or Morytania legs 2 or above:';
  const shopWith = 'If the player wears either an amulet of ghostspeak or the Morytania legs 2+:';
  const shopWithout = 'If the player does not wear either an amulet of ghostspeak or the Morytania legs 2+:';
  const gravingasWithout = 'If the player is not wearing an amulet of ghostspeak or Morytania legs 2+:';
  const captainWith = 'If the player is wearing a ghostspeak amulet:';
  assert.deepEqual([ask('Ghost banker', bankerWith), ask('Ghost banker', bankerWithout)], [false, true]);
  assert.deepEqual([ask('Ghost shopkeeper', shopWith), ask('Ghost shopkeeper', shopWithout)], [false, true]);
  assert.equal(ask('Gravingas', gravingasWithout), true);
  assert.equal(ask('Ghost captain', captainWith), false);
  amulet(p);
  assert.deepEqual([ask('Ghost banker', bankerWith), ask('Ghost banker', bankerWithout)], [true, false]);
  assert.deepEqual([ask('Ghost shopkeeper', shopWith), ask('Ghost shopkeeper', shopWithout)], [true, false]);
  assert.equal(ask('Gravingas', gravingasWithout), false);
  assert.equal(ask('Ghost captain', captainWith), true);
  // Compound conditions and other NPCs are answered by their own plugins.
  assert.equal(ask('Ghost captain', 'If the player is wearing a ghostspeak amulet, has not unlocked permanent access, and does not have 25 ectotokens:'), null);
  assert.equal(ask('Banker', bankerWith), null);
});

/** The started chain as [speaker npc id or 'box', text] rows. */
const lines = (builder) => [...builder.getDialogues().values()].map((entry) =>
  [typeof entry.getNpcId === 'function' ? entry.getNpcId() : 'box', entry.getText()]);

test('the innkeeper, whose transcript has no line for it, wails, then "You cannot understand the ghost." in a box', (t) => {
  const p = player(t);
  const id = core.NpcIdentifiers.GHOST_INNKEEPER;
  const npc = { getId: () => id };
  assert.equal(hooks.npcs['Ghost innkeeper']['Talk-to']({ player: p, npc }), true);
  assert.deepEqual(lines(p.started[0]), [[id, Ghosts.WAIL], ['box', Ghosts.CANNOT_UNDERSTAND]]);
  assert.equal(p.started[0].getDialogues().get(1).constructor.name, 'StatementDialogue');
  amulet(p);
  assert.equal(hooks.npcs['Ghost innkeeper']['Talk-to']({ player: p, npc }), false, 'with the amulet his own talk plays');
  assert.equal(p.started.length, 1);
});

test('Trade on the ghost shopkeeper without ghostspeak wails with the box and opens no shop; with it the store opens', (t) => {
  const p = player(t);
  const id = core.NpcIdentifiers.GHOST_SHOPKEEPER;
  const npc = { getId: () => id };
  const opened = t.mock.method(p, 'setInterfaceId');
  assert.equal(hooks.npcs['Ghost shopkeeper'].Trade({ player: p, npc }), true);
  assert.deepEqual(lines(p.started[0]), [[id, Ghosts.WAIL], ['box', Ghosts.CANNOT_UNDERSTAND]]);
  assert.equal(opened.mock.callCount(), 0, 'no shop interface');
  amulet(p);
  assert.equal(hooks.npcs['Ghost shopkeeper'].Trade({ player: p, npc }), false, 'left to the shop');
  assert.equal(p.started.length, 1);
});

test('Bank on the ghost banker or a town booth without ghostspeak plays the quick-bank section', (t) => {
  const p = player(t);
  const npc = { getId: () => core.NpcIdentifiers.GHOST_BANKER };
  const booth = core.CacheDefinitions.getLocId('ahoy_bankbooth');
  const boothBank = hooks.objects['Bank booth'][0].Bank;
  assert.equal(hooks.npcs['Ghost banker'].Bank({ player: p, npc }), true);
  assert.equal(boothBank({ player: p, objectId: booth }), true);
  assert.deepEqual(state.started.map((r) => [r.npcId, r.variant, r.exact]), [
    [core.NpcIdentifiers.GHOST_BANKER, Ghosts.QUICK_BANK_VARIANT, true],
    [core.NpcIdentifiers.GHOST_BANKER, Ghosts.QUICK_BANK_VARIANT, true],
  ]);
  assert.equal(boothBank({ player: p, objectId: core.CacheDefinitions.getLocId('bankbooth') }), false, 'other towns\' booths just bank');
  amulet(p);
  assert.equal(hooks.npcs['Ghost banker'].Bank({ player: p, npc }), false, 'with the amulet the bank opens at once');
  assert.equal(boothBank({ player: p, objectId: booth }), false);
  assert.equal(state.started.length, 2);
});

test('the quick-bank line is a message box, so the bank opens on its continue', () => {
  const event = { kind: 'message', stepId: '_uIcDa' };
  Ghosts.quickBankBox(event);
  assert.deepEqual(event.box, { statement: true });
  const other = { kind: 'message', stepId: 'other' };
  Ghosts.quickBankBox(other);
  assert.equal(other.box, undefined);
});

test('an NPC\'s Bank option goes to plugins before the plain bank opens', (t) => {
  const { NPCOptionPacketListener } = require('../dist/net/packet/impl/NPCOptionPacketListener');
  const { NpcInteractionManager } = require('../dist/game/entity/impl/npc/NpcInteractionManager');
  t.mock.method(NpcInteractionManager, 'handle', () => false);
  const opened = [];
  const p = { getBank: () => ({ open: () => opened.push(true) }), getCurrentBankTab: () => 0, sendMessage: () => {} };
  const npc = { getContentId: () => 1, getLocation: () => new Location(0, 0, 0) };
  const emit = t.mock.method(PluginManager, 'emitNpcInteraction', () => true);
  assert.equal(NPCOptionPacketListener.dispatch(p, npc, 1, 2, {}, 'bank'), true);
  assert.equal(opened.length, 0, 'a plugin that answers keeps the bank shut');
  emit.mock.mockImplementation(() => false);
  assert.equal(NPCOptionPacketListener.dispatch(p, npc, 1, 2, {}, 'bank'), true);
  assert.equal(opened.length, 1, 'unanswered, the bank opens');
});
