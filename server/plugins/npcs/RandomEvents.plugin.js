"use strict";

const Events = require("./random-events/RandomEvents");
const Lamp = require("./random-events/GenieLamp");

module.exports = {
  name: "RandomEvents",
  register(api) {
    api.registerCommand("randevt", Events.spawnCommand, api.core.PlayerRights.OWNER, "Test a random event ([id] = zero-based event index; omit for random)");
    api.onServerStartup(Events.initialize.bind(null, api));
    api.onServerShutdown(Events.shutdown);
    api.onPlayerLogin(Events.login);
    api.onPlayerProcess(Events.processPlayer);
    api.onPlayerLogout(Events.cleanup);
    api.onPlayerDisconnect(Events.cleanup);
    api.onPlayerDeath(Events.cleanup);
    api.onPlayerLogout(Lamp.cleanup);
    api.onPlayerDisconnect(Lamp.cleanup);
    api.onPlayerDeath(Lamp.cleanup);
    api.onNpcInteraction("Genie", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Sandwich lady", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Drunken Dwarf", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Rick Turpentine", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Mysterious Old Man", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Niles", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Miles", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Giles", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onInterfaceActionClick(Events.chooseSandwich);
    api.onInterfaceActionClick(Events.chooseCerter);
    api.onItemAction("Lamp", { Rub: Lamp.rub.bind(null, api) });
  },
};
