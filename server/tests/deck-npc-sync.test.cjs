// Run after `yarn build`: node --test tests/deck-npc-sync.test.cjs
// An NPC on a boat's deck reaches a client only once that client has the boat (#6599: Gurtob and
// Ros stood ashore at the chompy hunting grounds south of Castle Wars, the boat out of view).
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { BoatManager } = require("../dist/game/content/sailing/BoatManager");
const { BOAT_VIEW_DISTANCE } = require("../dist/game/content/sailing/WorldEntitySync");
const StaticShips = require("../plugins/skills/sailing/StaticShips.Sailing");

StaticShips.attach({ core: PluginManager.getCoreApi() });

const GURTOB = 15098;
const ROS = 15102;
const NPC_INFO = 21;
const WORLDENTITY_INFO = 143;
/** The chompy hunting grounds' player tile, north of Gurtob's moorings at Backwater. */
const VIEWER = new Location(2440, 3062, 0);

/** Gurtob's boat (bt_gurtob) with Gurtob and Ros aboard, its centre `distance` tiles south of the viewer. */
function gurtobsBoat(distance) {
  const ship = StaticShips.spawn("bt_gurtob", {
    fineX: VIEWER.getX() * 128 + 64, fineY: (VIEWER.getY() - distance) * 128 + 64, angle: 1536,
  });
  const npcs = [StaticShips.addDeckNpc(ship, GURTOB, 3, 3, undefined, { shared: true }),
    StaticShips.addDeckNpc(ship, ROS, 3, 2, undefined, { shared: true })];
  for (const npc of npcs) assert.equal(BoatManager.getBoatAboard(npc), ship.boat, "on the deck");
  return { ship, npcs };
}

function viewingPlayer(localNpcs) {
  const player = {
    getIndex: () => 1, getLocation: () => VIEWER,
    getArea: () => null, getPrivateArea: () => null,
    getLocalNpcs: () => localNpcs, getLocalPlayers: () => [],
    getAudioSettings: () => ({ 18: 1 }), getForceMovement: () => null,
    getNpcViewDistance: () => 64,
    getSession: () => player.session,
  };
  return player;
}

/** A real session for a viewer ashore at VIEWER who sees NPCs 64 tiles away (a world setting). */
function viewer(localNpcs, player = viewingPlayer(localNpcs)) {
  const session = new PlayerSession({ isOpen: true });
  session.setPlayer(player);
  player.session = session;
  const baseX = (VIEWER.getX() - 48) & ~7, baseY = (VIEWER.getY() - 48) & ~7;
  Object.assign(session, {
    hasReplayedScene: true, replayedSceneBaseX: baseX, replayedSceneBaseY: baseY, replayedSceneLevel: 0,
    lastGroundItemRegion: ((VIEWER.getX() >> 6) << 8) | (VIEWER.getY() >> 6), lastGroundItemLevel: 0,
    lastMusicArea: require("../dist/game/Music").Music.tracksAt(VIEWER.getX(), VIEWER.getY(), 0), lastMusicMode: 1,
  });
  const packets = [];
  session.sendClientPacket = (packet) => { packets.push(packet); return true; };
  let tick = 0;
  return {
    /** One tick's flush: the opcodes sent, in order, and the NPC indices the client now has. */
    flush() {
      packets.length = 0;
      session.playerSyncState = undefined; // Keep player appearance out of it.
      session.flush(++tick);
      return { opcodes: packets.map((packet) => packet[0]), npcs: [...session.npcSyncState.indices] };
    },
    player,
  };
}

test("deck NPCs past the boat view distance aren't sent, however far the viewer sees NPCs", () => {
  const { ship, npcs } = gurtobsBoat(BOAT_VIEW_DISTANCE + 8);
  try {
    const client = viewer(npcs.slice());
    for (let i = 0; i < 2; i++) {
      const { opcodes, npcs: sent } = client.flush();
      assert.ok(!opcodes.includes(WORLDENTITY_INFO), "the boat is out of the viewer's boat range");
      assert.ok(opcodes.includes(NPC_INFO));
      assert.deepEqual(sent, [], "Gurtob and Ros wait for their boat instead of standing ashore");
    }
  } finally {
    StaticShips.dispose(ship);
  }
});

test("deck NPCs are sent with their boat, after it, and leave when the boat does", () => {
  const { ship, npcs } = gurtobsBoat(10);
  try {
    const local = npcs.slice();
    const client = viewer(local);
    const first = client.flush();
    assert.ok(first.opcodes.indexOf(WORLDENTITY_INFO) >= 0, "the boat is spawned");
    assert.ok(first.opcodes.indexOf(WORLDENTITY_INFO) < first.opcodes.indexOf(NPC_INFO), "boat before its crew");
    assert.deepEqual(first.npcs.sort(), npcs.map((npc) => npc.getIndex()).sort(), "the crew come with it");

    // The boat sails out of boat range while the crew are still in NPC view.
    ship.boat.fineY -= (BOAT_VIEW_DISTANCE + 8) * 128;
    const gone = client.flush();
    assert.ok(gone.opcodes.indexOf(WORLDENTITY_INFO) < gone.opcodes.indexOf(NPC_INFO));
    assert.deepEqual(gone.npcs, [], "the crew are removed in the tick the boat is");
  } finally {
    StaticShips.dispose(ship);
  }
});

test("a new session on the same player (control taken over) is sent the boat again before its crew", () => {
  const { ship, npcs } = gurtobsBoat(10);
  try {
    const first = viewer(npcs.slice());
    assert.ok(first.flush().opcodes.includes(WORLDENTITY_INFO));
    const second = viewer(npcs.slice(), first.player);
    const { opcodes, npcs: sent } = second.flush();
    assert.ok(opcodes.includes(142), "the new client is sent the deck scene (REBUILD_WORLDENTITY)");
    assert.ok(opcodes.indexOf(WORLDENTITY_INFO) >= 0 && opcodes.indexOf(WORLDENTITY_INFO) < opcodes.indexOf(NPC_INFO));
    assert.deepEqual(sent.sort(), npcs.map((npc) => npc.getIndex()).sort());
  } finally {
    StaticShips.dispose(ship);
  }
});
