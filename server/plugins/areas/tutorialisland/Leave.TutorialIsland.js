/**
 * Starting and leaving. New accounts start with the past-experience screen, as captured (the
 * display name and appearance screens before it are not part of this tutorial); the answer picks
 * the transcripts' "brand new" or "played before" lines later on. The island ends as captured:
 * the Magic Instructor sends you off with the Home Teleport, and arriving in Lumbridge clears
 * your items, gives the starter kit and finishes the tutorial. The Gielinor Guide also offers to
 * skip the island (ours; `TutorialIsland:allowSkip` in world.json turns it off).
 */
const T = require("./Common.TutorialIsland");
const Interface = require("./Interface.TutorialIsland");

const { STEP } = T;
/** Tutorial Island start tile (the Gielinor Guide's house). */
const TUTORIAL_SPAWN = Object.freeze({ x: 3094, y: 3104, z: 0 });
/** The Home Teleport lands here (Lumbridge); worlds that start elsewhere move the player on. */
const LUMBRIDGE = Object.freeze({ x: 3222, y: 3218 });

let core, Items, pluginApi;

function clearItems(player) {
  const inv = player.getInventory();
  for (let slot = 0; slot < inv.capacity(); slot++) {
    const item = inv.getItems()[slot];
    if (item && item.getId() > 0) inv.deleteAtSlot(slot, item.getAmount());
  }
  // Emptying the slots isn't enough: the weapon interface (which drives combat), the bonuses and
  // the worn look follow the equipment, so refresh them as any equipment change does.
  const equipment = player.getEquipment();
  equipment.resetItems();
  player.setSpecialActivated?.(false);
  core.WeaponInterfaceManager.assign(player);
  pluginApi.getBonusManager().update(player);
  equipment.refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

/** The starter kit, as captured on arrival in Lumbridge. */
function giveStarterKit(player) {
  const inv = player.getInventory();
  for (const item of [
    Items.BRONZE_AXE, Items.BRONZE_PICKAXE, Items.TINDERBOX, Items.SMALL_FISHING_NET, Items.SHRIMPS,
    Items.BRONZE_DAGGER, Items.BRONZE_SWORD, Items.WOODEN_SHIELD, Items.SHORTBOW,
  ]) inv.adds(item, 1);
  inv.adds(Items.BRONZE_ARROW, 25);
  inv.adds(Items.AIR_RUNE, 25);
  inv.adds(Items.MIND_RUNE, 15);
  inv.adds(Items.BUCKET, 1);
  inv.adds(Items.POT, 1);
  inv.adds(Items.BREAD, 1);
  inv.adds(Items.WATER_RUNE, 6);
  inv.adds(Items.EARTH_RUNE, 4);
  inv.adds(Items.BODY_RUNE, 2);
  const bank = player.getBank(0);
  const coins = bank.getAmount(Items.COINS);
  if (coins < 25) bank.adds(Items.COINS, 25 - coins);
}

/** Ends the tutorial where the player stands (or at the world's spawn when that isn't Lumbridge). */
function complete(player) {
  clearItems(player);
  giveStarterKit(player);
  const spawn = core.GameConstants.DEFAULT_LOCATION;
  const nearLumbridge = Math.abs(spawn.getX() - LUMBRIDGE.x) <= 32 && Math.abs(spawn.getY() - LUMBRIDGE.y) <= 32;
  if (!nearLumbridge || T.atTutorial(player)) player.moveTo(spawn.clone());
  T.setProgress(player, STEP.COMPLETED);
  player.getPacketSender().sendVarbit(T.data.varbits.freeStuffCheck, 1);
  const { welcome, welcomeLumbridge, welcomeLumbridgeItem } = T.data.messages;
  player.sendMessage(welcome);
  T.showBoxes(player, [{ item: welcomeLumbridgeItem, text: welcomeLumbridge }]);
}

function onLogin(event) {
  const player = event.player;
  if (!player || player.isPlayerBot?.() === true) return;
  if (event.isNewAccount) {
    // Drawn on the first tick, once the gameframe and the character design are up.
    player.setAttribute(T.PROGRESS_ATTRIBUTE, STEP.PAST_EXPERIENCE);
    player.moveTo(new core.Location(TUTORIAL_SPAWN.x, TUTORIAL_SPAWN.y, TUTORIAL_SPAWN.z));
  } else if (!T.isActive(player)) {
    // Done with the island (or from before it existed): the quest list reads the varp.
    player.getPacketSender().sendConfig(T.data.varps.progress, STEP.COMPLETED);
  }
}

/** An answer on the past-experience screen (slots 1-3 of its option list). */
function onExperience({ player, action }) {
  const answer = T.data.experience[String(action)];
  if (!player || !answer || T.progress(player) !== STEP.PAST_EXPERIENCE) return true;
  player.setAttribute(T.EXPERIENCE_ATTRIBUTE, answer);
  T.setProgress(player, STEP.GIELINOR_TALK);
  player.getPacketSender().sendInterfaceRemoval();
  return true;
}

/**
 * The experience screen can't be closed without an answer: it opens again. It also opens once
 * the character design is confirmed, as captured.
 */
function onInterfaceClosed({ player, interfaceId }) {
  const { experience, appearance } = T.data.interfaces;
  if ((interfaceId !== experience && interfaceId !== appearance) || T.progress(player) !== STEP.PAST_EXPERIENCE) return;
  T.later(1, () => {
    if (T.progress(player) !== STEP.PAST_EXPERIENCE || player.getInterfaceId?.() === appearance) return;
    Interface.render(player, STEP.PAST_EXPERIENCE);
  });
}

/** Teleports can't leave the island, except the Home Teleport once the Magic Instructor says so. */
function onCanTeleport(event) {
  const player = event.player;
  if (!player || !T.isActive(player)) return;
  if (T.progress(player) === STEP.HOME_TELEPORT) return;
  event.allow = false;
  player.sendMessage("You can't leave Tutorial Island yet.");
}

/** Arriving off the island after the Home Teleport finishes the tutorial. */
function onProcess({ player }) {
  if (!player || T.progress(player) !== STEP.HOME_TELEPORT || T.atTutorial(player)) return;
  complete(player);
}

// The first Talk-to with the Gielinor Guide offers to skip the island.
const passedSkipOffer = new WeakSet();

function talkToGielinorGuide(event) {
  const player = event.player;
  if (passedSkipOffer.delete(player)) return false;
  if (!T.isActive(player) || T.progress(player) !== STEP.GIELINOR_TALK) return false;
  if (pluginApi.getPluginConfig("TutorialIsland:allowSkip", true) === false) return false;
  pluginApi.sendMultiChatboxPrompt(
    player,
    "Skip tutorial island?",
    "Yes, skip", () => complete(player),
    "No, continue", () => {
      passedSkipOffer.add(player);
      core.PluginManager.emitNpcInteraction({ ...event, handled: false });
    },
  );
  return true;
}

const STEP_NAMES = Object.fromEntries(Object.entries(STEP).map(([name, value]) => [value, name]));

/** ::tutnext / ::tutlast: walk the step list. */
function stepBy(player, delta) {
  if (!T.isActive(player)) {
    player.sendMessage("You're not doing Tutorial Island.");
    return true;
  }
  const playable = T.ORDER.filter((value) => value >= STEP.PAST_EXPERIENCE && value <= STEP.HOME_TELEPORT);
  const at = playable.findIndex((value) => value >= T.progress(player));
  const next = playable[Math.max(0, Math.min(playable.length - 1, at + delta))];
  T.setProgress(player, next);
  player.sendMessage(`Tutorial step: ${STEP_NAMES[next]} (${next})`);
  return true;
}

module.exports = function attach(api) {
  pluginApi = api;
  core = api.core;
  Items = core.ItemIdentifiers;
  api.persistAttribute(T.PROGRESS_ATTRIBUTE);
  api.persistAttribute(T.LEGACY_STAGE_ATTRIBUTE);
  api.persistAttribute(T.EXPERIENCE_ATTRIBUTE);
  const { experience, experienceOptions } = T.data.interfaces;
  api.onInterfaceActionButton((experience << 16) | experienceOptions, onExperience);
  api.onCustomEvent("interface:closed", onInterfaceClosed);
  api.registerCommand("tutnext", ({ player }) => stepBy(player, 1), core.PlayerRights.ADMINISTRATOR, "Advance to the next tutorial step");
  api.registerCommand("tutlast", ({ player }) => stepBy(player, -1), core.PlayerRights.ADMINISTRATOR, "Return to the previous tutorial step");
  api.onNpcInteraction("Gielinor Guide", { "Talk-to": talkToGielinorGuide });
  api.onPlayerLogin(onLogin);
  api.onCanTeleport(onCanTeleport);
  api.onPlayerProcess(onProcess);
};

Object.assign(module.exports, { complete });
