// Run after `yarn build`: node --test tests/bounty-hunter-bots.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const Bots = require('../plugins/minigames/bountyhunter/Bots.BountyHunter');
const { buildStyle, pickTierChoice, TIER_BANDS, archetypeCombatLevel } = require('../plugins/bots/behaviours/pvp/PvpTierLoadouts.PlayerBots');

const Entry = require('../plugins/minigames/bountyhunter/Entry.BountyHunter');
const Coffer = require('../plugins/minigames/bountyhunter/Coffer.BountyHunter');
const { setActiveBotRuntime } = require('../plugins/bots/runtime/RuntimeRegistry.PlayerBots');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const core = PluginManager.getCoreApi();

before(async () => {
  await CachePipeline.initialize();
  core.RegionManager.init();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({
    log() {}, onPlayerLogin() {}, registerContentEndpoint() {},
  });
  require('../plugins/items/Food.plugin').register(PluginManager.createApi('BountyHunterFoodRegression'));
});

test('every offered sigil spawn has an exact route out of the claw enclosure', (t) => {
  const bh = require('../plugins/minigames/bountyhunter/State.BountyHunter');
  Entry(PluginManager.createApi('BountyHunterSpawnsRegression'), bh);
  const routes = new core.RsmodRouteFinding();
  let sigil, offered;
  t.mock.method(core.Misc, 'randomElement', (values) => {
    if (values === bh.CRATER.sigils) return sigil;
    offered = values;
    return values[0];
  });
  for (sigil of bh.CRATER.sigils) {
    const exits = bh.CRATER.exits.map((exit) => ({
      x: exit.x + Math.sign(exit.x - exit.to.x) * 2,
      y: exit.y + Math.sign(exit.y - exit.to.y) * 2,
    }))
      .filter(({ x, y }) => core.RegionManager.getClipping(x, y, 0, null) === 0);
    assert.ok(exits.length, 'the cache has walkable ground in front of the fort gates');
    Entry.spawnTile();
    for (const { x, y } of offered) {
      const spawn = new core.Location(x, y);
      assert.equal(bh.isArenaTile(spawn), true);
      assert.equal(core.RegionManager.blocked(spawn, null), false);
      assert.ok(exits.some(({ x, y }) => routes.findRoute({ level: 0, srcX: spawn.getX(),
        srcY: spawn.getY(), srcSize: 1, destX: x, destY: y, moveNear: false }).success),
      `${spawn.getX()},${spawn.getY()} must reach the fort from sigil ${sigil.x},${sigil.y}`);
    }
  }
});

test('generated equipment selects wearable alternatives instead of dropping an invalid random choice', (t) => {
  const { buildGeneratedPreset } = require('../plugins/bots/behaviours/policies/PvpLoadoutPolicy.PlayerBots').__testing;
  const { canEquipPresetItem } = require('../plugins/modes/pvp/Presets.PvpMode');
  const state = { pvp: { profileId: 'standard', loadoutId: 'edge_main_melee', generatedArchetypeId: 'zerker_whip' } };
  for (const roll of [0, 0.5, 0.99]) {
    const random = t.mock.method(Math, 'random', () => roll);
    const { preset } = buildGeneratedPreset(null, state);
    assert.equal(preset.getStats()[1], 45);
    assert.ok(preset.getEquipment().every((item) => canEquipPresetItem(preset, item)));
    assert.ok(preset.getEquipment().some((item) => item.getDefinition().getEquipmentType().getSlot() === core.Equipment.BODY_SLOT));
    assert.ok(preset.getEquipment().every((item) => item.getId() !== core.ItemIdentifiers.OBSIDIAN_PLATEBODY));
    random.mock.restore();
  }
  // Inventory switches come from the same pools: a 1 Defence pure never carries a 40 Defence top.
  const pure = { pvp: { profileId: 'veteran', loadoutId: 'budget_pk', generatedArchetypeId: 'budget_pure_tribrid' } };
  for (const roll of [0, 0.5, 0.99]) {
    const random = t.mock.method(Math, 'random', () => roll);
    const { preset } = buildGeneratedPreset(null, pure);
    const switches = preset.getInventory().filter((item) => item.getDefinition().getEquipmentType().getSlot() >= 0);
    assert.ok(switches.length > 0);
    assert.ok(switches.every((item) => canEquipPresetItem(preset, item)), switches.map((item) => item.getDefinition().getName()).join(', '));
    random.mock.restore();
  }
});

test('the capped roster fills one per tick across combat bands and restores bots after death', (t) => {
  const hooks = new Map();
  const tasks = [];
  const spawned = [];
  const removed = [];
  const runtime = { botStatesByName: new Map(), spawnPvpBot };
  const human = { isPlayerBot: () => false };
  const bh = { lobby: new Set([human]), arena: new Set(), isArenaTile: () => true, inArena: () => false };
  const spawnTile = Entry.spawnTile;
  Entry.spawnTile = () => ({ getX: () => 3363, getY: () => 4037, getZ: () => 0 });
  setActiveBotRuntime(runtime, { PVP: 'pvp' });
  t.after(() => { Entry.spawnTile = spawnTile; setActiveBotRuntime(null, null); });

  function spawnPvpBot(location, options) {
    if (runtime.botStatesByName.has(options.username)) return null; // as the registry: name still taken
    const attributes = new Map();
    const generated = require('../plugins/bots/behaviours/policies/PvpLoadoutPolicy.PlayerBots').__testing
      .buildGeneratedPreset(null, { pvp: options.pvpMetadata });
    const level = archetypeCombatLevel(generated.preset.getStats());
    const bot = {
      skulled: false, dying: false, coins: 0,
      getUsername: () => options.username,
      band: options.pvpMetadata.combatLevelRange,
      isPlayerBot: () => true,
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      getSkillManager: () => ({ getCombatLevel: () => level }),
      isSkulled: () => bot.skulled,
      getHitpoints: () => 99,
      getCombat: () => ({ getTarget: () => bot.opponent, getAttacker: () => bot.attacker }),
      isDyingReturn: () => bot.dying,
      getLocation: () => location,
      getInventory: () => ({ forceAdd: (_, item) => { bot.coins += item.amount; } }),
      getForcedLogoutTimer: () => ({ start: () => {} }),
      requestLogout: () => { removed.push(bot); hooks.get('logout')({ player: bot }); },
    };
    assert.equal(options.mode, 'pvp');
    assert.ok(level >= bot.band.min && level <= bot.band.max, `${level} in ${bot.band.min}-${bot.band.max}`);
    runtime.botStatesByName.set(options.username, { pvp: options.pvpMetadata });
    spawned.push(bot);
    return bot;
  }

  const api = {
    core: {
      Task: class {},
      Item: class { constructor(id, amount) { this.amount = amount; } },
      ItemIdentifiers: { COINS: 995 },
      SkullType: { WHITE_SKULL: 'white' },
      CombatFactory: { PVP_SKULL_SECONDS: 1800, skull: (bot) => { bot.skulled = true; } },
    },
    onCustomEvent: (name, fn) => hooks.set(name, fn),
    onPlayerLogout: (fn) => hooks.set('logout', fn),
    onPlayerBeforeDeath: (fn) => hooks.set('before-death', fn),
    onServerStartup: (fn) => hooks.set('startup', fn),
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
  };
  Coffer(new Proxy(api, { get: (object, name) => object[name] ?? (() => {}) }));
  Bots(api, bh);
  const enter = hooks.get('bounty-hunter:entered-lobby');
  enter({ player: { isPlayerBot: () => true } });
  assert.equal(spawned.length, 0, 'bots cannot populate the crater');
  enter({ player: human });
  assert.equal(spawned.length, 0, 'entry cannot burst-spawn the roster');
  hooks.get('startup')();
  for (let index = 0; index < 60; index++) {
    tasks[0].execute();
    assert.equal(spawned.length, index + 1, 'at most one spawn per tick');
  }
  assert.deepEqual(spawned.map((bot) => bot.getUsername()), Array.from({ length: 60 }, (_, i) => `BhBot${i + 1}`));
  const { PVP_LOADOUT_DEFINITIONS } = require('../plugins/bots/behaviours/pvp/PvpLoadoutRegistry.PlayerBots');
  const archetypes = new Map(PVP_LOADOUT_DEFINITIONS.archetypes.map((entry) => [entry.id, entry]));
  const styleOf = (bot) => buildStyle(archetypes.get(runtime.botStatesByName.get(bot.getUsername()).pvp.generatedArchetypeId));
  for (const band of Bots._test.BOT_BANDS) {
    const inBand = spawned.filter((bot) => bot.band.min === band.min);
    assert.equal(inBand.length, 12, `${band.min}-${band.max}`);
    // 45/30/25 of 12 is 5.4/3.6/3: each style within one bot of its share.
    for (const [style, weight] of Object.entries(Bots._test.STYLE_WEIGHTS)) {
      const count = inBand.filter((bot) => styleOf(bot) === style).length;
      assert.ok(Math.abs(count - (weight / 100) * 12) <= 1, `${band.min}-${band.max} ${style}: ${count}`);
    }
  }
  assert.deepEqual([...new Set(spawned.map((bot) => runtime.botStatesByName.get(bot.getUsername()).pvp.profileId))].sort(),
    ['elite', 'novice', 'standard', 'veteran'], 'the high end includes the advanced shared PvP profile');
  for (const bot of spawned) {
    assert.equal(bot.isSkulled(), true);
    assert.equal(Coffer.balance(bot), Coffer.playerMinimumDeposit(bot));
  }
  enter({ player: human });
  assert.equal(spawned.length, 60, 'another entry cannot duplicate the population');

  const defender = spawned[0], rogue = spawned[1], quarry = spawned[2];
  const pvp = runtime.botStatesByName.get(defender.getUsername()).pvp;
  pvp.targetPlayer = rogue;
  pvp.targetUsername = rogue.getUsername();
  for (const link of ['opponent', 'attacker']) {
    defender[link] = rogue;
    hooks.get('bounty-hunter:target-assigned')({ player: defender, target: quarry });
    hooks.get('bounty-hunter:target-cleared')({ player: defender });
    assert.equal(pvp.targetPlayer, rogue, 'matchmaking cannot interrupt an ongoing fight');
    assert.equal(pvp.targetUsername, rogue.getUsername());
    defender[link] = null;
  }
  hooks.get('bounty-hunter:target-cleared')({ player: defender });
  assert.equal(pvp.targetPlayer, null, 'an idle bot drops its old assignment');

  const victim = spawned[0];
  const killer = spawned[1];
  const minimum = Coffer.playerMinimumDeposit(victim);
  Coffer.died({ player: victim, killer, skulled: true });
  assert.equal(killer.coins, 10_000, 'a bot kill pays the coffer reward');
  assert.equal(Coffer.balance(victim), minimum - 10_000);
  victim.skulled = false;
  victim.dying = true;
  tasks[0].execute();
  assert.equal(Coffer.balance(victim), minimum - 10_000, 'no refill or reskull during death handling');
  assert.equal(victim.isSkulled(), false);
  victim.dying = false;
  tasks[0].execute();
  assert.equal(Coffer.balance(victim), minimum);
  assert.equal(victim.isSkulled(), true);
  const rich = spawned[2];
  rich.setAttribute('bounty-hunter:coffer', 200_000);
  tasks[0].execute();
  assert.equal(Coffer.balance(rich), 200_000, 'funding preserves an existing surplus');

  for (const bot of [...spawned]) bot.requestLogout();
  assert.equal(removed.length, 60);
  tasks[0].execute();
  assert.equal(spawned.length, 61, 'an occupied crater recovers even after every bot leaves');
  for (let index = 1; index < 60; index++) tasks[0].execute();
  assert.equal(spawned.length, 120, 'one replacement per tick restores the roster without a burst');
  tasks[0].execute();
  assert.equal(spawned.length, 120, 'a full roster stops spawning');
  bh.lobby.clear();
  bh.arena.add(human);
  tasks[0].execute();
  assert.equal(removed.length, 60, 'entering the arena keeps the population');
  const otherHuman = { isPlayerBot: () => false };
  bh.lobby.add(otherHuman);
  enter({ player: otherHuman });
  bh.arena.delete(human);
  tasks[0].execute();
  assert.equal(removed.length, 60, 'one player leaving cannot remove another player\'s opponents');
  bh.lobby.delete(otherHuman);
  bh.arena.add(spawned[0]);
  tasks[0].execute();
  assert.equal(removed.length, 120, 'the next tick removes every bot when the last real player leaves');
  tasks[0].execute();
  assert.equal(removed.length, 120, 'an empty crater does no more bot work');
  bh.arena.clear();
  bh.lobby.add(human);
  enter({ player: human });
  for (let index = 0; index < 60; index++) tasks[0].execute();
  assert.equal(spawned.length, 180, 'the next visit fills a fresh capped population');
  assert.equal(spawned.at(-1).getUsername(), 'BhBot180', 'fresh names: the last bots may still be online');
  const high = spawned.slice(-60).find((bot) => bot.band.min === 121);
  high.requestLogout();
  tasks[0].execute();
  assert.equal(spawned.at(-1).band.min, 121, 'a departed high-level bot is replaced in its own band');
  bh.lobby.clear();
  bh.arena.clear();
  tasks[0].execute();
});

test('the shared tier picker still answers each tier', () => {
  for (const tier of Object.keys(TIER_BANDS)) assert.ok(pickTierChoice(tier), tier);
  assert.equal(pickTierChoice('unknown'), null);
});

test('members-only picks never draw a free-to-play preset', () => {
  for (const tier of Object.keys(TIER_BANDS)) {
    for (let index = 0; index < 20; index++) {
      const choice = pickTierChoice(tier, { index, excludeF2p: true });
      assert.ok(!choice || !choice.tags.includes('f2p'), `${tier} ${choice?.loadoutId}`);
    }
  }
});

test('crater kits use eligible BH gear and the shared engine indexes their real specials and ammo', (t) => {
  const bh = require('../plugins/minigames/bountyhunter/State.BountyHunter');
  const api = PluginManager.createApi('BountyHunterLoadoutsRegression');
  require('../plugins/minigames/bountyhunter/Loadouts.BountyHunter')(api, bh);
  const { Presetable } = require('../dist/game/content/presets/Presetable');
  const { applyGeneratedPvpLoadout } = require('../plugins/bots/behaviours/policies/PvpLoadoutPolicy.PlayerBots');
  const { SUPPORTED_SPEC_WEAPONS } = require('../plugins/bots/behaviours/policies/PvpCombatRuntimeCache.PlayerBots');
  const I = core.ItemIdentifiers;
  const player = new Player(null, new core.Location(3477, 4118));
  player.setUsername('bh_gear');
  player.setPlayerBot(true);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(player, 'sendMessage', () => {});
  const gear = require('../plugins/minigames/bountyhunter/data/bot-gear.json');
  const preset = (stats) => new Presetable('BH gear regression',
    Object.keys(gear).map((key) => new core.Item(I[key])), [], stats, core.MagicSpellbook.NORMAL, true);
  const high = preset([99, 99, 99, 99, 99, 99, 99]);
  api.emitCustomEvent('player-bots:pvp-loadout', { player, preset: high });
  assert.deepEqual(high.getInventory().map((item) => item.getId()), Object.values(gear).map((key) => I[key]));
  for (const name of ['DARK_BOW_BH_', 'ABYSSAL_DAGGER_BH_P_PLUS_PLUS_', 'VESTAS_LONGSWORD_BH_', 'STATIUSS_WARHAMMER_BH_']) {
    assert.ok(SUPPORTED_SPEC_WEAPONS.includes(I[name]), `${name} is usable by the shared special-attack policy`);
    assert.match(core.ItemDefinition.forId(I[name]).getName(), /\(bh\)/i);
  }
  const pure = preset([60, 1, 99, 90, 99, 52, 94]);
  api.emitCustomEvent('player-bots:pvp-loadout', { player, preset: pure });
  assert.ok(pure.getInventory().some((item) => item.getId() === I.DRAGON_DAGGER_P_PLUS_PLUS_), 'a pure cannot upgrade to a 70 Attack dagger');
  assert.ok(pure.getInventory().some((item) => item.getId() === I.BLACK_DHIDE_BODY), 'a pure cannot wear high-Defence Morrigan armour');
  player.moveTo(new core.Location(3093, 3493));
  const elsewhere = preset([99, 99, 99, 99, 99, 99, 99]);
  api.emitCustomEvent('player-bots:pvp-loadout', { player, preset: elsewhere });
  assert.deepEqual(elsewhere.getInventory().map((item) => item.getId()), Object.keys(gear).map((key) => I[key]), 'other PvP areas keep their kits');
  player.moveTo(new core.Location(3477, 4118));
  const state = { pvp: { profileId: 'elite', loadoutId: 'deep_wild_hybrid', generatedArchetypeId: 'elite_ancients_dbow' } };
  assert.equal(applyGeneratedPvpLoadout(player, state, { api }), true);
  assert.equal(state.pvp.generatedSpecWeaponId, I.DARK_BOW_BH_);
  assert.equal(state.pvp.generatedSpecAmmoId, I.DRAGON_ARROW);
});

test('Bounty Hunter retreat uses remaining food, commits to a real exit and logs out without refitting', async (t) => {
  const { PvpDefensiveActionNode } = require('../plugins/bots/behaviours/nodes/pvp/PvpDefensiveActionNode.PlayerBots');
  const { PvpController } = require('../plugins/bots/brain/pvp/PvpController.PlayerBots');
  const { EatFoodActionNode } = require('../plugins/bots/behaviours/nodes/actions/EatFoodActionNode.PlayerBots');
  const { peekMovementRequest, clearMovementRequest, dispatchMovementRequest } = require('../plugins/bots/behaviours/navigation/Navigation.PlayerBots');
  const bh = require('../plugins/minigames/bountyhunter/State.BountyHunter');
  const runtime = { botStatesByName: new Map() };
  const api = PluginManager.createApi('BountyHunterRetreatRegression');
  Entry(api, bh);
  Bots(api, bh);
  setActiveBotRuntime(runtime, { PVP: 'pvp' });
  t.after(() => setActiveBotRuntime(null, null));

  function fixture(t, name) {
    const player = new Player(null, new core.Location(3363, 4037));
    player.setUsername(name);
    player.setRegistered(true);
    player.setPlayerBot(true);
    player.setAttribute('bounty-hunter:bot', true);
    t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
    t.mock.method(player, 'sendMessage', () => {});
    let logouts = 0;
    t.mock.method(player, 'requestLogout', () => { logouts++; });
    player.setAutoRetaliate(true);
    player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.DRAGON_SCIMITAR));
    player.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(core.ItemIdentifiers.RUNE_PLATEBODY));
    player.getInventory().adds(core.ItemIdentifiers.SHARK, 5);
    const state = { mode: 'pvp', home: { x: 3363, y: 4037, z: 0 }, pvp: { profileId: 'standard', riskTolerance: 0.3, retreat: null } };
    runtime.botStatesByName.set(name, state);
    bh.arena.add(player);
    t.after(() => { player.setRegistered(false); bh.arena.delete(player); bh.lobby.delete(player); clearMovementRequest(player); });
    const node = new PvpDefensiveActionNode({
      api, setPhase: (state, phase) => { state.pvp.phase = phase; }, stopPvp: () => { state.recoveries = (state.recoveries ?? 0) + 1; },
    });
    return { player, state, node, logouts: () => logouts, tick: (nowMs = 1000) => node.tick({ player, state, nowMs, target: null }) };
  }

  await t.test('early retreat stays committed, eats while running and respects the real gate before logout', (t) => {
    const f = fixture(t, 'bh_flee');
    t.mock.method(Math, 'random', () => 0.99);
    assert.equal(f.tick().handled, true);
    const retreat = f.state.pvp.retreat;
    assert.ok(retreat, 'a low-food bot can leave before its last meal');
    assert.equal(f.player.autoRetaliateReturn(), false);
    let request = peekMovementRequest(f.player);
    const exit = bh.CRATER.exits.find((exit) => exit.x === request?.x && exit.y === request?.y);
    assert.ok(exit, 'the pending long walk targets an actual arena exit');
    assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.SHARK), 5, 'standing at its spawn never refits the bot');

    const quarry = new Player(null);
    quarry.setUsername('new_quarry');
    quarry.setRegistered(true);
    Bots._test.huntTarget({ player: f.player, target: quarry });
    Bots._test.dropTarget({ player: f.player });
    assert.equal(f.state.pvp.retreat, retreat, 'matchmaking cannot reset a committed escape');

    f.player.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99);
    f.player.setHitpoints(20);
    const support = {
      maintainCombatBoostsActionNode: { tick: () => 'failure' }, defensiveActionNode: f.node,
      eatFoodActionNode: new EatFoodActionNode(runtime.botStatesByName, api),
      botStatesByName: runtime.botStatesByName, behaviorMode: { PVP: 'pvp' }, resolveTargetPlayer: () => null,
    };
    assert.equal(PvpController.prototype.tickSupport.call(support, { player: f.player, state: f.state, nowMs: 1600 }).skip, true);
    assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.SHARK), 4, 'normal support still consumes real food while fleeing');
    assert.ok(f.player.getHitpoints() > 20);
    f.player.getInventory().deleteNumber(core.ItemIdentifiers.SHARK, 4);
    f.tick(60000);
    assert.equal(f.state.pvp.retreat, retreat, 'running out does not restart or reverse the escape');
    assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.SHARK), 0);
    request = peekMovementRequest(f.player);
    assert.deepEqual([request.x, request.y], [exit.x, exit.y]);

    let cycle = 100;
    t.mock.method(core.World, 'getProcessCycle', () => cycle);
    bh.lastSpecialAt.set(f.player, cycle);
    f.player.moveTo(new core.Location(exit.x, exit.y));
    f.tick(60600);
    assert.equal(bh.isArenaTile(f.player.getLocation()), true, 'the real recent-special restriction still applies');
    assert.equal(f.logouts(), 0, 'no logout while still vulnerable');
    cycle += 6;
    f.tick(64200);
    assert.equal(bh.isLobbyTile(f.player.getLocation()), true, 'the gate, rather than a teleport, enters the fort');
    f.tick(64800);
    f.tick(65400);
    assert.equal(f.logouts(), 1);
    assert.equal(peekMovementRequest(f.player), null);
    assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.SHARK), 0, 'escaping never regenerates supplies');
    assert.equal(f.state.recoveries ?? 0, 0);
    quarry.setRegistered(false);
  });

  await t.test('a bot that chooses to fight is not rerolled while meals remain', (t) => {
    const f = fixture(t, 'bh_stay');
    let rolls = 0;
    t.mock.method(Math, 'random', () => { rolls++; return 0; });
    for (const count of [5, 4, 1]) {
      f.player.getInventory().deleteNumber(core.ItemIdentifiers.SHARK, 5);
      if (count) f.player.getInventory().adds(core.ItemIdentifiers.SHARK, count);
      assert.equal(f.tick().handled, false);
      assert.equal(f.state.pvp.retreat ?? null, null);
    }
    assert.equal(rolls, 1, 'one personality decision for the whole low-food episode');
    assert.equal(peekMovementRequest(f.player), null);
    assert.equal(f.logouts(), 0);
    assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.SHARK), 1);
    f.player.getInventory().resetItems();
    f.player.getInventory().adds(core.ItemIdentifiers.SHARK, 7);
    f.tick();
    f.player.getInventory().deleteNumber(core.ItemIdentifiers.SHARK, 1);
    f.tick();
    assert.equal(rolls, 2, 'only a new supply episode permits another decision, including at six meals');
  });

  await t.test('death clears the escape and the next life can make a new decision', (t) => {
    const f = fixture(t, 'bh_death');
    t.mock.method(Math, 'random', () => 0.99);
    t.mock.method(core.TaskManager, 'submit', () => {});
    f.tick();
    assert.ok(f.state.pvp.retreat);
    f.player.setHitpoints(0);
    assert.equal(f.state.pvp.retreat, null);
    assert.equal(f.player.autoRetaliateReturn(), true);
    assert.equal(f.tick().handled, true);
    assert.equal(f.logouts(), 0);
    assert.equal(peekMovementRequest(f.player), null);
    f.player.resetAttributes();
    f.tick(2000);
    f.player.getInventory().resetItems();
    f.player.getInventory().adds(core.ItemIdentifiers.SHARK, 5);
    f.tick(2600);
    assert.ok(f.state.pvp.retreat, 'respawning does not inherit the previous retreat decision');
  });

  await t.test('a bare new life retains the actual PvP kit recovery before deciding whether to flee', (t) => {
    const f = fixture(t, 'bh_regear');
    f.player.getInventory().resetItems();
    f.player.getEquipment().resetItems();
    assert.equal(f.tick().status, 'success');
    assert.equal(f.state.recoveries ?? 0, 0, 'a new life does not enter the escape recovery');
    assert.equal(f.state.pvp.retreat, null);
    assert.ok(f.player.getInventory().getValidItems().length > 6);
    assert.ok(f.player.getEquipment().getValidItems().length > 0);
    assert.equal(f.logouts(), 0);
  });

  await t.test('coins left in a naked bot inventory cannot prevent shared kit recovery', (t) => {
    const f = fixture(t, 'bh_coins');
    f.player.getInventory().resetItems();
    f.player.getEquipment().resetItems();
    f.player.getInventory().adds(core.ItemIdentifiers.COINS, 1000);
    assert.equal(PvpController.prototype.ensureLoadout.call({ api }, f.player, f.state), true);
    assert.ok(f.player.getEquipment().isSlotOccupied(core.Equipment.WEAPON_SLOT));
    assert.ok(f.player.getEquipment().isSlotOccupied(core.Equipment.BODY_SLOT));
    assert.ok(f.player.getInventory().getValidItems().length > 6);
  });

  await t.test('a protected item after death does not leave a bot in a partial kit', (t) => {
    const f = fixture(t, 'bh_kept');
    f.player.getInventory().resetItems();
    f.player.getEquipment().resetItems();
    f.player.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(core.ItemIdentifiers.HELM_OF_NEITIZNOT));
    f.state.pvp.loadoutPending = true;
    assert.equal(f.tick().status, 'success');
    assert.equal(f.state.pvp.loadoutPending, false);
    assert.ok(f.player.getEquipment().isSlotOccupied(core.Equipment.WEAPON_SLOT));
    assert.ok(f.player.getEquipment().isSlotOccupied(core.Equipment.BODY_SLOT));
  });

  await t.test('an exhausted bot leaves even if it previously chose to fight with its last meals', (t) => {
    const f = fixture(t, 'bh_empty');
    t.mock.method(Math, 'random', () => 0);
    assert.equal(f.tick().handled, false);
    f.player.getInventory().resetItems();
    assert.equal(f.tick(1600).handled, true);
    assert.ok(f.state.pvp.retreat?.exit, 'no food overrides the earlier risk decision');
    assert.ok(peekMovementRequest(f.player), 'the exhausted bot has a real exit route');
  });

  await t.test('a transiently failed shared regear keeps owning its retreat until it finishes', (t) => {
    const f = fixture(t, 'bh_pending');
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    f.player.getInventory().resetItems();
    f.player.getEquipment().resetItems();
    const classification = t.mock.method(f.player, 'isPlayerBot', () => false);
    assert.equal(f.tick().status, 'running');
    const recovery = f.state.pvp.retreat;
    assert.equal(recovery ?? null, null);
    assert.equal(f.state.pvp.loadoutPending, true);
    assert.equal(f.tick(1600).status, 'running');
    assert.equal(f.state.pvp.retreat, recovery);
    classification.mock.restore();
    assert.equal(f.tick(2200).status, 'success');
    assert.equal(f.state.pvp.retreat, null);
    assert.equal(f.state.recoveries ?? 0, 0);
    assert.ok(f.player.getEquipment().getValidItems().length > 0);
    assert.equal(f.logouts(), 0);
    assert.deepEqual(errors, [], 'the custom hook never claims a pending shared recovery');
  });

  for (const [index, exit] of bh.CRATER.exits.entries()) await t.test(`actual map retreat reaches gate ${index + 1} from the arena side`, (t) => {
    const f = fixture(t, `bh_map_${index}`);
    t.mock.method(Math, 'random', () => 0.99);
    let cycle = 1000;
    t.mock.method(core.World, 'getProcessCycle', () => cycle);
    const x = exit.x + Math.sign(exit.x - exit.to.x) * 5;
    const y = exit.y + Math.sign(exit.y - exit.to.y) * 5;
    f.player.moveTo(new core.Location(x, y));
    f.player.setNeedsPlacement(false);
    core.RegionManager.loadMapFiles(exit.x, exit.y);
    assert.equal(core.RegionManager.blocked(f.player.getLocation(), null), false);
    f.tick(cycle * 600);
    const request = peekMovementRequest(f.player);
    assert.deepEqual([request.x, request.y], [exit.x, exit.y]);
    const routed = dispatchMovementRequest(f.player, request, f.state);
    assert.equal(routed.hasRoute, true, 'actual clipping must yield a reachable approach to the solid gate');
    const queue = f.player.getMovementQueue();
    for (let step = 0; step < 12 && !bh.isLobbyTile(f.player.getLocation()); step++) {
      cycle++;
      queue.beginCycle();
      queue.process();
      assert.equal(core.RegionManager.blocked(f.player.getLocation(), null), false, 'the bot never stands on the solid gate');
      f.tick(cycle * 600);
    }
    assert.equal(bh.isLobbyTile(f.player.getLocation()), true, 'real movement reaches canonical object-operating distance');
    assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [exit.to.x, exit.to.y]);
    f.tick((cycle + 1) * 600);
    assert.equal(f.logouts(), 1);
  });
});

test('every PvP build can wear what it names, and the researched builds keep their level and style', () => {
  const { canEquipPresetItem } = require('../plugins/modes/pvp/Presets.PvpMode');
  const { PVP_LOADOUT_DEFINITIONS } = require('../plugins/bots/behaviours/pvp/PvpLoadoutRegistry.PlayerBots');
  const pools = PVP_LOADOUT_DEFINITIONS.pools;
  const names = (spec) => spec == null ? [] : Array.isArray(spec) ? spec.flatMap(names)
    : typeof spec === 'string' ? (spec.startsWith('@') ? pools[spec.slice(1)] : [spec])
    : spec.item ? names(spec.item) : spec.magicStaff ? [spec.magicStaff] : [];
  const item = (name) => new core.Item(core.ItemIdentifiers[name], 1);
  for (const entry of PVP_LOADOUT_DEFINITIONS.archetypes) {
    const preset = { getStats: () => entry.stats };
    // A slot of only nulls is deliberately empty (no shield beside a two-hander).
    for (const [slot, spec] of Object.entries(entry.equipment).filter(([, spec]) => names(spec).length > 0)) {
      assert.ok(names(spec).some((name) => canEquipPresetItem(preset, item(name))), `${entry.id} ${slot}`);
    }
    // Switches and spare ammunition are worn mid-fight; a pool offers only what the build can wear.
    entry.inventory.forEach((spec, index) => {
      const gear = names(spec).filter((name) => item(name).getDefinition().getEquipmentType().getSlot() >= 0);
      if (gear.length) assert.ok(gear.some((name) => canEquipPresetItem(preset, item(name))), `${entry.id} inventory ${index}: ${gear}`);
    });
  }
  const builds = {
    ags_pure: [88, 'melee'], range_pure: [73, 'range'], low_prayer_pure: [66, 'melee'], thirteen_def_pure: [83, 'melee'],
    proselyte_pure: [88, 'melee'], rigour_zerker: [101, 'range'], granite_fifty_def: [101, 'melee'], defence_pure: [48, 'melee'],
    f2p_magic_tank: [70, 'hybrid'], f2p_rune_tank: [81, 'melee'], max_melee_main: [126, 'melee'], max_range_tank: [126, 'range'],
  };
  for (const [id, [level, style]] of Object.entries(builds)) {
    const entry = PVP_LOADOUT_DEFINITIONS.archetypes.find((archetype) => archetype.id === id);
    assert.deepEqual([archetypeCombatLevel(entry.stats), buildStyle(entry)], [level, style], id);
    assert.ok(PVP_LOADOUT_DEFINITIONS.loadouts.some((loadout) => loadout.archetypes.includes(id)), `${id} is in a loadout`);
  }
});

test('bot loadout bands use the same combat level as players', () => {
  const { combatLevelOf } = require('../plugins/bots/brain/SiteSpawner.PlayerBots');
  const { matchesHotspotCombatBand } = require('../plugins/bots/behaviours/policies/PvpLoadoutPolicy.PlayerBots').__testing;
  for (const attack of [1, 50]) {
    const stats = [attack, 1, 99, 65, 99, 1, 99];
    assert.equal(require("../dist/game/content/skill/SkillManager").SkillManager.calculateCombatLevel(stats), 64);
    assert.equal(archetypeCombatLevel(stats), 64);
    assert.equal(combatLevelOf([attack, 99, 1, 65, 99, 99, 1]), 64);
    assert.equal(matchesHotspotCombatBand(stats, { pvp: { combatLevelRange: { min: 64, max: 64 } } }), true);
    assert.equal(matchesHotspotCombatBand(stats, { pvp: { combatLevelRange: { min: 65, max: 65 } } }), false);
  }
});
