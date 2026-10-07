/**
 * The Warriors' Guild in Burthorpe: Ghommal's door, the token-earning rooms (animation, dummies,
 * catapult, shot put and Jimmy's kegs), the staff who pay the tokens out, and the cyclopes that
 * drop defenders on the top floor and in the basement. Behaviour is the OSRS Wiki's; where the
 * Wiki is silent, Near-Reality's port (and Void's data) fill in timings, animations and messages
 * (docs/warriors-guild.md lists which).
 *
 * This is under areas/ so its door and ladder handlers run before objects/Doors and Ladders.
 */
const Guild = require("./warriors-guild/Common.WarriorsGuild");

module.exports = {
  name: "WarriorsGuild",
  members: true,
  register(api) {
    Guild.init(api);
    require("./warriors-guild/Tokens.WarriorsGuild")(api);
    require("./warriors-guild/Entrance.WarriorsGuild")(api);
    require("./warriors-guild/Animator.WarriorsGuild")(api);
    require("./warriors-guild/Dummies.WarriorsGuild")(api);
    require("./warriors-guild/Catapult.WarriorsGuild")(api);
    require("./warriors-guild/ShotPut.WarriorsGuild")(api);
    require("./warriors-guild/Kegs.WarriorsGuild")(api);
    require("./warriors-guild/Cyclopes.WarriorsGuild")(api);
    require("./warriors-guild/Skillcapes.WarriorsGuild")(api);
    require("./warriors-guild/Chatter.WarriorsGuild")(api);
  },
};
