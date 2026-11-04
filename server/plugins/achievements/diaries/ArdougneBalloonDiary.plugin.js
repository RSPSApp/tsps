const DIARY = "ardougne";
const TASK = "travel-to-castlewars-by-hot-air-balloon";
const CASTLE_WARS_LANDING = { x: 2459, y: 3110, z: 0 };
const Travel = require("../../world/balloontransport/Travel.BalloonTransport");

function atCastleWarsLanding(player) {
  const location = player?.getLocation?.();
  return location?.getX?.() === CASTLE_WARS_LANDING.x
    && location?.getY?.() === CASTLE_WARS_LANDING.y
    && location?.getZ?.() === CASTLE_WARS_LANDING.z;
}

function register(api) {
  api.onCustomEvent("balloon-transport:passenger-arrival", (event) => {
    const { player, station, origin, opensRoute, logout } = event;
    if (!Travel.isPassengerArrival(event) || station !== "castle" || opensRoute === true
      || origin?.isPublic !== true
      || !["entrana", "taverley", "craft", "varrock", "gnome"].includes(origin.station)
      || origin.station === station
      || (player?.isRegistered?.() !== true && !(logout === true && player?.isRegistered?.() === false))
      || player.getHitpoints?.() <= 0
      || player.isDyingReturn?.()
      || !atCastleWarsLanding(player)) return;

    api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
  });
}

module.exports = {
  name: "ArdougneBalloonDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "BalloonTransport"],
  register,
  _test: { atCastleWarsLanding },
};
