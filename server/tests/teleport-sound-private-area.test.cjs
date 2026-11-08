// Run after `yarn build`: node --test tests/teleport-sound-private-area.test.cjs
// A standard teleport's cast sound is an area sound (range 10). It was sent with no source, so the private-area filter
// never ran and a player outside the caster's private area, on the same tile, heard it. Real Players and the real
// TeleportHandler.teleport.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { World } = require("../dist/game/World");
const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
const { TeleportHandler } = require("../dist/game/model/teleportation/TeleportHandler");
const { TeleportType } = require("../dist/game/model/teleportation/TeleportType");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

let next = 9850;
function make(t, name) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setIndex(next++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(3200, 3200, 0));
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

function heardBy(t, player) {
  const heard = [];
  t.mock.method(player.getPacketSender(), "sendAreaSound", (...args) => { heard.push(args); return player.getPacketSender(); });
  return heard;
}

test("a teleport cast in a private area is heard there, not by a player outside it", (t) => {
  assert.ok(TeleportType.NORMAL.getOptions().areaSoundRange, "the standard teleport's sound is an area sound");
  const caster = make(t, "privatecaster"), inside = make(t, "insider"), outside = make(t, "outsider");
  const area = new PrivateArea();
  caster.setArea(area);
  inside.setArea(area);
  t.mock.method(World, "getPlayers", () => [caster, inside, outside]);
  const insideHeard = heardBy(t, inside), outsideHeard = heardBy(t, outside);
  TeleportHandler.teleport(caster, new core.Location(3212, 3424, 0), TeleportType.NORMAL, false);
  assert.ok(insideHeard.length > 0, "a player in the same private area hears it");
  assert.equal(outsideHeard.length, 0, "a player outside it does not");
});
