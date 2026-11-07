process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const { test, before, afterEach } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { Location } = require('../dist/game/model/Location');
const { World } = require('../dist/game/World');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Shared = require('../plugins/minigames/valetotems/Shared.ValeTotems');
const State = require('../plugins/minigames/valetotems/State.ValeTotems');
const Ents = require('../plugins/minigames/valetotems/Ents.ValeTotems');
const hooks = {};
const viewers = [];
const SITE = 3;

before(async () => {
  await CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    spawnNpc: definition => PluginManager.spawnNpc(definition, 'ValeTotemsEffectTest'),
    persistAttribute() {},
    onPlayerLogin: fn => hooks.login = fn,
    onPlayerLogout: fn => hooks.logout = fn,
    onPlayerMapSquareChange: fn => hooks.enter = fn,
    onServerStartup: fn => hooks.start = fn,
  };
  Shared.init(api); State.attach(api); Ents.attach(api);
  hooks.start();
});

afterEach(() => {
  for (const viewer of viewers.splice(0)) hooks.logout(viewer);
});

function viewer(index) {
  const session = new PlayerSession({ isOpen: true, send() {} });
  const player = new Player(session, new Location(1385, 3274));
  player.setIndex(index); player.setUsername(`valeeffect${index}`); session.setPlayer(player);
  const packets = [];
  session.sendClientPacket = packet => { packets.push(packet); return true; };
  const npcs = [...World.getNpcs()].filter(npc => npc && Shared.DATA.animals.some(animal =>
    npc.getId() === Shared.npc(`ent_totems_site_${SITE}_animal_${animal.key}_1`)));
  assert.equal(npcs.length, 5, 'actual startup hook spawned five production NPCs for this site');
  player.getLocalNpcs().push(...npcs);
  const result = { player, session, packets, npcs };
  viewers.push(result);
  return result;
}

function seed(player, selected = [1, 2, 3]) {
  State.set(player, SITE, {
    animal_1: selected[0], animal_2: selected[1], animal_3: selected[2],
    ...Object.fromEntries(Shared.DATA.animals.map((animal, index) => [`multianimal_${animal.key}_1`, +selected.includes(index + 1)])),
  });
}

function reroll(player, random = 0) {
  const original = Math.random;
  try { Math.random = () => random; Ents.visitAll(player); }
  finally { Math.random = original; }
}

function tick(count = 1) { for (let i = 0; i < count; i++) TaskManager.process(); }
function shown(player) { return Shared.DATA.animals.flatMap((animal, i) => State.get(player, SITE, `multianimal_${animal.key}_1`) ? [i + 1] : []); }
function effects(viewer) { return viewer.packets.filter(packet => packet[0] === 24 || packet[0] === 25); }
function ids(viewer) { return effects(viewer).map(packet => packet.readUInt16BE(3)); }

test('captured rollover preserves old visibility two ticks, affects only removed/new species and one viewer', () => {
  const a = viewer(1), b = viewer(2); seed(a.player); seed(b.player);
  const globalAnimations = a.npcs.map(npc => npc.getAnimation());
  reroll(a.player);
  assert.deepEqual(State.animals(a.player, SITE), [2, 3, 4]);
  assert.deepEqual(shown(a.player), [1, 2, 3], 'old spirit mask during despawn');
  a.session.flush(1); b.session.flush(1);
  assert.deepEqual(ids(a), [Shared.core().CacheDefinitions.getSeqId('npc_nature_spirit_bison_despawn'), Shared.core().CacheDefinitions.getSpotanimId('vfx_nature_spirit_bison_despawn')]);
  assert.equal(effects(a)[1][5], 2, 'capture slot 2');
  assert.deepEqual(effects(b), []);
  a.packets.length = 0;
  tick(); a.session.flush(2);
  assert.deepEqual(shown(a.player), [1, 2, 3]); assert.deepEqual(effects(a), []);
  tick(); a.session.flush(3);
  assert.deepEqual(shown(a.player), [2, 3, 4]);
  assert.deepEqual(ids(a), [Shared.core().CacheDefinitions.getSeqId('npc_nature_spirit_snake_spawn'), Shared.core().CacheDefinitions.getSpotanimId('vfx_nature_spirit_snake_spawn')]);
  assert.deepEqual(shown(b.player), [1, 2, 3]);
  assert.deepEqual(a.npcs.map(npc => npc.getAnimation()), globalAnimations, 'shared NPC animation never changes');
});

test('a save and fresh login during despawn restore final coherent masks, and logout cancels its delayed effects', () => {
  const a = viewer(3); seed(a.player); reroll(a.player);
  State.set(a.player, SITE, { points: 17 });
  const snapshot = structuredClone(a.player.getAttribute('vale-totems:varps'));
  const b = viewer(4); b.player.setAttribute('vale-totems:varps', snapshot); hooks.login(b);
  assert.deepEqual(State.animals(b.player, SITE), [2, 3, 4]);
  assert.equal(State.get(b.player, SITE, 'points'), 17, 'another site save preserves the final mask and its own fields');
  assert.deepEqual(shown(b.player), [2, 3, 4], 'saved snapshot contains final visibility, not transient old mask');
  a.session.flush(1); a.packets.length = 0;
  hooks.logout(a); tick(3); a.session.flush(2); b.session.flush(2);
  assert.deepEqual(effects(a), []); assert.deepEqual(effects(b), [], 'login does not replay transient effects');
  assert.deepEqual(shown(a.player), [2, 3, 4]);
});

test('a second roll restores a reselected despawning actor and cancels the superseded visibility timer', () => {
  const a = viewer(5); seed(a.player); reroll(a.player); a.session.flush(1); a.packets.length = 0;
  tick(); reroll(a.player, 0.999999); a.session.flush(2);
  assert.deepEqual(ids(a), [Shared.core().CacheDefinitions.getSeqId('npc_nature_spirit_bison_spawn'), Shared.core().CacheDefinitions.getSpotanimId('vfx_nature_spirit_bison_spawn')]);
  a.packets.length = 0;
  tick(3); a.session.flush(3);
  assert.deepEqual(State.animals(a.player, SITE), [1, 2, 3]);
  assert.deepEqual(shown(a.player), [1, 2, 3]); assert.deepEqual(effects(a), []);
  reroll(a.player, 0.999999); tick(3); a.session.flush(4);
  assert.deepEqual(effects(a), [], 'an unchanged selection does not animate retained species');
});
