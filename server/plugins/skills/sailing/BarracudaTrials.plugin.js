// Sailing's Barracuda Trials (docs/barracuda-trials.md): the Tempor Tantrum, the Jubbly Jive and
// the Gwenith Glide, timed courses at sea with ranks, rewards and scoreboards. The units are in
// ./barracudatrials/.
const common = require("./barracudatrials/Common.BarracudaTrials");

module.exports = {
  name: "SailingBarracudaTrials",
  description: "Sailing's Barracuda Trials: the Tempor Tantrum, Jubbly Jive and Gwenith Glide timed sea courses, with ranks and rewards.",
  members: true,
  register(api) {
    common.init(api);
    require("./barracudatrials/Ships.BarracudaTrials")(api);
    require("./barracudatrials/Selection.BarracudaTrials")(api);
    require("./barracudatrials/Run.BarracudaTrials")(api);
    require("./barracudatrials/Supplies.BarracudaTrials")(api);
    require("./barracudatrials/Master.BarracudaTrials")(api);
    require("./barracudatrials/Cutscene.BarracudaTrials")(api);
    require("./barracudatrials/Hazards.BarracudaTrials")(api);
    require("./barracudatrials/StormClouds.BarracudaTrials")(api);
    require("./barracudatrials/Tempor.BarracudaTrials")(api);
    require("./barracudatrials/Jubbly.BarracudaTrials")(api);
    require("./barracudatrials/Gwenith.BarracudaTrials")(api);
    require("./barracudatrials/Resonance.BarracudaTrials")(api);
    require("./barracudatrials/Scoreboard.BarracudaTrials")(api);
    require("./barracudatrials/Dev.BarracudaTrials")(api);
  },
};
