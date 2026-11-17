// Real native packet queue, registered Player, World phases, map objects and encoded sync.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
const worldFile = path.resolve(__dirname, '../data/definitions/world.local.json');
const originalWorld = fs.existsSync(worldFile) ? fs.readFileSync(worldFile) : null;
const config = originalWorld ? JSON.parse(originalWorld.toString('utf8')) : {};
fs.writeFileSync(worldFile, JSON.stringify({ ...config, plugins: { ...config.plugins, WorldAdmin: { enabled: false } } }));
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { decodeClientPackets, encodePlayerSync, createPlayerSyncState } = require('../dist/net/protocol/ClientProtocol');
const { Skill } = require('../dist/game/model/Skill');
const { RIDGE } = require('../plugins/skills/agility/shortcuts/Wilderness.Agility')._test;
const errors = [], originalError = console.error;
let core, observation, started = false, serial = 0;
const streams = new WeakMap();

function bas(payload) {
  let offset = 3;
  assert.notEqual(payload.readUInt16BE(offset), 0xffff, 'fixture is not transformed');
  for (let copy = 0; copy < 2; copy++) for (let slot = 0; slot < 12; slot++) {
    const high = payload[offset++]; if (high !== 0) offset++;
  }
  offset += 5;
  return Array.from({ length: 7 }, (_, i) => payload.readUInt16BE(offset + i * 2));
}

function readMovement(bits) {
  let position = 0;
  const read = count => {
    let value = 0;
    for (let i = 0; i < count; i++, position++) value = (value << 1) | ((bits[position >> 3] >> (7 - (position & 7))) & 1);
    return value;
  };
  if (read(1) === 0) return { opcode: null, block: false };
  const block = read(1) === 1, opcode = read(2);
  const direction = opcode === 1 ? read(3) : opcode === 2 ? read(4) : undefined;
  return { opcode, block, direction };
}

function readBlock(block) {
  let offset = 0, mask = block[offset++];
  if (mask & 0x80) mask |= block[offset++] << 8;
  if (mask & 0x4000) mask |= block[offset++] << 16;
  // The fixture has no combat, tint or graphics. Refuse to misparse an unexpected block.
  assert.equal(mask & ~(0x01 | 0x02 | 0x04 | 0x08 | 0x40 | 0x80 | 0x1000 | 0x2000 | 0x4000), 0, 'only known clean movement blocks');
  if (mask & 0x01) while (block[offset++] !== 0) {}
  if (mask & 0x02) offset += 2;
  if (mask & 0x40) offset += 3;
  if (mask & 0x08) offset += 3;
  const out = { mask };
  if (mask & 0x1000) out.persistentType = (-block[offset++]) & 255;
  if (mask & 0x04) {
    const length = (-block[offset++]) & 255;
    out.bas = bas(block.subarray(offset, offset + length)); offset += length;
  }
  if (mask & 0x2000) out.temporaryType = (128 - block[offset++]) & 255;
  assert.equal(offset, block.length, 'the whole actual update block was consumed');
  return out;
}

function rawOpen(id, x, y) {
  const raw = Buffer.alloc(8); raw[0] = 96; // active native OPLOC1
  raw[1] = (x + 128) & 255; raw[2] = x >> 8; raw.writeUInt16LE(y, 3);
  raw[5] = 0; raw[6] = id >> 8; raw[7] = (id + 128) & 255;
  const packets = decodeClientPackets(raw);
  assert.equal(packets.length, 1);
  assert.deepEqual(packets[0], { type: 'object_option', id, x, y, clickType: 1 });
  return packets;
}

async function exitTrace() {
  const rows = new Map(), messages = [], doors = [], sounds = [];
  const row = tick => { if (!rows.has(tick)) rows.set(tick, { tick }); return rows.get(tick); };
  let player, tracking = false, cachedType = 1;
  const captureFrame = frame => {
      if (!tracking || !Buffer.isBuffer(frame) || frame[0] !== 20) return true;
      const blocks = player.getSession().playerSyncState.updateBlocks.map(value => Buffer.from(value));
      const syncLength = frame.readUInt16BE(13);
      assert.deepEqual(frame.subarray(15, 15 + syncLength), Buffer.concat(blocks), 'captured encoder blocks equal actual wire bytes');
      assert.ok(blocks.length <= 2, 'the isolated player sync contains only the actual local actor');
      const tick = frame.readInt32BE(9), movement = readMovement(blocks[0]);
      const extended = blocks.length === 2 ? readBlock(blocks[1]) : {};
      if (extended.persistentType !== undefined) cachedType = extended.persistentType;
      Object.assign(row(tick), { ...movement, ...extended, cachedType });
      return true;
    };
  const channel = { kind: 'websocket', binaryTransport: true, remoteAddress: '127.0.0.1',
    isOpen: () => true, close() {}, onData() {}, onError() {}, onClose() {}, send: () => true };
  const session = new PlayerSession(channel); player = new Player(session); session.setPlayer(player);
  const sendFrame = session.sendClientPacket.bind(session);
  session.sendClientPacket = frame => { captureFrame(frame); return sendFrame(frame); };
  player.setUsername('ridge-timing-qa'); player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(2998, 3931, 0)); player.setNeedsPlacement(false);
  const manager = player.getSkillManager();
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.HITPOINTS]) {
    manager.setExperiences(skill, core.SkillManager.getExperienceForLevel(99), false);
    manager.setMaxLevel(skill, 99); manager.setCurrentLevels(skill, 99);
  }
  manager.setExperiences(Skill.AGILITY, 0, false); manager.setMaxLevel(Skill.AGILITY, 1); manager.setCurrentLevels(Skill.AGILITY, 1);
  player.setRunning(true); player.setRunEnergy(95);
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel); connection.player = player;
  session.setTurnPacketProcessor(() => connection.processTurnPackets());
  const api = PM.createApi('RidgeExitTimingTest');
  api.onCustomEvent('network:sync-views', event => {
    if (!tracking || event.player !== player) return;
    const view = event.players.find(view => view.index === player.getIndex());
    assert.ok(view, 'actual sync includes local actor');
    Object.assign(row(event.tick), { x: view.x, y: view.y, skillAnimation: player.getSkillAnimation(), appearance: bas(view.appearance), busy: player.getAttribute('agility.obstacle') != null, energy: player.getRunEnergyUnits() });
  });
  const sender = player.getPacketSender(), typed = sender.sendTypedMessage.bind(sender);
  sender.sendTypedMessage = (type, message, ...rest) => {
    if (tracking) messages.push({ tick: core.World.getProcessCycle(), type, message, y: player.getLocation().getY() });
    return typed(type, message, ...rest);
  };
  const register = core.ObjectManager.register;
  core.ObjectManager.register = function (object, ...rest) {
    if (tracking && object.getId() === RIDGE.prisonDoorOpen && object.getLocation().getX() === 2998 && object.getLocation().getY() === 3916)
      doors.push({ tick: core.World.getProcessCycle(), y: player.getLocation().getY() });
    return register.call(this, object, ...rest);
  };
  const sendSound = sender.sendSoundEffect.bind(sender);
  sender.sendSoundEffect = (...args) => { if (tracking) sounds.push({ tick: core.World.getProcessCycle(), args }); return sendSound(...args); };
  const turn = () => { core.World.refreshActiveRegions(); core.World.process(); };
  try {
    const gate = core.MapObjects.get(RIDGE.gateLeft, new core.Location(...RIDGE.gateLeftTile), null);
    assert.ok(gate, 'actual active-map north gate exists');
    assert.equal(gate.getDefinition().getName(), 'Gate');
    turn(); turn(); tracking = true;
    connection.inject(rawOpen(RIDGE.gateLeft, ...RIDGE.gateLeftTile)); await connection.idle();
    assert.equal(player.getAttribute('agility.obstacle') == null, true, 'queued native input has not acted before the real player turn');
    let entered = false;
    for (let i = 0; i < 32; i++) {
      turn(); entered ||= player.getAttribute('agility.obstacle') != null;
      if (entered && !player.getAttribute('agility.obstacle')) { turn(); turn(); break; }
    }
    assert.equal(entered, true, 'native queued input started the actual runner');
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2998, 3916]);
    assert.equal(player.getMovementQueue().isMovementBlocked(), false);
    assert.equal(manager.getExperience(Skill.AGILITY), 0, 'exit does not invent XP');
    assert.ok(core.MapObjects.get(RIDGE.door, new core.Location(...RIDGE.doorTile), null), 'south door restored');
    assert.deepEqual(errors, [], 'real gameplay/startup hooks completed without hidden errors');
    return { rows: [...rows.values()], messages, doors, sounds };
  } finally {
    tracking = false; session.sendClientPacket = sendFrame; sender.sendTypedMessage = typed; sender.sendSoundEffect = sendSound; core.ObjectManager.register = register;
    core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex());
    if (player.isRegistered()) core.World.getPlayers().remove(player);
    core.World.refreshActiveRegions();
  }
}

before(async () => {
  console.error = (...args) => { errors.push(args.map(String).join(' ')); return originalError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  core.ObjectDefinition.init(); core.RegionManager.init(); core.RegionManager.loadMapFiles(2998, 3923);
  PM.emitServerStartup({}); started = true;
  PM.createApi('RidgeMovementReceipts').onCustomEvent('network:sync-views', event => {
    streams.get(event.player)?.push({ tick: event.tick, players: event.players.map(view => ({ ...view })) });
  });
  observation = await exitTrace();
  console.log('Ridge timing observation', JSON.stringify(observation));
});
after(() => {
  try { if (started) PM.emitServerShutdown({}); assert.deepEqual(errors, [], 'including shutdown hooks'); }
  finally { console.error = originalError; if (originalWorld) fs.writeFileSync(worldFile, originalWorld); else if (fs.existsSync(worldFile)) fs.unlinkSync(worldFile); }
});

test('ridge exit sends the end line at3918, one tick before the south-door opening', () => {
  const ends = observation.messages.filter(row => row.message === RIDGE.endOut);
  assert.equal(ends.length, 1, 'one end line, without a later completion duplicate');
  assert.equal(ends[0].type, core.ChatType.SPAM);
  assert.equal(ends[0].y, 3918, 'captured end line is before the final crossing');
  assert.equal(observation.doors[0].tick, ends[0].tick + 1, 'south door opens the next tick');
});

test('south-door opening carries the compact two-tile WALK update without placement', () => {
  const atDoor = observation.rows.find(row => row.tick === observation.doors[0].tick);
  assert.equal(atDoor.y, 3916, 'both final tiles arrive with the door opening');
  assert.equal(atDoor.opcode, 2, 'captured compact two-tile movement, not relative teleport');
  assert.equal(atDoor.direction, 2, 'two tiles south');
  assert.equal(atDoor.cachedType, 2, 'persistent run preference is retained');
  assert.equal(atDoor.temporaryType, 1, 'only this movement uses WALK traversal');
});

test('normal appearance is restored with the early end line before the final step', () => {
  const end = observation.messages.find(row => row.message === RIDGE.endOut);
  const atEnd = observation.rows.find(row => row.tick === end.tick);
  assert.deepEqual([atEnd.appearance[0], atEnd.appearance[2], atEnd.appearance[6]], [808, 819, 824]);
  assert.ok(atEnd.bas, 'actual appearance update accompanies the end line');
  assert.ok(end.tick < observation.doors[0].tick, 'normal walking appearance precedes the south-door step');
});

test('the final step releases the crossing and resumes energy recovery without another appearance reset', () => {
  const tick = observation.doors[0].tick;
  const before = observation.rows.find(row => row.tick === tick - 1), final = observation.rows.find(row => row.tick === tick);
  assert.equal(before.busy, true, 'message/wait remains owned by the obstacle');
  assert.equal(final.busy, false, 'release is on the final crossing cycle');
  assert.ok(final.energy > before.energy, 'ordinary recovery resumes in that World cycle');
  assert.equal(final.bas, undefined, 'already-restored appearance is not resent at release');
  assert.ok(observation.sounds.some(row => row.tick === tick && row.args[0] === 62));
});

function turn() { core.World.refreshActiveRegions(); core.World.process(); }
function actor(t, x = 3222, y = 3218) {
  const channel = { kind: 'websocket', binaryTransport: true, isOpen: () => true, remoteAddress: '127.0.0.1',
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel), p = new Player(session); session.setPlayer(p);
  p.setUsername('ridgelife' + ++serial); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true); p.setLocation(new core.Location(x, y)); p.setNeedsPlacement(false); p.setRunning(true);
  assert.equal(core.World.getPlayers().add(p), true);
  const connection = new ClientConnection(channel); connection.player = p;
  session.setTurnPacketProcessor(() => connection.processTurnPackets());
  const views = [], wire = []; streams.set(p, views);
  const send = session.sendClientPacket.bind(session);
  session.sendClientPacket = frame => {
    if (Buffer.isBuffer(frame) && frame[0] === 20 && session.playerSyncState?.updateBlocks?.length)
      wire.push({ tick: core.World.getProcessCycle(), frame: Buffer.from(frame), blocks: session.playerSyncState.updateBlocks.map(block => Buffer.from(block)) });
    return send(frame);
  };
  t.after(() => {
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    if (p.isRegistered()) core.World.getPlayers().remove(p);
    core.World.refreshActiveRegions();
  });
  return { p, session, connection, views, wire };
}
function schedule(player, action) {
  const task = new core.Task(1, player);
  task.execute = () => { task.stop(); action(); };
  core.TaskManager.submit(task);
}
function shortWalk(player, extra = {}) {
  const { run } = require('../plugins/skills/agility/ObstacleRunner.Agility');
  const here = player.getLocation();
  return run({ player, core }, [{ walk: [[here.getX() + 2, here.getY()]], tilesPerTick: 2, arrive: true, traversalType: 1, ...extra }], { agility: true });
}
async function queueMove(f, x, y) {
  const raw = Buffer.from([16, y >> 8, (y + 128) & 255, 0, x >> 8, (x + 128) & 255, 128, 0]);
  const packets = decodeClientPackets(raw);
  assert.deepEqual(packets, [{ type: 'move', worldX: x, worldY: y, modifierFlags: 0 }]);
  f.connection.inject(packets); await f.connection.idle();
}
const viewAt = (f, tick, player) => f.views.find(row => row.tick === tick)?.players.find(view => view.index === player.getIndex());

test('two actual observers see the final traversal before reset; the next ordinary run does not inherit it', async t => {
  core.RegionManager.loadMapFiles(3222, 3218);
  const f = actor(t), observer = actor(t, 3222, 3220); turn(); turn();
  schedule(f.p, () => {
    shortWalk(f.p);
    assert.equal(f.p.getAttribute('agility.obstacle'), null);
    assert.equal(f.p.getTemporaryMovementType(), 1, 'successful release retains the actual movement');
  });
  turn(); const tick = core.World.getProcessCycle();
  for (const recipient of [f, observer]) {
    const view = viewAt(recipient, tick, f.p); assert.ok(view, 'real self/foreign view exists');
    assert.equal(view.movementType, 2); assert.equal(view.temporaryMovementType, 1);
  }
  assert.equal(f.p.getTemporaryMovementType(), undefined, 'reset occurs after all views');
  const start = f.p.getLocation().clone();
  await queueMove(f, start.getX() + 2, start.getY()); turn();
  assert.notDeepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [start.getX(), start.getY()]);
  assert.equal(viewAt(f, core.World.getProcessCycle(), f.p).temporaryMovementType, undefined);
});

test('a queued native replacement move in the completion cycle invalidates the receipt', async t => {
  const f = actor(t); turn(); turn();
  const x = f.p.getLocation().getX(), y = f.p.getLocation().getY();
  await queueMove(f, x + 2, y + 2);
  schedule(f.p, () => { shortWalk(f.p); assert.equal(f.p.getTemporaryMovementType(), 1); });
  turn(); const view = viewAt(f, core.World.getProcessCycle(), f.p);
  assert.ok(view);
  assert.notDeepEqual([view.x, view.y], [x + 2, y], 'native input replaced the completed scripted step');
  assert.equal(view.temporaryMovementType, undefined, 'replacement uses its own traversal');
});

test('same-cycle equal-coordinate teleport, new-location identity and active force movement invalidate traversal', async t => {
  for (const kind of ['teleport', 'location-copy', 'force']) await t.test(kind, t => {
    const f = actor(t); turn(); turn();
    schedule(f.p, () => {
      shortWalk(f.p); assert.equal(f.p.getTemporaryMovementType(), 1);
      const at = f.p.getLocation();
      if (kind === 'teleport') f.p.moveTo(at.clone());
      else if (kind === 'location-copy') f.p.setLocation(at.clone());
      else f.p.setForceMovement(new core.ForceMovement(at.clone(), new core.Location(0, 1), 0, 30, 0, -1));
      assert.equal(f.p.getTemporaryMovementType(), undefined);
    });
    turn(); assert.equal(viewAt(f, core.World.getProcessCycle(), f.p).temporaryMovementType, undefined);
    f.p.setForceMovement(null);
  });
});

test('ordinary area changes retain the receipt while private-world changes do not', t => {
  const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');
  const f = actor(t); turn(); turn();
  schedule(f.p, () => {
    shortWalk(f.p); assert.equal(f.p.getTemporaryMovementType(), 1);
    const oldArea = f.p.getArea(); f.p.setArea(new core.Area([]));
    assert.equal(f.p.getTemporaryMovementType(), 1, 'ordinary AreaManager ownership is unrelated');
    f.p.setArea(oldArea);
    const privateArea = new PrivateArea([]); f.p.setArea(privateArea);
    assert.equal(f.p.getTemporaryMovementType(), undefined, 'another private world cannot inherit it');
    f.p.setArea(oldArea);
  });
  turn();
});

test('cancelling before movement creates no receipt; stopping an already-finished step keeps its current update', t => {
  const { run } = require('../plugins/skills/agility/ObstacleRunner.Agility');
  const f = actor(t); turn(); turn();
  schedule(f.p, () => {
    const at = f.p.getLocation();
    const pending = run({ player: f.p, core }, [{ wait: 2 }, { walk: [[at.getX() + 2, at.getY()]], tilesPerTick: 2, traversalType: 1 }], { agility: true });
    pending.stop(); assert.equal(f.p.getTemporaryMovementType(), undefined);
    assert.equal(f.p.getMovementQueue().isMovementBlocked(), false);
    const finished = shortWalk(f.p); finished.stop();
    assert.equal(f.p.getTemporaryMovementType(), 1);
  });
  turn(); assert.equal(f.p.getTemporaryMovementType(), undefined);
});

test('logout clears a receipt created by a logout hook and save snapshots exclude it', t => {
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const f = actor(t); turn(); turn(); let observed = false;
  PM.createApi('RidgeLogoutReceipt').onPlayerLogout(({ player }) => {
    if (player !== f.p || observed) return;
    observed = true; shortWalk(player);
    assert.equal(player.getTemporaryMovementType(), 1, 'real logout hook can create movement before core cleanup');
    const saved = PlayerSave.fromPlayer(player);
    assert.equal(JSON.stringify(saved).includes('temporaryMovementType'), false);
  });
  f.p.onLogout(); assert.equal(observed, true);
  assert.equal(f.p.getTemporaryMovementType(), undefined);
});

test('codec keeps ordinary walking/running defaults and gives reset-path127 precedence', () => {
  function encode(dx, props = {}) {
    const state = createPlayerSyncState(1, { x: 3000, y: 3000, level: 0 });
    const view = { index: 1, x: 3000 + dx, y: 3000, level: 0, appearance: Buffer.alloc(0), movementType: dx === 2 ? 2 : 1, ...props };
    encodePlayerSync(1, 2944, 2944, 1, [view], state);
    return { state, movement: readMovement(state.updateBlocks[0]), block: readBlock(state.updateBlocks[1]) };
  }
  assert.equal(encode(1).movement.opcode, 1);
  const ordinaryRun = encode(2); assert.equal(ordinaryRun.movement.opcode, 2); assert.equal(ordinaryRun.block.temporaryType, undefined);
  const walkOverride = encode(2, { temporaryMovementType: 1 });
  assert.equal(walkOverride.movement.opcode, 2); assert.equal(walkOverride.block.temporaryType, 1);
  assert.equal(walkOverride.state.movementTypes.get(1), 2);
  assert.equal(encode(2, { temporaryMovementType: 1, resetPath: true }).block.temporaryType, 127);
});

test('partial-waypoint traversal records successful one-tile progress within a two-tile budget', async t => {
  const { run } = require('../plugins/skills/agility/ObstacleRunner.Agility');
  for (const opted of [false, true]) await t.test(opted ? 'explicit RUN traversal' : 'unchanged default traversal', t => {
    const f = actor(t); turn(); turn(); const x = f.p.getLocation().getX(), y = f.p.getLocation().getY();
    schedule(f.p, () => run({ player: f.p, core }, [{
      walk: [[x + 1, y], [x + 3, y]], tilesPerTick: 2,
      ...(opted ? { traversalType: 2 } : {}),
    }], { agility: true }));
    turn(); const wire = f.wire.find(row => row.tick === core.World.getProcessCycle()); assert.ok(wire);
    assert.deepEqual(wire.frame.subarray(15, 15 + wire.frame.readUInt16BE(13)), Buffer.concat(wire.blocks));
    assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [x + 1, y]);
    assert.equal(readMovement(wire.blocks[0]).opcode, 1, 'one-tile geometry stays one-tile');
    const block = wire.blocks[1] ? readBlock(wire.blocks[1]) : {};
    assert.equal(block.temporaryType, opted ? 2 : undefined, 'the successful waypoint pass owns its explicit traversal');
  });
});
