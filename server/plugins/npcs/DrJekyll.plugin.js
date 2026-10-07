"use strict";

const Events = require("./random-events/RandomEvents");
const Jekyll = require("./random-events/DrJekyll");

module.exports = {
  name: "DrJekyll",
  members: true,
  register(api) {
    api.onCustomEvent(Events.DEFINITIONS_EVENT, Jekyll.addDefinition.bind(null, api));
    api.onNpcInteraction("Dr Jekyll", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
  },
};
