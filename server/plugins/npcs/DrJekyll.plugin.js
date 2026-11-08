"use strict";

const Events = require("./random-events/Common.RandomEvents");
const Jekyll = require("./random-events/DrJekyll.RandomEvents");

module.exports = {
  name: "DrJekyll",
  description: "Adds Dr Jekyll, the random-event NPC, with Talk-to and Dismiss options.",
  members: true,
  register(api) {
    api.onCustomEvent(Events.DEFINITIONS_EVENT, Jekyll.addDefinition.bind(null, api));
    api.onNpcInteraction("Dr Jekyll", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
  },
};
