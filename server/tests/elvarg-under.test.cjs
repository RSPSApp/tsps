// Run after `yarn build`: node --test tests/elvarg-under.test.cjs
//
// #2386. Standing under Elvarg: she has to move before she can hit again (Wiki: Dragon Slayer I,
// "You may consider standing under Elvarg while eating, as it takes her a moment to move and hit you again").
// Her boxed in must not bring back #489's deadlock, so she fights on after about 8 ticks under.
//
// Native fixture: the real plugins, Combat and movement, the real elvarg:enter and lair area, and a real move
// packet. Ticks are driven by hand, and the quest stage is set directly. No client ran. The tick figures follow from her size
// and our bound, not from a source; the Wiki says only "a moment".
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const WALL = [2847, 9636];
const SPAWN = [2852, 9637];
const STAGE_CRANDOR = 9;
const BREATH = 81;
const MELEE = 80;
const UNDER_BOUND = 8;

let core;
let next = 7700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...WALL);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function fixture(t, [x, y]) {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("elvargqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, 0));
  p.needsPlacement = false;
  const animations = [];
  const original = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => {
    animations.push([animation.getId(), cycle]);
    return original(animation);
  });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  QuestRuntime.getRegisteredQuests().find((quest) => quest.key === "dragon_slayer_i").setStage(p, STAGE_CRANDOR);
  const entered = { player: p, handled: false, aggressive: true };
  PM.emitCustomEvent("elvarg:enter", entered);
  assert.equal(entered.handled, true, "the lair opened");
  const npc = entered.npc;
  assert.ok(npc, "Elvarg spawned");
  const seen = [];
  const npcOriginal = npc.performAnimation.bind(npc);
  t.mock.method(npc, "performAnimation", (animation) => {
    seen.push(animation.getId());
    return npcOriginal(animation);
  });
  // World's order: tasks, NPCs, then each player: combat and movement, walk-to, then the area.
  const tick = ({ fights = false } = {}) => {
    cycle++;
    core.TaskManager.process();
    if (npc.isRegistered()) npc.process();
    if (fights) p.getCombat().preMovementProcess();
    p.getMovementQueue().process();
    if (fights) p.getCombat().postMovementProcess();
    core.TaskManager.processWalkTo(p.getIndex());
    p.getArea()?.process(p);
  };
  return { p, c, npc, seen, animations, tick, cycle: () => cycle };
}

const at = (mobile) => [mobile.getLocation().getX(), mobile.getLocation().getY()];

function overlapped(f) {
  const [nx, ny] = at(f.npc);
  const [px, py] = at(f.p);
  const size = f.npc.getSize();
  return px >= nx && px < nx + size && py >= ny && py < ny + size;
}

const attacks = (ids) => ids.filter((id) => id === BREATH || id === MELEE).length;

// ------------------------------------------------------------------ standing under her

test("Elvarg: out from under her, she attacks from where she stands", (t) => {
  const f = fixture(t, WALL);
  assert.deepEqual(at(f.npc), SPAWN, "she starts at her spawn");
  assert.equal(overlapped(f), false);
  for (let i = 0; i < 8; i++) f.tick();
  assert.ok(attacks(f.seen) > 0, `she attacks: ${f.seen}`);
  assert.equal(f.npc.getCombat().getTarget(), f.p, "the player is her target");
});

test("Elvarg: under her she stops attacking and moves, then attacks again once clear", (t) => {
  const f = fixture(t, WALL);
  assert.equal(f.npc.getSize(), 4, "a 4x4 dragon");
  under(f);
  assert.equal(overlapped(f), true, "the player stands under her");
  const start = at(f.npc);

  let hitWhileUnder = 0;
  let clearedAfter = -1;
  for (let i = 0; i < 40; i++) {
    const before = attacks(f.seen);
    const wasUnder = overlapped(f);
    f.tick();
    if (wasUnder && attacks(f.seen) > before) hitWhileUnder++;
    if (clearedAfter < 0 && !overlapped(f)) clearedAfter = i + 1;
  }
  t.diagnostic(`attacks while under ${hitWhileUnder}; moved ${start} to ${at(f.npc)}; clear after ${clearedAfter} ticks; attacks ${attacks(f.seen)}`);
  assert.equal(hitWhileUnder, 0, "no attack while the player is under her");
  assert.notDeepEqual(at(f.npc), start, "she moved");
  assert.ok(clearedAfter > 0, "she came clear of the player");
  assert.ok(clearedAfter <= 4, `promptly, by the shortest way, as a random walk needn't: ${clearedAfter}`);
  assert.ok(attacks(f.seen) > 0, "and attacks again");
});

// ------------------------------------------------------------------ not bringing back #489's deadlock

/** Puts the player under her at the end of a player phase, as walking there would. */
const under = (f, [x, y] = [SPAWN[0] + 1, SPAWN[1] + 1]) => {
  f.p.setLocation(new core.Location(x, y, 0));
  f.p.getArea().process(f.p);
};

test("Elvarg: boxed in, she can't step off, so she fights on after the bound", (t) => {
  const f = fixture(t, WALL);
  t.mock.method(f.npc.getMovementQueue(), "canWalkTo", () => false);
  under(f);
  const start = at(f.npc);
  let firstAttack = -1;
  for (let i = 0; i < UNDER_BOUND + 10; i++) {
    f.tick();
    if (firstAttack < 0 && attacks(f.seen) > 0) firstAttack = i + 1;
  }
  t.diagnostic(`first attack after ${firstAttack} ticks; at ${at(f.npc)}`);
  assert.deepEqual(at(f.npc), start, "she couldn't move");
  assert.equal(overlapped(f), true, "the player is still under her");
  assert.ok(firstAttack >= UNDER_BOUND, `no attack before the bound: ${firstAttack}`);
  assert.ok(firstAttack > 0, "she does attack in the end, so nobody is stuck");
});

test("Elvarg: under her a second time, she moves off again", (t) => {
  const f = fixture(t, WALL);
  under(f);
  for (let i = 0; i < UNDER_BOUND; i++) f.tick();
  assert.equal(overlapped(f), false, "clear the first time");

  const moved = at(f.npc);
  under(f, [moved[0] + 1, moved[1] + 1]);
  assert.equal(overlapped(f), true, "under her again");
  f.tick();
  const before = attacks(f.seen);
  let hitWhileUnder = 0;
  for (let i = 0; i < UNDER_BOUND - 2; i++) {
    const wasUnder = overlapped(f);
    const count = attacks(f.seen);
    f.tick();
    if (wasUnder && attacks(f.seen) > count) hitWhileUnder++;
  }
  t.diagnostic(`attacks before ${before}; while under again ${hitWhileUnder}; at ${at(f.npc)}`);
  assert.equal(hitWhileUnder, 0, "the bound started again");
  assert.notDeepEqual(at(f.npc), moved, "she moved again");
});

test("Elvarg: a player attacking from under her: nobody is stuck", (t) => {
  const f = fixture(t, WALL);
  f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.ABYSSAL_WHIP, 1));
  under(f);
  f.p.getCombat().attack(f.npc);
  let hitWhileUnder = 0;
  for (let i = 0; i < UNDER_BOUND; i++) {
    const wasUnder = overlapped(f);
    const count = attacks(f.seen);
    f.tick({ fights: true });
    if (wasUnder && attacks(f.seen) > count) hitWhileUnder++;
  }
  for (let i = 0; i < 20; i++) f.tick({ fights: true });
  const swings = f.animations.length;
  t.diagnostic(`attacks while under ${hitWhileUnder}; hers ${attacks(f.seen)}; player swings ${swings}; player ${at(f.p)}; her ${at(f.npc)}`);
  assert.equal(hitWhileUnder, 0, "she doesn't hit them under her");
  assert.equal(overlapped(f), false, "they came apart");
  assert.ok(attacks(f.seen) > 0, "she attacks again");
  assert.ok(swings > 0, "and so do they");
});

test("Elvarg: a player walking under her: she moves off and attacks once they stop", async (t) => {
  const f = fixture(t, WALL);
  const stand = [SPAWN[0] + 1, SPAWN[1] + 1];
  await f.c.dispatch([{ type: "move", worldX: stand[0], worldY: stand[1], modifierFlags: 0 }]);
  f.c.processTurnPackets();
  let hitWhileUnder = 0;
  let arrived = -1;
  let underTicks = 0;
  for (let i = 0; i < 40; i++) {
    const wasUnder = overlapped(f);
    const count = attacks(f.seen);
    f.tick();
    if (wasUnder) underTicks++;
    if (wasUnder && underTicks <= UNDER_BOUND && attacks(f.seen) > count) hitWhileUnder++;
    if (arrived < 0 && at(f.p)[0] === stand[0] && at(f.p)[1] === stand[1]) arrived = i + 1;
  }
  t.diagnostic(`arrived after ${arrived}; ticks under ${underTicks}; attacks under ${hitWhileUnder}; hers ${attacks(f.seen)}; her ${at(f.npc)}`);
  assert.ok(arrived > 0, "the player got there");
  assert.equal(hitWhileUnder, 0, "no attack while they're under her");
  assert.equal(overlapped(f), false, "she came clear once they stopped");
  assert.ok(attacks(f.seen) > 0, "and attacks");
});
