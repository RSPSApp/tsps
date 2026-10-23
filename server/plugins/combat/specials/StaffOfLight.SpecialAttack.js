module.exports = function registerStaffOfLightSpecialAttack(api) {
  require("./PowerOfDeath.SpecialAttack")(api, {
    id: "staff_of_light",
    itemId: api.core.ItemIdentifiers.STAFF_OF_LIGHT,
    animation: 7967,
    graphic: 1516,
  });
};
