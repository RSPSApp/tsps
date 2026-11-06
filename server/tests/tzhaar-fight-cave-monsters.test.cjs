// Run after `yarn build`: node --test tests/tzhaar-fight-cave-monsters.test.cjs
//
// #2653. Waves against the Wiki's list; a cave monster keeping its target while it can't get to the player, as capture 551
// shows; a Yt-HurKot not healing Jad while it fights the player, as captures 83 and 551 show.
//
// Real: the plugin, the map, the run resumed by the plugin's own login hook, npc_option for the attack, the combat loop.
// Fixture seams: only that one login hook is called, so other plugins' login work stays out of it; ticks are
// driven by hand, Jad is flagged combat:no-regen, as unhit here he'd regain 10% a tick and hide any healing, the player's hitpoints are topped up each tick so a run survives, and monsters are moved
// with setLocation to where the capture stood them. No client ran.
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
const Plugin = require("../plugins/minigames/TzhaarFightCaves.plugin");

const ATTR_WAVE = "tzhaar:fight-cave-wave";
const ATTR_ROTATION = "tzhaar:fight-cave-rotation";

let core;
let next = 9700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2400, 5088);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  setImmediate(() => process.exit());
});

/** A player resuming a run at this wave, through the plugin's own login hook. */
function resume(t, wave) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("caveqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2400, 5088, 0));
  p.setAttribute(ATTR_WAVE, wave);
  p.setAttribute(ATTR_ROTATION, 0);
  const c = new ClientConnection(channel);
  c.player = p;
  const hooks = PM.loginHooks.filter((hook) => hook.pluginName === "TzhaarFightCaves");
  assert.equal(hooks.length, 1, "control: the cave's own login hook");
  hooks[0].handler({ player: p, username: p.getUsername() });
  assert.ok(p.getPrivateArea(), `control: the hook put them in a run: ${p.getLocation().getX()},${p.getLocation().getY()}, wave ${p.getAttribute(ATTR_WAVE)}`);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c };
}

// The area's own list: getNpcs() holds only NPCs that have been processed into it, as the world loop does.
const inCave = (f) => (f.p.getPrivateArea()?.entities ?? []).filter((entity) => entity.isNpc?.());
const alive = (f, id) => inCave(f).filter((npc) => npc.getId() === id && npc.getHitpoints() > 0);

function tick(f, count) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    f.c.processTurnPackets();
    f.p.setHitpoints(990);
    f.p.needsPlacement = false;
    f.p.process();
    PM.emitPlayerProcess({ player: f.p });
    for (const npc of inCave(f)) if (npc.isRegistered()) npc.process();
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getSession().flushClient(core.World.processCycle);
    f.p.resetUpdating();
  }
}

function waitForWave(f, id) {
  for (let i = 0; i < 15 && alive(f, id).length === 0; i++) tick(f, 1);
  const at = f.p.getLocation();
  assert.ok(alive(f, id).length > 0, `control: npc ${id} came: player at ${at.getX()},${at.getY()}, area ${f.p.getArea()?.constructor?.name}, wave ${f.p.getAttribute(ATTR_WAVE)}, npcs ${inCave(f).map((npc) => npc.getId())}`);
}

const put = (mobile, x, y) => mobile.setLocation(new core.Location(x, y, 0));

// Wiki, TzHaar Fight Cave, wave list: h Tz-Kih, e Tz-Kek, x Tok-Xil, m Yt-MejKot, k Ket-Zek.
const WIKI_WAVES = [
  "h", "hh", "e", "eh", "ehh", "ee", "x", "xh", "xhh", "xe", "xeh", "xehh", "xee", "xx", "m", "mh", "mhh", "me", "meh", "mehh",
  "mee", "mx", "mxh", "mxhh", "mxe", "mxeh", "mxehh", "mxee", "mxx", "mm", "k", "kh", "khh", "ke", "keh", "kehh", "kee", "kx",
  "kxh", "kxhh", "kxe", "kxeh", "kxehh", "kxee", "kxx", "km", "kmh", "kmhh", "kme", "kmeh", "kmehh", "kmee", "kmx", "kmxh",
  "kmxhh", "kmxe", "kmxeh", "kmxehh", "kmxee", "kmxx", "kmm", "kk",
];

test("the waves are the Wiki's: 31 and 32 have one Ket-Zek", () => {
  const { NpcIdentifiers: N } = core;
  const letters = new Map([[N.TZ_KIH_3, "h"], [N.TZ_KEK_3, "e"], [N.TOK_XIL_4, "x"], [N.YT_MEJKOT, "m"], [N.KET_ZEK, "k"]]);
  WIKI_WAVES.forEach((want, index) => {
    const got = Plugin.waveMonsters(index + 1).map((id) => letters.get(id)).join("");
    assert.equal(got, want, `wave ${index + 1}`);
  });
});

test("wave 31 in a real run spawns one Ket-Zek", (t) => {
  const f = resume(t, 31);
  waitForWave(f, core.NpcIdentifiers.KET_ZEK);
  tick(f, 5);
  assert.equal(alive(f, core.NpcIdentifiers.KET_ZEK).length, 1);
  assert.equal(inCave(f).length, 1, "and nothing else");
});

test("a monster that can't get to the player keeps it, and comes on when it can", (t) => {
  const f = resume(t, 1);
  waitForWave(f, core.NpcIdentifiers.TZ_KIH_3);
  const [kih] = alive(f, core.NpcIdentifiers.TZ_KIH_3);
  // Capture 551, ticks 8050-8070: a Tz-Kih stood at 2384,5095 for 20 ticks, unclicked, with the player at 2384,5075 and
  // never cleared its face. Then the player moved, and it walked on.
  put(kih, 2384, 5095);
  put(f.p, 2384, 5075);
  tick(f, 20);
  t.diagnostic(`stood at ${kih.getLocation().getX()},${kih.getLocation().getY()}`);
  assert.equal(kih.getCombat().getTarget() === f.p, true, "still after the player");
  assert.ok(kih.calculateDistance(f.p) > 1, "control: it hasn't got there");
  put(f.p, 2388, 5090);
  const before = kih.calculateDistance(f.p);
  tick(f, 8);
  assert.ok(kih.calculateDistance(f.p) < before, "and it comes on");
});

function jadWithOneHealer(t) {
  const f = resume(t, 63);
  const { NpcIdentifiers: N } = core;
  waitForWave(f, N.TZTOK_JAD);
  const [jad] = alive(f, N.TZTOK_JAD);
  jad.setFlag("combat:no-regen");
  jad.setHitpoints(100);
  tick(f, 1);
  const healers = alive(f, N.YT_HURKOT);
  assert.equal(healers.length, 4, "control: 4 healers at half health");
  for (const other of healers.slice(1)) other.setHitpoints(0);
  tick(f, 1);
  const healer = healers[0];
  const at = jad.getLocation();
  put(healer, at.getX() - 1, at.getY());
  put(f.p, at.getX() - 2, at.getY());
  return { f, jad, healer };
}

test("a healer beside Jad heals him until it fights the player, and goes back when the player is far", async (t) => {
  const { f, jad, healer } = jadWithOneHealer(t);
  const start = jad.getHitpoints();
  tick(f, 8);
  assert.equal(jad.getHitpoints(), start + 10, "control: left alone beside him, it heals 5 every 4 ticks");

  await f.c.dispatch([{ type: "npc_option", index: healer.getIndex(), clickType: 2 }]);
  for (let i = 0; i < 20 && healer.getCombat().getTarget() !== f.p; i++) tick(f, 1);
  assert.equal(healer.getCombat().getTarget() === f.p, true, "control: hit, it turned on the player");
  f.p.getCombat().reset();
  const at = jad.getLocation();
  put(healer, at.getX() - 1, at.getY());
  put(f.p, at.getX() - 2, at.getY());
  const fighting = jad.getHitpoints();
  tick(f, 8);
  assert.equal(healer.getCombat().getTarget() === f.p, true, "control: still fighting");
  assert.ok(healer.calculateDistance(jad) <= 5, "control: within the Wiki's 5 tiles");
  assert.equal(jad.getHitpoints(), fighting, "no healing while it fights");

  // Hit again, then held 12 tiles off: it keeps the player for the 9 ticks after the hit, then lets go.
  const lastHit = () => healer.getAttribute("tzhaar:healer-last-hit");
  const before = lastHit();
  put(healer, at.getX() - 1, at.getY());
  put(f.p, at.getX() - 2, at.getY());
  await f.c.dispatch([{ type: "npc_option", index: healer.getIndex(), clickType: 2 }]);
  for (let i = 0; i < 40 && lastHit() === before; i++) tick(f, 1);
  assert.notEqual(lastHit(), before, "control: hit again");
  f.p.getCombat().reset();
  const farOff = () => {
    f.p.getCombat().reset(); // Its own retaliation would walk them back within the 10 tiles.
    // East: with rotation 0 Jad is at the north-west spawn, and 12 west of him is outside the cave, which ends the run.
    put(f.p, healer.getLocation().getX() + 12, healer.getLocation().getY());
    tick(f, 1);
  };
  for (let i = 0; i < 4; i++) farOff();
  assert.equal(healer.getCombat().getTarget() === f.p, true, "freshly hit, it keeps the player though far");
  assert.equal(f.p.getAttribute(ATTR_WAVE), 63, "control: the run is still on");
  for (let i = 0; i < 8; i++) farOff();
  assert.equal(healer.getCombat().getTarget() === f.p, false, `then, the player too far, it lets go: ${healer.calculateDistance(f.p)} tiles, last hit ${lastHit()}, cycle ${core.World.getProcessCycle()}, wave ${f.p.getAttribute(ATTR_WAVE)}`);
});
