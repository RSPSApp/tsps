// Real cache, private area, combat turns and projectile encoder. The transport is stubbed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const PROJECTILES_PACKET = 84; // ServerPacketId.PROJECTILES (a TypeScript const enum).
const ENTANGLE = '<col=ef1020>The Hespori entangles you in some vines!</col>';
const LOOSEN = 'You feel the vines loosen slightly as you try to move.';
const SPORES = [[1639, 30, 60, 8, 64, 98, 58], [1639, 55, 85, 8, 64, 98, 58]];
const WAVE = [1640, 90, 120, 8, 64, 340, 158];
const VINES = [1642, 90, 120, 8, 64, 340, 158];
let core, Patches, Hespori, patch;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(1246, 10085);
  Patches = require('../plugins/skills/farming/Patches.Farming');
  Hespori = require('../plugins/skills/farming/Hespori.Farming');
  patch = require('../plugins/skills/farming/Data.Farming').CACHE.patches.find(p => p.type === 'HESPORI');
  PM.emitServerStartup({});
});

function tick(n = 1) {
  for (let i = 0; i < n; i++) core.World.process();
}

function fixture(t, roll = 0.2) {
  const channel = {
    kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setUsername('hesporitest');
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(1246, 10085, 0));
  player.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, 99, false);
  player.setHitpoints(99);
  assert.equal(core.World.getPlayers().add(player), true);
  player.setNeedsPlacement(false);
  const messages = [], projectiles = [], sounds = [], graphics = [], hits = [], animations = [];
  const now = () => core.World.getProcessCycle();
  let draw = roll;
  t.mock.method(Math, 'random', () => draw);
  t.mock.method(core.PendingHit.prototype, 'isAccurate', () => true);
  t.mock.method(player, 'sendMessage', text => messages.push([now(), text]));
  const graphic = player.performGraphic.bind(player);
  t.mock.method(player, 'performGraphic', value => {
    graphics.push([now(), value.getId(), value.getDelay(), value.getHeight()]);
    graphic(value);
  });
  const tickHit = player.addTickHit.bind(player);
  t.mock.method(player, 'addTickHit', hit => {
    hits.push([now(), hit.getDamage()]);
    tickHit(hit);
  });
  const sender = player.getPacketSender();
  const sound = sender.sendSound.bind(sender);
  t.mock.method(sender, 'sendSound', (id, volume, delay) => {
    sounds.push([now(), id, delay]);
    return sound(id, volume, delay);
  });
  t.mock.method(player.getSession(), 'sendClientPacket', frame => {
    if (frame[0] === PROJECTILES_PACKET) {
      assert.equal(frame.readUInt16BE(3), 1);
      const shot = frame.subarray(5);
      projectiles.push([now(), [
        shot.readUInt16BE(0), shot.readUInt16BE(19), shot.readUInt16BE(21),
        shot[16], shot.readUInt16BE(17), shot.readUInt16BE(7), shot.readUInt16BE(14),
      ]]);
    }
    return true;
  });
  const spawn = PM.spawnNpc.bind(PM);
  t.mock.method(PM, 'spawnNpc', config => {
    const npc = spawn(config);
    if ([core.NpcIdentifiers.HESPORI, core.NpcIdentifiers.HESPORI_2].includes(config.id)) {
      const animate = npc.performAnimation.bind(npc);
      t.mock.method(npc, 'performAnimation', animation => {
        animations.push([now(), animation.getId()]);
        animate(animation);
      });
    }
    return npc;
  });

  t.after(() => {
    Hespori.hesporiLogout({ player, logout: true });
    player.getArea()?.leave(player, true);
    core.TaskManager.cancelTasks(player.getIndex());
    if (player.isRegistered()) core.World.getPlayers().removes(player);
    tick();
  });
  return { player, messages, projectiles, sounds, graphics, hits, animations, now, setRoll: value => { draw = value; } };
}

function farmingFight(f) {
  Object.assign(Patches.stateFor(f.player, patch), {
    crop: 'HESPORI', status: 'grown', stage: 3, nextAt: Number.MAX_SAFE_INTEGER,
  });
  Patches.farmFor(f.player).deathbank = [];
  Hespori.harvestHespori(f.player, patch);
  tick();
  const boss = f.player.getArea()?.entities.find(n => n.isNpc() && n.getId() === core.NpcIdentifiers.HESPORI);
  assert.ok(boss, 'harvesting a grown patch spawns the boss');
  assert.deepEqual(f.animations[0], [f.now(), 8221]);
  return boss;
}

function throughFirstVines(f) {
  const boss = farmingFight(f);
  const rise = f.now();
  let launch;
  for (let elapsed = 1; elapsed <= 57 && launch === undefined; elapsed++) {
    tick();
    launch = f.projectiles.find(([, shot]) => shot[0] === 1642)?.[0];
  }
  assert.ok(launch, 'forced roll throws vines by the tenth attack');
  return { boss, rise, launch };
}

function blocked(f) {
  return f.player.getMovementQueue().isMovementBlocked();
}

function worldInput(f, packet) {
  const event = { player: f.player, packet, handled: false };
  PM.emitCustomEvent('player:world-input', event);
  return event.handled;
}

test('farm rhythm starts at rise +3 and continues six ticks apart', t => {
  const f = fixture(t);
  farmingFight(f);
  const rise = f.now();
  tick(2);
  assert.deepEqual(f.animations.slice(1), []);
  tick();
  assert.deepEqual(f.animations.slice(1), [[rise + 3, 8224]]);
  tick(6);
  assert.deepEqual(f.animations.slice(1), [[rise + 3, 8224], [rise + 9, 8224]]);
});

test('spores send both recorded packet shapes and land together at attack +2', t => {
  const f = fixture(t);
  farmingFight(f);
  tick(3);
  const attack = f.animations.find(([, id]) => id === 8224)[0];
  assert.deepEqual(f.projectiles, SPORES.map(shot => [attack, shot]));
  tick(3);
  assert.deepEqual(f.hits, [[attack + 2, 1], [attack + 2, 1]]);
});

test('wave sends the recorded packet, graphic and sound and hits at attack +4', t => {
  const f = fixture(t, 0.6);
  farmingFight(f);
  tick(3);
  const attack = f.animations.find(([, id]) => id === 8223)[0];
  assert.deepEqual(f.projectiles, [[attack, WAVE]]);
  assert.deepEqual(f.graphics, [[attack, 1641, 120, 124]]);
  assert.deepEqual(f.sounds.filter(([, id]) => id === 4063), [[attack, 4063, 120]]);
  tick(4);
  assert.deepEqual(f.hits, [[attack + 4, 9]]);
});

test('vines launch with their recorded packet and take hold four ticks later', t => {
  const f = fixture(t, 0);
  const { launch } = throughFirstVines(f);
  assert.ok(f.animations.some(([at, clip]) => at === launch && clip === 8223));
  assert.deepEqual(f.projectiles.filter(([, [id]]) => id === 1642), [[launch, VINES]]);
  assert.deepEqual(f.sounds.filter(([, id]) => id === 4062), [[launch, 4062, 0]]);
  tick(launch + 3 - f.now());
  assert.equal(blocked(f), false);
  assert.deepEqual(f.messages.filter(([, text]) => text === ENTANGLE), []);
  tick();
  assert.equal(blocked(f), true);
  assert.deepEqual(f.messages.filter(([, text]) => text === ENTANGLE), [[launch + 4, ENTANGLE]]);
  assert.deepEqual(f.graphics, [[launch + 4, 1643, 0, 124]]);
  assert.deepEqual(f.sounds.filter(([, id]) => id === 4065), [[launch + 4, 4065, 0]]);
  assert.ok(f.hits.every(([at]) => at <= launch), 'vines have no direct hit');
});

test('vines in flight land after death and release without damage on encounter completion', t => {
  const f = fixture(t, 0);
  const { boss, launch } = throughFirstVines(f);
  tick(launch + 2 - f.now());
  f.setRoll(0.2);
  boss.getCombat().addDamage(f.player, boss.getHitpoints());
  boss.setHitpoints(0);
  tick(2);
  assert.equal(blocked(f), true);
  assert.deepEqual(f.messages.filter(([, text]) => text === ENTANGLE), [[launch + 4, ENTANGLE]]);

  let completed = false;
  while (f.now() < launch + 13 && !completed) {
    tick();
    completed = f.messages.some(([, text]) => text.startsWith('Your Hespori kill count is:'));
  }
  assert.equal(completed, true, 'the normal kill completes before the vines would expire');
  assert.equal(blocked(f), false, 'encounter completion releases the vines');
  tick(launch + 14 - f.now());
  assert.deepEqual(f.messages.filter(([, text]) => text === ENTANGLE), [[launch + 4, ENTANGLE]]);
  assert.equal(f.hits.some(([at]) => at > launch), false, 'there is no post-kill expiry hit');
});

test('clicks on six different ticks free the player while the boss keeps attacking', t => {
  const f = fixture(t, 0);
  const { boss, launch } = throughFirstVines(f);
  tick(launch + 4 - f.now());
  const walk = { type: 'move', worldX: 1245, worldY: 10085 };
  const attack = { type: 'npc_option', index: boss.getIndex(), clickType: 2 };
  for (let turn = 1; turn <= 5; turn++) {
    tick();
    for (let click = 0; click < 4; click++) assert.equal(worldInput(f, turn % 2 ? walk : attack), true);
    assert.equal(blocked(f), true);
  }
  const loosenTicks = Array.from({ length: 5 }, (_, i) => launch + 5 + i);
  assert.deepEqual(f.messages.filter(([, text]) => text === LOOSEN), loosenTicks.map(at => [at, LOOSEN]));
  assert.deepEqual(f.sounds.filter(([, id]) => id === 4057), loosenTicks.map(at => [at, 4057, 0]));
  tick();
  assert.ok(f.animations.some(([at, id]) => at === launch + 6 && id === 8224));
  assert.equal(f.hits.filter(([at]) => at === launch + 8).length, 2);
  worldInput(f, walk);
  assert.equal(blocked(f), false);
  assert.equal(worldInput(f, walk), false);
});

test('retail break-free line', { skip: 'Mechanics-only scope retains the existing break-free text' }, () => {});

test('uncleared vines release and damage the player exactly ten ticks after landing', t => {
  const f = fixture(t, 0);
  const { launch } = throughFirstVines(f);
  tick(launch + 13 - f.now());
  assert.equal(blocked(f), true);
  assert.equal(f.hits.some(([, damage]) => damage >= 40), false);
  tick();
  assert.equal(blocked(f), false);
  assert.equal(f.hits.filter(([at, damage]) => at === launch + 14 && damage >= 40 && damage <= 50).length, 1);
});

test('forced vines are eligible from the tenth attack and happen at most once per fight', t => {
  const f = fixture(t, 0);
  farmingFight(f);
  const rise = f.now();
  tick(81);
  assert.deepEqual(f.projectiles.filter(([, [id]]) => id === 1642).map(([at]) => at), [rise + 57]);
  assert.equal(f.animations.filter(([, id]) => id === 8224 || id === 8223).length, 14);
});

test('poison starts at a damaging hit with varp 16, and zero damage never poisons', t => {
  const f = fixture(t, 0);
  const poison = core.CombatFactory.poisonEntity.bind(core.CombatFactory);
  const applied = [];
  t.mock.method(core.CombatFactory, 'poisonEntity', (target, severity) => {
    applied.push([f.now(), severity]);
    return poison(target, severity);
  });
  farmingFight(f);
  const rise = f.now();
  tick(5);
  assert.deepEqual(applied, [], 'zero damage cannot poison');
  f.setRoll(0.12);
  tick(5);
  assert.deepEqual(applied, [], 'the second attack has not landed');
  tick();
  assert.deepEqual(applied, [[rise + 11, 16], [rise + 11, 16]]);
  assert.ok(f.messages.some(([at, text]) => at === rise + 11 && text === 'You have been poisoned!'));
  assert.equal(f.player.getPacketSender().getVarp(102), 16);
});

test('quest and Echo Hespori attack with the shared packet shape and cadence', t => {
  const f = fixture(t);
  const area = new core.PrivateArea([new core.Boundary(1216, 1279, 10048, 10111, 0)]);
  area.enter(f.player);
  const quest = { player: f.player, location: patch, area, handled: false };
  Hespori.challengeHespori(quest);
  assert.equal(quest.handled, true);
  const challenge = f.now();
  tick(9);
  assert.deepEqual(f.projectiles, [challenge + 3, challenge + 9].flatMap(at => SPORES.map(shot => [at, shot])));
  Hespori.hesporiLogout({ player: f.player });
  area.leave(f.player, false);
  tick();

  const emit = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, 'emitCustomEvent', (name, event) => {
    if (name === 'echo-boss:claim') event.token = 'hespori-test';
    else if (name === 'echo-boss:configure') event.configured = true;
    else emit(name, event);
  });
  f.projectiles.length = 0;
  const echo = { player: f.player, boss: 'hespori', handled: false };
  Hespori.startEcho(echo);
  assert.equal(echo.handled, true);
  const rise = f.now();
  tick(9);
  assert.deepEqual(f.projectiles, [rise + 3, rise + 9].flatMap(at => SPORES.map(shot => [at, shot])));
});
