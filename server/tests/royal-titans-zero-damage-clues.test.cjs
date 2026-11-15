// Run after `yarn build`: node --test tests/royal-titans-zero-damage-clues.test.cjs
// A Royal Titans claimant who dealt no damage gets no clue scroll on any claim option: Loot already gave nothing at
// zero contribution, and Sacrifice and Take pages now match it (approved decision, 2026-11-15; the Wiki is silent).
// Under 1% (1-11 damage) the Wiki still gives two rolls of 1 each and clue rates "do not depend on contribution", so
// such a claimant keeps the clue rolls on every option.
// Real engine as in royal-titans-primary-rolls.test.cjs: every plugin loaded, a real encounter, real Players.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, Shared, Area;
const claims = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
  Shared = require("../plugins/bosses/royaltitans/Shared.RoyalTitans");
  Area = require("../plugins/bosses/royaltitans/Area.RoyalTitans");
  require("../plugins/npcs/NpcDrops.plugin").__internals.loadDrops();
  PM.createApi("TitanClueWatch").onCustomEvent("npc-drops:roll", (event) => { if (event.claim) claims.push(event); });
});
after(() => PM.emitServerShutdown({}));

let next = 9950;
function player(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("clues" + p.getIndex());
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

function claim(p, corpse, option) {
  const actions = (corpse.getCurrentDefinition?.(p) ?? corpse.getDefinition()).getActions();
  const clickType = actions.indexOf(option) + 1;
  assert.ok(clickType > 0, `the corpse has ${option}: ${JSON.stringify(actions)}`);
  claims.length = 0;
  assert.equal(PM.emitNpcInteraction({ player: p, npc: corpse, npcId: corpse.getId(), clickType, handled: false }), true);
  for (let tick = 0; tick < 8; tick++) core.TaskManager.process();
  assert.equal(claims.length, 1, `${option}: one claim`);
  return claims[0].drops.filter((drop) => /clue scroll/i.test(drop.name ?? core.ItemDefinition.forId(drop.itemId).getName()));
}

/**
 * A kill where `dealer` did 600 per titan, `idle` none and `chip` 3 per titan (under 1%: a whole-percent share of 0);
 * every roll succeeds (Math.random 0).
 */
function kill(t) {
  t.mock.method(Math, "random", () => 0);
  const dealer = player(t);
  const idle = player(t);
  const chip = player(t);
  const session = encounter(t, [dealer, idle, chip]);
  for (const titan of [session.branda, session.eldric]) {
    titan.setAttribute(Shared.DAMAGE_DEALT_ATTRIBUTE, { [dealer.getUsername()]: 600, [chip.getUsername()]: 3 });
  }
  die(session, session.branda, dealer);
  die(session, session.eldric, dealer);
  return { dealer, idle, chip, session };
}

for (const option of ["Loot", "Sacrifice", "Take pages"]) {
  test(`${option}: a claimant who dealt no damage gets no clue scroll`, (t) => {
    const { idle, session } = kill(t);
    assert.deepEqual(claim(idle, session.branda, option), []);
  });

  test(`${option}: a claimant who dealt damage still rolls the clue scrolls`, (t) => {
    const { dealer, session } = kill(t);
    assert.ok(claim(dealer, session.eldric, option).length > 0, "every roll succeeds, so a clue scroll comes");
  });
}

// Wiki (Royal Titans): under 1% (1-11 damage) a player "will still roll for two items on the main table, but only
// receive 1 of each item"; clue rates "do not depend on contribution".
for (const option of ["Loot", "Sacrifice", "Take pages"]) {
  test(`${option}: a claimant under 1% (3 damage of 1206 per titan) still rolls the clue scrolls`, (t) => {
    const { chip, session } = kill(t);
    assert.equal(require("../plugins/bosses/royaltitans/Corpse.RoyalTitans")._test.shareOf(session, chip), 0, "the whole-percent share is 0");
    assert.ok(claim(chip, session.branda, option).length > 0);
  });
}

test("Loot under 1% gives 1 of each item rolled, not nothing", (t) => {
  const { chip, session } = kill(t);
  claim(chip, session.branda, "Loot");
  const items = claims[0].drops.filter((drop) => !/clue scroll/i.test(drop.name ?? core.ItemDefinition.forId(drop.itemId).getName()));
  assert.ok(items.length > 0, "main-table items come");
  for (const drop of items) assert.equal(drop.amount, 1, `${drop.itemId}: 1 of each`);
});
