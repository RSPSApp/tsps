/**
 * Test commands: ::trek [temple|ramble] [easy|medium|hard] starts a trek from wherever the
 * player is (no quest needed), ::trekevent <event> makes the next stop come up with that event (off: none at all).
 */
const Common = require("./Common.TempleTrekking");
const Trek = require("./Trek.TempleTrekking");

function startTrek({ player, parts }) {
  const direction = parts?.[1] === "ramble" ? "ramble" : "temple";
  const difficulty = ["easy", "medium", "hard"].includes(parts?.[2]) ? parts[2] : "easy";
  const follower = Common.data.followers.find((entry) => entry.direction === direction && entry.difficulty === difficulty);
  Trek.start(player, follower);
  player.sendMessage(`Escorting ${follower.name} (${direction}).`);
  return true;
}

function forceEvent({ player, parts }) {
  const trek = Trek.trekOf(player);
  const key = parts?.[1];
  if (trek && key === "off") {
    trek.noEvents = true;
    player.sendMessage("No more events on this trek.");
    return true;
  }
  if (!trek || !Common.data.events[key] || key.startsWith("$")) {
    player.sendMessage(`Usage: ::trekevent <${Object.keys(Common.data.events).filter((name) => !name.startsWith("$")).join("|")}|off> while on a trek.`);
    return true;
  }
  trek.forcedEvent = key;
  player.sendMessage(`The next stop brings ${key}.`);
  return true;
}

function attachCommands(api) {
  const { PlayerRights } = api.core;
  api.registerCommand("trek", startTrek, PlayerRights.OWNER, "Start a Temple Trek (trek [temple|ramble] [easy|medium|hard])");
  api.registerCommand("trekevent", forceEvent, PlayerRights.OWNER, "Make the trek's next stop an event (trekevent <event>)");
}

module.exports = { attachCommands };
