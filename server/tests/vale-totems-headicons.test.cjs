process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { Location } = require('../dist/game/model/Location');
const { World } = require('../dist/game/World');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Vale = require('../plugins/minigames/ValeTotems.plugin');
const Shared = require('../plugins/minigames/valetotems/Shared.ValeTotems');
const State = require('../plugins/minigames/valetotems/State.ValeTotems');
const Ents = require('../plugins/minigames/valetotems/Ents.ValeTotems');
const login = [], logout = [], starts = [];
let icon;
before(async () => {
  await CachePipeline.initialize();
  const api = { ...PluginManager.createApi('ValeTotemsHeadIconTest'),
    onServerStartup: fn => starts.push(fn),
    onPlayerLogin: fn => login.push(fn), onPlayerLogout: fn => logout.push(fn),
  };
  Vale.register(api);
  for (const start of starts) start();
  const icons = [...World.getNpcs()].filter(n => n?.getId() === Shared.npc('ent_totems_site_icon'));
  assert.equal(icons.length, 8, 'startup creates the actual captured site NPCs');
  icon = icons.find(n => n.getLocation().getX() === 1385 && n.getLocation().getY() === 3274);
  assert.ok(icon);
});
function viewer(index) {
  const session = new PlayerSession({ isOpen: true, send() {} });
  const player = new Player(session, new Location(1385, 3274));
  player.setIndex(index); player.setUsername(`valeicon${index}`); session.setPlayer(player);
  const packets = []; session.sendClientPacket = p => { packets.push(p); return true; };
  player.getLocalNpcs().push(icon);
  return { player, session, packets };
}
const frames = v => v.packets.filter(p => p[0] === 26).map(p => p.readUInt16BE(6));
function flush(v, tick) { v.session.flush(tick); v.session.flush(tick + 1); }
function carve(player, durability) {
  State.erect(player, 3, 1);
  for (const animal of [1,2,3]) State.carve(player, 3, animal, durability);
}

test('captured leaves follow actual carved state, visits and collapse for two independent players', () => {
  const a = viewer(1), b = viewer(2);
  carve(a.player, 2); carve(b.player, 6);
  flush(a, 1); flush(b, 1);
  assert.deepEqual(frames(a), [1]); assert.deepEqual(frames(b), [5]);
  a.packets.length = b.packets.length = 0;
  Ents.visitAll(a.player); flush(a, 3); flush(b, 3);
  assert.deepEqual(frames(a), [0]); assert.deepEqual(frames(b), []);
  a.packets.length = 0; Ents.visitAll(a.player); flush(a, 5);
  assert.deepEqual(frames(a), [65535]); assert.equal(State.totem(a.player, 3).decay, 0);
  assert.equal(icon.getHeadIcon(), -1, 'consumer never changes the global NPC icon');
});

test('visit and collapse leaves leave in the same tick, carve one tick later, with no duplicate on the next sync', () => {
  const a = viewer(5);
  carve(a.player, 2);
  a.session.flush(1);
  assert.deepEqual(frames(a), [], 'the carve leaf is the sync-path leaf, one tick after its varbit');
  a.session.flush(2);
  assert.deepEqual(frames(a), [1]);
  a.packets.length = 0;
  Ents.visitAll(a.player); a.session.flush(3);
  assert.deepEqual(frames(a), [0], 'visit leaf is sent by the flush of the visit tick');
  a.session.flush(4);
  assert.deepEqual(frames(a), [0], 'the following sync repeats nothing');
  a.packets.length = 0;
  Ents.visitAll(a.player); a.session.flush(5);
  assert.deepEqual(frames(a), [65535], 'collapse clear is sent by the flush of the visit tick');
  a.session.flush(6);
  assert.deepEqual(frames(a), [65535]);
});

test('a visit sends a changed site once, and a site out of view sends nothing', () => {
  const a = viewer(6), b = viewer(7);
  carve(a.player, 4); carve(b.player, 4);
  flush(a, 1); flush(b, 1);
  b.player.getLocalNpcs().splice(0);
  a.packets.length = b.packets.length = 0;
  Ents.visitAll(a.player); Ents.visitAll(b.player);
  a.session.flush(3); b.session.flush(3); a.session.flush(4); b.session.flush(4);
  assert.deepEqual(frames(a), [2]);
  assert.deepEqual(frames(b), [], 'out of view: nothing sent');
  b.player.getLocalNpcs().push(icon); flush(b, 5);
  assert.deepEqual(frames(b), [2], 'back in view: current durability only');
});

test('real remove/return and saved-state login resend current durability without replaying stale customization', () => {
  const a = viewer(3); carve(a.player, 7); flush(a, 1); assert.deepEqual(frames(a), [6]);
  a.packets.length = 0; a.player.getLocalNpcs().splice(0); flush(a, 3);
  assert.deepEqual(frames(a), []);
  a.player.getLocalNpcs().push(icon); flush(a, 5); assert.deepEqual(frames(a), [6]);
  const saved = structuredClone(a.player.getAttribute('vale-totems:varps'));
  for (const fn of logout) fn(a);
  const b = viewer(4); b.player.setAttribute('vale-totems:varps', saved);
  for (const fn of login) fn(b);
  flush(b, 1); assert.deepEqual(frames(b), [6]);
  assert.equal(State.totem(b.player, 3).decay, 7);
});
