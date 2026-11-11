"use strict";

// The leagues the data file names, so the option's list follows the data.
const LEAGUE_OPTIONS = [
  { value: 0, label: "Not a league world" },
  ...Object.entries(require("./data/leagues.json").leagues).map(([type, league]) => ({ value: Number(type), label: league.name })),
];

module.exports = {
  name: "LeagueMode",
  description: "Leagues characters, progression, tasks, relics, region unlocks, combat masteries, Demonic Pacts and rewards.",
  config: {
    "league:type": {
      type: "enum", label: "League", default: 0, values: LEAGUE_OPTIONS,
      help: "Runs this world as a league: every login is the account's league character, kept apart from its main save. Not a league world is a normal world. The list follows data/leagues.json. Also read by LeagueAreaUnlocks. Restart to change.",
    },
    "league:start": {
      type: "date", label: "League start date", defaultText: "Not set",
      help: "When the league began, as YYYY-MM-DD. Sets the client's league clock.",
    },
    "league:end": {
      type: "date", label: "League end date", defaultText: "Not set",
      help: "When the league ends, as YYYY-MM-DD. The welcome message then shows how many days remain.",
    },
  },
  members: true,
  register(api) {
    require("./Base.LeagueMode").register(api);
    require("./Points.LeagueMode").register(api);
    require("./Relics.LeagueMode").register(api);
    require("./Tasks.LeagueMode").register(api);
    require("./AreaUnlocks.LeagueMode").register(api);
    require("./CombatMasteries.LeagueMode").register(api);
    require("./Pacts.LeagueMode").register(api);
  },
};
