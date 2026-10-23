/**
 * Slayer (docs/slayer.md): tasks, masters, points and rewards from the cache's own Slayer
 * tables, with the player's state in the client's Slayer varps. Units in ./slayer/.
 */
const UNITS = [
  require("./slayer/Data.Slayer"),
  require("./slayer/State.Slayer"),
  require("./slayer/Tasks.Slayer"),
  require("./slayer/Choice.Slayer"),
  require("./slayer/Masters.Slayer"),
  require("./slayer/Combat.Slayer"),
  require("./slayer/Checks.Slayer"),
  require("./slayer/Rewards.Slayer"),
  require("./slayer/Equipment.Slayer"),
  require("./slayer/Finishers.Slayer"),
  require("./slayer/Superiors.Slayer"),
  require("./slayer/Keys.Slayer"),
  require("./slayer/Dev.Slayer"),
];

module.exports = {
  name: "Slayer",
  members: true,
  register(api) {
    for (const unit of UNITS) unit.init?.(api);
    for (const unit of UNITS) unit.attach?.(api);
  },
};
