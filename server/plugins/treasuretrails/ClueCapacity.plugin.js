"use strict";

module.exports = {
  name: "ClueCapacity",
  register(api) {
    require("./Capacity.ClueCapacity")(api);
    require("./Vessels.ClueCapacity").attach(api);
  },
};
