"use strict";

const Events = require("./random-events/RandomEvents");
const Plant = require("./random-events/StrangePlant");

module.exports = {
  name: "StrangePlant",
  members: true,
  register(api) {
    api.onCustomEvent(Events.DEFINITIONS_EVENT, Plant.addDefinition.bind(null, api));
    api.onNpcInteraction("Strange plant", { Pick: Events.talk, Dismiss: Events.dismiss });
  },
};
