// Run after `yarn build`: node --test tests/altar-recharge-spam.test.cjs
//
// Praying at an altar: "You recharge your Prayer points." goes on the spam (filtered) channel, as in all 56 recorded
// recharges (rsprox_transcripts/233/03242.txt:5471, a normal world); "You already have full Prayer points." is a game
// message (230/02850.txt:7450). The real plugin's Pray-at handler, a real Player.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");

let core;
const interactions = new Map();
before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  require("../plugins/objects/Altars.plugin").register(new Proxy({
    core, onObjectInteraction: (name, actions) => interactions.set(name, actions),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function prayAt(t, current) {
  const p = new Player(new BotPlayerSession());
  p.setUsername("altarspam");
  p.getSkillManager().setMaxLevel(core.Skill.PRAYER, 70).setCurrentLevel(core.Skill.PRAYER, current);
  const game = [], typed = [];
  t.mock.method(p, "sendMessage", (m) => game.push(m));
  const sender = p.getPacketSender(), sendTyped = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, "sendTypedMessage", (type, text, ...rest) => { typed.push([type, text]); return sendTyped(type, text, ...rest); });
  assert.equal(interactions.get("Altar")["Pray-at"]({ player: p }), true);
  t.mock.restoreAll();
  return { p, game, typed };
}

test("a recharge is a spam line; a full Prayer refusal a game message", (t) => {
  const drained = prayAt(t, 30);
  assert.equal(drained.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 70);
  assert.deepEqual(drained.typed, [[core.ChatType.SPAM, "You recharge your Prayer points."]]);
  assert.deepEqual(drained.game, []);
  const full = prayAt(t, 70);
  assert.deepEqual(full.game, ["You already have full Prayer points."]);
  assert.deepEqual(full.typed, []);
});
