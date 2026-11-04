// node --test tests/bot-names.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateBotName, botNameProblem } = require("../plugins/bots/lib/BotNames.PlayerBots");

test("names are valid and deterministic per username", () => {
  for (let i = 1; i <= 300; i += 1) {
    const name = generateBotName(`WildyBot${i}`);
    assert.equal(botNameProblem(name), null, name);
    assert.equal(name, generateBotName(`WildyBot${i}`));
  }
});

test("names are unique when taken ones are skipped", () => {
  const taken = new Set();
  for (let i = 1; i <= 300; i += 1) {
    const name = generateBotName(`WildyBot${i}`, (n) => taken.has(n.toLowerCase()));
    assert.ok(!taken.has(name.toLowerCase()), name);
    taken.add(name.toLowerCase());
  }
  assert.equal(taken.size, 300);
});


test("spawn names skip bots queued in the same batch", () => {
  const { Server } = require("../dist/Server");
  Server.installProductionPathResolver();
  const { createBotRegistry } = require("../plugins/bots/runtime/Registry.PlayerBots");
  const queued = [];
  const registry = createBotRegistry({
    botApi: {
      getRegionManager: () => ({}),
      core: {
        DisplayNames: { refusal: () => null },
        World: { getPlayers: () => [], getAddPlayerQueue: () => queued },
      },
    },
  });
  const names = new Set();
  for (let i = 1; i <= 8; i++) {
    const username = `WildyBot${i}`;
    const name = generateBotName(username, (candidate) => registry.botNameTaken(username, candidate));
    assert.ok(!names.has(name.toLowerCase()), `${username} reused ${name} before world registration`);
    names.add(name.toLowerCase());
    queued.push({ getUsername: () => username, getDisplayName: () => name });
  }
});

test("botname registers as developer-only and validates live renames", () => {
  const { registerBotCommands } = require("../plugins/bots/runtime/RegisterBotCommands.PlayerBots");
  const { PlayerRights } = require("../dist/game/model/rights/PlayerRights");
  const commands = new Map();
  const bot = {
    name: "Old Name", isPlayerBot: () => true, getUsername: () => "DevBot1",
    getDisplayName() { return this.name; }, setDisplayName(name) { this.name = name; },
  };
  registerBotCommands({
    api: { core: { World: { getPlayers: () => [bot] } }, onPlayerProcess() {},
      registerCommand: (name, handler, rank) => commands.set(name, { handler, rank }) },
    runtime: { botNameTaken: (_, name) => name === "Taken" },
    brainRegistry: { activities: [] },
  });
  const command = commands.get("botname");
  assert.equal(command.rank, PlayerRights.DEVELOPER);
  const messages = [];
  const invoke = (current, name) => command.handler({
    player: { sendMessage: message => messages.push(message) }, parts: ["botname", current, name],
  });
  invoke("Old_Name", "New_Name");
  assert.equal(bot.name, "New Name");
  invoke("DevBot1", "Taken");
  assert.equal(bot.name, "New Name");
  assert.match(messages.at(-1), /not available/);
  invoke("DevBot1", "mod_name");
  assert.equal(bot.name, "New Name");
  assert.match(messages.at(-1), /can't contain/);
  invoke("Missing", "Other");
  assert.match(messages.at(-1), /no bot/);
});
