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
  core.RegionManager.loadMapFiles(3104, 3161);
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

test("refused through the opponent's death animation; opens the tick it is removed", async (t) => {
  // Live 227/01885: killed t20818, refused t20819 while abyssal_death plays, opened t20821 as it is
  // removed. 240/1001355: goblin killed t1962, price checker refused t1964, opened t1969 on removal.
  const f = actor(t);
  f.p.getSkillManager().setCurrentLevel(core.Skill.ATTACK, 99, true);
  f.p.getSkillManager().setCurrentLevel(core.Skill.STRENGTH, 99, true);
  const npc = goblin(t, HOME.x + 1, HOME.y);
  npc.setHitpoints(1);
  Math.random = () => 0.99;
  t.after(() => { Math.random = random; });
  f.p.getCombat().attack(npc);
  for (let i = 0; i < 10 && npc.getHitpoints() > 0; i++) ticks(1);
  assert.equal(npc.getHitpoints(), 0, "the goblin is killed by a real hit");
  let refused = 0, opened = -1;
  for (let i = 0; i < 12 && opened < 0; i++) {
    const registered = npc.isRegistered() && npc.isDyingFunction();
    await send(f, STATS_BUTTON);
    if (f.p.getInterfaceId() === STATS_INTERFACE) {
      opened = i;
      assert.equal(registered, false, "it opens only once the dying goblin is gone");
    } else {
      assert.equal(registered, true, "refused only while the goblin is still dying");
      refused++;
    }
    ticks(1);
  }
  assert.ok(refused >= 1, "refused at least once during the death animation");
  assert.ok(opened >= 0, "opens after the goblin is removed");
});

test("dropped without a message during a forced move (a ditch jump)", async (t) => {
  const f = actor(t);
  const { ForceMovement, ForceMovementTask, Location, TaskManager } = core;
  // As WildernessDitch: a 3-tick ForceMovementTask with the jump animation (844).
  const jump = new ForceMovement(f.p.getLocation().clone(), new Location(0, 2), 0, 70, 0, new core.Animation(844));
  TaskManager.submit(new ForceMovementTask(f.p, 3, jump));
  ticks(1);
  assert.notEqual(f.p.getForceMovement(), null, "mid-jump");
  const animations = [];
  const perform = f.p.performAnimation.bind(f.p);
  t.mock.method(f.p, "performAnimation", (animation) => { animations.push(animation?.getId?.()); return perform(animation); });
  await send(f, STATS_BUTTON);
  assert.deepEqual(animations, [], "the jump's animation is not cut");
  assert.equal(f.p.getInterfaceId(), -1);
  assert.deepEqual(f.messages.filter((m) => m === REFUSAL), []);
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

const PRICES_BUTTON = { type: "widget_action", widgetId: (387 << 16) | 3, groupId: 387, childId: 3, buttonNum: 1, simple: true };
const PRICES_REFUSAL = "You cannot open the price checker screen while in combat.";

test("Guide prices is refused while fighting and opens once the fight is over", async (t) => {
  // Live 240/1001355 t1964 refused mid-fight with a goblin, t1969 opened.
  const f = actor(t);
  const npc = goblin(t, HOME.x + 1, HOME.y);
  f.p.getCombat().attack(npc);
  ticks(1);
  await send(f, PRICES_BUTTON);
  assert.deepEqual(f.messages.filter((m) => m === PRICES_REFUSAL), [PRICES_REFUSAL]);
  assert.equal(f.p.getInterfaceId(), -1, "the price checker does not open");
  assert.ok(f.p.getCombat().getTarget() === npc, "the attack keeps its target");
  npc.setHitpoints(0);
  npc.appendDeath();
  for (let i = 0; i < 12 && npc.isRegistered() && npc.isDyingFunction(); i++) ticks(1);
  assert.equal(npc.isRegistered() && npc.isDyingFunction(), false, "the goblin's death has ended");
  await send(f, PRICES_BUTTON);
  assert.equal(f.messages.filter((m) => m === PRICES_REFUSAL).length, 1, "no second refusal");
  assert.equal(f.p.getInterfaceId(), 464, "it opens once the goblin is gone");
});

test("a make-X loop (fletching Make-All) ends on the open, as a walk click ends it", async (t) => {
  // Live leaves a make-X under this screen unrecorded; tsps stops it as a walk click does.
  const { ItemIdentifiers: I } = core;
  const f = actor(t);
  f.p.getSkillManager().setMaxLevels(core.Skill.FLETCHING, 99, false).setCurrentLevels(core.Skill.FLETCHING, 99, false);
  const inv = f.p.getInventory();
  inv.setItem(0, new core.Item(I.KNIFE));
  for (let slot = 1; slot <= 10; slot++) inv.setItem(slot, new core.Item(I.LOGS));
  await send(f, { type: "inventory_use_on", slot: 0, itemId: I.KNIFE, target: { kind: "inventory", slot: 1, itemId: I.LOGS } });
  const menu = f.p.getCreationMenu();
  assert.ok(menu, "the knife on logs offers the make menu");
  const index = menu.getItems().indexOf(I.ARROW_SHAFT);
  assert.ok(index >= 0);
  await send(f, { type: "dialogue_continue", widgetId: (270 << 16) | (15 + index), childIndex: 10 });
  ticks(4);
  const logs = inv.getAmount(I.LOGS);
  assert.ok(logs < 10, "the Make-All has started");
  await send(f, STATS_BUTTON);
  assert.equal(f.p.getInterfaceId(), STATS_INTERFACE);
  ticks(20);
  assert.equal(inv.getAmount(I.LOGS), logs, "no more logs are cut behind the screen");
});

test("a loc clicked from in reach on the same tick still runs, and the screen stays shut", async (t) => {
  // Live 228/02229 t236: an oploc and View equipment stats on one tick; the passageway runs and the
  // screen does not open. Here, the Wizards' Tower ladder (2147) from its east side, in reach.
  const f = actor(t, { x: 3105, y: 3162 });
  ticks(1);
  f.p.needsPlacement = false;
  await send(f, { type: "object_option", id: 2147, x: 3104, y: 3162, clickType: 1 }, STATS_BUTTON);
  assert.notEqual(f.p.getInterfaceId(), STATS_INTERFACE, "the screen does not open");
  ticks(6);
  assert.ok(f.p.getLocation().getY() > 9000, "the climb went ahead, to the basement");
});

test("dropped while a loc's delay holds the player (mid ladder climb)", async (t) => {
  // Live 228/02229 t238: clicks during a delayed action open nothing.
  const f = actor(t, { x: 3105, y: 3162 });
  ticks(1);
  f.p.needsPlacement = false;
  await send(f, { type: "object_option", id: 2147, x: 3104, y: 3162, clickType: 1 });
  let blockedTick = -1;
  for (let i = 0; i < 4 && blockedTick < 0; i++) {
    ticks(1);
    if (f.p.getMovementQueue().isMovementBlocked()) blockedTick = i;
  }
  if (blockedTick < 0) return t.skip("this ladder holds no delay to click into");
  await send(f, STATS_BUTTON);
  assert.equal(f.p.getInterfaceId(), -1, "nothing opens mid-climb");
});
