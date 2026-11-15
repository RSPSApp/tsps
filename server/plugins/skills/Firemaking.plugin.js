const Logs = require("./firemaking/Logs.Firemaking");
const Rest = require("./firemaking/Rest.Firemaking");

module.exports = {
  ...Logs,
  name: "Firemaking",
  description: "Firemaking: lighting logs in the inventory or on the ground, Forester campfire tending and resting.",
  register(api) {
    Logs.attach(api);
    Rest.attach(api);
  },
};
