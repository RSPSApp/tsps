// Run after `yarn build`: node --test tests/rfd-dragon-token-bank.test.cjs
//
// Recipe for Disaster (Sir Amik Varze): a black dragon in the Evil Chicken's Lair gives the dragon
// token only to a player who owns none, so a banked one blocks a second. Real plugins, a real
// Player, Inventory and Bank; the kill is PluginManager.emitNpcDeath. No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const AMIK_STATE_ATTRIBUTE = "recipe-for-disaster:amik-state";
let core;
let index = 7680;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, name) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(2461, 4367, 0)); // the Evil Chicken's Lair
  p.needsPlacement = false;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "recipe_for_disaster").setStage(p, 4);
  p.setAttribute(AMIK_STATE_ATTRIBUTE, 1);
  return p;
}

function killBlackDragon(p) {
  const id = core.NpcIdentifiers.BLACK_DRAGON;
  const npc = core.NPC.create(id, new core.Location(2462, 4367, 0));
  PM.emitNpcDeath({ killer: p, npc, npcId: id });
}

const tokens = (p) => p.getInventory().getAmount(core.ItemIdentifiers.DRAGON_TOKEN);

test("a banked dragon token stops the lair's black dragons giving another", (t) => {
  const fresh = player(t, "rfdtokenqa1");
  killBlackDragon(fresh);
  assert.equal(tokens(fresh), 1, "the first kill gives the token");
  killBlackDragon(fresh);
  assert.equal(tokens(fresh), 1, "no second while one is carried");

  const banked = player(t, "rfdtokenqa2");
  banked.getBank(3).add(new core.Item(core.ItemIdentifiers.DRAGON_TOKEN, 1));
  killBlackDragon(banked);
  assert.equal(tokens(banked), 0, "the banked token is still owned");

  const placeholder = player(t, "rfdtokenqa3");
  placeholder.getBank(0).add(new core.Item(core.ItemIdentifiers.DRAGON_TOKEN, 0));
  killBlackDragon(placeholder);
  assert.equal(tokens(placeholder), 1, "a placeholder is not a token");
});
