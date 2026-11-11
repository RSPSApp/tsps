// Run after yarn build: node --test tests/hunter-pitfalls.test.cjs
// Pitfalls against rsprox captures 1108, 1757, 1858, 4046, 4051 (issues #4433, #4441, #4442, #4443): the pit is the map's
// 2x2 multiloc on its own varbit, with a coord timer; the creature steps in and falls 8 ticks after the jump and the pit
// shows full at 11; a miss is a leap across, and only that pit refuses the creature next.
const assert = require('node:assert/strict');
const { before, afterEach, test } = require('node:test');
const path = require('node:path');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
const C = require('../plugins/skills/hunter/Context.Hunter');
const { H } = C;
const Traps = require('../plugins/skills/hunter/Traps.Hunter');
const Pitfalls = require('../plugins/skills/hunter/Pitfalls.Hunter');

// Feldip Hills larupia pit hunting_pitfall_8 (19260, varbit hunt_pitfall_state8 2965), rotation 2, crossed north-south.
const PIT = { id: 19260, x: 2543, y: 2908, varbit: 2965 };
const NORTH = [2543, 2910], SOUTH = [2543, 2907];
let core, index = 9300, pit;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(PIT.x, PIT.y);
  H.core = core;
  H.data = require('../plugins/skills/hunter/Data.Hunter').build(core);
  H.api = { emitCustomEvent() {} };
  pit = core.MapObjects.get(PIT.id, new core.Location(PIT.x, PIT.y, 0), null);
  assert.ok(pit, 'the map places pit 19260 at 2543,2908');
});

afterEach(() => {
  for (const trap of [...H.traps]) Traps.remove(trap);
  for (const player of [...H.players]) Pitfalls.clear({ player });
  H.actions.clear(); H.players.clear(); H.reserved.clear(); H.hidden.clear();
});

function hunter(t, [x, y]) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername('pitfall' + p.getIndex()); p.setRegistered(true);
  p.setLocation(new core.Location(x, y, 0)); p.needsPlacement = false;
  p.getSkillManager().setCurrentLevels(core.Skill.HUNTER, 99).setMaxLevel(core.Skill.HUNTER, 99);
  p.getInventory().adds(core.ItemIdentifiers.KNIFE, 1).adds(core.ItemIdentifiers.TEASING_STICK, 1).adds(core.ItemIdentifiers.LOGS, 5);
  const sent = { messages: [], scripts: [], projectiles: 0, sounds: [] };
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendMessage', text => { sent.messages.push(text); return sender; });
  const script = sender.sendClientScript.bind(sender);
  t.mock.method(sender, 'sendClientScript', (...args) => { sent.scripts.push(args); return script(...args); });
  t.mock.method(sender, 'sendProjectile', () => { sent.projectiles++; return sender; });
  const sound = sender.sendSound.bind(sender);
  t.mock.method(sender, 'sendSound', (...args) => { sent.sounds.push(args[0]); return sound(...args); });
  H.players.add(p);
  return { p, sent };
}

function larupia(t, [x, y]) {
  const npc = new NPC(core.NpcIdentifiers.SPINED_LARUPIA, new core.Location(x, y, 0));
  npc.setRegistered(true);
  const seen = { animations: [], graphics: [] };
  const animate = npc.performAnimation.bind(npc), graphic = npc.performGraphic.bind(npc);
  t.mock.method(npc, 'performAnimation', a => { seen.animations.push([H.tick, a.getId()]); return animate(a); });
  t.mock.method(npc, 'performGraphic', g => { seen.graphics.push([H.tick, g.getId()]); return graphic(g); });
  return { npc, seen };
}

function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    // The world's update clears a moved player's placement flag each tick.
    for (const player of H.players) player.setNeedsPlacement(false);
    H.tick++; C.processActions(); Traps.process(); C.processHidden(); Pitfalls.process();
  }
}

function layPit(p) {
  Traps.lay(p, 'pit', pit.getLocation(), pit);
  tick(1);
  return [...H.traps].find(trap => trap.player === p);
}

function tease(p, npc) {
  Pitfalls.tease({ player: p, npc, npcId: npc.getId() });
  tick(1);
}

/** Jumps the pit with the catch roll forced; returns the tick the jump started. */
function jump(p, success) {
  const api = H.api;
  H.api = { emitCustomEvent(name, request) { if (name === 'hunter:catch-chance') request.chance = success ? 1 : 0; } };
  const at = H.tick;
  try {
    Pitfalls.jump({ player: p, object: pit });
    tick(2);
  } finally { H.api = api; }
  return at;
}

const varbit = p => p.getPacketSender().getVarbit(PIT.varbit);
const coord = (x, y) => (x << 14) | y;

test('a set pit is the map multiloc on its varbit, with the coord timer and no spawned loc (#4441)', t => {
  const { p, sent } = hunter(t, NORTH);
  const trap = layPit(p);
  assert.ok(trap, 'the pit is set');
  assert.equal(varbit(p), 1, 'hunt_pitfall_state8 shows the spiked pit');
  assert.deepEqual(trap.objects, [pit], 'the 2x2 map loc stays the trap');
  assert.ok(core.MapObjects.exists(pit), 'the base loc is still on the map');
  assert.equal(core.ObjectDefinition.forPlayer(PIT.id, p).getName(), 'Spiked pit');
  assert.deepEqual(sent.scripts.slice(-2), [[6678, coord(PIT.x, PIT.y)], [5478, coord(PIT.x, PIT.y), 4, 301, 16765184, 1]]);
  assert.equal(trap.expires - H.tick, 300);
});

test('Jump on the set pit is reached from whichever side the player stands (#4441)', t => {
  for (const [from, arrive] of [[[2543, 2912], NORTH], [[2543, 2905], SOUTH]]) {
    const { p } = hunter(t, from);
    const object = (() => { p.setLocation(new core.Location(...arrive, 0)); const trap = layPit(p); p.setLocation(new core.Location(...from, 0)); return trap.objects[0]; })();
    let arrived = null;
    const api = PluginManager.createApi('PitfallRouteTest');
    const saved = PluginManager.objectHooksByName;
    PluginManager.objectHooksByName = new Map();
    t.after(() => { PluginManager.objectHooksByName = saved; });
    api.onObjectInteraction('Spiked pit', { Jump: ({ player }) => { arrived = player.getLocation().clone(); return true; } });
    const steps = [];
    new ObjectActionPacketListener().executeAction(p, object.getId(), object.getLocation().getX(), object.getLocation().getY(), 1);
    for (let i = 0; i < 10 && !arrived; i++) {
      core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
      core.TaskManager.process();
      p.getMovementQueue().beginCycle();
      p.getMovementQueue().process();
      core.TaskManager.processWalkTo(p.getIndex());
      steps.push(`${p.getLocation().getX()},${p.getLocation().getY()}`);
    }
    assert.ok(arrived, `Jump fires from ${from}`);
    assert.deepEqual([arrived.getX(), arrived.getY()], arrive, `from ${from} the player stops on its own side (${steps.join(' > ')})`);
    for (const trap of [...H.traps]) Traps.remove(trap);
  }
});

test('teasing makes the creature follow with the teasing sound and no message (#4443)', t => {
  const { p, sent } = hunter(t, NORTH);
  const { npc } = larupia(t, [2543, 2911]);
  tease(p, npc);
  assert.equal(npc.getFollowing(), p, 'the engine follow chases the player');
  assert.ok(sent.sounds.includes(2524));
  assert.deepEqual(sent.messages, []);
});

test('a catch falls in 8 ticks after the jump and shows full at 11; the same pit catches the next creature (#4442, #4433)', t => {
  const { p, sent } = hunter(t, NORTH);
  const trap = layPit(p);
  for (let round = 0; round < 2; round++) {
    const { npc, seen } = larupia(t, [2543, 2911]);
    tease(p, npc);
    const at = jump(p, true);
    // A bare moveTo drops an NPC from clients for a tick; an exact move keeps it in view.
    const moves = { exact: 0, bare: 0 };
    let inExact = false;
    const exact = npc.exactMove.bind(npc), move = npc.moveTo.bind(npc);
    t.mock.method(npc, 'exactMove', (...args) => { moves.exact++; inExact = true; try { return exact(...args); } finally { inExact = false; } });
    t.mock.method(npc, 'moveTo', l => { if (!inExact) moves.bare++; return move(l); });
    assert.equal(npc.isVisible(), true, 'the creature is still there after the jump');
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], SOUTH, 'the player lands three tiles from the start');
    tick(at + 7 - H.tick);
    assert.equal(varbit(p), 1, 'not collapsed before +8');
    assert.deepEqual(moves, { exact: 3, bare: 0 }, 'three steps, each an exact move');
    tick(1);
    assert.equal(varbit(p), 2, '+8: collapsing');
    assert.deepEqual(seen.animations.at(-1), [at + 8, 5234]);
    // The player jumped south across a rotation-2 pit: the other way from the loc's, so state 4 and collapse_2.
    assert.deepEqual(seen.graphics.at(-1), [at + 8, 935]);
    assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], [PIT.x, PIT.y], 'it falls on the loc coord, along the loc column');
    tick(3);
    assert.equal(varbit(p), 4, '+11: the full pit');
    assert.equal(trap.state, 'caught');
    assert.deepEqual(sent.scripts.at(-1), [5478, coord(PIT.x, PIT.y), 4, 143, 2031427, 1]);
    assert.equal(npc.isVisible(), false);
    tick(1);
    assert.equal(npc.isVisible(), true, 'back at its spawn a tick later');
    sent.messages.length = 0;
    Traps.dismantle({ player: p, object: pit });
    tick(1);
    assert.equal(varbit(p), 0, 'dismantled');
    assert.ok(!sent.messages.includes('Lure this creature across a different pit.'));
    p.setLocation(new core.Location(...NORTH, 0));
    layPit(p);
  }
});

test('a miss leaps over the pit with no projectile, follows on, and only refuses that pit next (#4442, #4433)', t => {
  const { p, sent } = hunter(t, NORTH);
  const trap = layPit(p);
  const { npc, seen } = larupia(t, [2543, 2911]);
  tease(p, npc);
  const projectiles = [];
  t.mock.method(p.getPacketSender(), 'sendProjectile', (start, end, offset, speed, id, sh, eh, lock, delay) => {
    projectiles.push([id, start.getX(), start.getY(), end.getX(), end.getY(), delay, speed]); return p.getPacketSender(); });
  const at = jump(p, false);
  tick(at + 5 - H.tick);
  assert.deepEqual(seen.animations.at(-1), [at + 5, 5231], '+5: the big-cat leap');
  assert.equal(npc.isVisible(), true, 'the creature never vanishes');
  const size = npc.getSize(), from = npc.getLocation();
  // Both halves of the creature fly four tiles across, 53 to 90 cycles (1108 tick 21492).
  assert.deepEqual(projectiles, [
    [939, from.getX() + size - 1, from.getY() + size - 1, from.getX() + size - 1, from.getY() + size - 1 - 4, 53, 90],
    [940, from.getX(), from.getY(), from.getX(), from.getY() - 4, 53, 90]]);
  tick(2);
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], [PIT.x, PIT.y - size], '+7: landed beyond the pit');
  assert.ok(npc.getExactMove(), 'the landing keeps the creature in view');
  if (size > 1) assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [SOUTH[0], SOUTH[1] - 2], 'the landing knocks the player back two tiles');
  assert.equal(varbit(p), 1, 'the pit is still set');
  assert.equal(trap.state, 'idle');
  tick(1);
  assert.equal(npc.getFollowing(), p, 'the chase goes on without another tease');
  p.setLocation(new core.Location(...SOUTH, 0));
  Pitfalls.jump({ player: p, object: pit });
  assert.equal(sent.messages.at(-1), 'Lure this creature across a different pit.');
});

test('the full pit value follows the jump direction and the loc rotation (captures 1108, 1757, 1858)', () => {
  const at = (face) => ({ getFace: () => face });
  // Rotation 2 (graahk pit 15, kyatt pits 2 and 3): north 3, south 4.
  assert.equal(Pitfalls.fullValue(at(2), 0), 3); assert.equal(Pitfalls.fullValue(at(2), 2), 4);
  // Rotation 1 (graahk pit 16): west 3, east 4. Rotation 3 (antelope pits 17, 18): east 3, west 4.
  assert.equal(Pitfalls.fullValue(at(1), 3), 3); assert.equal(Pitfalls.fullValue(at(1), 1), 4);
  assert.equal(Pitfalls.fullValue(at(3), 1), 3); assert.equal(Pitfalls.fullValue(at(3), 3), 4);
});
