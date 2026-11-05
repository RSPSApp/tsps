/**
 * Achievement diary reward items (https://oldschool.runescape.wiki/w/Achievement_Diary#Rewards;
 * docs/diary-rewards.md): their teleports with the daily allowances, the Falador shield's prayer
 * restore and the Explorer's ring's energy restore and Check, and the flax keeper's daily bow strings. Each part is a unit in
 * ./diaryrewards/.
 */
const Rewards = require("./diaryrewards/Common.DiaryRewards");

module.exports = {
  name: "DiaryRewards",
  members: true,
  register(api) {
    Rewards.init(api);
    api.persistAttribute(Rewards.DAILY_ATTRIBUTE, null);
    require("./diaryrewards/Teleports.DiaryRewards")(api);
    require("./diaryrewards/FaladorShield.DiaryRewards")(api);
    require("./diaryrewards/ExplorersRing.DiaryRewards")(api);
    require("./diaryrewards/FlaxKeeper.DiaryRewards")(api);
    require("./diaryrewards/Battlestaves.DiaryRewards")(api);
    require("./diaryrewards/Robin.DiaryRewards")(api);
  },
};
