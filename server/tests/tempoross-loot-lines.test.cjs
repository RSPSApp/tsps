// Run after `yarn build`: node --test tests/tempoross-loot-lines.test.cjs
//
// The reward pool's loot lines, as recorded (rsprox_transcripts/227/00552.txt, 227/01858.txt, 234/03275.txt): spam
// "You found some loot: 60 x Spirit flakes" / "...: Casket", soaked pages a red game message
// "You found some loot: <col=ef1020>9 x Soaked page</col>". Real plugins, a real Player and Inventory.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const Rewards = require("../plugins/minigames/tempoross/Rewards.Tempoross");
const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});

test("loot on spam (commas for thousands), soaked pages a red game message", (t) => {
  const p = new Player(new BotPlayerSession());
  p.setUsername("tempoross-loot");
  const game = [], spam = [];
  t.mock.method(p, "sendMessage", (m) => game.push(m));
  t.mock.method(p.getPacketSender(), "sendTypedMessage", (type, m) => { (type === core.ChatType.SPAM ? spam : game).push(m); return p.getPacketSender(); });
  const I = core.ItemIdentifiers;
  Rewards.giveReward(p, { id: I.SPIRIT_FLAKES, amount: 60 });
  Rewards.giveReward(p, { id: I.FEATHER, amount: 1600 });
  Rewards.giveReward(p, { id: I.SOAKED_PAGE, amount: 9 });
  Rewards.giveReward(p, { id: I.CASKET, amount: 1 });
  // 227/01858.txt:126143: a unique, red: "You found some loot: <col=ef1020>Tackle box</col>".
  Rewards.giveReward(p, { id: I.TACKLE_BOX, amount: 1, unique: true });
  assert.deepEqual(spam, ["You found some loot: 60 x Spirit flakes", "You found some loot: 1,600 x Feather", "You found some loot: Casket"]);
  assert.deepEqual(game.filter((m) => m.startsWith("You found some loot")),
    ["You found some loot: <col=ef1020>9 x Soaked page</col>", "You found some loot: <col=ef1020>Tackle box</col>"]);
});

test("the uniques roll marks its reward as a unique", (t) => {
  const p = new Player(new BotPlayerSession());
  p.setUsername("tempoross-unique");
  t.mock.method(Math, "random", () => 0);
  const reward = Rewards.roll(p);
  assert.equal(reward.unique, true, JSON.stringify(reward));
});

test("the loot line goes out before the inventory update that adds the reward (227/01858 [4120]; RuneLite loot tracker)", (t) => {
  const p = new Player(new BotPlayerSession());
  p.setUsername("tempoross-order");
  const I = core.ItemIdentifiers;
  const sent = [];
  t.mock.method(p, "sendMessage", (m) => sent.push(m));
  t.mock.method(p.getPacketSender(), "sendTypedMessage", (type, m) => { sent.push(m); return p.getPacketSender(); });
  const inventory = p.getInventory();
  const refresh = inventory.refreshItems.bind(inventory);
  t.mock.method(inventory, "refreshItems", () => { sent.push(`inventory: ${inventory.getAmount(I.SPIRIT_FLAKES)} flakes`); return refresh(); });
  Rewards.giveReward(p, { id: I.SPIRIT_FLAKES, amount: 43 });
  const loot = sent.indexOf("You found some loot: 43 x Spirit flakes");
  assert.ok(loot >= 0, JSON.stringify(sent));
  assert.ok(sent.indexOf("inventory: 43 flakes") > loot, JSON.stringify(sent));
});

test("Net at the reward pool spends the permit (tempoross_rewardpermits) before the loot line (227/01858 [4120], [4123])", (t) => {
  const Records = require("../plugins/minigames/tempoross/Records.Tempoross");
  const hooks = {};
  Rewards.attachRewards({ onObjectInteraction: (name, h) => { hooks[name] = h; }, onNpcInteraction() {}, onItemAction() {} });
  const p = new Player(new BotPlayerSession());
  p.setUsername("tempoross-permit-order");
  t.mock.method(p, "isRegistered", () => true);
  const I = core.ItemIdentifiers;
  p.getInventory().adds(I.SMALL_FISHING_NET, 1);
  Records.setPermits(p, 2);
  const sent = [];
  t.mock.method(p, "sendMessage", (m) => sent.push(m));
  t.mock.method(p.getPacketSender(), "sendTypedMessage", (type, m) => { sent.push(m); return p.getPacketSender(); });
  const sendVarbit = p.getPacketSender().sendVarbit.bind(p.getPacketSender());
  t.mock.method(p.getPacketSender(), "sendVarbit", (id, value) => {
    if (id === 11936) sent.push(`permits=${value}`);
    return sendVarbit(id, value);
  });
  assert.equal(hooks["Reward pool"].Net({ player: p, objectId: 41356 }), true);
  for (let i = 0; i < 20 && !sent.some((m) => String(m).startsWith("You found some loot")); i++) core.TaskManager.process();
  const loot = sent.findIndex((m) => String(m).startsWith("You found some loot"));
  assert.ok(loot >= 0, JSON.stringify(sent));
  assert.equal(sent[loot - 1], "permits=1", JSON.stringify(sent));
  assert.equal(Records.permits(p), 1);
  Shared.stopAction?.(p);
});
