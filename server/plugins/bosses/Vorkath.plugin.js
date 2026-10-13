/**
 * Vorkath, post-quest form (https://oldschool.runescape.wiki/w/Vorkath): poke her awake on
 * Ungael and fight her with melee, magic, ranged, three dragonfire tiers and the deadly
 * fireball, alternating acid/rapid-fire and freeze/zombified-spawn specials every six
 * standards, with the boss health bar. Drops roll automatically from
 * data/definitions/npc-drops.json.
 */
const Wake = require("./vorkath/Wake.Vorkath");
const Combat = require("./vorkath/Combat.Vorkath");
const Specials = require("./vorkath/Specials.Vorkath");
const Area = require("./vorkath/Area.Vorkath");
const Hud = require("./vorkath/Hud.Vorkath");
const CombatAchievements = require("./vorkath/CombatAchievements.Vorkath");

module.exports = {
  name: "Vorkath",
  members: true,
  register(api) {
    Wake.attach(api);
    Combat.attach(api);
    Specials.attach(api);
    Area.attach(api);
    Hud.attach(api);
    CombatAchievements.attach(api);
  },
};
