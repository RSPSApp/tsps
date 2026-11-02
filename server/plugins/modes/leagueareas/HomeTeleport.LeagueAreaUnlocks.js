/**
 * Demonic Pacts' League Home Teleport (the league's `homeTeleport`; spellbook 218:5), as the
 * Leagues VI recordings show it: Cast asks which home, its other ops go straight to one. Civitas
 * illa Fortis plays the league's area-teleport cast; Yama's Lair opens a portal under the caster
 * that it falls through, landing four ticks later. The usual teleport rules apply (combat, the
 * Wilderness). No cooldown, as recorded.
 */
const Common = require("./Common.LeagueAreaUnlocks");
const { startHomeTeleport, castOf, BUSY_VARBIT } = require("../../combat/HomeTeleportSequence");

/** Players with the home menu up: closing it any way (Esc, walking off, a pick) clears busy. */
const menuOpen = new WeakSet();

function rules(type) {
  return Common.league(type)?.homeTeleport ?? null;
}

function near({ x, y, spread }) {
  const offset = () => Math.floor(Math.random() * (2 * spread + 1)) - spread;
  return new Common.core.Location(x + offset(), y + offset(), 0);
}

function allowed(player, target) {
  const { TeleportHandler, CombatFactory } = Common.core;
  if (CombatFactory.inCombat(player)) {
    player.sendMessage(Common.message("inCombat"));
    return false;
  }
  return TeleportHandler.checkReqs(player, target);
}

function civitas(player, type, home) {
  const target = near(home.civitas);
  if (!allowed(player, target)) return;
  startHomeTeleport(Common.core, player, target, null, castOf(Common.league(type).teleportCast));
}

/** Through Yama's portal: the portal on the tile, the fall two ticks on, the landing at +4. */
function yama(player, home) {
  const target = near(home.yama);
  if (!allowed(player, target)) return;
  const { core } = Common;
  const { portal, fall, fallTick, landTick, land, landGraphic, landGraphicHeight } = home.yama;
  const start = player.getLocation().clone();
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  core.World.sendLocalGraphics(portal, start);
  player.getMovementQueue().setBlockMovement(true).reset();
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
      if (tick === fallTick) player.performAnimation(new core.Animation(fall));
      if (tick !== landTick) return;
      this.stop();
      player.getMovementQueue().setBlockMovement(false).reset();
      player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
      player.moveTo(target);
      core.PluginManager?.emitCustomEvent?.("teleport:landed", { player, from: start, fromInstance: false, to: target });
      player.performAnimation(new core.Animation(land));
      player.performGraphic(new core.Graphic(landGraphic, 0, landGraphicHeight));
    }
  })());
}

function go(player, type, home, where) {
  if (where === "yama") yama(player, home);
  else if (where === "civitas") civitas(player, type, home);
}

function cast(event) {
  const { player } = event;
  const type = Common.leagueOf(player);
  const home = type === null ? null : rules(type);
  if (!home || String(event.spellName) !== home.spell) return;
  event.handled = true;
  const where = home.ops[String(event.opId ?? 1)];
  if (where) {
    go(player, type, home, where);
    return;
  }
  const { DialogueChainBuilder, OptionDialogue } = Common.core;
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        menuClosed({ player });
        go(player, type, home, Number(option) === 1 ? "yama" : Number(option) === 2 ? "civitas" : null);
      },
    }, ...home.menu.options).setTitle(home.menu.title),
  ));
  menuOpen.add(player);
}

function menuClosed({ player }) {
  if (!player || !menuOpen.delete(player)) return;
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

module.exports = function attach(api) {
  api.onSpellCast(cast);
  api.onCustomEvent("interface:closed", menuClosed);
};

Object.assign(module.exports, { cast });
