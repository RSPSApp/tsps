/**
 * Temple Trekking and the Burgh de Rott Ramble (https://oldschool.runescape.wiki/w/Temple_Trekking),
 * from plugins/minigames/data/temple-trekking.json and live captures: escorting a follower
 * between Burgh de Rott and Paterdomus by one of three routes, the events on the way in rooms of
 * their own, and the reward token. Each part lives in ./templetrekking/; docs/temple-trekking.md
 * records what the captures show.
 */
const Common = require("./templetrekking/Common.TempleTrekking");
const Trek = require("./templetrekking/Trek.TempleTrekking");

module.exports = {
  name: "TempleTrekking",
  members: true,
  register(api) {
    Common.init(api);
    api.persistAttribute(Common.TOKEN_POINTS_ATTRIBUTE);
    api.persistAttribute(Common.PACK_ATTRIBUTE);
    api.persistAttribute(Common.RETURN_ATTRIBUTE);
    Trek.attachTrek(api);
    require("./templetrekking/Followers.TempleTrekking").attachFollowers(api);
    require("./templetrekking/Combat.TempleTrekking").attachCombat(api);
    require("./templetrekking/Bridge.TempleTrekking").attachBridge(api);
    require("./templetrekking/River.TempleTrekking").attachRiver(api);
    require("./templetrekking/Boat.TempleTrekking").attachBoat(api);
    require("./templetrekking/Samaritan.TempleTrekking").attachSamaritan(api);
    require("./templetrekking/Rewards.TempleTrekking").attachRewards(api);
    require("./templetrekking/Commands.TempleTrekking").attachCommands(api);
  },
};
