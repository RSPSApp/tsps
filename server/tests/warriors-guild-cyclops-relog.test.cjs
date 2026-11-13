// Run after `yarn build`: node --test tests/warriors-guild-cyclops-relog.test.cjs
// Logging out inside a Warriors' Guild cyclops room and back in must leave the room as it was: tokens keep
// crumbling on the same minute clock, the defender the room will drop is still the one earned at the door, and
// the grace minute after the tokens run out carries on. Real engine: every plugin loaded, a real Player and
// Inventory, a PlayerSave round trip into a fresh Player, and the plugin's own handlers as it registers them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { PlayerSession } = require("../dist/net/PlayerSession");

const MINUTE_TICKS = 100;
const ARRIVING_TICKS = 3;
const TOP_ROOM_TILE = { x: 2852, y: 3545, z: 2 };
const TOP_LOBBY_TILE = { x: 2842, y: 3540, z: 2 };
const TOP_DOOR_TILE = { x: 2847, y: 3540, z: 2 };

let core;
let I;
let Guild;
let next = 9830;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Guild = require("../plugins/areas/warriors-guild/Common.WarriorsGuild");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername(name + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, messages };
}

/** The cyclops rooms exactly as the plugin registers them. */
function cyclopesHandlers() {
  const attach = require("../plugins/areas/warriors-guild/Cyclopes.WarriorsGuild");
  const h = { doors: [] };
  const real = PM.createApi("CyclopesRelogTest");
  attach(new Proxy(real, {
    get: (target, key) => {
      if (key === "onObjectInteraction") return (name, actions) => { if (name === "Door") h.doors.push(actions.Open); };
      if (key === "onPlayerProcess") return (handler) => { h.process = handler; };
      if (key === "onPlayerLogout") return (handler) => { h.logout = handler; };
      if (key === "onPlayerLogin") return (handler) => { h.login = handler; };
      if (key === "onCustomEvent") return (name, handler) => { if (name === "npc-drops:roll") h.drops = handler; };
      if (["onItemOnNpc", "onNpcDialogueCondition", "onCanUnequip", "onNpcHitModify"].includes(key)) return () => {};
      return target[key];
    },
  }));
  return h;
}

const at = (tile) => new core.Location(tile.x, tile.y, tile.z);

/** Walks in through Kamfreena's door with the tokens and defender given, then stands in the room. */
function enterTopRoom(t, h, { tokens, defender }) {
  const f = actor(t, "cyclops");
  f.p.setLocation(at(TOP_LOBBY_TILE));
  f.p.getInventory().add(new core.Item(Guild.ITEMS.TOKEN, tokens));
  if (defender) f.p.getInventory().add(new core.Item(defender, 1));
  h.doors[0]({ player: f.p, object: {}, location: TOP_DOOR_TILE });
  f.p.setLocation(at(TOP_ROOM_TILE));
  return f;
}

/** Log out (hooks, then the save), then log a fresh Player in from that save at the same spot. */
function relog(t, h, f) {
  h.logout({ player: f.p, username: f.p.getUsername() });
  const save = PlayerSave.fromPlayer(f.p);
  const fresh = actor(t, "cyclops");
  save.applyToPlayer(fresh.p);
  fresh.p.setLocation(f.p.getLocation().clone());
  h.login?.({ player: fresh.p, username: fresh.p.getUsername(), isNewAccount: false });
  return fresh;
}

function tick(h, player, times) {
  for (let i = 0; i < times; i++) h.process({ player });
}

const tokensOf = (player) => player.getInventory().getAmount(Guild.ITEMS.TOKEN);

function dropsFor(t, h, player) {
  t.mock.method(Guild, "random", () => 1);
  const drops = [];
  h.drops({ player, npc: { getLocation: () => player.getLocation() }, npcId: core.NpcIdentifiers.CYCLOPS_10, drops });
  return drops.map((drop) => drop.itemId);
}

test("the base drops distinguish upstairs and basement cyclopes", () => {
  const { loadDrops, tableForNpc } = require("../plugins/npcs/NpcDrops.plugin").__internals;
  loadDrops();
  const upstairs = [2463, 2464, 2465, 2466, 2467, 2468];
  const basement = [2137, 2138, 2139, 2140, 2141, 2142];
  for (const id of [...upstairs, ...basement]) {
    const { entries } = tableForNpc(id);
    const bones = entries.filter((entry) => entry.item_id === I.BIG_BONES);
    assert.equal(bones.length, 1, `cyclops ${id} has one Big bones row`);
    assert.ok(bones[0].always);
    assert.deepEqual(bones[0].quantity, [1, 1]);
    assert.equal(entries.some((entry) => entry.item_id === I.DRAGON_DEFENDER), basement.includes(id));
  }
});

test("tokens keep crumbling on the minute clock after a relog inside the room", (t) => {
  const h = cyclopesHandlers();
  const first = enterTopRoom(t, h, { tokens: 200 });
  assert.equal(tokensOf(first.p), 190, "ten tokens are taken at the door");
  tick(h, first.p, ARRIVING_TICKS + MINUTE_TICKS - 20);
  assert.equal(tokensOf(first.p), 190, "the first minute is not up yet");

  const second = relog(t, h, first);
  tick(h, second.p, 20);
  assert.equal(tokensOf(second.p), 180, "the minute that was running finishes after the relog");
  assert.ok(second.messages.some((message) => /tokens crumble away/.test(message)));
});

test("a relog does not restart the minute, so relogging cannot dodge the drain", (t) => {
  const h = cyclopesHandlers();
  let f = enterTopRoom(t, h, { tokens: 200 });
  tick(h, f.p, ARRIVING_TICKS);
  for (let minute = 0; minute < 3; minute++) {
    tick(h, f.p, MINUTE_TICKS - 1);
    f = relog(t, h, f);
  }
  tick(h, f.p, 3);
  assert.ok(tokensOf(f.p) < 190, "three minutes spent inside cost tokens however often the player relogged");
});

test("the room still drops the defender earned at the door after a relog", (t) => {
  const h = cyclopesHandlers();
  const first = enterTopRoom(t, h, { tokens: 200, defender: I.BRONZE_DEFENDER });
  assert.deepEqual(dropsFor(t, h, first.p), [I.IRON_DEFENDER]);
  const second = relog(t, h, first);
  assert.deepEqual(dropsFor(t, h, second.p), [I.IRON_DEFENDER]);
});

test("a defender won in the room does not advance the drop until the player re-enters, relog or not", (t) => {
  const h = cyclopesHandlers();
  const first = enterTopRoom(t, h, { tokens: 200 });
  first.p.getInventory().add(new core.Item(I.BRONZE_DEFENDER, 1)); // the drop just landed
  const second = relog(t, h, first);
  assert.deepEqual(dropsFor(t, h, second.p), [I.BRONZE_DEFENDER], "the room still drops the tier chosen at the door");
});

test("the grace minute after the tokens run out carries on across a relog", (t) => {
  const h = cyclopesHandlers();
  const first = enterTopRoom(t, h, { tokens: 105 });
  assert.equal(tokensOf(first.p), 95);
  tick(h, first.p, ARRIVING_TICKS + MINUTE_TICKS * 9); // nine minutes of drain leave 5: the grace minute starts
  assert.ok(tokensOf(first.p) < 10);
  tick(h, first.p, 50);
  const second = relog(t, h, first);
  tick(h, second.p, 49);
  assert.equal(second.p.getLocation().getX(), TOP_ROOM_TILE.x, "still inside with a tick of grace left");
  tick(h, second.p, 2);
  assert.notEqual(second.p.getLocation().getX(), TOP_ROOM_TILE.x, "teleported out when the grace minute is over");
});

test("a player who logged out outside the room logs back in with no room state", (t) => {
  const h = cyclopesHandlers();
  const first = enterTopRoom(t, h, { tokens: 200, defender: I.BRONZE_DEFENDER });
  first.p.setLocation(at(TOP_LOBBY_TILE));
  tick(h, first.p, ARRIVING_TICKS + 1); // the room clock notices they left
  const second = relog(t, h, first);
  assert.deepEqual(second.p.getAttribute("warriors-guild:room"), {}, "no clock was resumed for someone who was outside");
  // Put back in the room without the door, they are on a fresh clock from then (no entry fee, a minute to the first 10).
  second.p.setLocation(at(TOP_ROOM_TILE));
  tick(h, second.p, MINUTE_TICKS - 1);
  assert.equal(tokensOf(second.p), 190, "not a stale clock");
  tick(h, second.p, 1);
  assert.equal(tokensOf(second.p), 180, "a fresh one");
});

/** Saves a player who is still online (autosave, shutdown or a crash: no logout hook) and loads a fresh Player at the same spot. */
function saveWithoutLogout(t, h, f) {
  const save = PlayerSave.fromPlayer(f.p);
  const fresh = actor(t, "cyclops");
  save.applyToPlayer(fresh.p);
  fresh.p.setLocation(f.p.getLocation().clone());
  h.login({ player: fresh.p, username: fresh.p.getUsername(), isNewAccount: false });
  return fresh;
}

test("a save taken while still online (no logout hook) resumes the room clock", (t) => {
  const h = cyclopesHandlers();
  const first = enterTopRoom(t, h, { tokens: 200, defender: I.BRONZE_DEFENDER });
  tick(h, first.p, ARRIVING_TICKS + MINUTE_TICKS - 20);
  const second = saveWithoutLogout(t, h, first);
  assert.deepEqual(dropsFor(t, h, second.p), [I.IRON_DEFENDER], "the tier chosen at the door survives");
  tick(h, second.p, 20);
  assert.equal(tokensOf(second.p), 180, "the minute that was running finishes after the restart");
});

test("a save taken while still online keeps the grace minute running", (t) => {
  const h = cyclopesHandlers();
  const first = enterTopRoom(t, h, { tokens: 105 });
  tick(h, first.p, ARRIVING_TICKS + MINUTE_TICKS * 9 + 50);
  const second = saveWithoutLogout(t, h, first);
  tick(h, second.p, 49);
  assert.equal(second.p.getLocation().getX(), TOP_ROOM_TILE.x, "still inside with a tick of grace left");
  tick(h, second.p, 2);
  assert.notEqual(second.p.getLocation().getX(), TOP_ROOM_TILE.x, "moved out when the grace minute is over");
});

test("a save taken after leaving the room carries no room state", (t) => {
  const h = cyclopesHandlers();
  const first = enterTopRoom(t, h, { tokens: 200 });
  first.p.setLocation(at(TOP_LOBBY_TILE));
  tick(h, first.p, ARRIVING_TICKS + 1);
  const second = saveWithoutLogout(t, h, first);
  assert.deepEqual(second.p.getAttribute("warriors-guild:room"), {});
  second.p.setLocation(at(TOP_ROOM_TILE));
  tick(h, second.p, MINUTE_TICKS - 1);
  assert.equal(tokensOf(second.p), 190, "not a stale clock");
  tick(h, second.p, 1);
  assert.equal(tokensOf(second.p), 180, "a fresh one");
});

test("logging in inside a room with no saved state moves the player out", (t) => {
  const h = cyclopesHandlers();
  const f = actor(t, "cyclops");
  f.p.setLocation(at(TOP_ROOM_TILE));
  h.login({ player: f.p, username: f.p.getUsername(), isNewAccount: false });
  assert.notEqual(f.p.getLocation().getX(), TOP_ROOM_TILE.x);
  assert.equal(f.p.getLocation().getX(), TOP_DOOR_TILE.x - 1);
});

test("corrupt saved room state is treated as no state", (t) => {
  const h = cyclopesHandlers();
  const corrupt = [
    { room: "top", tier: "1", ticks: 5, graceTicks: -1 },
    { room: "top", tier: 1, ticks: NaN, graceTicks: -1 },
    { room: "top", tier: 1, ticks: 5, graceTicks: "50" },
    { room: "top", tier: 1.5, ticks: 5, graceTicks: -1 },
    { room: "basement", tier: 1, ticks: 5, graceTicks: -1 },
  ];
  for (const state of corrupt) {
    const f = actor(t, "cyclops");
    f.p.setLocation(at(TOP_ROOM_TILE));
    f.p.setAttribute("warriors-guild:room", state);
    h.login({ player: f.p, username: f.p.getUsername(), isNewAccount: false });
    assert.equal(f.p.getLocation().getX(), TOP_DOOR_TILE.x - 1, JSON.stringify(state));
  }
});
