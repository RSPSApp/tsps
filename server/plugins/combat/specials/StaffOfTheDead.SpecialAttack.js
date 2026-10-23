module.exports = function registerStaffOfTheDeadSpecialAttack(api) {
  require("./PowerOfDeath.SpecialAttack")(api, {
    id: "staff_of_the_dead",
    itemId: api.core.ItemIdentifiers.STAFF_OF_THE_DEAD,
    animation: 7083,
    graphic: 1228,
  });
};
