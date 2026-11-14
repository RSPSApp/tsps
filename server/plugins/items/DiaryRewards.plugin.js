/**
 * Achievement diary reward items (https://oldschool.runescape.wiki/w/Achievement_Diary#Rewards;
 * docs/diary-rewards.md): their teleports with the daily allowances, the Falador shield's prayer
 * restore and the Explorer's ring's energy restore and Check, the flax keeper's daily bow strings, the Ardougne pickpocketing rewards,
 * the Karamja gloves' shop prices, Peer the Seer's deposit box, Thirus's free dynamite and Wizard Cromperty's free pure essence. Each part is a unit in
 * ./diaryrewards/.
 */
const Rewards = require("./diaryrewards/Common.DiaryRewards");

module.exports = {
  name: "DiaryRewards",
  description: "Achievement diary reward items: their daily teleports, Falador shield prayer restore, Explorer's ring energy and the other diary rewards.",
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
    require("./diaryrewards/Lundail.DiaryRewards")(api);
    require("./diaryrewards/Thirus.DiaryRewards")(api);
    require("./diaryrewards/Cromperty.DiaryRewards")(api);
    require("./diaryrewards/PeerTheSeer.DiaryRewards")(api);
    require("./diaryrewards/Pickpocketing.DiaryRewards")(api);
    require("./diaryrewards/KaramjaGloves.DiaryRewards")(api);
  },
};
