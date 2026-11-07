// Run after `yarn build`: node --test tests/tob-relog-items.test.cjs
// A save made mid-raid (shutdown, saveall, a requested save) carries no logout record. Logging in from it inside the
// theatre with no raid to rejoin, the player is put outside and leaves the Theatre's own items behind: the Dawnbringer
// ("never leaves Verzik's room") and the bandages (Wiki: neither tradeable nor bankable). Real engine: every plugin
// loaded, a real Player wielding the Dawnbringer, and the real login event.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Shared = require("../plugins/minigames/tob/Shared.TheatreOfBlood");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("a login in the theatre with no raid takes the worn Dawnbringer and the bandages, and puts the player outside", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9790); p.setUsername("tobrelog"); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3168, 4303, 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  assert.equal(Shared.inTheatre(p.getLocation()), true);
  const slot = core.Equipment.WEAPON_SLOT;
  p.getEquipment().setItem(slot, new core.Item(Shared.ITEM.DAWNBRINGER, 1));
  p.getInventory().add(new core.Item(Shared.ITEM.BANDAGES, 4), false);
  p.getInventory().add(new core.Item(4151, 1), false);
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.notEqual(p.getEquipment().getItems()[slot]?.getId(), Shared.ITEM.DAWNBRINGER, "Dawnbringer gone");
  assert.equal(p.getEquipment().getAmount(Shared.ITEM.DAWNBRINGER), 0);
  assert.equal(p.getInventory().getAmount(Shared.ITEM.BANDAGES), 0, "bandages gone");
  assert.equal(p.getInventory().getAmount(4151), 1, "own items kept");
  assert.equal(Shared.inTheatre(p.getLocation()), false, "put outside");
});
