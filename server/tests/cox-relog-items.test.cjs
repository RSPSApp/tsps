// Run after `yarn build`: node --test tests/cox-relog-items.test.cjs
// Raid-only items can't leave the Chambers of Xeric: a logout drops them inside. A save made mid-raid (shutdown,
// saveall, a requested save) still holds them with `cox:inside` set, so a login whose party can't be re-found takes
// them as it puts the player outside. Real engine: every plugin loaded, a real Player, the real login event.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Shared = require("../plugins/minigames/cox/Shared.ChambersOfXeric");

const OVERLOAD = 20996, XERICS_AID = 20984, KINDLING = 20799, WHIP = 4151, DARK_JOURNAL = 20899;
let core, next = 9800;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function saved(t, inside) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("coxrelog" + p.getIndex()); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3232, 5730, 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  if (inside) p.setAttribute(Shared.ATTR.INSIDE, true);
  for (const [id, n] of [[OVERLOAD, 1], [XERICS_AID, 1], [KINDLING, 20], [WHIP, 1], [DARK_JOURNAL, 1]]) p.getInventory().add(new core.Item(id, n), false);
  return p;
}

test("a login from a mid-raid save with no party to rejoin takes the raid-only items", (t) => {
  const p = saved(t, true);
  assert.ok(Shared.isRaidItem(OVERLOAD) && Shared.isRaidItem(XERICS_AID) && Shared.isRaidItem(KINDLING));
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  for (const id of [OVERLOAD, XERICS_AID, KINDLING]) assert.equal(p.getInventory().getAmount(id), 0, `raid item ${id} gone`);
  assert.equal(p.getInventory().getAmount(WHIP), 1, "own items kept");
  assert.equal(p.getInventory().getAmount(DARK_JOURNAL), 1, "the dark journal is kept, as leaving keeps it");
  assert.equal(p.getAttribute(Shared.ATTR.INSIDE) ?? null, null);
  const out = Shared.loc(Shared.OUTSIDE);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [out.getX(), out.getY()]);
});

test("a login with no raid record keeps everything", (t) => {
  const p = saved(t, false);
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  for (const id of [OVERLOAD, XERICS_AID, WHIP]) assert.equal(p.getInventory().getAmount(id), 1);
});
