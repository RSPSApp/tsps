// Run after `yarn build`: node --test tests/projectile-source-actor.test.cjs
// A projectile names the actor firing it, so the client starts it from where that actor is drawn:
// a caster that attacks on the tick it steps into range is still walking there on screen.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { encodeProjectiles } = require("../dist/net/protocol/ClientProtocol");
const { PacketSender } = require("../dist/net/packet/PacketSender");
const { Projectile } = require("../dist/game/model/Projectile");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");

/** The fields after the cycles in a one-projectile packet: [source kind, source index, target kind, target index]. */
function actorFields(packet) {
  // Packets start with their id (and a size for variable ones); the payload is the last 2 + 29 bytes.
  const entry = packet.subarray(packet.length - 29);
  return [entry[23], entry.readUInt16BE(24), entry[26], entry.readUInt16BE(27)];
}

const view = (extra) => ({
  projectileId: 280, source: { x: 3200, y: 3200, level: 0 }, target: { x: 3205, y: 3200, level: 0 },
  sourceHeight: 172, endHeight: 124, slope: 16, startPos: 64, startCycleOffset: 51, endCycleOffset: 96, ...extra,
});

test("the packet carries the source actor beside the target", () => {
  const packet = encodeProjectiles([view({ sourceActor: { kind: "player", index: 7 }, targetActor: { kind: "npc", index: 300 } })]);
  assert.deepEqual(actorFields(packet), [1, 7, 2, 300]);
  assert.deepEqual(actorFields(encodeProjectiles([view({})])), [0, 0, 0, 0], "neither: tiles only");
});

function capturingSender() {
  const sent = [];
  const player = { getSession: () => ({ sendClientPacket: (packet) => { sent.push(packet); return true; }, write() {} }) };
  return { sender: new PacketSender(player), sent };
}

const mobile = (index, isPlayer, x = 3200) => ({
  getIndex: () => index,
  isPlayer: () => isPlayer,
  getLocation: () => new Location(x, 3200, 0),
  getSize: () => 1,
  getPrivateArea: () => null,
});

test("sendProjectile names its source when given one", () => {
  const { sender, sent } = capturingSender();
  const start = new Location(3200, 3200, 0);
  const end = new Location(3205, 3200, 0);
  sender.sendProjectile(start, end, 0, 96, 280, 43, 31, mobile(300, false, 3205), 51, 16, 64, mobile(7, true));
  assert.deepEqual(actorFields(sent[0]), [1, 7, 2, 300]);
  sender.sendProjectile(start, end, 0, 96, 280, 43, 31, null, 51);
  assert.deepEqual(actorFields(sent[1]), [0, 0, 0, 0], "callers that pass no source are unchanged");
});

test("createProjectile fires from its caster, so the client follows the caster until launch", () => {
  const caster = mobile(7, true);
  const victim = mobile(300, false, 3205);
  const calls = [];
  const recipient = {
    getPrivateArea: () => null,
    getLocation: () => new Location(3201, 3201, 0),
    getNpcViewDistance: () => 15,
    getPacketSender: () => ({ sendProjectile: (...args) => calls.push(args) }),
  };
  const original = World.forEachNetworkPlayer;
  World.forEachNetworkPlayer = (visit) => visit(recipient);
  try {
    Projectile.createProjectile(caster, victim, 280, 51, 96, 43, 31).sendProjectile();
    new Projectile(new Location(3200, 3200, 0), new Location(3205, 3200, 0), victim, 280, 51, 96, 43, 31, null).sendProjectile();
  } finally {
    World.forEachNetworkPlayer = original;
  }
  assert.equal(calls[0][11], -(7 + 1), "the caster, as a player lock-on index");
  assert.equal(calls[1][11], null, "a projectile from a tile has no source actor");
});
