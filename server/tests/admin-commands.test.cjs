// Run after `yarn build`: node --test tests/admin-commands.test.cjs
// ::infrun, ::give and ::setlevel (issue #593), typed the way the chatbox sends them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");
const { CommandPacketListener } = require("../dist/net/packet/impl/CommandPacketListener");
const AdminCommands = require("../plugins/commands/AdminCommands.plugin");

const NO_PERMISSION = "You do not have permission to use this command.";
let core, I, Skill, Rights;
let online = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  ({ ItemIdentifiers: I, Skill, PlayerRights: Rights } = core);
  // Online means in this list; World.getPlayerByName still matches names its own way.
  core.World.players = { search: (match) => online.find(match) ?? null, forEach: (each) => online.forEach(each) };
  AdminCommands.register(PluginManager.createApi("AdminCommands"));
});

beforeEach(() => {
  online = [];
});

/** An online player of this rank, with their messages and every run energy the orb was sent. */
function login(username, rights = Rights.NONE) {
  const player = new Player(null);
  player.setUsername(username);
  player.setRights(rights);
  const messages = [];
  const orb = [];
  const sender = new Proxy({}, {
    get: (target, key) => (key === "sendRunEnergy" ? () => (orb.push(player.getRunEnergy()), sender) : () => sender),
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  online.push(player);
  return Object.assign(player, { messages, orb });
}

/** Typing ::text in the chatbox. */
const type = (player, text) => CommandPacketListener.execute(player, text);

test("::infrun keeps run energy full while running, until it is turned off", () => {
  const owner = login("Owner", Rights.OWNER);
  owner.setRunning(true);
  owner.setRunEnergy(40);
  type(owner, "infrun");
  assert.equal(owner.getRunEnergy(), 100, "topped up at once");
  assert.equal(owner.messages.at(-1), "Your run energy now stays full. ::infrun again to stop.");

  const run = (steps) => {
    for (let step = 0; step < steps; step++) {
      owner.getMovementQueue().drainRunEnergy(); // what each running step costs
      PluginManager.emitPlayerProcess({ player: owner }); // plugins process after movement in a tick
    }
  };
  run(150);
  assert.equal(owner.getRunEnergy(), 100);
  assert.equal(owner.isRunningReturn(), true);
  assert.equal(owner.orb.at(-1), 100, "the orb is left showing full");

  type(owner, "infrun");
  assert.equal(owner.messages.at(-1), "Your run energy drains as normal again.");
  run(150);
  assert.equal(owner.getRunEnergy(), 0);
  assert.equal(owner.isRunningReturn(), false, "out of energy, so walking");
});

test("::infrun and ::setlevel need an owner, ::give an administrator", () => {
  const admin = login("Admin", Rights.ADMINISTRATOR);
  const moderator = login("Moderator", Rights.MODERATOR);
  admin.setRunEnergy(50);
  type(admin, "infrun");
  type(admin, "setlevel attack 99");
  type(moderator, "give 385 1 Moderator");
  assert.deepEqual(admin.messages, [NO_PERMISSION, NO_PERMISSION]);
  assert.deepEqual(moderator.messages, [NO_PERMISSION]);
  assert.equal(admin.getRunEnergy(), 50);
  assert.equal(admin.getSkillManager().getMaxLevel(Skill.ATTACK), 1);
  assert.equal(moderator.getInventory().getAmount(I.SHARK), 0);

  type(admin, "give 385 1 Admin");
  assert.equal(admin.getInventory().getAmount(I.SHARK), 1);
});

test("::give puts items in another player's inventory and tells them who gave them", () => {
  const admin = login("Admin", Rights.ADMINISTRATOR);
  const bob = login("Bob Smith");
  type(admin, "give 385 5 bob smith");
  assert.equal(bob.getInventory().getAmount(I.SHARK), 5);
  assert.equal(admin.messages.at(-1), "Gave Bob Smith 5 x Shark (385).");
  assert.equal(bob.messages.at(-1), "Admin gave you 5 x Shark.");

  type(admin, "give 4151 bob"); // one, to the only player whose name starts with "bob"
  assert.equal(bob.getInventory().getAmount(I.ABYSSAL_WHIP), 1);
  type(admin, "give 995 1000000 [Bob Smith]");
  assert.equal(bob.getInventory().getAmount(I.COINS), 1000000);
});

test("::give takes a number before the name as the amount", () => {
  const admin = login("Admin", Rights.ADMINISTRATOR);
  const guys = login("5 Guys");
  type(admin, "give 385 1 5 guys");
  assert.equal(guys.getInventory().getAmount(I.SHARK), 1);
  assert.equal(admin.messages.at(-1), "Gave 5 Guys 1 x Shark (385).");
});

test("::give gives only what fits, and refuses unknown items and players who aren't online", () => {
  const admin = login("Admin", Rights.ADMINISTRATOR);
  const bob = login("Bob");
  bob.getInventory().adds(I.COINS, 1);
  for (let slot = 0; slot < 25; slot++) bob.getInventory().adds(I.ABYSSAL_WHIP, 1);
  type(admin, "give 385 5 bob");
  assert.equal(bob.getInventory().getAmount(I.SHARK), 2);
  assert.equal(admin.messages.at(-1), "Gave Bob 2 x Shark (385); only 2 of 5 fit.");
  assert.deepEqual(bob.messages, ["Admin gave you 2 x Shark."], "not told they couldn't hold the rest");

  type(admin, "give 995 100 bob"); // a full inventory still takes more of a stack it has
  assert.equal(bob.getInventory().getAmount(I.COINS), 101);
  type(admin, "give 385 bob");
  assert.equal(admin.messages.at(-1), "Bob's inventory is full.");
  assert.deepEqual(bob.messages, ["Admin gave you 2 x Shark.", "Admin gave you 100 x Coins."]);

  type(admin, "give 9999999 bob");
  assert.equal(admin.messages.at(-1), "There is no item 9999999.");
  type(admin, "give 385 nobody");
  assert.equal(admin.messages.at(-1), "Player nobody is not online.");
  for (const text of ["give", "give 385", "give whip bob", "give 385 0 bob"]) {
    type(admin, text);
    assert.equal(admin.messages.at(-1), "Usage: ::give id [amount] player", text);
  }
});

test("::setlevel sets another player's level and experience, or your own", () => {
  const owner = login("Owner", Rights.OWNER);
  const bob = login("Bob");
  const skills = bob.getSkillManager();
  type(owner, "setlevel attack 60 bob");
  assert.equal(skills.getMaxLevel(Skill.ATTACK), 60);
  assert.equal(skills.getCurrentLevel(Skill.ATTACK), 60);
  assert.equal(skills.getExperience(Skill.ATTACK), SkillManager.getExperienceForLevel(60));
  assert.equal(owner.messages.at(-1), "Set Bob's Attack level to 60.");
  assert.equal(bob.messages.at(-1), "Owner set your Attack level to 60.");

  type(owner, "setlevel attack 1 bob");
  assert.equal(skills.getMaxLevel(Skill.ATTACK), 1);
  assert.equal(skills.getExperience(Skill.ATTACK), 0);

  type(owner, "setlevel hp 50"); // no name: your own
  assert.equal(owner.getSkillManager().getMaxLevel(Skill.HITPOINTS), 50);
  type(owner, "setlevel str 70");
  assert.equal(owner.getSkillManager().getMaxLevel(Skill.STRENGTH), 70);
  assert.equal(owner.messages.at(-1), "Set Owner's Strength level to 70.");
});

test("::setlevel refuses levels a skill can't have, and skill names it can't tell apart", () => {
  const owner = login("Owner", Rights.OWNER);
  type(owner, "setlevel hitpoints 9");
  assert.equal(owner.messages.at(-1), "Hitpoints can be set from 10 to 99.");
  type(owner, "setlevel attack 100");
  assert.equal(owner.messages.at(-1), "Attack can be set from 1 to 99.");
  type(owner, "setlevel m 50"); // Magic or Mining
  assert.equal(owner.messages.at(-1), "Usage: ::setlevel skill level [player]");
  type(owner, "setlevel attack 50 nobody");
  assert.equal(owner.messages.at(-1), "Player nobody is not online.");
  assert.equal(owner.getSkillManager().getMaxLevel(Skill.ATTACK), 1, "nothing changed");
});
