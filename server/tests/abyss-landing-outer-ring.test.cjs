// Run after `yarn build`: node --test tests/abyss-landing-outer-ring.test.cjs
// Wiki (Abyss): the Mage of Zamorak's teleport lands in the outer ring, a multicombat area, and the player must get
// through an obstacle to the inner ring. Live lands at 3063,4824 (rsprox_transcripts/226/01636.txt, activity "-");
// the teleport put players straight into the inner ring among the rifts.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { TeleportHandler } = require("../dist/game/model/teleportation/TeleportHandler");

let core, teleport;
const landings = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const real = PluginManager.createApi("AbyssLandingTest");
  const api = new Proxy({ core,
    onNpcInteraction: (name, actions) => { if (name === "Mage of Zamorak") teleport = actions.Teleport; },
    emitCustomEvent: (name, request) => {
      if (name === "quest:is-complete") request.complete = true;
      if (name === "lever:teleport") landings.push(request.destination);
    },
  }, { get: (object, name) => object[name] ?? real[name] ?? (() => {}) });
  require("../plugins/skills/Runecrafting.plugin").register(api);
  TeleportHandler.checkReqs = () => true;
});

test("the Mage of Zamorak lands the player in the Abyss's outer ring", (t) => {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("abysslanding");
  p.setLocation(new core.Location(3106, 3556, 0));
  t.after(() => core.TaskManager.cancelTasks(p));
  teleport({ player: p });
  const to = landings.at(-1);
  assert.deepEqual([to.getX(), to.getY(), to.getZ()], [3063, 4824, 0]);
});
