/**
 * The Ectofuntus in Port Phasmatys (https://oldschool.runescape.wiki/w/Ectofuntus): Prayer
 * training with slime from the pool below, bonemeal from the grinder above and worship at the
 * fountain; the ectophial's teleport there; the ghost disciples' tokens and bonecrusher. Bones and
 * bonemeal come from plugins/skills/data/bones.json. See docs/ectofuntus.md.
 */
const Common = require("./ectofuntus/Common.Ectofuntus");

module.exports = {
  name: "Ectofuntus",
  description: "The Ectofuntus in Port Phasmatys: slime, bonemeal, worship, ghost disciple tokens, the ectophial teleport and bonecrusher.",
  members: true,
  register(api) {
    Common.init(api);
    api.persistAttribute(Common.TOKENS_ATTRIBUTE, 0);
    api.persistAttribute(Common.GRINDER_STATUS_ATTRIBUTE, 0);
    api.persistAttribute(Common.GRINDER_BONE_ATTRIBUTE, 0);
    api.onPlayerLogin(Common.restore);
    require("./ectofuntus/Ectophial.Ectofuntus")(api);
    require("./ectofuntus/Slime.Ectofuntus")(api);
    require("./ectofuntus/Grinder.Ectofuntus")(api);
    require("./ectofuntus/Worship.Ectofuntus")(api);
    require("./ectofuntus/Disciples.Ectofuntus")(api);
  },
};
