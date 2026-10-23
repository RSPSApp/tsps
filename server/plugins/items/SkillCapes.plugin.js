/**
 * Skillcapes and the max cape (https://oldschool.runescape.wiki/w/Cape_of_Accomplishment,
 * https://oldschool.runescape.wiki/w/Max_cape; docs/skillcapes.md): buying them from the skill
 * masters and Mac, trimming, Boost, their teleports and options, and the "skillcape:has-perk"
 * question other plugins ask for each cape's perk. Each part is a unit in ./skillcapes/.
 */
const Capes = require("./skillcapes/Common.SkillCapes");

module.exports = {
  name: "SkillCapes",
  members: true,
  register(api) {
    Capes.init(api);
    require("./skillcapes/Perks.SkillCapes")(api);
    require("./skillcapes/WornVariants.SkillCapes")(api);
    require("./skillcapes/Sellers.SkillCapes")(api);
    require("./skillcapes/Trimming.SkillCapes")(api);
    require("./skillcapes/Boost.SkillCapes")(api);
    require("./skillcapes/Teleports.SkillCapes")(api);
    require("./skillcapes/Options.SkillCapes")(api);
    require("./skillcapes/Passive.SkillCapes")(api);
    require("./skillcapes/MetalAttraction.SkillCapes")(api);
    require("./skillcapes/MaxCape.SkillCapes")(api);
    require("./skillcapes/MacIsland.SkillCapes")(api);
  },
};
