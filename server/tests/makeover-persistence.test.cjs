// Run after `yarn build`: node --test tests/makeover-persistence.test.cjs
// The makeover interface (516) through the real plugin, cache, Appearance and PlayerSave: the
// cache-derived styles survive save/load, and switching category shows what is worn.
const assert = require('node:assert/strict'), path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

let core, PlayerSave, next = 5160;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  ({ PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave'));
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const MALE = [0, 3, 18, 26, 34, 38, 42, 14, 2, 14, 5, 4, 0];
const FEMALE = [1, 48, 57, 65, 68, 77, 80, -1, 2, 14, 5, 4, 0];
const TOP = 3;
const ARMS_BURGER_SLOT = 10 + 4 * 2;

function actor(t, look) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('makeover' + next); p.setRegistered(true);
  p.setLocation(new core.Location(2948, 3216, 0));
  p.getAppearance().setLookArray([...look]);
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); });
  return p;
}

const component = (name) => core.CacheDefinitions.getComponentId(`makeover:${name}`);
const click = (p, name, slot) => PM.emitInterfaceActionClick({ player: p, buttonId: component(name), action: 1, slot });

test('female defaults and newly spawned bots never wear a torso kit as their jaw', (t) => {
  const p = actor(t, FEMALE);
  p.getAppearance().set();
  assert.equal(p.getAppearance().getLook()[core.Appearance.BEARD], -1);
  const queue = [];
  const random = Math.random;
  Math.random = () => 0.75;
  try {
    const bot = require('../plugins/bots/behaviours/spawn/PlayerFactory.PlayerBots').createBotPlayer(
      'jawcheck', new core.Location(3090, 3530), {
        loadPersistence: false, saveRandomizedAppearance: false,
        api: { getWorld: () => ({ getPlayerByName: () => null, getAddPlayerQueue: () => queue }) },
      });
    assert.equal(bot.getAppearance().getLook()[core.Appearance.GENDER], 1);
    assert.equal(bot.getAppearance().getLook()[core.Appearance.BEARD], -1);
    assert.equal(queue[0], bot);
  } finally { Math.random = random; }
});

test('loading an old female torso-in-jaw save repairs the jaw and keeps worn armour', (t) => {
  const p = actor(t, FEMALE);
  p.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(core.ItemIdentifiers.FIGHTER_TORSO));
  const saved = PlayerSave.fromPlayer(p);
  saved.appearance[core.Appearance.BEARD] = 57;
  assert.equal(core.CacheDefinitions.getIdentKits().find(kit => kit.id === 57).bodyPartId, 9,
    'the former jaw default is actually a female torso');
  const loaded = actor(t, FEMALE);
  saved.applyToPlayer(loaded);
  assert.equal(loaded.getAppearance().getLook()[core.Appearance.BEARD], -1);
  assert.equal(loaded.getAppearance().getLook()[core.Appearance.CHEST], FEMALE[core.Appearance.CHEST]);
  assert.equal(loaded.getEquipment().get(core.Equipment.BODY_SLOT).getId(), core.ItemIdentifiers.FIGHTER_TORSO);
});

test('cache-valid female jaw styles still survive save and load', (t) => {
  const jaw = core.CacheDefinitions.getIdentKits().find(kit => kit.bodyPartId === 8 && !kit.nonSelectable);
  assert.ok(jaw);
  const p = actor(t, FEMALE);
  p.getAppearance().getLook()[core.Appearance.BEARD] = jaw.id;
  const loaded = actor(t, FEMALE);
  PlayerSave.fromPlayer(p).applyToPlayer(loaded);
  assert.equal(loaded.getAppearance().getLook()[core.Appearance.BEARD], jaw.id);
});

/** The torso kits the makeover lists for a body type, in style order. */
function torsoKits(typeB) {
  const { CacheDefinitions } = core;
  const rows = CacheDefinitions.getEnumValues(5495);
  const column = typeB ? 'player_kit_id_type_b' : 'player_kit_id_type_a';
  return Array.from({ length: rows.size }, (_, index) => {
    const row = CacheDefinitions.getDbRow(Number(rows.get(index)));
    return row.int(CacheDefinitions.getDbColumn(row.tableId, column), -1);
  });
}

for (const [label, look, legacy] of [['male', MALE, [18, 25]], ['female', FEMALE, [56, 60]]]) {
  test(`a ${label} top beyond the old kit range survives save and load`, (t) => {
    const kits = torsoKits(look === FEMALE);
    const style = kits.findIndex((kit) => kit >= 0 && (kit < legacy[0] || kit > legacy[1]));
    assert.ok(style >= 0, `the cache lists a ${label} top outside ${legacy}`);

    const p = actor(t, look);
    assert.equal(require('../plugins/npcs/Makeover.plugin').openMakeover(p, TOP), true);
    assert.equal(click(p, 'item_area', style * 5), true);
    assert.equal(click(p, 'select_and_close', 0), true);
    assert.equal(p.getAppearance().getLook()[core.Appearance.CHEST], kits[style], 'Confirm wears the style');

    const q = actor(t, look);
    PlayerSave.fromPlayer(p).applyToPlayer(q);
    assert.equal(q.getAppearance().getLook()[core.Appearance.CHEST], kits[style], 'the style comes back after relog');
  });
}

test('save and load still repair a kit of the wrong body part or gender', (t) => {
  const p = actor(t, MALE);
  const look = [...MALE];
  look[core.Appearance.CHEST] = torsoKits(true).find((kit) => kit > 25);
  p.getAppearance().setLookArray(look);
  const q = actor(t, MALE);
  PlayerSave.fromPlayer(p).applyToPlayer(q);
  assert.equal(q.getAppearance().getLook()[core.Appearance.CHEST], 25, 'a female torso on a male body is clamped');
});

test('switching category restores the kept colour and selects it, not the discarded preview', (t) => {
  const Makeover = require('../plugins/npcs/Makeover.plugin');
  const p = actor(t, MALE);
  const colourVarp = core.CacheDefinitions.getVarpId('makeover_colour');
  assert.equal(Makeover.openMakeover(p, TOP), true);
  click(p, 'colours', 3 * 2);
  click(p, 'select', 0);
  click(p, 'colours', 5 * 2);
  assert.equal(p.getPacketSender().getVarp(colourVarp), 5, 'previewing colour 5');

  assert.equal(click(p, 'burger_menu_frame', ARMS_BURGER_SLOT), true);
  assert.equal(p.getAppearance().getLook()[core.Appearance.TORSO_COLOUR], 3, 'the kept colour is worn');
  assert.equal(p.getPacketSender().getVarp(colourVarp), 3, 'and the panel selects it');
});

for (const pronouns of [0, 1, 2]) {
  test(`pronouns ${pronouns}: designer and settings share saved state independently of body type`, (t) => {
    const p = actor(t, FEMALE);
    assert.equal(p.getAppearance().getPronouns(), 1, 'legacy saves follow their existing body type');
    PM.emitCustomEvent('makeover-mage:open', { player: p });
    const dropdown = core.CacheDefinitions.getComponentId('player_design:pronouns_buttons');
    assert.equal(PM.emitInterfaceActionClick({ player: p, buttonId: dropdown, action: 1, slot: pronouns + 1 }), true);
    assert.equal(p.getAppearance().getPronouns(), pronouns);
    const appearance = p.getSession().createPlayerView(p, true).appearance;
    assert.equal(appearance[0], 1, 'native appearance still uses body type B');
    assert.equal(appearance[appearance.length - 17], pronouns, 'native textGender byte carries the choice');
    assert.equal(p.getAppearance().getLook()[0], 1, 'pronouns do not change body type');
    const q = actor(t, MALE);
    PlayerSave.fromPlayer(p).applyToPlayer(q);
    assert.equal(q.getAppearance().getPronouns(), pronouns, 'save/load keeps the independent choice');
    assert.equal(q.getPacketSender().getVarbit(10988), 0);
    const login = { player: q, isNewAccount: false };
    PM.emitPlayerLogin({ ...login, username: q.getUsername() });
    assert.equal(q.getPacketSender().getVarbit(10988), pronouns, 'login restores the native setting');
    const next = (pronouns + 1) % 3;
    q.setAttribute('settings:selected', 387);
    assert.equal(PM.emitInterfaceActionClick({ player: q, buttonId: (134 << 16) | 29, action: 1, slot: next * 3 }), true);
    assert.equal(q.getAppearance().getPronouns(), next);
    assert.equal(q.getPacketSender().getVarbit(10988), next);
    const transmitted = { player: q, varpId: 2855, value: pronouns << 24, handled: false };
    PM.emitCustomEvent('player:varp-transmit', transmitted);
    assert.equal(transmitted.handled, true);
    assert.equal(q.getAppearance().getPronouns(), pronouns);
    q.getAppearance().setPronouns(next);
    q.getAppearance().setLook(0, 0);
    assert.equal(q.getAppearance().getPronouns(), next, 'changing body type preserves an explicit choice');
    for (const bad of [-1, 3, 1.5, '1']) q.getAppearance().setPronouns(bad);
    assert.equal(q.getAppearance().getPronouns(), next, 'invalid values cannot alter the saved choice');
  });
}


test('opening the designer retains a legacy pronoun default across native body changes', (t) => {
  const p = actor(t, MALE);
  PM.emitCustomEvent('makeover-mage:open', { player: p });
  assert.equal(p.getAppearance().getPronouns(), 0);
  assert.equal(PM.emitInterfaceActionClick({ player: p, buttonId: (679 << 16) | 69, action: 1, slot: -1 }), true);
  assert.equal(p.getAppearance().getLook()[0], 1);
  assert.equal(p.getAppearance().getPronouns(), 0);
  assert.equal(p.getPacketSender().getVarbit(10988), 0);
  const q = actor(t, FEMALE);
  PlayerSave.fromPlayer(p).applyToPlayer(q);
  assert.equal(q.getAppearance().getPronouns(), 0, 'the independent default survives save/load');
});
