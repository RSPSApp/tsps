/**
 * Shooting Stars (https://oldschool.runescape.wiki/w/Shooting_Stars): crashed stars land around
 * the world; players mine them layer by layer for stardust and trade it with Dusuri. Free-to-play
 * like OSRS (half experience there; Dusuri trades on members worlds only).
 *
 * Units in ./shootingstars/, data in ./data/shooting-stars.json, mechanics and captures in
 * docs/shooting-stars.md.
 */
const Common = require("./shootingstars/Common.ShootingStars");

module.exports = {
  name: "ShootingStars",
  register(api) {
    Common.bind(api);
    Common.persistAttributes(api);
    api.onPlayerLogin(Common.restoreVarbits);
    require("./shootingstars/Landing.ShootingStars")(api);
    require("./shootingstars/Mining.ShootingStars")(api);
    require("./shootingstars/Prospect.ShootingStars")(api);
    require("./shootingstars/Noticeboard.ShootingStars")(api);
    require("./shootingstars/Dusuri.ShootingStars")(api);
    require("./shootingstars/CelestialRing.ShootingStars")(api);
  },
};
