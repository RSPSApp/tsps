const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const core = PluginManager.getCoreApi();
const Settings = require('../plugins/minigames/castlewars/Settings.CastleWars');
const Practice = require('../plugins/minigames/castlewars/Practice.CastleWars');
const Bots = require('../plugins/minigames/castlewars/Bots.CastleWars');
let game;
let prompt;
let playing = true;
let queued = 0;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  game = {
    PHASE: { IDLE: 'idle' }, getPhase: () => 'idle', queueCounts: () => ({ a: queued, b: 0 }),
    gameArea: { getPlayers: () => [{ getAttribute: () => true }] }, TEAM: {}, inGameProcessors: [], isPlaying: (player) => playing && player?.getArea?.() === game.gameArea,
    getCarriedFlagTeam: () => null, equipTeamColours() {}, refreshPlayerAppearance() {}, getTeamId: () => 'a', isBarricade: (npc) => npc.cade === true,
  };
  const api = PluginManager.createApi('CastleWarsPracticeTest');
  Settings({ ...api, sendMultiChatboxPrompt: (player, title, ...pairs) => { prompt = { player, title, pairs }; } }, game);
  Practice(api, game);
  Bots({ ...api, getTaskManager: () => ({ submit() {} }) }, game);
});

function player(t, x = 2426, y = 3082) {
  const p = new Player(null);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(p, 'getArea', () => game.gameArea);
  p.setLocation(new core.Location(x, y, 1));
  p.setRegistered(true);
  return p;
}

function pick(text) {
  const index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value.startsWith(text));
  assert.notEqual(index, -1, `${text} is available`);
  prompt.pairs[index + 1]();
}

test('Lanthus settings choose team sizes, freeze limits and barricade caps, and reject stale callbacks', (t) => {
  const p = player(t);
  const messages = [];
  t.mock.method(p, 'sendMessage', (m) => messages.push(m));
  Settings.openSettings({ player: p });
  pick('Teams:');
  assert.deepEqual(prompt.pairs.filter((_, i) => i % 2 === 0), ['1 vs 1', '3 vs 3', '5 vs 5', '10 vs 10', '30 vs 30']);
  pick('1 vs 1');
  assert.equal(game.settings.teamSize, 1);
  pick('More settings');
  pick('Ice freeze:');
  pick('10 seconds');
  assert.equal(game.settings.freezeSeconds, 10);
  pick('Barricades per team:');
  pick('20');
  assert.equal(game.getBarricadeLimit(), 20);
  pick('Back');
  const stale = prompt.pairs[9];
  queued = 1;
  stale();
  assert.equal(game.getBarricadeLimit(), 20);
  assert.match(messages.at(-1), /locked/);
  queued = 0;
});

test('selected ice duration caps the real freeze and immunity, while binds and outside combat retain defaults', (t) => {
  const caster = player(t), victim = player(t, 2427);
  t.mock.method(victim, 'sendMessage', () => {});
  for (const [seconds, kind, inside, expected] of [[10, 'ice', true, 16], [15, 'ice', true, 25], [0, 'ice', true, 32], [10, 'bind', true, 32], [10, 'ice', false, 32]]) {
    game.settings.freezeSeconds = seconds;
    playing = inside;
    victim.getTimers().cancel(core.TimerKey.FREEZE);
    victim.getTimers().cancel(core.TimerKey.FREEZE_IMMUNITY);
    core.CombatFactory.freezeTicks(victim, 32, null, caster, kind);
    assert.equal(victim.getTimers().getTicks(core.TimerKey.FREEZE), expected);
    assert.equal(victim.getTimers().getTicks(core.TimerKey.FREEZE_IMMUNITY), expected + core.Misc.getTicks(3));
  }
  playing = true;
  game.settings.freezeSeconds = 0;
});

test('Lanthus practice defaults to maxed bots, keeps tier choices and scopes menu priority to bot matches', (t) => {
  const p = player(t);
  Object.assign(game.settings, Settings._test.DEFAULTS);
  const originalJoin = game.joinFromLobby;
  let joined;
  game.joinFromLobby = (...args) => { joined = args; };
  try {
    Settings.openSettings({ player: p });
    pick('Join practice');
    assert.equal(joined[2], 'veteran');
    assert.equal(joined[4], true, 'maxed practice is explicit, separate from a normal Veteran tier');
    Settings.openSettings({ player: p });
    pick('More settings');
    assert.ok(prompt.pairs.length <= 10, 'native menus support at most five options');
    pick('Bot combat:'); pick('Novice'); pick('Back'); pick('Join practice');
    assert.equal(joined[2], 'novice');
    assert.equal(joined[4], false, 'an explicitly selected tier preserves its stat band');
    Settings.openSettings({ player: p }); pick('More settings'); pick('Additional settings');
    assert.equal(game.getBarricadePlayerPriority(), false);
    pick('Barricade right-click:');
    assert.equal(game.getBarricadePlayerPriority(), true);
    t.mock.method(game.gameArea, 'getPlayers', () => []);
    assert.equal(game.getBarricadePlayerPriority(), false, 'human-only matches retain standard priority');
    pick('Back'); pick('Back'); pick('Reset defaults');
    assert.equal(game.settings.botTier, 'maxed');
    assert.equal(game.settings.barricadePlayerPriority, false);
  } finally {
    game.joinFromLobby = originalJoin;
    Object.assign(game.settings, Settings._test.DEFAULTS);
  }
});

test('Castle Wars Shove animates once, prevents instant chaining and keeps the normal attack delay', (t) => {
  const attacker = player(t), victim = player(t, 2427);
  attacker.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.ZAMORAKIAN_HASTA, 1));
  attacker.setSpecialPercentage(100);
  let definition, attackerAnimations = 0, victimAnimations = 0;
  t.mock.method(attacker, 'performAnimation', () => { attackerAnimations++; });
  t.mock.method(victim, 'performAnimation', () => { victimAnimations++; });
  t.mock.method(victim, 'sendMessage', () => {});
  t.mock.method(core.TaskManager, 'submit', () => {});
  t.mock.method(core.Sounds, 'sendSound', () => {});
  t.mock.method(core.CombatSpecial, 'drain', (p, amount) => p.setSpecialPercentage(p.getSpecialPercentage() - amount));
  t.mock.method(core.CombatSpecial, 'updateBar', () => {});
  require('../plugins/combat/specials/Shove.SpecialAttack')({ core, emitCustomEvent: PluginManager.emitCustomEvent.bind(PluginManager), registerCombatSpecial: (value) => { definition = value; } });
  for (let i = 0; i < 4; i++) definition.combatMethod.start(attacker, victim);
  assert.equal(attacker.getSpecialPercentage(), 75);
  assert.equal(attackerAnimations, 1);
  assert.equal(victimAnimations, 1);
  assert.equal(attacker.getCombat().getAttackDelay(), attacker.getBaseAttackSpeed() + 1);
  assert.equal(victim.getTimers().has(core.TimerKey.FREEZE_IMMUNITY), false);
  playing = false;
  attacker.setSpecialPercentage(100);
  definition.combatMethod.start(attacker, victim);
  assert.equal(attacker.getSpecialPercentage(), 100, 'normal immunity prevents chaining outside the game');
  playing = true;
});

test('practice scorer and defender get distinct real loadouts and Castle Wars supplies', (t) => {
  for (const role of ['scorer', 'defender']) {
    const p = player(t);
    const state = { role };
    p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 65).setCurrentLevels(core.Skill.MAGIC, 65);
    Bots._test.preparePracticeLoadout(p, state, 'a');
    assert.equal(state.equipped, true);
    assert.equal(p.getEquipment().getSlot(core.Equipment.BODY_SLOT), role === 'scorer' ? core.ItemIdentifiers.MASORI_BODY_F_ : core.ItemIdentifiers.ANCESTRAL_ROBE_TOP);
    assert.equal(p.getEquipment().getSlot(core.Equipment.SHIELD_SLOT), role === 'scorer' ? core.ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD : core.ItemIdentifiers.ELIDINIS_WARD_F_);
    assert.equal(p.getSkillManager().getMaxLevel(core.Skill.MAGIC), 65, 'role gear preserves tier stats');
    assert.equal(p.getSkillManager().getMaxLevel(core.Skill.THIEVING), 99);
    assert.equal(p.getEquipment().getSlot(core.Equipment.HEAD_SLOT), role === 'scorer' ? core.ItemIdentifiers.MASORI_MASK_F_ : core.ItemIdentifiers.ANCESTRAL_HAT);
    assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION), 4);
    for (const item of p.getEquipment().getItems()) assert.ok(Number.isInteger(item.getId()), 'every equipped id exists');
    if (role === 'scorer') {
      Bots._test.ensureFlagWeapon(p, role);
      assert.equal(p.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), core.ItemIdentifiers.MASTER_WAND);
      p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
      p.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(-1, 0));
      p.getInventory().adds(core.ItemIdentifiers.MASTER_WAND, 1).adds(core.ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD, 1);
      Bots._test.ensureFlagWeapon(p, role);
      assert.equal(p.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), core.ItemIdentifiers.MASTER_WAND);
      assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.MASTER_WAND), 0, 'stowed gear is re-equipped after scoring');
    }
  }
});

test('a scorer extinguishes a burning obstruction before exploding it on its next action', (t) => {
  const p = player(t);
  const npc = new core.NPC(core.NpcIdentifiers.BARRICADE, new core.Location(2427, 3082, 1));
  npc.cade = true;
  t.mock.method(npc, 'getNpcTransformationId', () => burning ? 1 : -1);
  let burning = true;
  const used = [];
  p.getInventory().adds(core.ItemIdentifiers.BUCKET_OF_WATER, 1).adds(core.ItemIdentifiers.EXPLOSIVE_POTION, 1);
  t.mock.method(core.World, 'getNpcs', () => [npc]);
  t.mock.method(core.PluginManager, 'emitItemOnNpc', (event) => { used.push(event.itemId); burning = false; return true; });
  const state = {};
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, state), 'running');
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1200 }, state), 'failure');
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1600 }, state), 'running');
  assert.deepEqual(used, [core.ItemIdentifiers.BUCKET_OF_WATER, core.ItemIdentifiers.EXPLOSIVE_POTION]);
});

test('practice tools remain available after the initial supplies have been consumed', (t) => {
  const p = player(t);
  const npc = new core.NPC(core.NpcIdentifiers.BARRICADE, new core.Location(2427, 3082, 1));
  npc.cade = true;
  t.mock.method(core.World, 'getNpcs', () => [npc]);
  t.mock.method(core.PluginManager, 'emitItemOnNpc', ({ player, itemId }) => {
    assert.equal(player.getInventory().contains(itemId), true);
    player.getInventory().delete(itemId, 1);
    return true;
  });
  const state = {};
  for (let i = 0; i < 12; i++) assert.equal(Practice._test.scorerTools({ player: p, nowMs: i * 600 }, state), 'running');
});

test('the defender clears its pending barrage before a hasta special and can switch back to magic', (t) => {
  const p = player(t), target = player(t, 2427);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99).setCurrentLevels(core.Skill.MAGIC, 99);
  target.getTimers().registers(core.TimerKey.FREEZE, 20);
  p.setSpecialPercentage(100);
  const combat = p.getCombat();
  combat.setCastSpell(core.CombatSpells.ICE_BARRAGE.getSpell());
  let melees = 0, spells = 0;
  t.mock.method(combat, 'attack', () => {
    assert.equal(combat.getCastSpell(), null);
    assert.equal(combat.getAutocastSpell(), null);
    assert.equal(p.isSpecialActivated(), true);
    melees++;
  });
  t.mock.method(combat, 'castSpellOn', () => { spells++; });
  Practice._test.defenderAttack({ player: p }, {}, target);
  assert.equal(melees, 1);
  assert.equal(p.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), core.ItemIdentifiers.ZAMORAKIAN_HASTA);
  target.getTimers().cancel(core.TimerKey.FREEZE);
  Practice._test.defenderAttack({ player: p }, {}, target);
  assert.equal(spells, 1);
  assert.equal(p.isSpecialActivated(), false);
  assert.equal(p.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), core.ItemIdentifiers.KODAI_WAND);
});

test('human games ignore custom barricade and freeze limits, and Lanthus offers no bots', (t) => {
  const p = player(t), victim = player(t, 2427);
  t.mock.method(game.gameArea, 'getPlayers', () => []);
  game.settings.barricades = 20;
  game.settings.freezeSeconds = 10;
  assert.equal(game.getBarricadeLimit(), 10);
  const event = { kind: 'ice', source: p, target: victim, ticks: 32 };
  Settings._test.capFreeze(event);
  assert.equal(event.ticks, 32);
  let joined;
  game.joinFromLobby = (...args) => { joined = args; };
  Settings.openSettings({ player: p });
  pick('Bots:'); pick('None'); pick('Join practice');
  assert.equal(joined[2], null, 'no-bot selection skips the tier prompt and seeds no bots');
});

test('practice tools do not interact diagonally through a barricade corner', (t) => {
  const p = player(t);
  const npc = new core.NPC(core.NpcIdentifiers.BARRICADE, new core.Location(2427, 3083, 1));
  npc.cade = true;
  t.mock.method(core.World, 'getNpcs', () => [npc]);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, {}), 'failure');
});
