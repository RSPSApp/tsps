const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { MagicSpellbook } = require("../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { spellbookLockedRefusal } = require("../../src/main/typescript/elvarg/game/content/combat/magic/SpellbookLocks");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ChatType } = require("../../src/main/typescript/elvarg/net/protocol/ClientProtocol");
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

// The occult altar shows its variant for the active spellbook, whose named options are the
// other three books; Venerate offers the same three in a menu.
const OCCULT_ALTAR_BOOKS = [
  { name: "Standard", book: () => MagicSpellbook.NORMAL },
  { name: "Ancient", book: () => MagicSpellbook.ANCIENT },
  { name: "Lunar", book: () => MagicSpellbook.LUNAR },
  { name: "Arceuus", book: () => MagicSpellbook.ARCEUUS },
];
const OCCULT_SWITCH_SOUND = new Sound(1097, 1, 0, 5);
const MAGIC_TAB = 6;

/** A switch to `spellbook` the player hasn't unlocked (core SpellbookLocks): refused with the line, and true (handled). */
function refuseLocked(player, spellbook) {
  const refusal = spellbookLockedRefusal(player, spellbook);
  if (refusal) player.sendMessage(refusal);
  return refusal !== null;
}

function handleAncientAltar(player) {
  if (player.getSpellbook() !== MagicSpellbook.ANCIENT && refuseLocked(player, MagicSpellbook.ANCIENT)) return true;
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
  // Wiki: Prayer (5 April 2023) - praying at an altar resets the timer on Prayer point draining effects.
  player.setPrayerPointDrain(0);
  // Spam (filtered) chat: all 56 recorded recharges, revisions 227 to 237 (rsprox_transcripts/233/03242.txt:5471, a
  // normal world, after oploc1 on chaosaltar). "You already have full Prayer points." stays a game message (230/02850).
  player.getPacketSender().sendTypedMessage(ChatType.SPAM, "You recharge your Prayer points.");
  return true;
}

function handleJaldraochtAltar(player) {
  // As the Ancient altar: the switch to the Ancients needs Desert Treasure I (core SpellbookLocks); refused first,
  // so the Prayer drain doesn't happen either.
  if (player.getSpellbook() !== MagicSpellbook.ANCIENT && refuseLocked(player, MagicSpellbook.ANCIENT)) return true;
  // The pyramid altar plays no animation or sound and sends only its own line.
  const skillManager = player.getSkillManager();
  skillManager.setCurrentLevels(Skill.PRAYER, 0);
  skillManager.updateSkill(Skill.PRAYER);
  if (player.getSpellbook() === MagicSpellbook.ANCIENT) {
    MagicSpellbook.changeSpellbook(player, MagicSpellbook.NORMAL, false, "You feel a strange drain upon your memory...");
  } else {
    const switched = MagicSpellbook.changeSpellbook(player, MagicSpellbook.ANCIENT, false, "You feel a strange wisdom fill your mind...");
    if (switched) api.emitCustomEvent("diary:task", {
      player,
      diary: "desert",
      task: JALDRAOCHT_ALTAR_TASK,
    });
  }
  return true;
}

function handleOccultAltar(player, spellbook) {
  // Choosing the book already in use needs no unlock check, as the Ancient altar's own toggle.
  if (player.getSpellbook() !== spellbook && refuseLocked(player, spellbook)) return true;
  player.performAnimation(PRAY_AT_ALTAR_ANIMATION);
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
  MagicSpellbook.changeSpellbook(player, spellbook);
  return true;
}

/**
 * The Altar of the Occult's switch: the pray animation, the Magic tab, and its own sound. A named option says
 * "Your mind fills with knowledge."; a book picked from Venerate's menu says "...new knowledge." in a message box.
 */
function switchAtOccultAltar(player, spellbook, fromMenu = false) {
  if (player.getSpellbook() !== spellbook && refuseLocked(player, spellbook)) return true;
  const text = fromMenu ? "Your mind fills with new knowledge." : "Your mind fills with knowledge.";
  if (!MagicSpellbook.changeSpellbook(player, spellbook, false, fromMenu ? null : text)) return true;
  player.performAnimation(PRAY_AT_ALTAR_ANIMATION);
  player.getPacketSender().sendTab(MAGIC_TAB);
  Sounds.sendSound(player, OCCULT_SWITCH_SOUND);
  if (fromMenu) {
    const { DialogueChainBuilder, StatementDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  }
  return true;
}

function ancientAltar({ player }) {
  return handleAncientAltar(player);
}

function lunarAltar({ player }) {
  return handleOccultAltar(player, player.getSpellbook() === MagicSpellbook.LUNAR ? MagicSpellbook.NORMAL : MagicSpellbook.LUNAR);
}

function darkAltar({ player, objectId }) {
  if (Number.isInteger(objectId) && objectId === core.ObjectIdentifiers?.DARK_ALTAR) {
    api.emitCustomEvent("runecrafting:dark-altar-venerate", { player });
    return true;
  }
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
  // Dead or dying (killed on the way): nothing, and answered here so Nature Spirit's own Pray-at hook can't restore.
  if (player.getHitpoints() <= 0 || player.isDyingReturn?.() === true) return true;
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

/** Venerate: a menu of the three books other than the current one, with the Magic tab opened. */
function venerateOccultAltar({ player }) {
  const current = player.getSpellbook();
  const pairs = OCCULT_ALTAR_BOOKS
    .filter((entry) => entry.book() !== current)
    .flatMap((entry) => [entry.name, (who) => {
      const chooser = who ?? player;
      // The book in use since the menu opened (another switch meanwhile): nothing to do.
      if (chooser.getSpellbook() !== entry.book()) switchAtOccultAltar(chooser, entry.book(), true);
    }]);
  player.getPacketSender().sendTab(MAGIC_TAB);
  api.sendMultiChatboxPrompt(player, "Select an option", ...pairs);
  return true;
}

function standardSpellbook({ player }) {
  return switchAtOccultAltar(player, MagicSpellbook.NORMAL);
}

function ancientSpellbook({ player }) {
  return switchAtOccultAltar(player, MagicSpellbook.ANCIENT);
}

function lunarSpellbook({ player }) {
  return switchAtOccultAltar(player, MagicSpellbook.LUNAR);
}

function arceuusSpellbook({ player }) {
  return switchAtOccultAltar(player, MagicSpellbook.ARCEUUS);
}

module.exports = {
  name: "Altars",
  description: "Altar actions: pray to restore Prayer points, switch spellbooks at Ancient, Lunar and Dark altars, and the Chaos, Nature, Guthix and Occult altars.",
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
module.exports._test = { ancientAltar, lunarAltar, ancientSpellbook, lunarSpellbook, arceuusSpellbook, standardSpellbook, venerateOccultAltar, handleJaldraochtAltar };
