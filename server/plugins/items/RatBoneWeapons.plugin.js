/**
 * Rat bone weapons, made from Scurrius' spine (Wiki: Rat bone weapons; docs/scurrius.md): the bone
 * mace, shortbow and staff, how they're made (by the player or by Historian Aldo), the staff's
 * charges and spell, and the rats-only rule with its +10 maximum hit.
 */
const Common = require("./ratboneweapons/Common.RatBoneWeapons");
const Creation = require("./ratboneweapons/Creation.RatBoneWeapons");
const Staff = require("./ratboneweapons/Staff.RatBoneWeapons");
const Combat = require("./ratboneweapons/Combat.RatBoneWeapons");

module.exports = {
  name: "RatBoneWeapons",
  description: "Adds the rat bone mace, shortbow and staff made from Scurrius' spine: making them, the staff's charges and spell, and the rats-only bonus.",
  members: true,
  register(api) {
    Common.init(api);
    Creation.attach(api);
    Staff.attach(api);
    Combat.attach(api);
  },
};
