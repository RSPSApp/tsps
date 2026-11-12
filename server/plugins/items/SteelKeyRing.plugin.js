/** One Small Favour's reusable key storage; see docs/steel-key-ring.md. */
module.exports = {
  name: "SteelKeyRing",
  description: "Stores reusable keys and opens the native Check-keys interface.",
  // Weapon store and maze keys remain usable on free worlds (OSRS Wiki).
  register(api) {
    require("./steelkeyring/Ring.SteelKeyRing")(api);
  },
};
