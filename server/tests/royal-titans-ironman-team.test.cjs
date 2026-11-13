// Run after `yarn build`: node --test tests/royal-titans-ironman-team.test.cjs
// Wiki (Ironman Mode): "Iron accounts receive group-boss rewards when fighting with others", Royal Titans among them.
// Each claim is the claimant's own roll; the titan's death roll (the top damager's, thrown away for the claims) must
// not tell an Ironman top damager they get no loot because others helped. Real engine: every plugin loaded, a real
// encounter, deaths through PluginManager.emitNpcDeath and claims through emitNpcInteraction, real Players.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, Area, Shared;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
  Area = require("../plugins/bosses/royaltitans/Area.RoyalTitans");
  Shared = require("../plugins/bosses/royaltitans/Shared.RoyalTitans");
});
after(() => PM.emitServerShutdown({}));

let next = 9800;
function player(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("titans" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

/** A real encounter for `players`, both titans spawned by the plugin and in the world. */
function encounter(t, players) {
  const session = {
    area: { isDestroyed: () => false, add() {}, remove() {}, getPlayers: () => players },
    owner: players[0], players, branda: null, eldric: null, spawnedAt: 0, over: false, respawnAt: 0,
    claimedBy: null, corpses: [], rows: new Set(), minions: new Set(), staticLocs: [], tileLocs: new Map(), pendingRows: [],
  };
  Area.spawnEncounter(session);
  for (const npc of [session.branda, session.eldric]) {
    const queue = core.World.getAddNPCQueue();
    if (queue.includes(npc)) queue.splice(queue.indexOf(npc), 1);
    core.World.getNpcs().add(npc);
    t.after(() => core.World.getNpcs().remove(npc));
  }
  for (const p of players) p.setLocation(session.branda.getLocation().clone());
  return session;
}

/** A titan's death as NPCDeathTask emits it, every player a damager. */
function die(session, npc, killer) {
  const at = npc.getLocation();
  PM.emitNpcDeath({ killer, damagers: session.players, npc, npcId: npc.getId(), location: { x: at.getX(), y: at.getY(), z: at.getZ() }, remains: null });
}

/** A Loot click on a corpse through the plugin's own npc option, then the claim's ticks. */
function loot(p, corpse) {
  const actions = (corpse.getCurrentDefinition?.(p) ?? corpse.getDefinition()).getActions();
  const clickType = actions.indexOf("Loot") + 1;
  assert.ok(clickType > 0, `the corpse has Loot: ${JSON.stringify(actions)}`);
  assert.equal(PM.emitNpcInteraction({ player: p, npc: corpse, npcId: corpse.getId(), clickType, handled: false }), true);
  for (let tick = 0; tick < 8; tick++) core.TaskManager.process();
}

const SHARED_KILL = "As an Ironman, you don't get loot if other players helped you kill the monster.";

test("an Ironman in a team kill gets no shared-kill refusal at the titans' deaths, and claims their own loot", (t) => {
  const iron = player(t), other = player(t);
  iron.setAttribute("ironman:mode", "ironman");
  const messages = [];
  t.mock.method(iron, "sendMessage", (message) => messages.push(message));
  const claimed = [];
  PM.createApi("TitanIronWatch").onCustomEvent("npc-drops:roll", ({ player, drops, claim }) => {
    if (claim === true && player === iron) claimed.push(drops.length);
  });
  const session = encounter(t, [iron, other]);
  for (const titan of [session.branda, session.eldric]) {
    titan.setAttribute(Shared.DAMAGE_DEALT_ATTRIBUTE, { [iron.getUsername()]: 600, [other.getUsername()]: 600 });
  }
  t.mock.method(Math, "random", () => 0.5);
  die(session, session.branda, iron);
  die(session, session.eldric, iron);
  assert.equal(messages.includes(SHARED_KILL), false, `no shared-kill line: ${JSON.stringify(messages)}`);
  loot(iron, session.branda);
  assert.equal(claimed.length, 1, "the Ironman's claim rolls");
  assert.ok(claimed[0] > 0, "and keeps its loot");
  assert.equal(messages.includes(SHARED_KILL), false);
});
