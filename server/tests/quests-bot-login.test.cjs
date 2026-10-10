// Run after `yarn build`: node --test tests/quests-bot-login.test.cjs
// The quests' login hooks skip bots (plugins/quests/Quests.plugin.js forPlayers): a bot has no
// client for quest progress, and running ~160 of them made each bot login cost ~85 ms.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const loginHooks = [];

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi();
  // Every other api call is a no-op; only the login hooks are kept.
  const api = new Proxy({}, {
    get: (_, property) => {
      if (property === "core") return core;
      if (property === "onPlayerLogin") return (handler) => loginHooks.push(handler);
      return () => undefined;
    },
  });
  const quiet = console.log;
  console.log = () => {};
  try {
    require("../plugins/quests/Quests.plugin.js").register(api);
  } finally {
    console.log = quiet;
  }
});

function playerSendingTo(sent, bot) {
  const sender = new Proxy({}, { get: (_, key) => (...args) => { sent.push(key); return sender; } });
  const attributes = new Map();
  return {
    isPlayerBot: () => bot,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUsername: () => (bot ? "DevBot1" : "Admin"),
    sendMessage: () => {},
  };
}

function login(player) {
  for (const hook of loginHooks) {
    try { hook({ player, username: player.getUsername(), isNewAccount: false }); } catch {}
  }
}

test("a bot's login runs none of the quests' login hooks", () => {
  assert.ok(loginHooks.length > 100, `the quests register their login hooks (${loginHooks.length})`);
  const sent = [];
  login(playerSendingTo(sent, true));
  assert.equal(sent.length, 0, "nothing sent for a bot");
});

test("a real player's login still sends the quest progress", () => {
  const sent = [];
  login(playerSendingTo(sent, false));
  assert.ok(sent.filter((key) => key === "sendConfig" || key === "sendVarbit").length > 50, "quest varps and varbits sent");
});
