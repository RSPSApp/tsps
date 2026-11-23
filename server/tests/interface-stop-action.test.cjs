// Run after `yarn build`: node --test tests/interface-stop-action.test.cjs
// View equipment stats (worn-items 387:1) stops the player as live does (rsprox captures, see
// docs/interface-interruption.md): on the click's tick the walk is cleared and does not resume
// after close, a pending route and a repeating skill end and the animation resets. It is refused,
// interrupting nothing, while fighting something alive. Native input: a real Player in the World,
// its ClientConnection and the widget_action packet the client sends, advanced with World.process().
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");

const HOME = { x: 3103, y: 3424 };
const ROCK_TILE = { x: 3110, y: 3424 };
const STATS_INTERFACE = 84;
const STATS_BUTTON = { type: "widget_action", widgetId: (387 << 16) | 1, groupId: 387, childId: 1, buttonNum: 1, simple: true };
const REFUSAL = "You cannot open the equip screen while in combat!";
let core, next = 4100;
const previousBots = process.env.DISABLE_PLAYER_BOTS;
const random = Math.random;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(HOME.x, HOME.y);
  PM.emitServerStartup({});
});
after(() => {
  Math.random = random;
  try { PM.emitServerShutdown({}); } finally {
    if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = previousBots;
  }
});

/** A real Player in the World with a client connection, and the game messages it is sent. */
function actor(t, at = HOME) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername("stopaction" + next++);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at.x, at.y, 0));
  assert.equal(core.World.getPlayers().add(p), true);
  p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  const messages = [];
  const sender = p.getPacketSender();
  const sendMessage = sender.sendMessage.bind(sender);
  t.mock.method(sender, "sendMessage", (message, ...rest) => { messages.push(String(message)); return sendMessage(message, ...rest); });
  t.after(() => {
    core.TaskManager.cancelTasks(p.getIndex());
    p.getCombat().reset?.();
    if (p.isRegistered()) core.World.getPlayers().removes(p);
  });
  return { p, c, messages };
}

async function send(f, ...packets) {
  await f.c.dispatch(packets);
  f.c.processTurnPackets();
}

function ticks(n) {
  for (let i = 0; i < n; i++) core.World.process();
}

const at = (p) => [p.getLocation().getX(), p.getLocation().getY()];

function goblin(t, x, y) {
  const npc = core.NPC.create(core.NpcIdentifiers.GOBLIN, new core.Location(x, y, 0));
  assert.equal(core.World.getNpcs().add(npc), true);
  npc.needsPlacement = false;
  t.after(() => { npc.getCombat().reset?.(); if (npc.isRegistered()) core.World.getNpcs().removes(npc); });
  return npc;
}

test("a walk stops on the click's tick and does not resume after the screen closes", async (t) => {
  // Live 227/1000433 t11626 (minimap walk), 227/01751 t3614 closed t3620 with no further step.
  const f = actor(t);
  ticks(1);
  f.p.needsPlacement = false;
  await send(f, { type: "move", worldX: HOME.x + 5, worldY: HOME.y, modifierFlags: 0, run: false });
  ticks(2);
  const walked = at(f.p);
  assert.notDeepEqual(walked, [HOME.x, HOME.y], "the walk has started");
  await send(f, STATS_BUTTON);
  assert.equal(f.p.getInterfaceId(), STATS_INTERFACE, "the stats screen opens");
  ticks(3);
  assert.deepEqual(at(f.p), walked, "no step while it is open");
  await send(f, { type: "interface_close" });
  ticks(4);
  assert.deepEqual(at(f.p), walked, "the walk was cleared, not paused");
});

test("a pending object route is cancelled and its action never runs", async (t) => {
  // Live 227/1000561 t12352: the route to a rope ends on the click's tick.
  const { CacheDefinitions, GameObject, Location, ObjectManager, ItemIdentifiers: I } = core;
  const f = actor(t, { x: ROCK_TILE.x - 6, y: ROCK_TILE.y });
  f.p.getInventory().add(new core.Item(I.BRONZE_PICKAXE), true);
  const rock = new GameObject(CacheDefinitions.getLocId("copperrock1"), new Location(ROCK_TILE.x, ROCK_TILE.y, 0), 10, 0, null);
  ObjectManager.register(rock, true);
  t.after(() => ObjectManager.deregister(rock, true));
  await send(f, { type: "object_option", id: rock.getId(), x: ROCK_TILE.x, y: ROCK_TILE.y, action: "Mine" });
  ticks(1);
  const stopped = at(f.p);
  await send(f, STATS_BUTTON, { type: "interface_close" });
  ticks(10);
  assert.deepEqual(at(f.p), stopped, "no further step toward the rock");
  assert.equal(f.p.getInventory().getAmount(I.COPPER_ORE), 0, "the rock is never mined");
});

test("a repeating skill stops and the animation resets", async (t) => {
  // Live 227/1000507 t226: mining's animation resets on the open and no swing follows.
  const { CacheDefinitions, GameObject, Location, ObjectManager, ItemIdentifiers: I } = core;
  const f = actor(t, { x: ROCK_TILE.x - 1, y: ROCK_TILE.y });
  const skills = f.p.getSkillManager();
  skills.setExperience(core.Skill.MINING, SkillManager.getExperienceForLevel(40));
  skills.setMaxLevel(core.Skill.MINING, 40);
  skills.setCurrentLevel(core.Skill.MINING, 40, true);
  f.p.getInventory().add(new core.Item(I.BRONZE_PICKAXE), true);
  Math.random = () => 0;
  t.after(() => { Math.random = random; });
  const rock = new GameObject(CacheDefinitions.getLocId("copperrock1"), new Location(ROCK_TILE.x, ROCK_TILE.y, 0), 10, 0, null);
  ObjectManager.register(rock, true);
  t.after(() => ObjectManager.deregister(rock, true));
  const animations = [];
  const perform = f.p.performAnimation.bind(f.p);
  t.mock.method(f.p, "performAnimation", (animation) => { animations.push(animation?.getId?.()); return perform(animation); });
  await send(f, { type: "object_option", id: rock.getId(), x: ROCK_TILE.x, y: ROCK_TILE.y, action: "Mine" });
  ticks(3);
  assert.ok(animations.some((id) => id > 0 && id !== 65535), "the mining swing plays");
  const mined = f.p.getInventory().getAmount(I.COPPER_ORE);
  animations.length = 0;
  await send(f, STATS_BUTTON);
  assert.deepEqual(animations, [65535], "the animation resets on the open");
  ticks(4);
  await send(f, { type: "interface_close" });
  ticks(10);
  assert.deepEqual(animations, [65535], "no swing after the open or the close");
  assert.equal(f.p.getInventory().getAmount(I.COPPER_ORE), mined, "no ore after the open or the close");
});

test("refused while attacking: nothing is interrupted", async (t) => {
  // Live 227/1000539 t1780: refused; the next swing lands on its normal tick (t1781).
  const f = actor(t);
  const npc = goblin(t, HOME.x + 1, HOME.y);
  f.p.getCombat().attack(npc);
  ticks(1);
  assert.ok(f.p.getCombat().getTarget() === npc, "the attack has started");
  await send(f, STATS_BUTTON);
  assert.deepEqual(f.messages.filter((m) => m === REFUSAL), [REFUSAL]);
  assert.equal(f.p.getInterfaceId(), -1, "the screen does not open");
  assert.ok(f.p.getCombat().getTarget() === npc, "the attack keeps its target");
});

test("refused while only being hit by a living NPC", async (t) => {
  // Live 227/1000539 t1775: walking away from an NPC that is still hitting the player.
  const f = actor(t);
  const npc = goblin(t, HOME.x + 3, HOME.y);
  f.p.getCombat().setUnderAttack(npc);
  await send(f, STATS_BUTTON);
  assert.deepEqual(f.messages.filter((m) => m === REFUSAL), [REFUSAL]);
  assert.equal(f.p.getInterfaceId(), -1);
});

test("opens once the target is dead", async (t) => {
  // Live 227/01885 t20819 refused while the demon lived, t20821 opened after it died.
  const f = actor(t);
  const npc = goblin(t, HOME.x + 1, HOME.y);
  f.p.getCombat().attack(npc);
  f.p.getCombat().setUnderAttack(npc);
  ticks(1);
  npc.setHitpoints(0);
  await send(f, STATS_BUTTON);
  assert.deepEqual(f.messages.filter((m) => m === REFUSAL), []);
  assert.equal(f.p.getInterfaceId(), STATS_INTERFACE);
});

test("dropped without a message mid-teleport", async (t) => {
  // Live 228/02229 t236: the click is ignored during the passageway's teleport.
  const f = actor(t);
  f.p.setTeleporting(true);
  t.after(() => f.p.setTeleporting(false));
  await send(f, STATS_BUTTON);
  assert.equal(f.p.getInterfaceId(), -1);
  assert.deepEqual(f.messages.filter((m) => m === REFUSAL), []);
});

test("an NPC's hit closes the open screen", async (t) => {
  // Live 227/1000296 t5358: the server closes it on the hit's tick (CombatFactory.executeHit).
  const f = actor(t);
  await send(f, STATS_BUTTON);
  assert.equal(f.p.getInterfaceId(), STATS_INTERFACE);
  const npc = goblin(t, HOME.x + 1, HOME.y);
  npc.getCombat().attack(f.p);
  let closedAt = -1;
  for (let i = 0; i < 12 && closedAt < 0; i++) {
    ticks(1);
    if (f.p.getInterfaceId() === -1) closedAt = i;
  }
  assert.ok(closedAt >= 0, "the goblin's hit closes the stats screen");
});
