// Run after `yarn build`: node --test tests/royal-titans-pet-at-claim.test.cjs
// Bran (the Royal Titans' pet) is had at a corpse's claim, one roll per claim (Wiki: Sacrificing doubles the pet rate),
// not at the titan's death. Pets took Bran out of the death roll and gave it to the last hitter before the corpse's
// stash saw it; the death roll can't be told from a claim's by its npc (titanDied has already turned it into the
// corpse), so the claims mark theirs. Real engine: every plugin loaded, a real encounter (Area.spawnEncounter), deaths
// through PluginManager.emitNpcDeath and claims through emitNpcInteraction, real Players.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const BRAN = 30622;
let core, Shared, Area;
const obtained = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
  Shared = require("../plugins/bosses/royaltitans/Shared.RoyalTitans");
  Area = require("../plugins/bosses/royaltitans/Area.RoyalTitans");
  PM.createApi("BranWatch").onCustomEvent("pets:obtained", ({ player, itemId }) => {
    if (itemId === BRAN) obtained.push(player.getUsername());
  });
});
after(() => PM.emitServerShutdown({}));

let next = 9700;
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

test("no Bran at the titans' deaths, even when their death roll has it; one at the claim", (t) => {
  obtained.length = 0;
  const p = player(t);
  const session = encounter(t, [p]);
  t.mock.method(Math, "random", () => 0); // every roll hits: Bran is in both death rolls
  die(session, session.branda, p);
  die(session, session.eldric, p);
  assert.equal(Shared.isCorpse(session.branda.getId()), true, "the titan is a corpse during its own death roll");
  assert.equal(session.over, true, "both down: the claims are open");
  assert.deepEqual(obtained, [], "no Bran at either death");
  loot(p, session.branda);
  assert.deepEqual(obtained, [p.getUsername()], "exactly one Bran, at the claim");
});

test("the death's Bran isn't shared: each claimant rolls their own", (t) => {
  obtained.length = 0;
  const a = player(t), b = player(t);
  const session = encounter(t, [a, b]);
  const random = t.mock.method(Math, "random", () => 0);
  die(session, session.branda, a);
  die(session, session.eldric, a);
  // The claims' own rolls miss: the death roll's Bran must not reach either claimant through the shared stash.
  random.mock.mockImplementation(() => 0.99);
  loot(a, session.branda);
  loot(b, session.branda);
  assert.deepEqual(obtained, [], "nobody gets the death roll's Bran");
  // A hit on a claim's own roll pays that claimant only.
  random.mock.mockImplementation(() => 0);
  const c = player(t), d = player(t);
  const second = encounter(t, [c, d]);
  random.mock.mockImplementation(() => 0.99);
  die(second, second.branda, c);
  die(second, second.eldric, c);
  random.mock.mockImplementation(() => 0);
  loot(c, second.branda);
  assert.deepEqual(obtained, [c.getUsername()], "one claim, one roll");
  loot(d, second.branda);
  assert.deepEqual(obtained, [c.getUsername(), d.getUsername()], "the second claimant rolls their own");
});

test("each claimant's loot is their own roll: the top damager's death roll is copied to nobody", (t) => {
  const claimed = new Map();
  PM.createApi("TitanClaimWatch").onCustomEvent("npc-drops:roll", ({ player, drops, claim }) => {
    if (claim === true) claimed.set(player.getUsername(), drops.map((drop) => [drop.itemId, drop.amount]));
  });
  const random = t.mock.method(Math, "random", () => 0);
  const run = (deathRandom) => {
    const a = player(t), b = player(t);
    const session = encounter(t, [a, b]);
    for (const titan of [session.branda, session.eldric]) {
      titan.setAttribute(Shared.DAMAGE_DEALT_ATTRIBUTE, { [a.getUsername()]: 600, [b.getUsername()]: 600 });
    }
    random.mock.mockImplementation(() => deathRandom);
    die(session, session.branda, a);
    die(session, session.eldric, a);
    random.mock.mockImplementation(() => 0.5);
    loot(a, session.branda);
    loot(b, session.branda);
    return [claimed.get(a.getUsername()), claimed.get(b.getUsername())];
  };
  const lucky = run(0), unlucky = run(0.99);
  assert.ok(lucky[0]?.length > 0, "the claim has loot");
  assert.deepEqual(lucky, unlucky, "what each claimant gets doesn't depend on the death roll");
});
