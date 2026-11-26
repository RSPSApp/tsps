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
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { TemplatedInstanceArea } = require("../dist/game/model/areas/impl/TemplatedInstanceArea");

const REBUILD_REGION = 140;
/** OSRS rebuilds once the player is this close to the scene's edge; tsps uses the same margin. */
const EDGE_TILES = 16;
const SIZE_CHUNKS = 24;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
});

/** The scene each REBUILD_REGION gives the client, and the player's distance to its edge each tick. */
function walk(points) {
  const area = new TemplatedInstanceArea(SIZE_CHUNKS, SIZE_CHUNKS);
  // Any cache chunk will do: only the palette's centre and coverage are checked.
  for (let x = 0; x < SIZE_CHUNKS; x++) {
    for (let y = 0; y < SIZE_CHUNKS; y++) area.setChunk(0, x, y, { sourceChunkX: 400, sourceChunkY: 400, sourcePlane: 0, rotation: 0 });
  }
  const loc = new GameObject(26661, area.tile(points[0][0], points[0][1], 0), 10, 0, area); // active ore vein
  ObjectManager.register(loc, true);
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
      const sync = frames.findIndex(frame => frame[0] === 20);
      const additions = frames.flatMap((frame, index) => frame[0] === 134 ? [index] : []);
      assert.ok(additions.every(index => index > sync), "instance locs follow authoritative player sync too");
      if (tick === 1) assert.equal(additions.length, 1, "initial instance login replays its runtime loc once");
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

test("Motherlode's runtime veins replay after player sync on initial login, relog and scene reload", t => {
  const Veins = require("../plugins/areas/motherlode/Veins.MotherlodeMine");
  const Mine = require("../plugins/areas/motherlode/State.MotherlodeMine");
  RegionManager.loadMapFiles(Mine.MINE.minX, Mine.MINE.minY);
  const originals = [];
  for (let x = Mine.MINE.minX; x <= Mine.MINE.maxX; x++) {
    for (let y = Mine.MINE.minY; y <= Mine.MINE.maxY; y++) {
      for (const id of [26665, 26666, 26667, 26668]) {
        const original = MapObjects.get(id, new Location(x, y), null);
        if (original) originals.push(original);
      }
    }
  }
  assert.ok(originals.length > 0, "the cache map starts with depleted veins");
  t.after(() => {
    for (const vein of Veins.veins.values()) {
      const object = MapObjects.get(vein.oreId, new Location(...vein.tile), null);
      if (object) ObjectManager.deregister(object, true);
    }
    for (const original of originals) ObjectManager.register(original, true);
    Veins.veins.clear();
  });
  Veins.spawnAll(); // The real Motherlode startup producer, without a server or client.
  const vein = Veins.veins.values().next().value;
  assert.ok(vein);
  const at = new Location(...vein.tile);
  assert.equal(MapObjects.get(vein.oreId, at, null).getId(), vein.oreId);
  for (let login = 0; login < 2; login++) {
    const frames = [];
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel), player = new Player(session);
    session.setPlayer(player);
    player.setUsername(`veinlogin${login}`);
    player.setAttribute("bot-skip-persistence", true);
    player.needsPlacement = false;
    player.setLocation(at.clone());
    assert.equal(World.getPlayers().add(player), true);
    const send = session.sendClientPacket.bind(session);
    session.sendClientPacket = frame => { frames.push(frame); return send(frame); };
    const checkReplay = tick => {
      frames.length = 0;
      session.flushClient(tick);
      const sync = frames.findIndex(frame => frame[0] === 20); // PLAYER_SYNC
      const additions = frames.flatMap((frame, index) => frame[0] === 134
        && frame.readUInt16BE(2) === vein.oreId
        && frame.readUInt16BE(4) === at.getX() && frame.readUInt16BE(6) === at.getY() ? [index] : []);
      assert.equal(additions.length, 1, "one active-vein override, rather than the depleted map loc");
      assert.ok(sync >= 0 && additions[0] > sync,
        `login ${login}, tick ${tick}: gateway must initialize its scene from player sync before loc replay`);
      assert.ok(frames.filter(frame => frame[0] === 135).every(frame => frames.indexOf(frame) > sync),
        "base-map removals follow player sync too");
    };
    try {
      checkReplay(1);
      frames.length = 0;
      session.flushClient(2);
      assert.equal(frames.some(frame => frame[0] === 134), false, "an unchanged scene does not replay locs again");
      player.setLocation(new Location(3222, 3218));
      session.flushClient(3);
      player.setLocation(at.clone());
      checkReplay(4);
    } finally {
      World.getPlayers().remove(player);
    }
  }
});
