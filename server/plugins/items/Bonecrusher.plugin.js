module.exports = {
  name: "Bonecrusher",
  description: "Bonecrusher: while charged and active in the inventory, crushes the bones a kill drops for Prayer XP, in full with the elite Morytania diary.",
  members: true,
  register(api) {
    require("./bonecrusher/Charges.Bonecrusher")(api);
    require("./bonecrusher/Crushing.Bonecrusher")(api);
  },
};
