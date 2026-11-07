// Run after `yarn build`: node --test tests/mounted-xerics-honour.test.cjs
// Wiki (Xeric's talisman): "Players must use an ancient tablet on the talisman before being able to teleport here."
// The worn talisman keeps Xeric's Honour shut until that unlock exists; the mounted one teleported there for anyone.
// It now asks the worn talisman's plugin (xerics-talisman:honour-unlocked). Real KourendTravelItems answer.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let core, Mounted, House, Ids;
const handlers = new Map();
const events = new Map();
let forceUnlocked = false;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    onCustomEvent(name, fn) { (events.get(name) ?? events.set(name, []).get(name)).push(fn); },
    emitCustomEvent(name, request) {
      for (const fn of events.get(name) ?? []) fn(request);
      if (name === "xerics-talisman:honour-unlocked" && forceUnlocked) request.unlocked = true;
    },
    onObjectInteraction(name, options) { handlers.set(name, options); },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require("../plugins/items/KourendTravelItems.plugin").register(api);
  require("../plugins/skills/construction/Core.Construction").init(api);
  Ids = require("../plugins/skills/construction/Ids.Construction");
  House = require("../plugins/skills/construction/House.Construction");
  Mounted = require("../plugins/skills/construction/Mounted.Construction");
  Mounted.attachMountedItems(api);
});

function visit(t, option, loc) {
  const statements = [], teleports = [];
  const player = { getDialogueManager: () => ({ startDialogues: (chain) => statements.push(chain) }), sendMessage() {} };
  t.mock.method(House, "houseFor", () => ({ owner: player }));
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "teleport", (_p, target) => teleports.push([target.getX(), target.getY()]));
  handlers.get("Xeric's Talisman")[option]({ player, definition: { getName: () => "Xeric's Talisman" }, objectId: Ids.loc(loc), handled: false });
  return { statements, teleports };
}

test("the mounted talisman's Xeric's Honour is shut, as the worn talisman's is, until the unlock answers yes", (t) => {
  const locked = visit(t, "Honour", "poh_amulet_xeric_honour");
  assert.equal(locked.teleports.length, 0, "no teleport to Honour");
  assert.equal(locked.statements.length, 1, "the refusal box");
  forceUnlocked = true;
  try {
    assert.equal(visit(t, "Honour", "poh_amulet_xeric_honour").teleports.length, 1, "teleports once unlocked");
  } finally {
    forceUnlocked = false;
  }
});

test("the mounted talisman's other destinations need nothing", (t) => {
  for (const [option, loc] of [["Look out", "poh_amulet_xeric_lookout"], ["Glade", "poh_amulet_xeric_glade"], ["Inferno", "poh_amulet_xeric_inferno"], ["Heart", "poh_amulet_xeric_heart"]]) {
    assert.equal(visit(t, option, loc).teleports.length, 1, option);
  }
});
