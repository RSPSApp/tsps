const attachRecoil = require("./suffering/Recoil.RingOfSuffering");

module.exports = {
  name: "RingOfSuffering",
  description: "Handles the ring of suffering's recoil effect by reusing the shared recoil handling.",
  members: true,
  _test: attachRecoil._test,
  register(api) {
    attachRecoil(api);
  },
};
