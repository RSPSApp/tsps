const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { MagicSpellbook } = require("../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ObjectIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const PRAY_AT_ALTAR_ANIMATION = new Animation(645);
const EAST_ARDOUGNE_CHURCH_ALTAR = [2617, 3309, 0];
const ARDOUGNE_ALTAR_TASK = "use-the-altar-in-east-ardougne-s-church";
// The 1st floor (UK) altar of Varrock Palace (OSRS Wiki: Varrock Diary hard task 9).
const VARROCK_PALACE_ALTAR = { x: 3208, y: 3494, z: 1 };
const VARROCK_PALACE_ALTAR_TASK = "pray-at-the-altar-in-varrock-palace-with-smite-a";

const JALDRAOCHT_ALTAR_ID = 6552;
const JALDRAOCHT_ALTAR_TASK = "activate-ancient-magicks-at-the-altar-in-the-jal";
const KOUREND_CASTLE_ALTAR = { id: 18258, x: 1617, y: 3672, z: 2 };
const KOUREND_CASTLE_ALTAR_TASK = "pray-at-the-altar-in-kourend-castle";

// The easy Wilderness Diary's "Pray at the Chaos Altar in Western Wilderness.": the Chaos Temple
// (church) altar at level 38 (OSRS Wiki: Chaos Temple), not the Wilderness hut's.
const WESTERN_CHAOS_ALTAR = { x: 2947, y: 3820, z: 0 };

let core = null;
let api = null;

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

function handlePrayerAltar(player, fullMessage = "You already have full Prayer points.") {
  const skillManager = player.getSkillManager();
  const currentPrayer = skillManager.getCurrentLevel(Skill.PRAYER);
  const maxPrayer = skillManager.getMaxLevel(Skill.PRAYER);
  if (currentPrayer >= maxPrayer) {
    player.sendMessage(fullMessage);
    return true;
  }

  player.performAnimation(PRAY_AT_ALTAR_ANIMATION);
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
  skillManager.setCurrentLevels(Skill.PRAYER, maxPrayer);
  skillManager.updateSkill(Skill.PRAYER);
  player.sendMessage("You recharge your Prayer points.");
  return true;
}

function handleJaldraochtAltar(player) {
  player.performAnimation(PRAY_AT_ALTAR_ANIMATION);
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
  const skillManager = player.getSkillManager();
  skillManager.setCurrentLevels(Skill.PRAYER, 0);
  skillManager.updateSkill(Skill.PRAYER);
  if (player.getSpellbook() === MagicSpellbook.ANCIENT) {
    player.sendMessage("You feel a strange drain upon your memory...");
    MagicSpellbook.changeSpellbook(player, MagicSpellbook.NORMAL);
  } else {
    player.sendMessage("You feel a strange wisdom fill your mind....");
    MagicSpellbook.changeSpellbook(player, MagicSpellbook.ANCIENT);
    api.emitCustomEvent("diary:task", {
      player,
      diary: "desert",
      task: JALDRAOCHT_ALTAR_TASK,
    });
  }
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

function prayerAltar({ player, object }) {
  if (player.getHitpoints() <= 0 || player.isDyingReturn?.() === true) return false;
  if (object?.getId?.() === JALDRAOCHT_ALTAR_ID) return handleJaldraochtAltar(player);

  const skillManager = player.getSkillManager();
  const prayerBefore = skillManager.getCurrentLevel(Skill.PRAYER);
  const handled = handlePrayerAltar(player);
  const prayerAfter = skillManager.getCurrentLevel(Skill.PRAYER);

  if (object && prayerAfter > prayerBefore) {
    const location = object.getLocation();
    api.emitCustomEvent("altar:prayed", { player, objectId: object.getId(), location });
    // Content that credits praying by place (the Desert Diary's Sophanem altar) reads the gain.
    api.emitCustomEvent("altars:prayed", {
      player,
      location: { x: location.getX(), y: location.getY(), z: location.getZ() },
      restored: prayerAfter - prayerBefore,
    });
    api.emitCustomEvent("prayer:restored-at-altar", {
      player,
      objectId: object.getId(),
      location,
      prayerBefore,
      prayerAfter,
    });
  }

  // Varrock hard: praying at the palace altar while Smite is active, restoration or not.
  if (object && handled && object.getId() === ObjectIds.ALTAR) {
    const location = object.getLocation();
    const palace = VARROCK_PALACE_ALTAR;
    if (location.getX() === palace.x && location.getY() === palace.y && location.getZ() === palace.z
      && player.getPrivateArea?.() === null
      && player.getPrayerActive?.()?.[core.PrayerHandler.SMITE] === true) {
      api.emitCustomEvent("diary:task", { player, diary: "varrock", task: VARROCK_PALACE_ALTAR_TASK });
    }
  }

  if (object && prayerAfter > prayerBefore && player.getPrivateArea() === null) {
    const location = object.getLocation();
    if (object.getId() === ObjectIds.ALTAR) {
      const [x, y, z] = EAST_ARDOUGNE_CHURCH_ALTAR;
      if (location.getX() === x && location.getY() === y && location.getZ() === z) {
        api.emitCustomEvent("diary:task", {
          player,
          diary: "ardougne",
          task: ARDOUGNE_ALTAR_TASK,
        });
      }
    }
    if (object.getId() === KOUREND_CASTLE_ALTAR.id
      && location.getX() === KOUREND_CASTLE_ALTAR.x
      && location.getY() === KOUREND_CASTLE_ALTAR.y
      && location.getZ() === KOUREND_CASTLE_ALTAR.z) {
      api.emitCustomEvent("diary:task", {
        player,
        diary: "kourend",
        task: KOUREND_CASTLE_ALTAR_TASK,
      });
    }
  }

  return handled;
}

/**
 * Chaos altars pray as altars do (captured at the Chaos Temple: human_pray, synth 2674, the same
 * messages). The Yanille Agility dungeon's trapdoor altar is left to fall through.
 */
function prayAtChaosAltar({ player, objectId, location }) {
  if (player.getHitpoints?.() <= 0 || player.isDyingReturn?.() === true) return false;
  if (objectId === core.ObjectIdentifiers.CHAOS_ALTAR_3) return false;
  const handled = handlePrayerAltar(player);
  const west = WESTERN_CHAOS_ALTAR;
  if (handled && location?.x === west.x && location?.y === west.y && location?.z === west.z) {
    api.emitCustomEvent("diary:task", { player, diary: "wilderness", task: "pray-at-the-chaos-altar-in-western-wilderness" });
  }
  return handled;
}

/** The Nature Grotto's altar: restores Prayer as altars do, and reports the restored points. */
function natureAltar({ player }) {
  const skills = player.getSkillManager();
  const before = skills.getCurrentLevel(Skill.PRAYER);
  const max = skills.getMaxLevel(Skill.PRAYER);
  const request = { player, handled: false };
  api.emitCustomEvent("altar:nature-quest-prayer", request);
  const handled = request.handled === true || handlePrayerAltar(player);
  // The diary requires restoring Prayer below its normal maximum, not just the quest bonus.
  if (handled && before < max && skills.getCurrentLevel(Skill.PRAYER) > before) {
    api.emitCustomEvent("altar:nature", { player });
  }
  return handled;
}

/** Shrines restore Prayer as altars do; the Woodcutting Guild's full-Prayer line, as captured. */
function prayAtShrine({ player }) {
  return handlePrayerAltar(player, "You already have full Prayer Points.");
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
  register: (pluginApi) => {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.onObjectInteraction("Ancient Altar", { Venerate: ancientAltar });
    pluginApi.onObjectInteraction("Lunar Altar", { Venerate: lunarAltar });
    pluginApi.onObjectInteraction("Dark Altar", { Venerate: darkAltar });
    pluginApi.onObjectInteraction("Altar", { "Pray-at": prayerAltar, Pray: prayerAltar });
    pluginApi.onObjectInteraction("Altar of Guthix", { "Pray-at": prayerAltar });
    pluginApi.onObjectInteraction("Chaos altar", { "Pray-at": prayAtChaosAltar });
    pluginApi.onObjectInteraction("Altar of nature", { "Pray-at": natureAltar });
    pluginApi.onObjectInteraction("Shrine", { "Pray-at": prayAtShrine });
    pluginApi.onObjectInteraction("Shrine of Ralos", { Bask: prayerAltar });
    pluginApi.onObjectInteraction("Altar of the Occult", {
      Venerate: venerateOccultAltar,
      Standard: standardSpellbook,
      Ancient: ancientSpellbook,
      Lunar: lunarSpellbook,
      Arceuus: arceuusSpellbook,
    });
  },
};
