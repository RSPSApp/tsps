"use strict";

const Events = require("./random-events/Common.RandomEvents");
const Lamp = require("./random-events/GenieLamp.RandomEvents");

module.exports = {
  name: "RandomEvents",
  config: {
    "random-events:enabled": {
      type: "boolean", label: "Random events", default: true,
      help: "Turn off to stop random events from appearing.",
    },
  },
  register(api) {
    api.registerCommand("randevt", Events.spawnCommand, api.core.PlayerRights.OWNER, "Test a random event ([id] = zero-based event index; omit for random)");
    api.onServerStartup(Events.initialize.bind(null, api));
    api.onServerShutdown(Events.shutdown);
    api.onPlayerLogin(Events.login);
    api.onCustomEvent("agent:advance-time", Events.advanceTime);
    api.onPlayerProcess(Events.processPlayer);
    api.onPlayerLogout(Events.logoutCleanup);
    api.onPlayerDisconnect(Events.logoutCleanup);
    api.onPlayerDeath(Events.cleanup);
    api.onPlayerLogout(Lamp.cleanup);
    api.onPlayerDisconnect(Lamp.cleanup);
    api.onPlayerDeath(Lamp.cleanup);
    api.onNpcsInteraction([
      "Genie", "Sandwich lady", "Drunken Dwarf", "Rick Turpentine", "Mysterious Old Man",
      "Niles", "Miles", "Giles", "Count Check", "Capt' Arnav", "Bee keeper", "Quiz Master",
      "Sergeant Damien", "Freaky Forester", "Leo", "Flippa", "Evil Bob", "Postie Pete",
      "Pillory Guard", "Dunce",
    ], { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onInterfaceActionClick(Events.chooseSandwich);
    api.onInterfaceActionClick(Events.chooseCerter);
    api.onItemAction("Lamp", { Rub: Lamp.rub.bind(null, api) });
    api.onItemAction("Book of Knowledge", { Read: Lamp.read.bind(null, api) });
    require("./random-events/CountCheck.RandomEvents")(api, Events);
    require("./random-events/KissTheFrog.RandomEvents")(api, Events);
    require("./random-events/CaptArnav.RandomEvents")(api, Events);
    require("./random-events/Beekeeper.RandomEvents")(api, Events);
    require("./random-events/QuizMaster.RandomEvents")(api, Events);
    require("./random-events/DrillDemon.RandomEvents")(api, Events);
    require("./random-events/FreakyForester.RandomEvents")(api, Events);
    require("./random-events/Gravedigger.RandomEvents")(api, Events);
    require("./random-events/Pinball.RandomEvents")(api, Events);
    require("./random-events/EvilBob.RandomEvents")(api, Events);
    require("./random-events/EvilTwin.RandomEvents")(api, Events);
    require("./random-events/Maze.RandomEvents")(api, Events);
    require("./random-events/Mime.RandomEvents")(api, Events);
    require("./random-events/Pillory.RandomEvents")(api, Events);
    require("./random-events/SurpriseExam.RandomEvents")(api, Events);
  },
};
