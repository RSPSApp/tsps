// Run after `yarn build`: node --test tests/house-teleport-no-house.test.cjs
// Teleport to House with no house went to Rimmington and spent its runes. It is now refused first with the house
// tablet's line, spending nothing; with a house it still casts. Its "Outside" option (op2) took the player inside
// (issue 3870); it now lands at the house portal in the house's town, whatever the house's teleport setting.
// Real engine: every plugin loaded, a real Player, the spell cast by a native widget_action packet.
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

let core, next = 9970;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3200, 3200);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, owned) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("hometele" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0)); p.needsPlacement = false;
  const conn = new ClientConnection(channel); conn.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.setSpellbook(core.MagicSpellbook.NORMAL);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false); p.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  if (owned) p.setAttribute("construction:house", require("../plugins/skills/construction/Instance.Construction").createDefaultHouseSave());
  for (const [id, n] of [[563, 1], [556, 1], [557, 1]]) p.getInventory().add(new core.Item(id, n), false);
  const owns = { player: p, owns: true };
  PM.emitCustomEvent("construction:owns-house", owns);
  assert.equal(owns.owns, owned, "the saved house state");
  const messages = [], send = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (...args) => { messages.push(args[0]); return send(...args); });
  return { p, conn, messages };
}

async function cast(f, buttonNum = 1) {
  const spell = core.CacheDefinitions.getSpellByName("Teleport to House");
  assert.ok(spell);
  const w = spell.widgetId;
  await f.conn.dispatch([{ type: "widget_action", widgetId: w, groupId: w >>> 16, childId: w & 65535, slot: -1, buttonNum }]);
  f.conn.processTurnPackets();
  for (let i = 0; i < 8; i++) core.TaskManager.process();
}

test("Teleport to House without a house is refused and spends nothing", async (t) => {
  const f = actor(t, false);
  await cast(f);
  assert.ok(f.messages.includes("You do not own a house. Speak to an Estate agent to buy one."), f.messages.join(" | "));
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [3200, 3200], "not moved");
  assert.equal(f.p.getInventory().getAmount(563), 1, "no law rune spent");
});

test("Teleport to House with a house still casts", async (t) => {
  const f = actor(t, true);
  await cast(f);
  assert.equal(f.messages.includes("You do not own a house. Speak to an Estate agent to buy one."), false);
  assert.equal(f.p.getInventory().getAmount(563), 0, "the law rune is spent");
});

const Instance = () => require("../plugins/skills/construction/Instance.Construction");
const at = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];

test("Outside lands at the house portal in the house's town, even with teleport inside on", async (t) => {
  for (const [location, portal] of [[1, [2954, 3224, 0]], [2, [2894, 3465, 0]]]) {
    const f = actor(t, true);
    const saved = f.p.getAttribute("construction:house");
    saved.location = location;
    saved.teleportOutside = false;
    await cast(f, 2);
    assert.equal(f.p.getInventory().getAmount(563), 0, "the law rune is spent");
    assert.equal(Instance().PlayerHouseInstance.isAllocationLocation(f.p.getLocation()), false, "not taken inside");
    assert.deepEqual(at(f.p), portal, `outside house location ${location}'s portal`);
  }
});

test("Cast still follows the house's teleport setting", async (t) => {
  const inside = actor(t, true);
  inside.p.getAttribute("construction:house").teleportOutside = false;
  await cast(inside, 1);
  assert.equal(Instance().PlayerHouseInstance.isAllocationLocation(inside.p.getLocation()), true, "taken inside");

  const outside = actor(t, true);
  const saved = outside.p.getAttribute("construction:house");
  saved.location = 2;
  saved.teleportOutside = true;
  await cast(outside, 1);
  assert.deepEqual(at(outside.p), [2894, 3465, 0], "outside the Taverley portal");
});

test("Inside the house Home Sweet Home plays and unlocks, whatever played outside", async (t) => {
  const f = actor(t, true);
  f.p.getAttribute("construction:house").teleportOutside = false;
  const session = f.p.getSession();
  session.setPlayer(f.p);
  let tick = 0;
  const songs = async () => {
    // The test player has no player sync; music runs before it in the flush.
    try { session.flush(++tick); } catch { /* player sync */ }
    const frames = [...session.pendingPackets];
    session.pendingPackets.length = 0;
    await Promise.resolve();
    return frames.filter((frame) => frame[0] === 133).map((frame) => frame.readUInt16BE(frame.length - 10));
  };
  const outside = await songs();
  assert.equal(outside.length, 1, "Lumbridge plays one of its tracks");
  assert.ok(core.Music.tracksAt(3200, 3200, 0).includes(outside[0]));
  await cast(f, 1);
  assert.equal(Instance().PlayerHouseInstance.isAllocationLocation(f.p.getLocation()), true, "taken inside");
  assert.deepEqual(await songs(), [Instance().HOME_SWEET_HOME_TRACK]);
  assert.equal(core.Music.trackNames()[Instance().HOME_SWEET_HOME_TRACK], "Home Sweet Home");
  assert.ok(f.messages.some((message) => message.includes("You have unlocked a new music track:") && message.includes("Home Sweet Home")), f.messages.join(" | "));
  assert.deepEqual(await songs(), [], "and keeps playing");
});
