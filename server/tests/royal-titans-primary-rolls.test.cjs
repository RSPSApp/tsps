// Run after `yarn build`: node --test tests/royal-titans-primary-rolls.test.cjs
// Wiki: Branda and Eldric roll their table twice per kill (rolls=2 on the repeated rows, their Pre-roll uniques once).
// The corpse's Loot already adds "one extra roll" to its own roll; once the export carries `rolls: 2` the own roll is
// both, so the claim must ask for no extra primary roll (else 4 in all). Real engine as in
// royal-titans-pet-at-claim.test.cjs: every plugin loaded, a real encounter, real Players.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, Shared, Area, Drops;
const asked = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
  Shared = require("../plugins/bosses/royaltitans/Shared.RoyalTitans");
  Area = require("../plugins/bosses/royaltitans/Area.RoyalTitans");
  Drops = require("../plugins/npcs/NpcDrops.plugin");
  Drops.__internals.loadDrops();
  PM.createApi("TitanPrimaryWatch").onCustomEvent("npc-drops:extra-rolls", (request) => asked.push(request.rolls));
});
after(() => PM.emitServerShutdown({}));

let next = 9900;
function player(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("primary" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

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

function die(session, npc, killer) {
  const at = npc.getLocation();
  PM.emitNpcDeath({ killer, damagers: session.players, npc, npcId: npc.getId(), location: { x: at.getX(), y: at.getY(), z: at.getZ() }, remains: null });
}

function loot(p, corpse) {
  const actions = (corpse.getCurrentDefinition?.(p) ?? corpse.getDefinition()).getActions();
  const clickType = actions.indexOf("Loot") + 1;
  assert.ok(clickType > 0, `the corpse has Loot: ${JSON.stringify(actions)}`);
  assert.equal(PM.emitNpcInteraction({ player: p, npc: corpse, npcId: corpse.getId(), clickType, handled: false }), true);
  for (let tick = 0; tick < 8; tick++) core.TaskManager.process();
}

/** One claim of `titan`'s corpse; the extra primary rolls it asked NpcDrops for. */
function extraRollsOf(t, titan) {
  t.mock.method(Math, "random", () => 0.99); // no Bran, no clue
  const p = player(t);
  const session = encounter(t, [p]);
  die(session, session.branda, p);
  die(session, session.eldric, p);
  asked.length = 0;
  loot(p, titan === "branda" ? session.branda : session.eldric);
  return [...asked];
}

for (const [titan, id] of [["branda", () => Shared.BRANDA_ID], ["eldric", () => Shared.ELDRIC_ID]]) {
  test(`${titan}: the export's rolls=2 is the two primary rolls, so a claim asks for no extra roll`, (t) => {
    const table = Drops.__internals.tablesByNpc.get(id())[0];
    assert.equal(table.rolls, 2, "the dump carries the Wiki's rolls=2");
    assert.deepEqual(extraRollsOf(t, titan), []);
  });

  test(`${titan}: with no exported count one extra roll tops the own roll up to two`, (t) => {
    const table = Drops.__internals.tablesByNpc.get(id())[0];
    const rolls = table.rolls;
    delete table.rolls;
    t.after(() => { table.rolls = rolls; });
    assert.deepEqual(extraRollsOf(t, titan), [1]);
  });

  test(`${titan}: the table-rolls answer is the exported count`, () => {
    const request = { npcId: id(), rolls: 0 };
    PM.emitCustomEvent("npc-drops:table-rolls", request);
    assert.equal(request.rolls, 2);
  });
}
