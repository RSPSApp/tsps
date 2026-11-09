const Logs = require("./firemaking/Logs.Firemaking");

module.exports = {
  ...Logs,
  name: "Firemaking",
  description: "Firemaking: lighting logs in the inventory or on the ground, and Forester campfire tending.",
  register(api) {
    Logs.attach(api);
  },
};
