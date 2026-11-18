"use strict";

/**
 * Varlamore's alpacas (Wiki: Alpaca; shearable at Ortus Farm and the Quetzacalli Gorge): Shear with
 * shears in the inventory gives one wool. As captured (rsprox.net 1105, rev 237, ten shears):
 *   - on the arrival the player faces the alpaca;
 *   - then (1 to 3 ticks on) the player plays human_shearing, synth 761 (delay 10) plays, the
 *     alpaca faces the player and busy goes 0 -> 1;
 *   - two ticks later "You shear the alpaca and get some wool.", +1 wool, the alpaca turns into its
 *     sheared form (varlamore_alpaca_sheared_1 / _2) and busy goes 1 -> 0; a tick later it looks away;
 *   - fifty ticks after it turns sheared it is back to its woolly form (1105: index 4283 sheared at
 *     2051, back at 2101; 4269 at 2057 and 2107).
 * The sheared forms have no Shear option (cache), so they need no line of their own.
 * Emits `alpaca:sheared` { player } with the wool (a league's "Shear an Alpaca").
 *
 * Ours: without shears, the sheep's captured "You need a set of shears to do this."; with no room
 * for the wool, the sheep's "You don't have enough inventory space to hold the wool." (no alpaca
 * recording shows either). The shear starts on the arrival's tick here (recorded 1 to 3 ticks on).
 */
const SHEAR_TICKS = 2;
const REGROW_TICKS = 50;
const SHEAR_SOUND = 761;
const SHEAR_SOUND_DELAY = 10;
const SHEARED = "You shear the alpaca and get some wool.";
const NO_SHEARS = "You need a set of shears to do this.";
const NO_ROOM = "You don't have enough inventory space to hold the wool.";

let api = null;
/** The alpacas being sheared or still sheared, so one can't be shorn twice before it regrows. */
const shorn = new WeakSet();

function ids() {
  const C = api.core.CacheDefinitions;
  return new Map([
    [C.getNpcId("varlamore_alpaca_1"), C.getNpcId("varlamore_alpaca_sheared_1")],
    [C.getNpcId("varlamore_alpaca_2"), C.getNpcId("varlamore_alpaca_sheared_2")],
  ]);
}

function busy(player, on) {
  const id = api.core.CacheDefinitions.getVarbitId("busy");
  if (Number.isInteger(id)) player.getPacketSender().sendVarbit(id, on ? 1 : 0);
}

function shear({ player, npc }) {
  const { core } = api;
  if (!npc || shorn.has(npc)) return true;
  const sheared = ids().get(npc.getId());
  if (!Number.isInteger(sheared)) return false;
  const inventory = player.getInventory();
  if (!inventory.contains(core.ItemIdentifiers.SHEARS)) {
    player.sendMessage(NO_SHEARS);
    return true;
  }
  // Wool doesn't stack: a full pack has no room, whatever it holds.
  if (inventory.isFull()) {
    player.sendMessage(NO_ROOM);
    return true;
  }
  shorn.add(npc);
  player.setPositionToFace(npc.getLocation());
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_shearing")));
  player.getPacketSender().sendSoundEffect(SHEAR_SOUND, 1, SHEAR_SOUND_DELAY);
  npc.setPositionToFace?.(player.getLocation());
  busy(player, true);
  core.TaskManager.submit(new core.CountdownTask(npc, SHEAR_TICKS, () => {
    busy(player, false);
    if (!player.isRegistered() || !npc.isRegistered()) {
      shorn.delete(npc);
      return;
    }
    if (inventory.isFull()) {
      shorn.delete(npc);
      player.sendMessage(NO_ROOM);
      return;
    }
    player.sendMessage(SHEARED);
    inventory.adds(core.ItemIdentifiers.WOOL, 1);
    npc.setNpcTransformationId(sheared);
    api.emitCustomEvent("alpaca:sheared", { player });
    // 1105: woolly again 50 ticks after the sheared form appears (index 4283: 2051 -> 2101).
    core.TaskManager.submit(new core.CountdownTask(npc, REGROW_TICKS, () => {
      shorn.delete(npc);
      if (npc.isRegistered()) npc.setNpcTransformationId(-1);
    }));
  }));
  return true;
}

module.exports = {
  name: "Alpaca",
  description: "Lets players shear Varlamore's alpacas for wool with shears, as captured: the sheared alpaca grows its wool back 50 ticks later.",
  members: true,
  _test: { shear, SHEARED, NO_SHEARS, NO_ROOM, SHEAR_TICKS, REGROW_TICKS },
  register(pluginApi) {
    api = pluginApi;
    api.onNpcInteraction("Alpaca", { Shear: shear });
  },
};
