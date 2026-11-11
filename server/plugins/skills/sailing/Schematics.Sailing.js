const common = require("./schematics/Common.Schematics");
const unlocks = require("./schematics/Unlocks.Schematics");
const acquisition = require("./schematics/Acquisition.Schematics");

module.exports = {
  register(api) {
    common.attach(api);
    unlocks(api);
    acquisition.attach(api);
    require("./schematics/Sources.Schematics").attach(api);
  },
};
