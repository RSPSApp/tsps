module.exports = {
  name: "KalphiteQueen",
  description: "The Kalphite Queen fight, run entirely from its encounter unit.",
  members: true,
  register(api) {
    require("./kalphitequeen/Encounter.KalphiteQueen")(api);
  },
};
