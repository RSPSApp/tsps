// Run after `yarn build`: node --test tests/scene-rebuild-centre.test.cjs
//
// A scene rebuild must give the client the scene the server goes on judging the player against.
// PlayerSession moves its scene base one axis at a time; it centred REBUILD_REGION on the player's
// zone instead, so a rebuild for one axis left the client's scene up to five zones off the server's
// on the other. A client that builds only the 104x104 scene it is sent (the official client through
// the RuneLite gateway) then walked off its scene before the next rebuild came: the Chambers of Xeric
// rooms past the Thieving room were drawn as a black void, with only their NPCs on it.
// Real Player and PlayerSession, a real TemplatedInstanceArea, the session's own packets.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");
const { TemplatedInstanceArea } = require("../dist/game/model/areas/impl/TemplatedInstanceArea");

const REBUILD_REGION = 140;
/** OSRS rebuilds once the player is this close to the scene's edge; tsps uses the same margin. */
const EDGE_TILES = 16;
const SIZE_CHUNKS = 24;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

/** The scene each REBUILD_REGION gives the client, and the player's distance to its edge each tick. */
function walk(points) {
  const area = new TemplatedInstanceArea(SIZE_CHUNKS, SIZE_CHUNKS);
  // Any cache chunk will do: only the palette's centre and coverage are checked.
  for (let x = 0; x < SIZE_CHUNKS; x++) {
    for (let y = 0; y < SIZE_CHUNKS; y++) area.setChunk(0, x, y, { sourceChunkX: 400, sourceChunkY: 400, sourcePlane: 0, rotation: 0 });
  }
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("scenecentre");
  player.setAttribute("bot-skip-persistence", true);
  player.needsPlacement = false;
  assert.equal(World.getPlayers().add(player), true);
  const frames = [];
  const send = session.sendClientPacket.bind(session);
  session.sendClientPacket = (frame) => { frames.push(frame); return send(frame); };

  const scenes = [];
  const margins = [];
  let scene = null;
  let tick = 0;
  let [x, y] = points[0];
  const steps = [[x, y]];
  for (const [tx, ty] of points.slice(1)) {
    while (x !== tx) { x += Math.sign(tx - x); steps.push([x, y]); }
    while (y !== ty) { y += Math.sign(ty - y); steps.push([x, y]); }
  }
  try {
    for (const [localX, localY] of steps) {
      const tile = area.tile(localX, localY, 0);
      player.setLocation(tile);
      player.setArea(area);
      frames.length = 0;
      session.flushClient(++tick);
      for (const frame of frames.filter((f) => f[0] === REBUILD_REGION)) {
        const payload = frame.subarray(3); // op, u16 size
        scene = { zoneX: payload.readUInt16BE(3), zoneZ: payload.readUInt16BE(0) };
        scenes.push({ tick, ...scene });
      }
      assert.ok(scene, `a scene by tick ${tick}`);
      const sceneX = tile.getX() - ((scene.zoneX - 6) << 3);
      const sceneY = tile.getY() - ((scene.zoneZ - 6) << 3);
      margins.push({ tick, at: [localX, localY], margin: Math.min(sceneX, sceneY, 103 - sceneX, 103 - sceneY) });
    }
  } finally {
    World.getPlayers().remove(player);
    area.destroy();
  }
  return { scenes, margins };
}

test("a rebuild for one axis keeps the scene the server judges the other axis by", () => {
  // North far enough to move the scene on y, back south a little, east until x moves the scene
  // (y then off the scene's centre), then the rest of the way south: the case that walked off.
  const { scenes, margins } = walk([[40, 40], [40, 110], [40, 90], [130, 90], [130, 20], [20, 20]]);
  assert.ok(scenes.length >= 4, `the walk rebuilds the scene several times (${scenes.length})`);
  const worst = margins.reduce((a, b) => (b.margin < a.margin ? b : a));
  assert.ok(worst.margin >= EDGE_TILES,
    `the player stays ${EDGE_TILES}+ tiles inside the scene the client was sent; at ${worst.at} on tick ${worst.tick} it was ${worst.margin}`);
});
