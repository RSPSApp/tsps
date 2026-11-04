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
    getCarriedFlagTeam: () => null, equipTeamColours() {}, refreshPlayerAppearance() {}, showBraceletCharges() {}, getTeamId: () => 'a', isBarricade: (npc) => npc.cade === true,
    spawnBounds: { inside: () => false },
    getTeamData: () => ({ respawnBounds: game.spawnBounds }),
    teamBarricadeCount: () => 0,
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

function barricade(x, y, burning = false) {
  const npc = new core.NPC(core.NpcIdentifiers.BARRICADE, new core.Location(x, y, 1));
  npc.cade = true;
  npc.setRegistered(true);
  npc.getNpcTransformationId = () => burning ? 1 : -1;
  return npc;
}

function queueRoute(p, x, y, z = 1) {
  p.getMovementQueue().reset(false);
  p.getMovementQueue().addCheckpoint(new core.Location(x, y, z));
}

function clearRoute(p) {
  p.getMovementQueue().reset(false);
}

function pick(text) {
  const index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value.startsWith(text));
  assert.notEqual(index, -1, `${text} is available`);
  prompt.pairs[index + 1]();
}

test('Lanthus settings retain team sizes and barricade caps without the removed custom controls, and reject stale callbacks', (t) => {
  const p = player(t);
  const messages = [];
  t.mock.method(p, 'sendMessage', (m) => messages.push(m));
  Settings.openSettings({ player: p });
  pick('Teams:');
  assert.deepEqual(prompt.pairs.filter((_, i) => i % 2 === 0), ['1 vs 1', '3 vs 3', '5 vs 5', '10 vs 10', '30 vs 30']);
  pick('1 vs 1');
  assert.equal(game.settings.teamSize, 1);
  pick('More settings');
  assert.deepEqual(prompt.pairs.filter((_, i) => i % 2 === 0), ['Barricades per team: 10', 'Bot combat: Maxed (126)', 'Bracelet charges', 'Back']);
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

test('practice and human games retain normal ice and bind durations and immunity', (t) => {
  const caster = player(t), victim = player(t, 2427);
  t.mock.method(victim, 'sendMessage', () => {});
  for (const practice of [true, false]) {
    t.mock.method(game.gameArea, 'getPlayers', () => practice ? [{ getAttribute: () => true }] : []);
    for (const [ticks, kind] of [[8, 'ice'], [16, 'ice'], [24, 'ice'], [32, 'ice'], [8, 'bind']]) {
      victim.getTimers().cancel(core.TimerKey.FREEZE);
      victim.getTimers().cancel(core.TimerKey.FREEZE_IMMUNITY);
      core.CombatFactory.freezeTicks(victim, ticks, null, caster, kind);
      assert.equal(victim.getTimers().getTicks(core.TimerKey.FREEZE), ticks);
      assert.equal(victim.getTimers().getTicks(core.TimerKey.FREEZE_IMMUNITY), ticks + core.Misc.getTicks(3));
    }
  }
});

test('Lanthus practice defaults to maxed bots, keeps tier choices and exposes bracelet charges directly', (t) => {
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
    let braceletPlayer;
    t.mock.method(game, 'showBraceletCharges', (player) => { braceletPlayer = player; });
    Settings.openSettings({ player: p }); pick('More settings'); pick('Bracelet charges');
    assert.equal(braceletPlayer, p);
    pick('Back'); pick('Reset defaults');
    assert.equal(game.settings.botTier, 'maxed');
    assert.deepEqual(Object.keys(game.settings).sort(), ['barricades', 'botTier', 'opponent', 'teamSize']);
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
  const I = core.ItemIdentifiers;
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
      assert.equal(p.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), I.ZARYTE_CROSSBOW);
      const ammo = p.getEquipment().getItems()[core.Equipment.AMMUNITION_SLOT];
      assert.equal(ammo.getId(), I.ONYX_BOLTS_E_);
      assert.ok(ammo.getAmount() > 0, 'the scorer carries bolts');
      assert.ok(p.getInventory().getAmount(I.BARRICADE) > 0, 'the scorer carries barricades');
      const weapon = p.getEquipment().getSlot(core.Equipment.WEAPON_SLOT);
      Bots._test.ensureFlagWeapon(p, role);
      assert.equal(p.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), I.ZARYTE_CROSSBOW);
      p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
      p.getInventory().adds(weapon, 1);
      Bots._test.ensureFlagWeapon(p, role);
      assert.equal(p.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), weapon);
      assert.equal(p.getInventory().getAmount(weapon), 0, 'stowed gear is re-equipped after scoring');
    }
  }
});

test('a scorer waits, extinguishes a burning obstruction, then waits again before exploding it', (t) => {
  const p = player(t);
  let burning = true;
  const npc = barricade(2427, 3082, burning);
  npc.getNpcTransformationId = () => burning ? 1 : -1;
  const used = [];
  p.getInventory().adds(core.ItemIdentifiers.BUCKET_OF_WATER, 1).adds(core.ItemIdentifiers.EXPLOSIVE_POTION, 1);
  t.mock.method(core.World, 'getNpcs', () => [npc]);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  t.mock.method(core.PluginManager, 'emitItemOnNpc', (event) => {
    assert.equal(event.definition, npc.getCurrentDefinition(p), 'normal NPC handlers receive their required definition');
    assert.equal(event.npcId, npc.getContentId(p));
    used.push(event.itemId);
    burning = false;
    return true;
  });
  const state = { practiceGoal: [2428, 3082, 1] };
  queueRoute(p, 2427, 3082);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, state), 'running');
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 2199 }, state), 'running');
  assert.deepEqual(used, [], 'the first reaction waits 1200ms');
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 2200 }, state), 'running');
  assert.deepEqual(used, [core.ItemIdentifiers.BUCKET_OF_WATER]);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 3399 }, state), 'running');
  assert.deepEqual(used, [core.ItemIdentifiers.BUCKET_OF_WATER], 'subsequent clearings also wait');
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 3400 }, state), 'running');
  assert.deepEqual(used, [core.ItemIdentifiers.BUCKET_OF_WATER, core.ItemIdentifiers.EXPLOSIVE_POTION]);
});

test('scorer tools ignore behind, side, diagonal, unreachable, spawn and other-area barricades', (t) => {
  const p = player(t);
  const used = [];
  queueRoute(p, 2427, 3082);
  t.mock.method(core.PluginManager, 'emitItemOnNpc', (event) => { used.push(event.itemId); return true; });
  const cases = [
    ['behind', barricade(2425, 3082), true],
    ['side', barricade(2426, 3083), true],
    ['diagonal', barricade(2427, 3083), true],
    ['unreachable', barricade(2427, 3082), false],
  ];
  const original = game.spawnBounds;
  try {
    for (const [name, npc, reachable] of cases) {
      t.mock.method(core.World, 'getNpcs', () => [npc]);
      t.mock.method(core.PathFinder, 'reachedEntity', () => reachable);
      assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, { practiceGoal: [2428, 3082, 1] }), 'failure', name);
    }
    const forward = barricade(2427, 3082);
    t.mock.method(core.World, 'getNpcs', () => [forward]);
    t.mock.method(core.PathFinder, 'reachedEntity', () => true);
    game.spawnBounds = { inside: (loc) => loc.getX() === 2427 && loc.getY() === 3082 };
    assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, { practiceGoal: [2428, 3082, 1] }), 'failure', 'spawn');
    game.spawnBounds = original;
    const outside = barricade(2427, 3082);
    game.spawnBounds = { inside: (loc) => loc.getX() === 2426 && loc.getY() === 3082 };
    t.mock.method(core.World, 'getNpcs', () => [outside]);
    queueRoute(p, 2427, 3082);
    assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, { practiceGoal: [2428, 3082, 1] }), 'failure', 'player spawn');
    game.spawnBounds = original;
    const other = { getObjects() {} };
    p.setArea({ getObjects() {} });
    forward.setArea(other);
    t.mock.method(core.World, 'getNpcs', () => [forward]);
    assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, { practiceGoal: [2428, 3082, 1] }), 'failure', 'other area');
  } finally {
    game.spawnBounds = original;
  }
  assert.deepEqual(used, [], 'irrelevant barricades are never touched');
});

test('scorer pending clears when the obstruction disappears or the goal moves', (t) => {
  const p = player(t);
  let npcs = [barricade(2427, 3082)];
  t.mock.method(core.World, 'getNpcs', () => npcs);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  let uses = 0;
  t.mock.method(core.PluginManager, 'emitItemOnNpc', () => { uses++; return true; });
  const state = { practiceGoal: [2428, 3082, 1] };
  queueRoute(p, 2427, 3082);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, state), 'running');
  assert.ok(state.pendingClear);
  state.practiceGoal = [2426, 3084, 1];
  queueRoute(p, 2426, 3084);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1200 }, state), 'failure');
  assert.equal(state.pendingClear, null, 'a changed goal drops the old obstruction');
  state.practiceGoal = [2428, 3082, 1];
  queueRoute(p, 2427, 3082);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1400 }, state), 'running');
  assert.ok(state.pendingClear);
  npcs = [];
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 2600 }, state), 'failure');
  assert.equal(state.pendingClear, null, 'a vanished obstruction drops the pending action');
  assert.equal(uses, 0);
});

test('scorer follows the queued route axis when the goal is diagonal', (t) => {
  const p = player(t);
  const east = barricade(2427, 3082);
  const north = barricade(2426, 3083);
  let npcs = [east];
  t.mock.method(core.World, 'getNpcs', () => npcs);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  t.mock.method(core.PluginManager, 'emitItemOnNpc', () => true);
  queueRoute(p, 2426, 3090);
  const state = { practiceGoal: [2428, 3083, 1] };
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, state), 'failure', 'east is not the queued axis');
  npcs = [north];
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, state), 'running', 'north is the queued axis');
});

test('scorer derives the next step with the native walk route when nothing is queued', (t) => {
  const p = player(t);
  const east = barricade(2427, 3082);
  const north = barricade(2426, 3083);
  let npcs = [north];
  t.mock.method(core.World, 'getNpcs', () => npcs);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  t.mock.method(core.PathFinder, 'calculateWalkRoute', (player) => {
    player.getMovementQueue().addCheckpoint(new core.Location(2430, 3082, 1));
    return 1;
  });
  t.mock.method(core.PluginManager, 'emitItemOnNpc', () => true);
  const state = { practiceGoal: [2428, 3082, 1] };
  clearRoute(p);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, state), 'failure', 'native route runs east');
  npcs = [east];
  clearRoute(p);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, state), 'running');
});

test('practice tools remain available after the initial supplies have been consumed', (t) => {
  const p = player(t);
  let npc = barricade(2427, 3082), uses = 0;
  t.mock.method(core.World, 'getNpcs', () => [npc]);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  t.mock.method(core.PluginManager, 'emitItemOnNpc', ({ player, itemId }) => {
    assert.equal(player.getInventory().contains(itemId), true);
    player.getInventory().delete(itemId, 1);
    npc = barricade(2427, 3082);
    uses++;
    return true;
  });
  const state = { practiceGoal: [2428, 3082, 1] };
  queueRoute(p, 2427, 3082);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 0 }, state), 'running');
  for (let i = 0; i < 12; i++) {
    assert.equal(Practice._test.scorerTools({ player: p, nowMs: i * 2400 + 1200 }, state), 'running');
    assert.equal(Practice._test.scorerTools({ player: p, nowMs: i * 2400 + 2400 }, state), 'running');
  }
  assert.equal(uses, 12, 'successive barricades are cleared after replenishing consumed potions');
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

test('human games ignore custom barricade limits, and Lanthus offers no bots', (t) => {
  const p = player(t);
  t.mock.method(game.gameArea, 'getPlayers', () => []);
  game.settings.barricades = 20;
  assert.equal(game.getBarricadeLimit(), 10);
  let joined;
  game.joinFromLobby = (...args) => { joined = args; };
  Settings.openSettings({ player: p });
  pick('Bots:'); pick('None'); pick('Join practice');
  assert.equal(joined[2], null, 'no-bot selection skips the tier prompt and seeds no bots');
});

test('practice tools do not interact diagonally through a barricade corner', (t) => {
  const p = player(t);
  const npc = barricade(2427, 3083);
  t.mock.method(core.World, 'getNpcs', () => [npc]);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  queueRoute(p, 2426, 3084);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 1000 }, { practiceGoal: [2428, 3083, 1] }), 'failure');
});

test('defender places only on its assigned tile, even without a target, and respects the cap', (t) => {
  const p = player(t);
  let npcs = [];
  t.mock.method(core.World, 'getNpcs', () => npcs);
  const placed = [];
  t.mock.method(core.PluginManager, 'emitItemAction', ({ player, itemId, option }) => {
    placed.push(option);
    player.getInventory().delete(itemId, 1);
    return true;
  });
  const state = { practicePost: [2426, 3083, 1] };
  assert.equal(Practice._test.defenderTools({ player: p, nowMs: 0 }, state, null), 'failure', 'not on the post tile');
  p.setLocation(new core.Location(2426, 3083, 1));
  assert.equal(Practice._test.defenderTools({ player: p, nowMs: 0 }, state, null), 'running');
  assert.deepEqual(placed, ['Set-up']);
  assert.ok(p.getInventory().getAmount(core.ItemIdentifiers.BARRICADE) === 0);
  t.mock.method(game, 'getBarricadeLimit', () => 1);
  t.mock.method(game, 'teamBarricadeCount', () => 1);
  state.nextBarricadeAt = 0;
  assert.equal(Practice._test.defenderTools({ player: p, nowMs: 2000 }, state, null), 'failure', 'cap reached');
  assert.equal(placed.length, 1);
});

test('a failed defender placement does not keep returning running every tick', (t) => {
  const p = player(t);
  t.mock.method(core.World, 'getNpcs', () => []);
  t.mock.method(core.PluginManager, 'emitItemAction', () => true);
  const state = { practicePost: [2426, 3082, 1] };
  assert.equal(Practice._test.defenderTools({ player: p, nowMs: 0 }, state, null), 'failure');
  assert.equal(Practice._test.defenderTools({ player: p, nowMs: 600 }, state, null), 'failure');
  assert.ok(state.nextBarricadeAt >= 1200, 'failed placements back off');
});

test('a defender lights its own barricade once and keeps a burning blockade when pressed', (t) => {
  const p = player(t), target = player(t, 2427);
  let npcs = [{ }];
  t.mock.method(core.World, 'getNpcs', () => npcs);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  const tools = [];
  t.mock.method(core.PluginManager, 'emitItemOnNpc', ({ itemId }) => { tools.push(itemId); npcs[0].getNpcTransformationId = () => itemId === core.ItemIdentifiers.TINDERBOX ? 1 : -1; return true; });
  const own = barricade(2427, 3082, false);
  own.castleWarsTeam = 'a';
  npcs = [own];
  const state = {};
  for (let i = 0; i < 5; i++) Practice._test.defenderTools({ player: p, nowMs: i * 2000 }, state, target);
  assert.deepEqual(tools, [core.ItemIdentifiers.TINDERBOX], 'own blockade is lit once for a close intruder');
  const burning = barricade(2427, 3082, true);
  burning.castleWarsTeam = 'a';
  npcs = [burning];
  const pressed = {};
  for (let i = 0; i < 5; i++) Practice._test.defenderTools({ player: p, nowMs: i * 2000 }, pressed, target);
  assert.deepEqual(tools, [core.ItemIdentifiers.TINDERBOX], 'burning blockade is preserved under an intruder');
  const quiet = {};
  for (let i = 0; i < 5; i++) Practice._test.defenderTools({ player: p, nowMs: i * 2000 }, quiet, null);
  assert.deepEqual(tools, [core.ItemIdentifiers.TINDERBOX, core.ItemIdentifiers.BUCKET_OF_WATER], 'quiet own barricade is doused once');
});

test('one defender can light, douse and relight the same barricade', (t) => {
  const p = player(t), target = player(t, 2427);
  let burning = false;
  const own = barricade(2427, 3082);
  own.castleWarsTeam = 'a';
  own.getNpcTransformationId = () => burning ? 1 : -1;
  t.mock.method(core.World, 'getNpcs', () => [own]);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  const tools = [];
  t.mock.method(core.PluginManager, 'emitItemOnNpc', ({ itemId }) => {
    tools.push(itemId);
    burning = itemId === core.ItemIdentifiers.TINDERBOX;
    return true;
  });
  const state = {};
  Practice._test.defenderTools({ player: p, nowMs: 0 }, state, target);
  Practice._test.defenderTools({ player: p, nowMs: 2000 }, state, target);
  Practice._test.defenderTools({ player: p, nowMs: 4000 }, state, null);
  Practice._test.defenderTools({ player: p, nowMs: 6000 }, state, target);
  burning = false; // A teammate douses it through the ordinary item-on-NPC action.
  Practice._test.defenderTools({ player: p, nowMs: 8000 }, state, target);
  assert.deepEqual(tools, [core.ItemIdentifiers.TINDERBOX, core.ItemIdentifiers.BUCKET_OF_WATER, core.ItemIdentifiers.TINDERBOX, core.ItemIdentifiers.TINDERBOX]);
});

test('scorer defence places behind a pursuer, lights next tick and only throttles new placements', (t) => {
  const p = player(t), behind = player(t, 2424), ahead = player(t, 2428);
  t.mock.method(p.getMovementQueue(), 'canWalkTo', () => true);
  let npcs = [];
  let burning = false;
  t.mock.method(core.World, 'getNpcs', () => npcs);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  const placed = [];
  t.mock.method(core.PluginManager, 'emitItemAction', ({ player, itemId, option }) => {
    placed.push(option);
    player.getInventory().delete(itemId, 1);
    const cade = barricade(player.getLocation().getX(), player.getLocation().getY(), burning);
    cade.getNpcTransformationId = () => burning ? 1 : -1;
    npcs = [cade];
    return true;
  });
  const tools = [];
  t.mock.method(core.PluginManager, 'emitItemOnNpc', ({ itemId }) => {
    tools.push(itemId);
    burning = true;
    return true;
  });
  queueRoute(p, 2430, 3082);
  const state = { practiceGoal: [2430, 3082, 1] };
  assert.equal(Practice._test.scorerDefence({ player: p, nowMs: 0 }, state, behind), 'running');
  assert.deepEqual(placed, ['Set-up']);
  const departure = p.getMovementQueue().pointsReturn().at(-1).position;
  assert.deepEqual([departure.getX(), departure.getY()], [2427, 3082], 'step forward before lighting, never back toward the pursuer');
  assert.equal(Practice._test.scorerDefence({ player: p, nowMs: 600 }, state, behind), 'running');
  assert.deepEqual(tools, [], 'wait for the forward step before using the tinderbox');
  p.setLocation(new core.Location(2427, 3082, 1));
  assert.equal(Practice._test.scorerDefence({ player: p, nowMs: 1000 }, state, behind), 'running', 'lighting is not delayed by the placement cooldown');
  assert.deepEqual(tools, [core.ItemIdentifiers.TINDERBOX]);
  assert.equal(state.scorerDefenceLight, null);
  assert.equal(Practice._test.scorerDefence({ player: p, nowMs: 2000 }, state, behind), 'failure', 'new placements remain throttled');
  assert.equal(placed.length, 1);
  t.mock.method(game, 'getTeamId', () => 'a');
  const original = game.spawnBounds;
  game.spawnBounds = { inside: () => true };
  assert.equal(Practice._test.scorerDefence({ player: p, nowMs: 7000 }, state, behind), 'failure', 'never in spawn');
  game.spawnBounds = original;
  state.nextDefencePlaceAt = 0;
  queueRoute(p, 2430, 3082);
  assert.equal(Practice._test.scorerDefence({ player: p, nowMs: 7000 }, state, ahead), 'failure', 'not every nearby enemy is a pursuer');
  npcs = [barricade(2428, 3082)];
  queueRoute(p, 2430, 3082);
  assert.equal(Practice._test.scorerDefence({ player: p, nowMs: 7000 }, state, behind), 'failure', 'clearing progress wins');
  npcs = [];
  state.nextDefencePlaceAt = 0;
  queueRoute(p, 2430, 3082);
  assert.equal(Practice._test.scorerDefence({ player: p, nowMs: 7000 }, state, behind), 'running');
  assert.equal(placed.length, 2);
  t.mock.method(game, 'getCarriedFlagTeam', () => 'b');
  npcs = [];
  state.scorerDefenceLight = null;
  state.nextDefencePlaceAt = 0;
  queueRoute(p, 2430, 3082);
  assert.equal(Practice._test.scorerDefence({ player: p, nowMs: 7000 }, state, behind), 'running', 'flag carrying does not block tools');
  assert.equal(placed.length, 3);
});


test('a diagonal route only clears a corner barricade when movement has no free fallback', (t) => {
  const p = player(t);
  const npc = barricade(2427, 3082);
  t.mock.method(core.World, 'getNpcs', () => [npc]);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  let freeFallback = false;
  t.mock.method(p.getMovementQueue(), 'canWalkTo', (next) => freeFallback && next.getX() === 2426 && next.getY() === 3083);
  queueRoute(p, 2428, 3084);
  const state = { practiceGoal: [2428, 3084, 1] };
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 0 }, state), 'running');
  assert.equal(state.pendingClear.npc, npc);
  freeFallback = true;
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 600 }, state), 'failure');
  assert.equal(state.pendingClear, null, 'walking around the corner beats an unnecessary explosion');
});

test('defenders neither place nor use barricades from the respawn room', (t) => {
  const p = player(t), target = player(t, 2427);
  const npc = barricade(2427, 3082);
  t.mock.method(core.World, 'getNpcs', () => [npc]);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  const use = t.mock.method(core.PluginManager, 'emitItemOnNpc', () => true);
  const place = t.mock.method(core.PluginManager, 'emitItemAction', () => true);
  t.mock.method(game.spawnBounds, 'inside', (loc) => loc.getX() === 2426);
  assert.equal(Practice._test.defenderTools({ player: p, nowMs: 0 }, { practicePost: [2426, 3082, 1] }, target), 'failure');
  assert.equal(use.mock.callCount(), 0);
  assert.equal(place.mock.callCount(), 0);
});


test('failed and no-op tool actions back off, and removed or dead barricades are ignored', (t) => {
  const p = player(t);
  let npc = barricade(2427, 3082);
  t.mock.method(core.World, 'getNpcs', () => [npc]);
  t.mock.method(core.PathFinder, 'reachedEntity', () => true);
  const times = [];
  let now = 0, handled = false;
  t.mock.method(core.PluginManager, 'emitItemOnNpc', () => { times.push(now); return handled; });
  queueRoute(p, 2428, 3082);
  for (const result of [false, true]) {
    handled = result;
    times.length = 0;
    const state = { practiceGoal: [2428, 3082, 1] };
    for (now = 0; now <= 15000; now += 600) Practice._test.scorerTools({ player: p, nowMs: now }, state);
    assert.ok(times.length > 0 && times.length <= 6, 'one bounded attempt window before backoff');
    assert.ok(state.clearBackoff?.until >= 14000);
  }
  npc.setHitpoints(0);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 0 }, { practiceGoal: [2428, 3082, 1] }), 'failure');
  npc = barricade(2427, 3082);
  npc.setRegistered(false);
  assert.equal(Practice._test.scorerTools({ player: p, nowMs: 0 }, { practiceGoal: [2428, 3082, 1] }), 'failure');
});
