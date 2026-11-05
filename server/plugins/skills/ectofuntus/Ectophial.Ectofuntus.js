/**
 * The ectophial (Ghosts Ahoy's reward). As captured (rsprox, 14 recordings, rev 224-236), from the
 * click on Empty:
 * - 0: ahoy_ecto_teleport with ectophial_pour_spotanim, the full phial becomes the empty one and
 *   "You empty the ectoplasm onto the ground around your feet..." The sequence loops (99 times)
 *   until the server stops it.
 * - 3: the sequence is reset and the player lands on one of (3658-3661, 3522) by the Ectofuntus,
 *   "...and the world changes around you."
 * - 4: facing (3659, 3520), human_pickupfloor with synth 1132
 * - 5: the empty phial is full again, "You refill the ectophial from the Ectofuntus.", the sequence
 *   reset again.
 * A click doesn't stop it: in recording 703 the player clicks on tick 5, the phial refills that
 * tick and they only move on the next, so movement is held until the refill. Using an empty phial
 * on the Ectofuntus refills it too (Wiki). It obeys the teleport rules (level 20 Wilderness).
 */
const Common = require("./Common.Ectofuntus");

const LANDING_XS = [3658, 3659, 3660, 3661];
const LANDING_Y = 3522;
const FACE_TILE = [3659, 3520];
const TELEPORT_TICK = 3;
const KNEEL_TICK = 4;
const REFILL_TICK = 5;
const REFILL_SOUND = 1132;
const POUR_SOUND_RADIUS = 5;
const REFILL_ANIMATION_DELAY = 10;
const REFILL_SOUND_DELAY = 30;
const refilling = new WeakSet();

/** The Wiki's refill immunity applies at impact, after attackers have earned their XP. */
function protectRefill({ player, hit }) {
  if (refilling.has(player)) hit.setTotalDamage(0);
}

/** Direct hits, including an existing poison/venom pulse, use the final damage boundary. */
function protectDirectDamage({ target, hit }) {
  if (refilling.has(target)) hit.setDamage(0);
}

function landing() {
  const x = LANDING_XS[Math.floor(Math.random() * LANDING_XS.length)];
  return new Common.core.Location(x, LANDING_Y, 0);
}

/** Face the Ectofuntus and kneel; the refill follows a tick later. */
function kneel(player, automatic = false) {
  const { core } = Common;
  player.setPositionToFace(new core.Location(FACE_TILE[0], FACE_TILE[1], 0));
  player.performAnimation(new core.Animation(Common.gameval("seq", "human_pickupfloor"),
    automatic ? REFILL_ANIMATION_DELAY : 0));
  player.getPacketSender().sendSound(REFILL_SOUND, 1, automatic ? REFILL_SOUND_DELAY : 0);
}

function refill(player) {
  const { core } = Common;
  if (Common.swap(player, core.ItemIdentifiers.ECTOPHIAL_2, core.ItemIdentifiers.ECTOPHIAL)) {
    Common.spam(player, "You refill the ectophial from the Ectofuntus.");
  }
  player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
}

function empty({ player, slot }) {
  const { core } = Common;
  const inventory = player.getInventory();
  if (inventory.get(slot)?.getId() !== core.ItemIdentifiers.ECTOPHIAL) return true;
  const destination = landing();
  if (!core.TeleportHandler.checkReqs(player, destination)) return true;
  inventory.setItem(slot, new core.Item(core.ItemIdentifiers.ECTOPHIAL_2, 1)).refreshItems();
  const movement = player.getMovementQueue();
  movement.setBlockMovement(true).reset();
  player.getPacketSender().sendVarbit(Common.gameval("varbit", "busy"), 1);
  Common.animate(player, "ahoy_ecto_teleport");
  player.performGraphic(new core.Graphic(Common.gameval("spotanim", "ectophial_pour_spotanim")));
  const at = player.getLocation();
  core.Sounds.playAreaSound({ soundId: core.Sound.DRINK.getId(), x: at.getX(), y: at.getY(), level: at.getZ(), radius: POUR_SOUND_RADIUS });
  Common.spam(player, "You empty the ectoplasm onto the ground around your feet...");
  let tick = 0;
  // Keyed to the player object, not their index, so a walk or click doesn't cancel it.
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player, false); }
    execute() {
      tick++;
      if (!player.isRegistered()) {
        this.stop();
        return;
      }
      if (tick === TELEPORT_TICK) {
        refilling.add(player);
        player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
        player.moveTo(destination);
        Common.api.emitCustomEvent("ectophial:arrived", { player });
        Common.spam(player, "...and the world changes around you.");
      } else if (tick === KNEEL_TICK) {
        kneel(player, true);
      } else if (tick === REFILL_TICK) {
        refill(player);
        this.stop();
      }
    }
    stop() {
      refilling.delete(player);
      movement.setBlockMovement(false);
      player.getPacketSender().sendVarbit(Common.gameval("varbit", "busy"), 0);
      super.stop();
    }
  })());
  return true;
}

/** The empty phial used on the Ectofuntus. */
function refillAtEctofuntus({ player, itemId }) {
  if (itemId !== Common.core.ItemIdentifiers.ECTOPHIAL_2) return false;
  kneel(player);
  Common.run(player, () => {
    refill(player);
    return false;
  });
  return true;
}

module.exports = function attachEctophial(api) {
  api.onItemAction("Ectophial", { Empty: empty });
  api.onItemOnObject("Ectophial", "Ectofuntus", refillAtEctofuntus);
  api.onPlayerHitModify(protectRefill);
  api.onCustomEvent("combat:damage-apply", protectDirectDamage);
};
