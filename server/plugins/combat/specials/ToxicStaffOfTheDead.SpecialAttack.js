const SPECIAL_ANIMATION = 1720; // cache: sotd_special_toxic_charged
const SPECIAL_GRAPHIC = 1228; // cache: sotd_special_start

module.exports = function registerToxicStaffOfTheDeadSpecialAttack(api) {
  require("./PowerOfDeath.SpecialAttack")(api, {
    id: "toxic_staff_of_the_dead",
    itemId: api.core.ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD,
    animation: SPECIAL_ANIMATION,
    graphic: SPECIAL_GRAPHIC,
  });
};
