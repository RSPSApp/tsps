module.exports = {
  name: "Canoes",
  description: "Canoe travel: shape a canoe at a canoe station and paddle it to the other stations, from Lumbridge up to the Wilderness.",
  _test: require("./canoes/Network.Canoes")._test,
  register(api) {
    require("./canoes/Network.Canoes")(api);
  },
};
