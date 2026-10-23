module.exports = function registerStaffOfBalanceSpecialAttack(api) {
  require("./PowerOfDeath.SpecialAttack")(api, {
    id: "staff_of_balance",
    itemId: api.core.ItemIdentifiers.STAFF_OF_BALANCE,
    animation: 3652,
    graphic: 1733,
  });
};
