// Run after `yarn build`: node --test tests/skull-commands-never-shorten.test.cjs
// ::skull and ::redskull replaced the skull's type and timer, so a player skulled for 30 minutes for attacking first
// could ::skull out of combat to a white 5-minute skull: Protect Item back, and the skull gone 25 minutes early (Wiki,
// Skull (status): only death removes it early). A self-skull only adds to a skull already there now. Real Player,
// the commands' own skull step and the real CombatFactory.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { SkullType } = require("../dist/game/model/SkullType");

let Commands;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  Commands = require("../plugins/commands/PlayerCommands.plugin")._test;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9060); p.setUsername("skull9060"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  return p;
}

test("::skull on a red 30-minute skull keeps it red and keeps the 30 minutes", (t) => {
  const p = player(t);
  CombatFactory.skull(p, SkullType.RED_SKULL, 60 * 30);
  const before = p.getSkullTimer();
  Commands.skullAtLeast(p, SkullType.WHITE_SKULL, 300);
  assert.equal(p.getSkullType(), SkullType.RED_SKULL, "still red: Protect Item stays off");
  assert.equal(p.getSkullTimer(), before, "not cut to 5 minutes");
});

test("::skull on no skull gives the white 5-minute skull, and ::redskull lengthens a white one", (t) => {
  const p = player(t);
  Commands.skullAtLeast(p, SkullType.WHITE_SKULL, 300);
  assert.equal(p.getSkullType(), SkullType.WHITE_SKULL);
  const five = p.getSkullTimer();
  assert.ok(five > 0);
  Commands.skullAtLeast(p, SkullType.RED_SKULL, 60 * 30);
  assert.equal(p.getSkullType(), SkullType.RED_SKULL);
  assert.ok(p.getSkullTimer() > five);
});
