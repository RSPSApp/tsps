/**
 * Prayer training at Ralos' Rise and the Teomat (docs/ralos-rise.md): blessing bones and wine at
 * the exposed altar, breaking blessed bones into shards with a chisel, and sacrificing the shards
 * at the libation bowl. Data: plugins/skills/data/ralos-rise.json, and the bones' blessed forms in
 * bones.json.
 */
const Common = require("./ralosrise/Common.RalosRise");

module.exports = {
  name: "RalosRise",
  members: true,
  register(api) {
    Common.init(api);
    require("./ralosrise/ExposedAltar.RalosRise").attach(api);
    require("./ralosrise/BlessedBones.RalosRise").attach(api);
    require("./ralosrise/LibationBowl.RalosRise").attach(api);
  },
};
