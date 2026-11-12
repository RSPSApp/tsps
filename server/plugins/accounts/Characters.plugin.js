const { createLoginExtension } = require("./characters/Login.Characters");
const registerCommands = require("./characters/Commands.Characters");

module.exports = {
  name: "Characters",
  description: "Lets one account hold several characters and choose between them at login. Off unless the world turns it on.",
  config: {
    "characters:maxPerAccount": {
      type: "number", label: "Characters per account", default: 6, integer: true, min: 1, max: 6,
      help: "How many characters one account may hold, 1 to 6. At 1 the picker is skipped. Worlds hosted in a browser without account saving always use 1.",
    },
  },
  enabled: false,
  register(api) {
    api.registerLoginExtension(createLoginExtension);
    registerCommands(api);
  },
};
