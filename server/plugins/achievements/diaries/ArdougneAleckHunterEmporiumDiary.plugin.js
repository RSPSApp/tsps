const DIARY = "ardougne";
const TASK = "view-aleck-s-hunter-emporium-in-yanille";
const SHOP_ID = 1007;
const ALECK_X = 2568;
const ALECK_Y = 3082;
const SHOP_RADIUS = 8;

function isAtAleckShop(player) {
  const location = player?.getLocation?.();
  if (
    !location ||
    player.isRegistered?.() !== true ||
    player.getHitpoints?.() <= 0 ||
    player.isDyingReturn?.() ||
    player.getPrivateArea?.()
  ) return false;

  return location.getZ() === 0 &&
    Math.abs(location.getX() - ALECK_X) <= SHOP_RADIUS &&
    Math.abs(location.getY() - ALECK_Y) <= SHOP_RADIUS;
}

module.exports = {
  name: "ArdougneAleckHunterEmporiumDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    api.onCustomEvent("shop:opened", ({ player, shopId }) => {
      if (shopId === SHOP_ID && isAtAleckShop(player)) {
        api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
      }
    });
  },
  _test: { isAtAleckShop },
};
