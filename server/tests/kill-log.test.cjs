// Run after `yarn build`: node --test tests/kill-log.test.cjs
//
// The Boss Kill Log (kill_log, 549) from the ring of wealth's Boss Log: the captured open (rsprox
// 2905 and 1001169, rev 230: the modal, IF_SETEVENTS op 1 on kill_log:reset for every row, then
// killcounts with the names, kills, streaks and "Boss Kill Log"), drawn by rev 242's script 9525
// from the cache kill-count varps, and the streak reset behind Confirm Reset. Real engine: every
// plugin loaded and a real Player.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Item } = require("../dist/game/model/Item");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const KILL_LOG = 549, KILLCOUNTS = 9525, FLAG_OP1 = 1 << 1;
const RESET = (KILL_LOG << 16) | 16, CONFIRM = (KILL_LOG << 16) | 25, CANCEL = (KILL_LOG << 16) | 27;
const RING_OF_WEALTH_5 = 11980;
const ROWS = require("../plugins/interface/data/kill-log.json").boss.rows;
let core, KillLog;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  PM.emitServerStartup({});
  KillLog = require("../plugins/interface/KillLog.plugin");
});
after(() => PM.emitServerShutdown({}));

let nextIndex = 5600;
function newPlayer(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.getSession().setPlayer?.(player);
  player.setUsername(`killlog${nextIndex++}`);
  player.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(player), true);
  const seen = { interfaces: [], scripts: [], flags: [], messages: [] };
  const sender = player.getPacketSender();
  const sendInterface = sender.sendInterface.bind(sender);
  sender.sendInterface = (id) => (seen.interfaces.push(id), sendInterface(id));
  const sendClientScript = sender.sendClientScript.bind(sender);
  sender.sendClientScript = (id, ...args) => (seen.scripts.push([id, ...args]), sendClientScript(id, ...args));
  const sendFlags = sender.sendInterfaceFlagsRange.bind(sender);
  sender.sendInterfaceFlagsRange = (...args) => (seen.flags.push(args), sendFlags(...args));
  player.sendMessage = (message) => seen.messages.push(message);
  t.after(() => { core.TaskManager.cancelTasks(player); core.World.getPlayers().remove(player); });
  return { player, seen };
}

const varp = (name) => core.CacheDefinitions.getVarpId(name);
const row = (name) => ROWS.findIndex((entry) => entry.name === name);
const setKills = (player, name, kills) => player.getPacketSender().sendConfig(varp(ROWS[row(name)].varp), kills);

/** The worn ring's Boss Log: worn option 6, the fifth of the cache's ring options. */
function bossLogFromRing(player) {
  const ring = new Item(RING_OF_WEALTH_5, 1);
  player.getEquipment().setItem(Equipment.RING_SLOT, ring);
  const event = { player, item: ring, itemId: RING_OF_WEALTH_5, slot: Equipment.RING_SLOT,
    interfaceId: Equipment.INVENTORY_INTERFACE_ID, clickType: 6, option: "Boss Log", handled: false };
  assert.equal(PM.emitItemAction(event), true);
}

function lastLog(seen) {
  const call = seen.scripts.findLast(([id]) => id === KILLCOUNTS);
  assert.ok(call, "killcounts ran");
  const [, names, kills, streaks, title, canReset] = call;
  return { names, kills, streaks, title, canReset };
}

function click(player, buttonId, slot = -1) {
  const event = { player, buttonId, groupId: buttonId >>> 16, childId: buttonId & 0xffff, slot, action: 0, opId: 1, handled: false };
  PM.emitInterfaceActionClick(event);
  assert.equal(event.handled, true, `button ${buttonId & 0xffff} is handled`);
}

test("the ring of wealth's Boss Log opens the kill log with every captured row and the kill-count varps", (t) => {
  const { player, seen } = newPlayer(t);
  setKills(player, "Vorkath", 246);
  setKills(player, "Barrows Chests", 1325);
  bossLogFromRing(player);
  assert.equal(seen.interfaces.at(-1), KILL_LOG);
  assert.equal(player.getInterfaceId(), KILL_LOG);
  assert.deepEqual(seen.flags.at(-1), [RESET, 0, ROWS.length - 1, FLAG_OP1], "a Reset Streak op on every row");
  const log = lastLog(seen);
  assert.equal(log.names.length, 71, "the 71 rows live sent");
  assert.equal(log.names[0], "Abyssal Sire");
  assert.equal(log.names.at(-1), "Zulrah");
  assert.equal(log.title, "Boss Kill Log");
  assert.equal(log.canReset, 1);
  assert.equal(log.kills[row("Vorkath")], 246);
  assert.equal(log.kills[row("Barrows Chests")], 1325);
  assert.equal(log.kills[row("Zulrah")], 0);
  assert.equal(log.streaks[row("Vorkath")], 246, "before any reset the streak is the whole count");
  assert.deepEqual(seen.messages, [], "no 'not available yet' message");
});

test("Confirm Reset zeroes that row's streak, which then counts kills from there; Cancel leaves it", (t) => {
  const { player, seen } = newPlayer(t);
  setKills(player, "Wintertodt", 720);
  setKills(player, "Zulrah", 30);
  bossLogFromRing(player);
  click(player, RESET, row("Wintertodt"));
  click(player, CONFIRM);
  let log = lastLog(seen);
  assert.equal(log.kills[row("Wintertodt")], 720, "the kill count stays");
  assert.equal(log.streaks[row("Wintertodt")], 0);
  assert.equal(log.streaks[row("Zulrah")], 30, "other rows keep theirs");

  click(player, RESET, row("Zulrah"));
  click(player, CANCEL);
  const draws = seen.scripts.length;
  click(player, CONFIRM);
  assert.equal(seen.scripts.length, draws, "a Confirm after Cancel resets nothing");

  setKills(player, "Wintertodt", 801);
  bossLogFromRing(player);
  log = lastLog(seen);
  assert.equal(log.streaks[row("Wintertodt")], 81, "kills since the reset (as the capture's 720 / 81)");
  assert.equal(log.streaks[row("Zulrah")], 30);
  assert.deepEqual(player.getAttribute(KillLog.STREAK_BASES_ATTRIBUTE), { Wintertodt: 720 });
});

test("an Awakened row shows '---' and shares the standard boss's streak", (t) => {
  const { player, seen } = newPlayer(t);
  setKills(player, "Vardorvis", 10);
  setKills(player, "Vardorvis (Awakened)", 3);
  bossLogFromRing(player);
  let log = lastLog(seen);
  assert.equal(log.kills[row("Vardorvis (Awakened)")], 3);
  assert.equal(log.streaks[row("Vardorvis (Awakened)")], -1, "script 9528 draws a negative streak as ---");
  assert.equal(log.streaks[row("Vardorvis")], 13, "the Awakened kills count for Vardorvis's streak");
  for (const name of ["Duke Sucellus (Awakened)", "The Leviathan (Awakened)", "The Whisperer (Awakened)"]) {
    assert.equal(log.streaks[row(name)], -1, name);
  }

  const draws = seen.scripts.length;
  click(player, RESET, row("Vardorvis (Awakened)"));
  click(player, CONFIRM);
  assert.equal(seen.scripts.length, draws, "the client refuses an Awakened reset, so nothing is reset");

  click(player, RESET, row("Vardorvis"));
  click(player, CONFIRM);
  setKills(player, "Vardorvis (Awakened)", 4);
  bossLogFromRing(player);
  log = lastLog(seen);
  assert.equal(log.streaks[row("Vardorvis")], 1, "one Awakened kill since the reset");
});

test("the streaks are saved with the player", () => {
  const key = KillLog.STREAK_BASES_ATTRIBUTE;
  assert.ok(PlayerSave.persistentAttributeKeys.has(key));
});

test("a log closed before Confirm Reset resets nothing", (t) => {
  const { player, seen } = newPlayer(t);
  setKills(player, "Zulrah", 9);
  bossLogFromRing(player);
  click(player, RESET, row("Zulrah"));
  player.getPacketSender().sendInterfaceRemoval();
  const event = { player, buttonId: CONFIRM, groupId: KILL_LOG, childId: 25, slot: -1, action: 0, opId: 1, handled: false };
  PM.emitInterfaceActionClick(event);
  assert.equal(player.getAttribute(KillLog.STREAK_BASES_ATTRIBUTE)?.Zulrah, undefined);
  assert.equal(seen.scripts.filter(([id]) => id === KILLCOUNTS).length, 1);
});
