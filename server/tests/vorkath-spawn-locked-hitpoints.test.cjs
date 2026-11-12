// Run after `yarn build`: node --test tests/vorkath-spawn-locked-hitpoints.test.cjs
// While her zombified spawn is up Vorkath is immune (Wiki). Thralls, recoil and vengeance queue their damage straight to
// her HitQueue (ArceuusThralls.ts, CombatFactory recoil/vengeance), past the hit hook that zeroes ordinary hits, so her
// hitpoints are held for the spawn and freed after it. Real engine: every plugin loaded, a real Vorkath and Player,
// damage through Mobile.decrementHealth (the path HitQueue.applyDamage takes).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, Specials;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  Specials = require("../plugins/bosses/vorkath/Specials.Vorkath");
});
after(() => PM.emitServerShutdown({}));

test("damage that skips her hit hook can't hurt Vorkath while her spawn is up, and can again after", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9995); p.setUsername("vorkathfoe"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2272, 4054, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const vorkath = core.NPC.create(core.NpcIdentifiers.VORKATH, new core.Location(2269, 4062, 0));
  vorkath.setRegistered?.(true);
  t.after(() => { Specials.endFight(vorkath); vorkath.setRegistered?.(false); core.TaskManager.cancelTasks(vorkath); });
  vorkath.setHitpoints(750);
  const start = vorkath.getHitpoints();
  Specials.startSpawn(vorkath, p);
  vorkath.decrementHealth(new core.HitDamage(25, core.HitMask.RED));
  assert.equal(vorkath.getHitpoints(), start, "a thrall's or recoil's hit lands for nothing during the spawn");
  Specials.endSpawn(vorkath, Specials.fights.get(vorkath));
  vorkath.decrementHealth(new core.HitDamage(25, core.HitMask.RED));
  assert.equal(vorkath.getHitpoints(), start - 25, "after the spawn it hurts her again");
});
