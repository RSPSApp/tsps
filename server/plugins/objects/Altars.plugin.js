const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { MagicSpellbook } = require("../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ObjectIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const PRAY_AT_ALTAR_ANIMATION = new Animation(645);

// The client transforms the occult altar to match the active spellbook. Its
// first "Venerate" option therefore selects the spellbook omitted by the
// named options on that variant.
const OCCULT_ALTAR_SPELLBOOKS = new Map([
  [ObjectIds.ALTAR_OF_THE_OCCULT, MagicSpellbook.NORMAL],
  [ObjectIds.ALTAR_OF_THE_OCCULT_2, MagicSpellbook.ANCIENT],
  [ObjectIds.ALTAR_OF_THE_OCCULT_3, MagicSpellbook.LUNAR],
  [ObjectIds.ALTAR_OF_THE_OCCULT_4, MagicSpellbook.ARCEUUS],
]);

function handleAncientAltar(player) {
  player.performAnimation(PRAY_AT_ALTAR_ANIMATION);
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
  MagicSpellbook.changeSpellbook(
    player,
    player.getSpellbook() === MagicSpellbook.ANCIENT
      ? MagicSpellbook.NORMAL
      : MagicSpellbook.ANCIENT
  );
  return true;
}

function handlePrayerAltar(player) {
  const skillManager = player.getSkillManager();
  const currentPrayer = skillManager.getCurrentLevel(Skill.PRAYER);
  const maxPrayer = skillManager.getMaxLevel(Skill.PRAYER);
  if (currentPrayer >= maxPrayer) {
    player.sendMessage("You already have full Prayer points.");
    return true;
  }

  player.performAnimation(PRAY_AT_ALTAR_ANIMATION);
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
  skillManager.setCurrentLevels(Skill.PRAYER, maxPrayer);
  skillManager.updateSkill(Skill.PRAYER);
  player.sendMessage("You recharge your Prayer points.");
  return true;
}

function handleOccultAltar(player, spellbook) {
  player.performAnimation(PRAY_AT_ALTAR_ANIMATION);
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
  MagicSpellbook.changeSpellbook(player, spellbook);
  return true;
}

function ancientAltar({ player }) {
  return handleAncientAltar(player);
}

function lunarAltar({ player }) {
  return handleOccultAltar(player, player.getSpellbook() === MagicSpellbook.LUNAR ? MagicSpellbook.NORMAL : MagicSpellbook.LUNAR);
}

function darkAltar({ player }) {
  return handleOccultAltar(player, player.getSpellbook() === MagicSpellbook.ARCEUUS ? MagicSpellbook.NORMAL : MagicSpellbook.ARCEUUS);
}

function prayerAltar({ player }) {
  return handlePrayerAltar(player);
}

function venerateOccultAltar({ player, objectId }) {
  const spellbook = OCCULT_ALTAR_SPELLBOOKS.get(objectId);
  return spellbook ? handleOccultAltar(player, spellbook) : false;
}

function standardSpellbook({ player }) {
  return handleOccultAltar(player, MagicSpellbook.NORMAL);
}

function ancientSpellbook({ player }) {
  return handleOccultAltar(player, MagicSpellbook.ANCIENT);
}

function lunarSpellbook({ player }) {
  return handleOccultAltar(player, MagicSpellbook.LUNAR);
}

function arceuusSpellbook({ player }) {
  return handleOccultAltar(player, MagicSpellbook.ARCEUUS);
}

module.exports = {
  name: "Altars",
  register: (api) => {
    api.onObjectInteraction("Ancient Altar", { Venerate: ancientAltar });
    api.onObjectInteraction("Lunar Altar", { Venerate: lunarAltar });
    api.onObjectInteraction("Dark Altar", { Venerate: darkAltar });
    api.onObjectInteraction("Altar", { "Pray-at": prayerAltar, Pray: prayerAltar });
    api.onObjectInteraction("Altar of the Occult", {
      Venerate: venerateOccultAltar,
      Standard: standardSpellbook,
      Ancient: ancientSpellbook,
      Lunar: lunarSpellbook,
      Arceuus: arceuusSpellbook,
    });
  },
};
