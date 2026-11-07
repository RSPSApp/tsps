const { createLoginExtension } = require("./characters/Login.Characters");
const registerCommands = require("./characters/Commands.Characters");

module.exports = {
  name: "Characters",
  enabled: false,
  register(api) {
    api.registerLoginExtension(createLoginExtension);
    registerCommands(api);
  },
};
