// Run after `yarn build`: node --test tests/white-wolf-mountain-rock-slide.test.cjs
//
// #3892: the rock slide outside the Ice Queen's Lair (herorockslide at 2838,3517) offered Mine but nothing happened.
// Wiki (Rock slide): a pickaxe and 50 Mining, no XP; cleared, the player walks to the other side and it respawns.
// Recorded (rsprox_transcripts/234/03278.txt): Investigate's message; Mine swings at once and every two ticks, the loc
// is rockslide2 a tick later, rockslide4 two after that, cleared two after that, back four after that; the player
// walked 2837,3518 -> 2840,3517 through it. Real map, real Player, packets in; no client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const RockSlide = require("../plugins/areas/WhiteWolfMountain.plugin")._test;

const SLIDE = [2838, 3517, 0];
const WEST = [...RockSlide.WEST_SIDE, 0];
const EAST = [...RockSlide.EAST_SIDE, 0];

let core;
let next = 9800;
let slideId;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(SLIDE[0], SLIDE[1]);
  PM.emitServerStartup({});
  slideId = core.CacheDefinitions.getLocId("herorockslide");
});
after(() => PM.emitServerShutdown({}));

function actor(t, at, { mining = 50, pickaxe = true } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("rockslideqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...at));
  p.needsPlacement = false;
  core.World.getPlayers().add(p);
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const boxes = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  const dialogues = p.getDialogueManager();
  t.mock.method(dialogues, "startDialogues", (chain) => { for (const box of chain.dialogues.values()) boxes.push(String(box.text)); });
  const animations = [];
  const perform = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => { animations.push(core.World.processCycle); return perform(animation); });
  p.getSkillManager().setMaxLevel(core.Skill.MINING, mining).setCurrentLevel(core.Skill.MINING, mining);
  if (pickaxe) p.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_PICKAXE, 1));
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.World.getPlayers().remove(p);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, messages, boxes, animations };
}

function tick(f) {
  core.World.processCycle++;
  core.TaskManager.process();
  f.c.processTurnPackets();
  f.p.getMovementQueue().process();
  core.TaskManager.processWalkTo(f.p.getIndex());
  f.p.getSession().flushClient(core.World.processCycle);
  f.p.resetUpdating();
}

async function click(f, clickType) {
  await f.c.dispatch([{ type: "object_option", id: slideId, x: SLIDE[0], y: SLIDE[1], clickType }]);
  f.c.processTurnPackets();
}

const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];
const slideTile = () => new core.Location(...SLIDE);
const locHere = () => core.ObjectManager.objectsAt(slideTile()).find((o) => o.getType() === 10)?.getId()
  ?? core.MapObjects.get(slideId, slideTile(), null)?.getId() ?? null;
const blocked = (x, y) => core.RegionManager.blocked(new core.Location(x, y, 0), null);

/** Ticks until the slide is back, noting the cycle each loc first showed. */
function runClear(f, limit = 20) {
  const seen = new Map();
  let wasCleared = false;
  for (let i = 0; i < limit; i++) {
    tick(f);
    const id = locHere();
    const name = id == null ? "cleared" : id;
    if (!seen.has(name)) seen.set(name, core.World.processCycle);
    if (id == null && !wasCleared) {
      wasCleared = true;
      seen.set("open", !blocked(2838, 3518) && !blocked(2839, 3518));
      seen.set("clearedFrom", at(f));
    }
    if (!seen.has("arrived") && at(f).join() !== seen.get("clearedFrom")?.join() && wasCleared && seen.has("clearedFrom")) seen.set("firstStep", seen.get("firstStep") ?? core.World.processCycle);
    if (wasCleared && id === slideId && !RockSlide.clearing.size) break;
  }
  return seen;
}

test("the slide is solid, and the recorded tiles either side are open", () => {
  assert.equal(locHere(), slideId, "the map has the rock slide");
  assert.equal(blocked(2838, 3518), true, "its tiles block");
  assert.equal(blocked(...WEST.slice(0, 2)), false);
  assert.equal(blocked(...EAST.slice(0, 2)), false);
});

test("Investigate gives the recorded message", async (t) => {
  const f = actor(t, WEST);
  await click(f, 1);
  for (let i = 0; i < 3; i++) tick(f);
  assert.ok(f.messages.includes("These rocks contain nothing interesting. They are just in the way."), JSON.stringify(f.messages));
});

test("50 Mining and a pickaxe clear it in the recorded stages, walk the player through, and it comes back", async (t) => {
  const f = actor(t, WEST);
  const xp = f.p.getSkillManager().getExperience(core.Skill.MINING);
  await click(f, 2);
  const seen = runClear(f);
  const first = seen.get(core.CacheDefinitions.getLocId("rockslide2"));
  assert.ok(first, `rockslide2 shown: ${JSON.stringify([...seen])}`);
  const swing = f.animations[0];
  assert.equal(first - swing, 1, "rockslide2 a tick after the first swing");
  assert.equal(seen.get(core.CacheDefinitions.getLocId("rockslide4")) - swing, 3);
  assert.equal(seen.get("cleared") - swing, 5);
  assert.equal(seen.get("open"), true, "the cleared tiles are open");
  assert.equal(seen.get("firstStep") - swing, 6, "the walk starts the tick after the clear");
  assert.deepEqual(f.animations.slice(0, 3).map((cycle) => cycle - swing), [0, 2, 4], "swings every two ticks");
  assert.deepEqual(at(f), EAST, "walked to the other side");
  assert.equal(locHere(), slideId, "the rock slide is back");
  assert.equal(blocked(2838, 3518), true, "and blocks again");
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.MINING), xp, "no XP");
  assert.deepEqual(f.messages, [], "no message");
});

test("from the east side it walks the player west", async (t) => {
  const f = actor(t, EAST);
  await click(f, 2);
  runClear(f, 25);
  assert.deepEqual(at(f), WEST);
  assert.equal(locHere(), slideId);
});

test("49 Mining can't, a boost to 50 can, and no pickaxe can't", async (t) => {
  const low = actor(t, WEST, { mining: 49 });
  await click(low, 2);
  for (let i = 0; i < 8; i++) tick(low);
  assert.equal(locHere(), slideId, "untouched");
  assert.deepEqual(at(low), WEST);
  assert.ok(low.boxes.some((box) => box.includes("Mining level of 50")), JSON.stringify(low.boxes));
  low.p.setRegistered(false);
  core.World.getPlayers().remove(low.p);

  const none = actor(t, WEST, { pickaxe: false });
  await click(none, 2);
  for (let i = 0; i < 8; i++) tick(none);
  assert.equal(locHere(), slideId, "untouched");
  assert.ok(none.boxes.some((box) => box.includes("You need a pickaxe")), JSON.stringify(none.boxes));
  none.p.setRegistered(false);
  core.World.getPlayers().remove(none.p);

  const boosted = actor(t, WEST, { mining: 45 });
  boosted.p.getSkillManager().setCurrentLevel(core.Skill.MINING, 50);
  await click(boosted, 2);
  runClear(boosted);
  assert.deepEqual(at(boosted), EAST, "the boosted level counts");
});
