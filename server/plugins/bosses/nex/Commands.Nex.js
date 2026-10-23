/**
 * Developer commands for Nex:
 *   ::nex                 to the safe room, the frozen door unsealed and 40 ancient essence
 *   ::nexspawn            Nex now, in your chamber (public or private); moves you in first
 *   ::nexphase <2-5>      skips to a phase (the mages before it die)
 *   ::nexspecial <name>   a special now: virus, dash, smash, darkness, siphon, sacrifice, containment, prison
 *   ::nexhp <hitpoints>   sets her hitpoints
 *   ::nexend              clears the chamber without a kill
 */
const Common = require("./Common.Nex");
const Chamber = require("./Chamber.Nex");
const Specials = require("./Specials.Nex");

const SAFE_ROOM = [2905, 5203, 0];

function toPrison({ player }) {
  player.setAttribute(Common.UNLOCKED_ATTRIBUTE, true);
  Common.setEssence(player, Common.data.prison.essenceRequired);
  player.moveTo(Common.toLocation(SAFE_ROOM));
  return true;
}

function spawn({ player }) {
  const instance = require("./Instance.Nex").instanceOf(player);
  if (instance) {
    if (instance.fight) {
      player.sendMessage("Nex is already being fought.");
      return true;
    }
    instance.pendingSpawn = null;
    instance.scheduleSpawn(1);
    return true;
  }
  if (Chamber.fight()) {
    player.sendMessage("Nex is already being fought.");
    return true;
  }
  if (!Chamber.arena.inChamber(player.getLocation())) player.moveTo(Common.toLocation(Common.data.chamber.entry));
  Common.later(2, () => Chamber.fight() || Chamber.startFight());
  return true;
}

function currentFight(player) {
  const fight = Chamber.fightFor(player) ?? Chamber.fight();
  if (!fight || fight.stopped) {
    player.sendMessage("Start a fight first (::nexspawn).");
    return null;
  }
  return fight;
}

function skipPhase({ player, parts }) {
  const fight = currentFight(player);
  if (!fight) return true;
  const phases = Common.data.fight.phases;
  const target = Number(parts?.[1]) - 1;
  if (fight.stage !== "fighting" || !Number.isInteger(target) || target <= fight.phaseIndex || target >= phases.length) {
    player.sendMessage("Use ::nexphase <2-5> during a fight, after the spawn.");
    return true;
  }
  while (fight.phaseIndex < target && !fight.stopped) {
    const phase = fight.phase();
    fight.boss.setHitpoints(Math.min(fight.boss.getHitpoints(), Math.floor(Common.data.fight.hitpoints * phase.floor)));
    const mage = fight.mages.get(phase.mage);
    if (mage) Common.api.removeNpc(mage);
    Specials.phaseEnded(fight, phase.key);
    fight.mages.delete(phase.mage);
    fight.stage = "fighting";
    fight.startPhase(fight.phaseIndex + 1);
  }
  return true;
}

function special({ player, parts }) {
  const fight = currentFight(player);
  if (!fight) return true;
  const name = String(parts?.[1] ?? "").toLowerCase();
  const hold = fight.stage === "fighting" ? Specials.run(fight, name) : null;
  if (hold == null) player.sendMessage(`Use ::nexspecial <${Object.keys(Specials.SPECIALS).join("|")}> during a fight.`);
  else fight.nextAttackTick = fight.tick + hold;
  return true;
}

function setHitpoints({ player, parts }) {
  const fight = currentFight(player);
  const value = Number(parts?.[1]);
  if (!fight) return true;
  if (!Number.isFinite(value) || value < 1) {
    player.sendMessage("Use ::nexhp <hitpoints> during a fight.");
    return true;
  }
  fight.boss.setHitpoints(Math.trunc(value));
  return true;
}

function endFight({ player }) {
  const fight = currentFight(player);
  if (fight) fight.end(false);
  return true;
}

function attachCommands(api) {
  const { DEVELOPER } = api.core.PlayerRights;
  api.registerCommand("nex", toPrison, DEVELOPER, "To Nex's safe room, door unsealed, 40 ancient essence");
  api.registerCommand("nexspawn", spawn, DEVELOPER, "Spawn Nex in your chamber now");
  api.registerCommand("nexphase", skipPhase, DEVELOPER, "Skip Nex to a phase: ::nexphase <2-5>");
  api.registerCommand("nexspecial", special, DEVELOPER, "Nex uses a special: ::nexspecial <name>");
  api.registerCommand("nexhp", setHitpoints, DEVELOPER, "Set Nex's hitpoints: ::nexhp <n>");
  api.registerCommand("nexend", endFight, DEVELOPER, "End the Nex fight without a kill");
}

module.exports = { attachCommands };
