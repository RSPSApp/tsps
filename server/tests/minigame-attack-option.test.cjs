// Run after `yarn build`: node --test tests/minigame-attack-option.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Location } = require("../dist/game/model/Location");
const FightPits = require("../plugins/minigames/TzhaarFightPits.plugin");

// The client shows "Attack" on another player when the Wilderness varbit is set or player
// option slot 1 reads "Attack" (render/render/interact/check.ts). sendInteractionOption writes a
// legacy packet that PlayerSession.write drops, so areas outside the Wilderness must use
// sendPlayerOption.

test("the Fight Pit offers Attack on player option slot 1 in the arena, and takes it away", () => {
  const sent = [];
  const sender = {
    sendPlayerOption: (slot, option, priority) => (sent.push([slot, option, priority]), sender),
    sendSubInterface: () => sender,
    closeSubInterface: () => sender,
  };
  const player = { getPacketSender: () => sender, getLocation: () => new Location(2399, 5160, 0) };
  FightPits._test.enterArena({ player });
  FightPits._test.leaveArena({ player });
  assert.deepEqual(sent, [[1, "Attack", true], [1, "", false]]);
});

test("no minigame sets the player option through the dropped legacy packet", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith(".js") && fs.readFileSync(file, "utf8").includes("sendInteractionOption(")) offenders.push(path.relative(path.join(__dirname, ".."), file));
    }
  };
  walk(path.join(__dirname, "..", "plugins", "minigames"));
  assert.deepEqual(offenders, []);
});
