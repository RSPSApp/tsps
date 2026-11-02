/**
 * Leaving Yama's Lair, where a Demonic Pacts character begins (the league's `exit`): the Glowing
 * portal's Leave takes the player to Civitas illa Fortis through a shadow fade, as recorded
 * (237/01098). Only the league's own portal loc, for its own characters.
 */
const Common = require("./Common.LeagueAreaUnlocks");

const BUSY_VARBIT = 12393;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_HIDDEN = 2;
/** The fade overlay as the toplevel's overlay_atmosphere carries it (the magic mushtrees' too). */
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function exitOf(player, object) {
  const type = Common.leagueOf(player);
  const exit = type === null ? null : Common.league(type)?.exit;
  if (!exit) return null;
  return Common.core.CacheDefinitions.getLocId?.(exit.loc) === object?.getId?.() ? exit : null;
}

function leave({ player, object }) {
  const exit = exitOf(player, object);
  if (!exit) return false;
  const { core } = Common;
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  player.getMovementQueue().setBlockMovement(true).reset();
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(exit.animation)));
  player.performGraphic(new core.Graphic(core.CacheDefinitions.getSpotanimId(exit.graphic)));
  fade(player, true);
  const offset = () => Math.floor(Math.random() * (2 * exit.to.spread + 1)) - exit.to.spread;
  const target = new core.Location(exit.to.x + offset(), exit.to.y + offset(), 0);
  let tick = 0;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      tick++;
      if (!player.isRegistered()) {
        this.stop();
        return;
      }
      if (tick === exit.minimapTick) sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_HIDDEN);
      if (tick === exit.moveTick) {
        player.moveTo(target);
        player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
      }
      if (tick < exit.endTick) return;
      this.stop();
      sender.sendVarbit(MINIMAP_STATE_VARBIT, 0);
      sender.sendVarbit(BUSY_VARBIT, 0);
      player.getMovementQueue().setBlockMovement(false).reset();
      fade(player, false);
    }
  })());
  return true;
}

module.exports = function attach(api) {
  api.onObjectInteraction("Glowing portal", { Leave: leave });
};

Object.assign(module.exports, { leave });
