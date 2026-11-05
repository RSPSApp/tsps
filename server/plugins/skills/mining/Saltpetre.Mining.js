"use strict";

/**
 * Saltpetre deposits in Hosidius (Wiki: Saltpetre (deposit)).
 *
 * Digging needs a spade, gives no Mining experience, and yields 1 saltpetre, or 2 with a chance
 * roughly equal to the player's Mining level out of 100. The five deposits are placed at the
 * Wiki's map pins; the Wiki's single active deposit (the one Konoo is working) is not modelled,
 * and the game does not publish the rotation. The dig animation and sound are the captures the
 * shared Spade plugin uses for a plain dig; the chat lines for a missing spade or a full
 * inventory are not captured.
 */
const DIG_ANIMATION = 830;
const DIG_SOUND = 1470;
const DIG_TICKS = 2;
const SALT_OBJECT_IDS = new Set([27433, 27434, 27435, 27436]);
const SPADE_NAMES = new Set(["Spade", "Large spade", "Eastfloor spade"]);
const NEED_SPADE = "You need a spade to dig here.";
const NO_SPACE = "You don't have enough inventory space.";

let api;
let core;
let Task;
let TaskManager;

function hasSpade(player) {
  return player.getInventory().getItems().some((item) =>
    item.getAmount() > 0 && SPADE_NAMES.has(core.CacheDefinitions.getItem(item.getId())?.name));
}

/** The chance of a second piece is the visible Mining level out of 100 (Wiki). */
function amount(player, random = Math.random) {
  const level = player.getSkillManager().getCurrentLevel(core.Skill.MINING);
  return random() * 100 < level ? 2 : 1;
}

function dig(event) {
  const { player, object } = event;
  if (!SALT_OBJECT_IDS.has(object.getId())) return false;
  event.handled = true;
  if (!hasSpade(player)) {
    player.sendMessage(NEED_SPADE);
    return true;
  }
  if (player.getInventory().isFull()) {
    player.sendMessage(NO_SPACE);
    return true;
  }
  player.performAnimation(new core.Animation(DIG_ANIMATION));
  core.Sounds.sendSound(player, new core.Sound(DIG_SOUND, 1, 0, 0));
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(DIG_TICKS);
      this.player = player;
    }
    execute() {
      this.stop();
      if (!this.player.isRegistered()) return;
      if (this.player.getInventory().isFull()) {
        this.player.sendMessage(NO_SPACE);
        return;
      }
      const count = amount(this.player);
      this.player.getInventory().adds(core.ItemIdentifiers.SALTPETRE, count);
      this.player.sendMessage("You dig up some saltpetre.");
      api.emitCustomEvent("mining:saltpetre", { player: this.player, amount: count });
    }
  })());
  return true;
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  Task = core.Task;
  TaskManager = core.TaskManager;
  api.onObjectInteraction("Saltpetre", { Dig: dig });
}

module.exports = { attach, _test: { dig, hasSpade, amount } };
