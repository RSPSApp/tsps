"use strict";

/** Wiki Echo identities/rewards with explicitly temporary normal combat controllers. */
module.exports = {
  name: "EchoBosses",
  members: true,
  description: "Leagues VI Echo encounters using normal-mechanics placeholders.",
  register(api) {
    require("./echobosses/Actors.EchoBosses").attach(api);
    require("./echobosses/Sessions.EchoBosses").attach(api);
    require("./echobosses/Loot.EchoBosses").attach(api);
    require("./echobosses/Progress.EchoBosses").attach(api);
  },
};
