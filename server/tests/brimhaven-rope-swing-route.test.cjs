// Run after `yarn build`: node --test tests/brimhaven-rope-swing-route.test.cjs
// A rope swing click through the real packet, routing and walk-to path, on cache clipping.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const core = PluginManager.getCoreApi();

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.RegionManager.init();
});

/** A player clicking a loc through the real packet listener, run until `cycles` have passed. */
function click(at, objectId, loc, option, cycles = 30) {
  for (const key of ["objectInteractionHooks", "objectRouteHooks"]) PluginManager[key] = [];
  for (const key of ["objectHooksByName", "objectHooksById", "customEventHooks"]) PluginManager[key] = new Map();
  const api = PluginManager.createApi("brimhaven-rope-swing-route");
  require("../plugins/minigames/brimhavenagilityarena/Shared.BrimhavenAgilityArena").init(api);
  require("../plugins/minigames/brimhavenagilityarena/Obstacles.BrimhavenAgilityArena")(api);

  const player = new Player(null);
  player.setUsername("offline1447");
  player.setIndex(1447);
  player.isRegistered = () => true;
  let sender;
  sender = new Proxy({}, { get: (target, key) => target[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.getSkillManager().setCurrentLevel(core.Skill.AGILITY, 99, false);
  core.RegionManager.loadMapFiles(loc[0], loc[1], false);
  player.setLocation(new core.Location(at[0], at[1], 3));
  player.setNeedsPlacement(false);

  const seen = [];
  new ObjectActionPacketListener().executeAction(player, objectId, loc[0], loc[1], 1, option);
  for (let n = 0; n < cycles; n++) {
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process(); player.getMovementQueue().beginCycle();
    player.getMovementQueue().process(); core.TaskManager.processWalkTo(player.getIndex());
    const tile = player.getLocation();
    seen.push(`${tile.getX()},${tile.getY()}`);
  }
  const end = player.getLocation();
  return { seen, end: [end.getX(), end.getY(), end.getZ()] };
}

test("a rope swing clicked from the platform corner walks to the rope's axis and swings", () => {
  const { seen, end } = click([2804, 9587], 3566, [2806, 9585], "Swing-on");
  assert.ok(seen.includes("2806,9587"), `walks to two tiles before the rope: ${seen.join(" ")}`);
  assert.deepEqual(end, [2806, 9582, 3], "lands three tiles past the rope");
});

test("monkey bars are walked to from the platform beside their blocked first bar, then crossed (rsprox 1735)", () => {
  // Each set's end pieces (3564), a start on each side's platform, and where the swing lands.
  const BARS = [
    { ends: [[2771, 9570], [2771, 9577]], sides: [[[2772, 9569], [2772, 9578]], [[2773, 9579], [2772, 9569]]] },
    { ends: [[2774, 9545], [2781, 9545]], sides: [[[2772, 9547], [2782, 9546]], [[2783, 9547], [2773, 9546]]] },
    { ends: [[2793, 9559], [2793, 9566]], sides: [[[2795, 9557], [2794, 9567]], [[2795, 9568], [2794, 9558]]] },
  ];
  for (const { ends, sides } of BARS) {
    for (const loc of ends) {
      for (const [from, landing] of sides) {
        const { seen, end } = click(from, 3564, loc, "Swing-across", 40);
        assert.deepEqual(end, [...landing, 3], `bars at ${loc} from ${from}: ${[...new Set(seen)].join(" ")}`);
      }
    }
  }
});
