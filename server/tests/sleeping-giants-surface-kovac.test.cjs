// Run after `yarn build`: node --test tests/sleeping-giants-surface-kovac.test.cjs
// Sleeping Giants: Kovac waits on the Giants' Plateau as a Hill Giant (11467, "Strike") only until the
// quest starts. The intro walks him into the foundry with the player, so his copy belongs to the player
// and leaves with the quest instead of standing outside afterwards (issue 4270).
// Real engine: every plugin loaded, real Players in the World, the quest's own login and start hook.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

/** The surface Hill Giant, Kovac in disguise (NpcIdentifiers.HILL_GIANT_12). */
const SURFACE_KOVAC = 11467;

let core;
let next = 9130;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function makePlayer(t) {
  const channel = { kind: "test", binaryTransport: true, remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("sgsurface" + next++);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(3368, 3152, 0));
  player.setNeedsPlacement(false);
  t.mock.method(player, "onAdd", () => {});
  t.mock.method(player, "onRemove", () => {});
  assert.equal(core.World.getPlayers().add(player), true);
  core.World.refreshActiveRegions();
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player);
    core.World.getPlayers().remove(player);
    core.World.refreshActiveRegions();
    for (const npc of [...core.World.getNpcs()]) if (npc?.getOwner?.() === player) PM.removeNpc(npc);
  });
  return player;
}

function surfaceKovacs(player) {
  return [...core.World.getNpcs()].filter((npc) => npc?.getId?.() === SURFACE_KOVAC && npc.getOwner?.() === player);
}

function login(player) {
  PM.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount: false });
}

test("the spawn file leaves the surface Hill Giant to the quest", () => {
  assert.equal(core.NpcIdentifiers.HILL_GIANT_12, SURFACE_KOVAC);
  const spawns = require("../data/definitions/npc-spawns.json");
  assert.equal(spawns.some((row) => row.id === SURFACE_KOVAC), false, "no world spawn");
  const decisions = require("../data/definitions/npc-spawn-sync.json");
  assert.equal(decisions.ids[String(SURFACE_KOVAC)].skip, true, "a sync run must not add him back");
});

test("Kovac is the player's own while the quest is unstarted and leaves when it starts", (t) => {
  const player = makePlayer(t);
  login(player);
  const spawned = surfaceKovacs(player);
  assert.equal(spawned.length, 1, "one copy on login");
  assert.equal(spawned[0].isOwnerOnly(), true, "only the player sees him");
  assert.deepEqual([spawned[0].getLocation().getX(), spawned[0].getLocation().getY()], [3362, 3146], "the plateau tile");

  PM.emitCustomEvent("npc-dialogue:hook", { player, hook: "quest:sleeping-giants:start" });
  assert.deepEqual(surfaceKovacs(player), [], "he went into the foundry with the player");

  login(player);
  assert.deepEqual(surfaceKovacs(player), [], "still gone after a relog");
});

test("starting the quest leaves another player's Kovac alone", (t) => {
  const started = makePlayer(t);
  const waiting = makePlayer(t);
  login(started);
  login(waiting);
  assert.equal(surfaceKovacs(started).length, 1);
  assert.equal(surfaceKovacs(waiting).length, 1);
  PM.emitCustomEvent("npc-dialogue:hook", { player: started, hook: "quest:sleeping-giants:start" });
  assert.equal(surfaceKovacs(started).length, 0);
  assert.equal(surfaceKovacs(waiting).length, 1, "the other player's quest has not started");
});

test("logging out takes the player's own Kovac with them", (t) => {
  const player = makePlayer(t);
  login(player);
  assert.equal(surfaceKovacs(player).length, 1);
  PM.emitPlayerLogout({ player, username: player.getUsername() });
  assert.equal(surfaceKovacs(player).length, 0, "no invisible copy left behind");
});
