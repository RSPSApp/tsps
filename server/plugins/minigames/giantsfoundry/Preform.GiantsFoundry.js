"use strict";

/**
 * The preform: worn in the weapon slot while it is worked, kept warm in the preform storage, and
 * stored there automatically when the player leaves the cave or logs out. Its HUD (754) is open
 * whenever it is worn.
 *
 * rsprox captures (recording 101): Store-preform and Take-preform play human_furnace, flip
 * preform_stored, and close or reopen the HUD with the combat tab's header. Picking the preform up
 * from the jig in ice gloves plays synth 1051 with "Your Ice gloves cool the preform as you reach
 * for it." on the spam channel (recordings 96, 100, 101, 565); the bucket line goes there too.
 */

const Shared = require("./Shared.GiantsFoundry");
const Mould = require("./Mould.GiantsFoundry");
const Tools = require("./Tools.GiantsFoundry");

const ANIM_STORAGE = 899; // human_furnace
const HEADER_COMPONENT = 2; // combat_interface:header
const SOUND_PICK_UP = 1051;
/**
 * The preform is a giant's two-handed sword: human_weapon_giant01 ready, turn, walk and run
 * (cache sequences 9460, 823, 9461, 820-822, 9459), where the item's own default is a one-handed pose.
 */
const STANCE = [9460, 823, 9461, 820, 821, 822, 9459];
const POURED_AT = "pouredAt";
const JIG = { EMPTY: 0, POURED: 2, COOLED: 3 };
/** Molten metal cools about a degree a tick in the jig (rsprox: 980-998 at pickup). */
const POUR_TEMPERATURE = 1000;
/** Set by the quest's commission; its sword is worked hammer, grind, polish. */
const TUTORIAL = "tutorial";
const TUTORIAL_SEEDS = [1, 2, 0, 0, 0, 0];
/** Gloves that let the player pick the preform up hot, by item id. */
const COOLING_GLOVES = [Shared.ITEM.ICE_GLOVES, Shared.ITEM.SMITHS_GLOVES_I];

const MESSAGE = {
  STORED: "<col=229628>You place the preform in the handy storage area. It should stay nice and warm there.",
  TAKEN: "You take the preform from the handy storage area. It will start to get cold now.",
  KEPT_WARM: "You notice your current commission is being kept warm in the preform storage.",
  FREE_HANDS: "You must free your hands so you can hold the preform.",
  NOTHING_STORED: "There is no preform in the storage.",
  NOTHING_TO_STORE: "You have no preform to store.",
  GLOVES_COOL: (gloves) => `Your ${gloves} cool the preform as you reach for it.`,
  /** Not captured: every recorded pickup was made in ice gloves. */
  BUCKET_COOLS: "You cool the preform with your bucket of water as you take it from the mould.",
  /** Not captured either (no recorded pour used water); the quest says the metal must be cooled first. */
  BUCKET_COOLED: "You pour the water over the hot preform, cooling it down.",
  TOO_HOT: "The preform is still molten! You need to cool it down.",
};

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(Shared.core().ChatType.SPAM, text);
}

function hasFreeHands(player) {
  const { Equipment } = Shared.core();
  const equipment = player.getEquipment();
  return !equipment.get(Equipment.WEAPON_SLOT)?.isValid?.() && !equipment.get(Equipment.SHIELD_SLOT)?.isValid?.();
}

/** Two hands on the sword: the walk and stand poses follow the preform while it is worn. */
function holdStance(player) {
  const { Flag } = Shared.core();
  player.setRenderAnimations(STANCE);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
}

function releaseStance(player) {
  if (player.getRenderAnimations() === STANCE) player.setRenderAnimations(null);
}

function refreshWeapon(player) {
  const { WeaponInterfaceManager, Flag } = Shared.core();
  player.getEquipment().refreshItems();
  WeaponInterfaceManager.assign(player);
  Shared.api().getBonusManager().update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
}

function openHud(player) {
  player.getPacketSender().sendSubInterface(Shared.OVERLAY_HUD_UID, Shared.INTERFACE.HUD, 1);
}

function closeHud(player) {
  player.getPacketSender().closeSubInterface(Shared.OVERLAY_HUD_UID);
}

/** Puts the preform in the player's hands, with its combat tab header and HUD. */
function equip(player) {
  const { Equipment, Item } = Shared.core();
  player.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(Shared.ITEM.PREFORM, 1));
  refreshWeapon(player);
  holdStance(player);
  player.getPacketSender().sendString("Preform", (Shared.INTERFACE.COMBAT_TAB << 16) | HEADER_COMPONENT);
  openHud(player);
}

/** Takes the preform out of the player's hands. */
function unequip(player) {
  const { Equipment, Item } = Shared.core();
  if (!Shared.wornPreform(player)) return false;
  player.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(-1, 0));
  releaseStance(player);
  refreshWeapon(player);
  closeHud(player);
  return true;
}

/** The preform goes into the storage, keeping its heat and progress. */
function store(player) {
  if (!unequip(player)) return false;
  Shared.set(player, Shared.VARBIT.PREFORM_STORED, 1);
  return true;
}

function storePreform({ player }) {
  if (!Shared.wornPreform(player)) {
    player.sendMessage(MESSAGE.NOTHING_TO_STORE);
    return;
  }
  Shared.stopWork(player);
  Shared.animate(player, ANIM_STORAGE);
  store(player);
  player.sendMessage(MESSAGE.STORED);
}

function takePreform({ player }) {
  if (Shared.get(player, Shared.VARBIT.PREFORM_STORED) !== 1) {
    player.sendMessage(MESSAGE.NOTHING_STORED);
    return;
  }
  if (!hasFreeHands(player)) {
    Shared.statement(player, MESSAGE.FREE_HANDS);
    return;
  }
  Shared.animate(player, ANIM_STORAGE);
  Shared.set(player, Shared.VARBIT.PREFORM_STORED, 0);
  equip(player);
  player.sendMessage(MESSAGE.TAKEN);
}

/**
 * Stage 0 is always the trip hammer; each later stage needs one of the two tools the stage
 * before it didn't (every captured preform follows this). Returns seeds 1-6, 0 when unused.
 */
function rollSeeds(stages) {
  const seeds = [0, 0, 0, 0, 0, 0];
  let previous = 0;
  for (let stage = 1; stage < stages; stage++) {
    const choices = [0, 1, 2].filter((tool) => tool !== previous);
    previous = choices[Math.floor(Math.random() * choices.length)];
    seeds[stage - 1] = previous;
  }
  return seeds;
}

function coolingGloves(player) {
  const { Equipment } = Shared.core();
  const gloves = player.getEquipment().get(Equipment.HANDS_SLOT);
  const id = gloves?.getId?.();
  return COOLING_GLOVES.includes(id) ? id : null;
}

/** Whether an item-on-object event names the mould jig (the map holds its multiloc). */
function isMouldJig(player, objectId) {
  if (objectId === Shared.OBJECT.MOULD_JIG_MULTI) return true;
  const { ObjectDefinition } = Shared.core();
  const name = ObjectDefinition.forPlayer(objectId, player)?.getName?.();
  return Shared.OBJECT.MOULD_JIG.includes(name);
}

/**
 * Pouring the bucket over the jig cools the poured metal so it can be taken out: the Wiki's
 * quest walkthrough says "use a bucket of water to cool the sword", and Kovac's next line is
 * "take the preform and put it in your hand". Every capture drank from the ice gloves instead,
 * so the text is the only part not recorded.
 */
function coolMould(event) {
  const { player, itemId } = event;
  if (event.handled || itemId !== Shared.ITEM.BUCKET_OF_WATER || !isMouldJig(player, event.objectId)) return;
  if (!Shared.questComplete(player)) return;
  if (Shared.get(player, Shared.VARBIT.MOULD_STATE) !== JIG.POURED) return;
  event.handled = true;
  Shared.set(player, Shared.VARBIT.MOULD_STATE, JIG.COOLED);
  player.getInventory().delete(Shared.ITEM.BUCKET_OF_WATER, 1);
  player.getInventory().adds(Shared.ITEM.BUCKET, 1);
  player.getInventory().refreshItems();
  spam(player, MESSAGE.BUCKET_COOLED);
}

/** Takes the poured preform from the jig, working out its difficulty, quality and stages. */
function pickUp({ player }) {
  if (!Shared.questComplete(player)) return false;
  if (!hasFreeHands(player)) {
    Shared.statement(player, MESSAGE.FREE_HANDS);
    return true;
  }
  const gloves = coolingGloves(player);
  const cooled = Shared.get(player, Shared.VARBIT.MOULD_STATE) === JIG.COOLED;
  if (!cooled) {
    if (gloves !== null) {
      spam(player, MESSAGE.GLOVES_COOL(Shared.itemName(gloves)));
    } else if (player.getInventory().contains(Shared.ITEM.BUCKET_OF_WATER)) {
      player.getInventory().delete(Shared.ITEM.BUCKET_OF_WATER, 1);
      player.getInventory().adds(Shared.ITEM.BUCKET, 1);
      player.getInventory().refreshItems();
      spam(player, MESSAGE.BUCKET_COOLS);
    } else {
      Shared.statement(player, MESSAGE.TOO_HOT);
      return true;
    }
  }
  const difficulty = Shared.get(player, Shared.VARBIT.ALLOY_DIFFICULTY);
  const quality = Math.max(0, difficulty + Mould.playerScore(player));
  // Kovac's tutorial sword goes trip hammer, grindstone, polishing wheel (Sleeping Giants).
  const tutorial = Shared.field(player, TUTORIAL, false) === true;
  const seeds = tutorial ? TUTORIAL_SEEDS : rollSeeds(Tools.stageCount(difficulty));
  const pouredAt = Number(Shared.field(player, POURED_AT, Shared.tick()));
  const temperature = Math.max(0, POUR_TEMPERATURE - Math.max(0, Shared.tick() - pouredAt));
  Shared.set(player, Shared.VARBIT.PREFORM_DIFFICULTY, difficulty);
  Shared.set(player, Shared.VARBIT.PREFORM_QUALITY, quality);
  Shared.set(player, Shared.VARBIT.PREFORM_START_QUALITY, quality);
  seeds.forEach((seed, index) => Shared.set(player, Shared.VARBIT.SEED_FIRST + index, seed));
  Shared.set(player, Shared.VARBIT.TEMPERATURE, temperature);
  Shared.set(player, Shared.VARBIT.COMPLETION, 0);
  Shared.set(player, Shared.VARBIT.ALLOY_DIFFICULTY, 0);
  Mould.clearSelection(player);
  Shared.set(player, Shared.VARBIT.MOULD_STATE, JIG.EMPTY);
  Shared.setField(player, POURED_AT, null);
  Tools.resetPreform(player);
  equip(player);
  Shared.sound(player, SOUND_PICK_UP);
  Shared.step(player, "preform-taken");
  return true;
}

/** The preform never leaves the foundry: walking out, teleporting or logging out stores it. */
function storeOnLeave(player) {
  if (Shared.wornPreform(player)) store(player);
}

function noticeStoredPreform(player) {
  if (Shared.get(player, Shared.VARBIT.PREFORM_STORED) === 1) player.sendMessage(MESSAGE.KEPT_WARM);
}

/**
 * The preform can only be taken off at the preform storage (Wiki). No capture shows the
 * refusal's message, so it is refused silently.
 */
function keepPreformWorn(event) {
  if (event.item?.getId?.() !== Shared.ITEM.PREFORM) return;
  event.allow = false;
}

/** A preform worn outside the cave (an old save) goes back into storage. */
function checkLogin({ player }) {
  if (Shared.wornPreform(player) && !Shared.inRoom(player.getLocation())) store(player);
  else if (Shared.wornPreform(player)) {
    holdStance(player);
    openHud(player);
  }
}

module.exports = function attachPreform(api) {
  api.onObjectInteraction(Shared.OBJECT.PREFORM_STORAGE, { "Store-preform": storePreform, "Take-preform": takePreform });
  api.onObjectInteraction("Mould jig (Poured metal)", { "Pick-up": pickUp });
  api.onObjectInteraction("Mould jig (Cooled metal)", { "Pick-up": pickUp });
  api.onItemOnObject(coolMould, { noted: false });
  api.onCanUnequip(keepPreformWorn);
  api.onPlayerLogin(checkLogin);
};

Object.assign(module.exports, {
  hasFreeHands, rollSeeds, equip, unequip, STANCE, store, storeOnLeave, noticeStoredPreform, openHud, closeHud, MESSAGE,
  coolMould, isMouldJig,
});
