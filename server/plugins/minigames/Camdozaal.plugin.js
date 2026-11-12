"use strict";

/** Camdozaal's shard economy and the activities powered by the Sacred Forge. */
module.exports = {
  name: "Camdozaal",
  register(api) {
    require("./camdozaal/Shared.Camdozaal").bind(api);
    require("./camdozaal/Exchange.Camdozaal")(api);
    require("./camdozaal/Rewards.Camdozaal")(api);
    require("./camdozaal/Actions.Camdozaal")(api);
    require("./camdozaal/Fish.Camdozaal")(api);
    require("./camdozaal/Buffs.Camdozaal")(api);
    require("./camdozaal/Area.Camdozaal")(api);
    require("./camdozaal/Vault.Camdozaal")(api);
    require("./camdozaal/Lockboxes.Camdozaal")(api);
  },
};
