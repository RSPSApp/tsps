/**
 * Developer commands for trying the fight:
 *   ::nightmare            to the Sisterhood Sanctuary, by the sleeping Nightmare
 *   ::nmskip               her countdown runs out now
 *   ::nmshield             her shield fails
 *   ::nmtotems             the totems charge (her blast follows)
 *   ::nmspecial <name>     she uses a special now: claws, husks, flowers, curse, parasite, spores, surge
 */
const Common = require("./Common.Nightmare");
const Dream = require("./Dream.Nightmare");

const fightOf = (player) => Dream.dreamOf(player)?.fight ?? null;

function toSanctuary({ player }) {
  player.moveTo(Common.toLocation([3808, 9752, 1]));
}

function skip({ player }) {
  const fight = fightOf(player);
  if (!fight || fight.state !== "waiting") return player.sendMessage("No countdown is running.");
  fight.events = [];
  fight.awaken(false);
}

function breakShield({ player }) {
  const fight = fightOf(player);
  if (fight?.stage !== "shield") return player.sendMessage("Her shield isn't up.");
  fight.shield = 0;
  fight.shieldBroken();
}

function chargeTotems({ player }) {
  const fight = fightOf(player);
  if (fight?.stage !== "totems") return player.sendMessage("The totems aren't ready.");
  for (const totem of fight.totems) {
    totem.charge = fight.totemMax;
    totem.charged = true;
    totem.npc?.setNpcTransformationId(totem.spec.charged);
  }
  fight.totemsCharged();
}

function special({ player, parts }) {
  const fight = fightOf(player);
  const name = String(parts?.[1] ?? "").toLowerCase();
  const units = {
    claws: "./Claws.Nightmare", husks: "./Husks.Nightmare", flowers: "./Flowers.Nightmare",
    parasite: "./Parasites.Nightmare", spores: "./Spores.Nightmare", surge: "./Surge.Nightmare",
  };
  if (!fight || fight.state !== "fighting") return player.sendMessage("No fight is running.");
  if (name === "curse") {
    require("./Specials.Nightmare").curse(fight);
    return;
  }
  if (!units[name]) return player.sendMessage("Specials: claws, husks, flowers, curse, parasite, spores, surge.");
  require(units[name]).start(fight, fight.target());
}

module.exports = function registerNightmareCommands(api) {
  const { PlayerRights } = api.core;
  api.registerCommand("nightmare", toSanctuary, PlayerRights.DEVELOPER, "Go to the Sisterhood Sanctuary (the Nightmare)");
  api.registerCommand("nmskip", skip, PlayerRights.DEVELOPER, "The Nightmare wakes now");
  api.registerCommand("nmshield", breakShield, PlayerRights.DEVELOPER, "The Nightmare's shield fails");
  api.registerCommand("nmtotems", chargeTotems, PlayerRights.DEVELOPER, "The Nightmare's totems charge");
  api.registerCommand("nmspecial", special, PlayerRights.DEVELOPER, "The Nightmare uses a special: ::nmspecial <name>");
};
