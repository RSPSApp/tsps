// Run after `yarn build`: node --test tests/blood-money-pvp-mode.test.cjs
// Wiki (Blood money): a Deadman Mode currency. Here it is the PvP world's (PvpMode) currency: the PK shops only
// price in it while Presets is on, so a regular world's Wilderness player and bot kills pay none (issue #3895).
// Real Players and Inventories; only the network is stubbed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Wilderness } = require("../dist/game/content/wilderness/Wilderness");
const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const DeathLoot = require("../plugins/bots/runtime/DeathLoot.PlayerBots");

let core, real, defeated;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  real = PluginManager.createApi("BloodMoneyPvpModeTest");
  const api = new Proxy({ core,
    onPlayerDefeated: (handler) => { defeated = handler; },
    emitCustomEvent: () => {},
  }, { get: (object, name) => object[name] ?? real[name] ?? (() => {}) });
  require("../plugins/combat/KillStreaks.plugin").register(api);
  DeathLoot.initBotDeathLootCoreAccess(real);
});

let next = 0;
function actor(t, { bot = false } = {}) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername(`bloodmoney${next++}`);
  p.setPlayerBot(bot);
  p.isRegistered = () => true;
  const host = `10.0.0.${next}`;
  p.getHostAddress = () => host;
  p.setLocation(new core.Location(3093, 3540 + next, 0));
  const messages = [];
  p.sendMessage = (text) => messages.push(text);
  p.getPacketSender().sendMessage = (text) => { messages.push(text); return p.getPacketSender(); };
  t.after(() => core.TaskManager.cancelTasks(p));
  return { p, messages };
}

const money = (p) => p.getInventory().getAmount(core.ItemIdentifiers.BLOOD_MONEY);

function killBot(t, killer) {
  const bot = actor(t, { bot: true }).p;
  DeathLoot.handleBotDeathItemDrop({ player: bot, killer, item: new core.Item(core.ItemIdentifiers.COINS, 1), dropEligible: false }, null);
  DeathLoot.clearBotDeathLootPlan(bot);
}

function killPlayer(t, killer) {
  const victim = actor(t).p;
  defeated({ killer, victim });
}

test("a regular world (PvpMode off) pays no blood money for Wilderness player or bot kills", (t) => {
  assert.equal(Presets.isEnabled(), false);
  const killer = actor(t);
  assert.equal(Wilderness.isIn(killer.p), true, "the kill happens in the Wilderness");
  killPlayer(t, killer.p);
  killBot(t, killer.p);
  assert.equal(money(killer.p), 0);
  assert.equal(killer.messages.some((m) => /blood money/i.test(m)), false, killer.messages.join("|"));
  assert.equal(killer.p.getAttribute("pvp:killstreak"), 1, "the player kill still counts toward the streak");
});

test("a PvP world (PvpMode on) still pays its blood money rewards", (t) => {
  Presets.register(new Proxy({}, { get: (object, name) => real[name] ?? (() => {}) }));
  assert.equal(Presets.isEnabled(), true);
  const killer = actor(t);
  killPlayer(t, killer.p);
  assert.equal(money(killer.p), 150, "base player-kill reward");
  killBot(t, killer.p);
  assert.equal(money(killer.p), 300, "standard-profile bot reward");
  assert.ok(killer.messages.includes("You've received 150 blood money for that kill!"), killer.messages.join("|"));
});
