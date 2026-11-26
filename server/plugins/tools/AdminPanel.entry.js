const register = require("./adminpanel/Controller.AdminPanel");

module.exports = {
  name: "AdminPanel",
  category: "@ Ghost Plugins @",
  description: "Native ::admin panel for Admin, Owner and Developer accounts: players, direct teleports, pictured items and NPCs, live player editing, cheats and bot deployment.",
  register,
};
