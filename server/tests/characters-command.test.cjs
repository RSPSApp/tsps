// Run after `yarn build`: node --test tests/characters-command.test.cjs
// ::characters <name> lists an account's characters (developer rank, read-only).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, after } = require("node:test");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "characters-command-"));
process.env.TSPS_ACCOUNTS_FILE = path.join(directory, "accounts.json");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { CommandPacketListener } = require("../dist/net/packet/impl/CommandPacketListener");
const Characters = require("../plugins/accounts/Characters.plugin");

const PLAYED_AT = Date.UTC(2026, 10, 3, 12, 30);
let core, Rights;

before(() => {
  core = PluginManager.getCoreApi();
  Rights = core.PlayerRights;
  const { Accounts } = core;
  Accounts.reset();
  Accounts.ensure("Hero", 1000);
  Accounts.addCharacter("hero", "Hero Alt", 2000);
  Accounts.addCharacter("hero", "Hero Fresh", 3000);
  Accounts.touchLastPlayed("hero", "Hero", PLAYED_AT);
  Accounts.touchLastPlayed("hero", "Hero Alt", PLAYED_AT);
  Characters.register(PluginManager.createApi("Characters"));
});

after(() => {
  core.Accounts.reset();
  fs.rmSync(directory, { recursive: true, force: true });
});

function login(rights) {
  const player = new Player(null);
  player.setUsername("Staff");
  player.setRights(rights);
  const messages = [];
  player.sendMessage = (text) => messages.push(text);
  return Object.assign(player, { messages });
}

const date = "2026-11-03 12:30 UTC";

test("::characters lists the account's characters, primary first, with the last played time", () => {
  const dev = login(Rights.DEVELOPER);
  CommandPacketListener.execute(dev, "characters Hero Alt");
  assert.deepEqual(dev.messages, [
    `Hero (primary) · last played ${date}`,
    `Hero Alt · last played ${date}`,
    "Hero Fresh · last played never",
  ]);
});

test("::characters reports an unknown name and a missing name", () => {
  const dev = login(Rights.DEVELOPER);
  CommandPacketListener.execute(dev, "characters Nobody");
  CommandPacketListener.execute(dev, "characters");
  assert.deepEqual(dev.messages, ["No account owns that name.", "Usage: ::characters <name>"]);
});

test("::characters is developer-only", () => {
  const admin = login(Rights.ADMINISTRATOR);
  CommandPacketListener.execute(admin, "characters Hero");
  assert.deepEqual(admin.messages, ["You do not have permission to use this command."]);
});

test("::releasename frees a deleted character's name and reports the outcome", () => {
  const { Accounts } = core;
  Accounts.addCharacter("hero", "Gone Guy", 4000);
  Accounts.removeCharacter("hero", "Gone Guy", 5000);
  const admin = login(Rights.ADMINISTRATOR);
  CommandPacketListener.execute(admin, "releasename gone_guy");
  CommandPacketListener.execute(admin, "releasename Gone Guy");
  CommandPacketListener.execute(admin, "releasename");
  assert.deepEqual(admin.messages, [
    "Released Gone Guy (deleted by hero). The name can be used again.",
    "No deleted character had that name.",
    "Usage: ::releasename <name>",
  ]);
  assert.equal(Accounts.isDeleted("gone guy"), false);
});

test("::releasename is administrator rank: a moderator is refused", () => {
  const { Accounts } = core;
  Accounts.addCharacter("hero", "Kept Guy", 4000);
  Accounts.removeCharacter("hero", "Kept Guy", 5000);
  const moderator = login(Rights.MODERATOR);
  CommandPacketListener.execute(moderator, "releasename Kept Guy");
  assert.deepEqual(moderator.messages, ["You do not have permission to use this command."]);
  assert.equal(Accounts.isDeleted("kept guy"), true);
});
