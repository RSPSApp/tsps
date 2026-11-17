/** The free-to-play tools in the Lumbridge Swamp farming shed. */
module.exports = {
  name: "FarmingShed",
  description: "Borrow a rake and spade from the Lumbridge Swamp shed.",
  register(api) {
    require("./farming-shed/Tools.FarmingShed").attach(api);
  },
};
