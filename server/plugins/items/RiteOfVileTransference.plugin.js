"use strict";

/**
 * Rite of vile transference (Wiki: Rite of vile transference, Death Charge): reading it consumes
 * the scroll and permanently upgrades Death Charge to restore special attack energy from two
 * targets per cast. The upgrade itself is in ArceuusSpells (core Death Charge), which reads
 * ArceuusSpells.DEATH_CHARGE_UPGRADED_ATTRIBUTE; this plugin saves it and drives the read.
 *
 * rsprox recording 3285 (revision 234) ticks 6162-6178, Read (op2):
 *  - an objectbox of the scroll with READ_INTRO (also a mesbox line), Click here to continue;
 *  - a chatmenu titled "This will consume the scroll." with "Upgrade <col=7f0000>Death Charge</col>"
 *    and Cancel;
 *  - Upgrade, the same tick: varbit death_charge_scroll_used 1, seq qip_watchtower_read_scroll_and_stop,
 *    spotanim death_charge_upgrade_cast_spotanim and synth 5034 (both delay 80), the scroll gone and
 *    the menu closed;
 *  - 6 ticks later, an objectbox of the scroll with UPGRADED (also a mesbox line).
 * Recordings 787-792 send death_charge_scroll_used 1 on login.
 *
 * Events:
 *  - "arceuus:death-charge-upgraded" { player, itemId } -> out: the rite was read.
 */

const RITE_NAME = "Rite of vile transference";
const SCROLL_USED_VARBIT = "death_charge_scroll_used";
const READ_SEQ = "qip_watchtower_read_scroll_and_stop";
const UPGRADE_SPOTANIM = "death_charge_upgrade_cast_spotanim";
const UPGRADE_SOUND = 5034;
const UPGRADE_DELAY = 80;
const UPGRADED_BOX_TICKS = 6;

const SPELL = "<col=7f0000>Death Charge</col>";
const READ_INTRO = "You can make out some faded words on the ancient parchment. "
  + "It appears to be a demonic learning on spell efficiency. Would you like to absorb its knowledge?";
const CONSUME_TITLE = "This will consume the scroll.";
const UPGRADE_OPTION = `Upgrade ${SPELL}`;
const UPGRADED = `You study the scroll and upgrade an Arceuus Spell: ${SPELL}`;
// Ours: the Wiki and recordings don't show a second rite read; worded like the prayer scrolls'
// recorded "nothing more for you to learn" line.
const ALREADY_UPGRADED = "You can make out some faded words on the ancient parchment. "
  + "It appears to be a demonic learning on spell efficiency. However there's nothing more for you to learn.";

let api = null;
let core = null;

function isUpgraded(player) {
  return player.getAttribute(core.ArceuusSpells.DEATH_CHARGE_UPGRADED_ATTRIBUTE) === true;
}

function sendScrollUsed(player) {
  const id = core.CacheDefinitions.getVarbitId(SCROLL_USED_VARBIT);
  if (id != null) player.getPacketSender().sendVarbit(id, isUpgraded(player) ? 1 : 0);
}

function itemBox(player, itemId, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, itemId, text)));
}

function readRite({ player, itemId }) {
  if (player.busy()) {
    player.sendMessage("You cannot do that right now.");
    return true;
  }
  if (isUpgraded(player)) {
    player.sendMessage(ALREADY_UPGRADED);
    return true;
  }
  const chain = new core.DialogueChainBuilder();
  chain.add(new core.ItemStatementDialogue(0, itemId, READ_INTRO));
  chain.add(new core.OptionDialogue(1, {
    executeOption(option) {
      player.getDialogueManager().reset();
      if (Number(option) === 1) upgrade(player, itemId);
    },
  }, UPGRADE_OPTION, "Cancel").setTitle(CONSUME_TITLE));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

function upgrade(player, itemId) {
  if (isUpgraded(player) || !player.getInventory().contains(itemId)) return;
  player.getInventory().deleteNumber(itemId, 1);
  player.setAttribute(core.ArceuusSpells.DEATH_CHARGE_UPGRADED_ATTRIBUTE, true);
  sendScrollUsed(player);
  const seq = core.CacheDefinitions.getSeqId(READ_SEQ);
  if (seq != null) player.performAnimation(new core.Animation(seq));
  const spotanim = core.CacheDefinitions.getSpotanimId(UPGRADE_SPOTANIM);
  if (spotanim != null) player.performGraphic(new core.Graphic(spotanim, UPGRADE_DELAY));
  player.getPacketSender().sendSoundEffect(UPGRADE_SOUND, 1, UPGRADE_DELAY, 255);
  core.TaskManager.submit(new core.CountdownTask(null, UPGRADED_BOX_TICKS, () => showUpgraded(player, itemId)));
  api.emitCustomEvent("arceuus:death-charge-upgraded", { player, itemId });
}

function showUpgraded(player, itemId) {
  if (!player.isRegistered()) return;
  itemBox(player, itemId, UPGRADED);
}

function syncOnLogin({ player }) {
  sendScrollUsed(player);
}

module.exports = {
  name: "RiteOfVileTransference",
  description: "Reading the Rite of vile transference consumes it and permanently upgrades Death Charge to restore special attack energy from two kills per cast.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.persistAttribute(pluginApi.core.ArceuusSpells.DEATH_CHARGE_UPGRADED_ATTRIBUTE, false);
    pluginApi.onPlayerLogin(syncOnLogin);
    pluginApi.onItemAction(RITE_NAME, { Read: readRite });
  },
};

module.exports._test = { readRite, upgrade, syncOnLogin, READ_INTRO, UPGRADED, CONSUME_TITLE, UPGRADE_OPTION };
