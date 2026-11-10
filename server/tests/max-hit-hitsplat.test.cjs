// Run after `yarn build`: node --test tests/max-hit-hitsplat.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { settingClicked, restore } = require("../plugins/interface/MaxHitThreshold.plugin")._test;

function createPlayer(threshold = 0) {
  const log = [];
  const attributes = new Map();
  let amountAction = null;
  const sender = {
    sendVarbit: (id, value) => { log.push(`varbit ${id}=${value}`); return sender; },
    sendEnterAmountPrompt: (title) => { log.push(`prompt ${title}`); return sender; },
    getVarbit: (id) => (id === 14195 ? threshold : 0),
  };
  return {
    log,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    setEnteredAmountAction: (action) => { amountAction = action; },
    answer: (amount) => amountAction.execute(amount),
  };
}

function typeFor(player, hit, onMe = false) {
  const session = Object.create(PlayerSession.prototype);
  session.player = player;
  return session.hitView(hit, onMe).type;
}

test("a rolled max hit the player dealt is the max splat; below max, or a hit on them, is not", () => {
  const player = createPlayer();
  const max = new HitDamage(25, HitMask.RED).setRolledMaximum(25).setSource(player);
  assert.equal(typeFor(player, max), 43);
  assert.equal(typeFor(player, new HitDamage(24, HitMask.RED).setRolledMaximum(25).setSource(player)), 16);
  assert.equal(typeFor(player, new HitDamage(25, HitMask.RED).setSource(player)), 16, "fixed damage never counts");
  assert.equal(typeFor(player, max, true), 16, "hits on the player are not theirs");
  assert.equal(typeFor(player, new HitDamage(25, HitMask.RED).setRolledMaximum(25).setSource({})), 17, "someone else's hit stays dark");
  assert.equal(typeFor(player, new HitDamage(25, HitMask.YELLOW).setRolledMaximum(25).setSource(player)), 46);
});

test("max hits below the threshold keep the ordinary splat", () => {
  const player = createPlayer(30);
  assert.equal(typeFor(player, new HitDamage(25, HitMask.RED).setRolledMaximum(25).setSource(player)), 16);
  assert.equal(typeFor(player, new HitDamage(30, HitMask.RED).setRolledMaximum(30).setSource(player)), 43);
});

test("the threshold row asks for a number, saves it (at most 511) and sends it again on login", () => {
  const player = createPlayer();
  const request = { player, settingId: 280, handled: false };
  settingClicked(request);
  assert.equal(request.handled, true);
  assert.equal(player.log.at(-1).startsWith("prompt "), true);
  player.log.length = 0;
  player.answer(40);
  assert.deepEqual(player.log, ["varbit 14195=40", "varbit 16075=0", "varbit 12393=0"]);
  settingClicked({ player, settingId: 280, handled: false });
  player.answer(9999);
  assert.equal(player.getAttribute("settings.max-hit-hitsplat-threshold"), 511);
  player.log.length = 0;
  restore({ player });
  assert.deepEqual(player.log, ["varbit 14195=511"]);
  const other = { player, settingId: 1, handled: false };
  settingClicked(other);
  assert.equal(other.handled, false);
});
