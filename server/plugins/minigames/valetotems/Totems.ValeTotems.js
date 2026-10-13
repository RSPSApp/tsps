"use strict";

/**
 * The totem at each site: Build (a log), Carve (three spirit animals) and Decorate (four
 * fletched items of the totem's wood).
 *
 * Captures (rsprox, Auburn Valley):
 * - Build: a tick after arriving, human_pickupfloor with sound 1739, the log goes, "You erect an
 *   oak totem." and the carve menu opens on the same tick.
 * - Carve: skillmulti (mode 34, one at a time) "What animal would you like to carve?" with the
 *   five animal icons, carved ones shown with their _disabled icon. Choosing one plays
 *   human_pickuptable_walkmerge with sound 10384 (delay 15) and "You carve a buffalo into the
 *   totem."; the third sets the durability.
 * - Decorate: human_pickuptable_walkmerge with sound 2739 (delay 20), the item goes a tick later
 *   with "You decorate the totem." and the next starts the tick after, until the fourth: "You add
 *   the final decoration to the totem.". A fifth: "You have already added as many decorations as
 *   possible to the totem." (mesbox). "You don't have any logs to build a totem with." and "You
 *   don't have anything to decorate the totem with." when there's nothing to use.
 * Wiki: the Fletching level per wood (boostable), 15% run energy per totem built, Construction
 * xp of one per level when building with a house, and 25% less decoration xp per wrong animal.
 */
const Shared = require("./Shared.ValeTotems");
const State = require("./State.ValeTotems");

const { DATA } = Shared;
const CARVE_MENU_TITLE = "What animal would you like to carve?";
const CARVE_MENU_MODE = 34;
const MAX_DECORATIONS = 4;
const BUILD_DELAY = 1;
const KNIVES = ["knife", "fletching_knife"];

function article(word) {
  return /^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`;
}

function woodOf(index) {
  return DATA.woods[index - 1];
}

function hasKnife(player) {
  return KNIVES.some((name) => player.getInventory().contains(Shared.obj(name)) || player.getEquipment().contains(Shared.obj(name)));
}

/** How many carvings don't match the site's spirits. */
function wrongAnimals(player, site) {
  const animals = State.animals(player, site);
  return State.totem(player, site).carvings.filter((animal) => animal !== 0 && !animals.includes(animal)).length;
}

/** The best log the player has the level for, or why there's none. */
function chooseLog(player) {
  const level = Shared.level(player, "FLETCHING");
  const held = DATA.woods.map((wood, index) => ({ wood, index: index + 1 }))
    .filter(({ wood }) => player.getInventory().contains(Shared.obj(wood.log)));
  if (!held.length) return { error: "You don't have any logs to build a totem with." };
  const usable = held.filter(({ wood }) => level >= wood.level);
  if (!usable.length) {
    const lowest = held[0].wood;
    return { error: `You need a Fletching level of ${lowest.level} to build ${article(lowest.name)} totem.` };
  }
  return usable[usable.length - 1];
}

function siteOf(event) {
  return State.siteOfLoc(event.objectId ?? event.object?.getId?.());
}

function build(event) {
  const { player } = event;
  const site = siteOf(event);
  if (site == null) return false;
  State.join(player);
  if (State.totem(player, site).points >= DATA.offeringsLimit) {
    Shared.statement(player, "You should take some of the offerings already here before building a new totem.");
    return true;
  }
  const choice = chooseLog(player);
  if (choice.error) {
    player.sendMessage(choice.error);
    return true;
  }
  Shared.face(player, State.tileOf(site));
  Shared.later(BUILD_DELAY, () => erect(player, site, choice));
  return true;
}

function erect(player, site, { wood, index }) {
  if (State.totem(player, site).wood !== 0 || !player.getInventory().contains(Shared.obj(wood.log))) return;
  player.getInventory().delete(Shared.obj(wood.log), 1);
  player.getInventory().refreshItems();
  Shared.animate(player, Shared.SEQ.BUILD);
  Shared.sound(player, Shared.SOUND.BUILD);
  State.erect(player, site, index);
  Shared.addXp(player, "FLETCHING", wood.carveXp);
  if (Shared.ownsHouse(player)) Shared.addXp(player, "CONSTRUCTION", player.getSkillManager().getMaxLevel(Shared.core().Skill.CONSTRUCTION));
  player.setRunEnergy(player.getRunEnergy() + DATA.runEnergyRestore);
  player.getPacketSender().sendRunEnergy();
  player.sendMessage(`You erect ${article(wood.name)} totem.`);
  openCarveMenu(player, site);
}

function carve(event) {
  const { player } = event;
  const site = siteOf(event);
  if (site == null) return false;
  State.join(player);
  Shared.face(player, State.tileOf(site));
  openCarveMenu(player, site);
  return true;
}

function openCarveMenu(player, site) {
  if (!hasKnife(player)) {
    player.sendMessage("You need a knife to carve the totem.");
    return;
  }
  const carved = State.totem(player, site).carvings;
  const icons = DATA.animals.map((animal, index) => Shared.obj(carved.includes(index + 1)
    ? `ent_totems_animal_icon_${animal.key}_disabled`
    : `ent_totems_animal_icon_${animal.key}`));
  const menu = new (Shared.core().CreationMenu)(CARVE_MENU_TITLE, icons, {
    execute(itemId) {
      carveAnimal(player, site, icons.indexOf(itemId) + 1);
    },
  }, { labels: DATA.animals.map((animal) => animal.label), maxAmount: 1, lastAmount: 1, mode: CARVE_MENU_MODE });
  player.getPacketSender().sendCreationMenu(menu);
}

function carveAnimal(player, site, animal) {
  const totem = State.totem(player, site);
  if (animal < 1 || totem.wood === 0 || totem.carved || totem.carvings.includes(animal)) return;
  const wood = woodOf(totem.wood);
  Shared.face(player, State.tileOf(site));
  Shared.animate(player, Shared.SEQ.CARVE);
  Shared.sound(player, Shared.SOUND.CARVE, Shared.SOUND_DELAY.CARVE);
  State.carve(player, site, animal, wood.durability);
  Shared.addXp(player, "FLETCHING", wood.carveXp);
  player.sendMessage(`You carve ${article(DATA.animals[animal - 1].name)} into the totem.`);
}

/** The first decoration of the totem's wood in the inventory, or null. */
function decorationFor(player, wood) {
  const name = wood.decorations.find((item) => player.getInventory().contains(Shared.obj(item)));
  return name ? Shared.obj(name) : null;
}

function decorate(event) {
  const { player } = event;
  const site = siteOf(event);
  if (site == null) return false;
  State.join(player);
  const totem = State.totem(player, site);
  if (!totem.carved) return carve(event);
  Shared.face(player, State.tileOf(site));
  if (totem.decorations >= MAX_DECORATIONS) {
    Shared.statement(player, "You have already added as many decorations as possible to the<br>totem.");
    return true;
  }
  const wood = woodOf(totem.wood);
  if (decorationFor(player, wood) == null) {
    player.sendMessage("You don't have anything to decorate the totem with.");
    return true;
  }
  Shared.startAction(player, (tick) => (tick % 2 === 0 ? startDecoration(player, wood) : addDecoration(player, site, wood)));
  return true;
}

function startDecoration(player, wood) {
  if (decorationFor(player, wood) == null) return false;
  Shared.animate(player, Shared.SEQ.DECORATE);
  Shared.sound(player, Shared.SOUND.DECORATE, Shared.SOUND_DELAY.DECORATE);
  return true;
}

function addDecoration(player, site, wood) {
  const item = decorationFor(player, wood);
  const totem = State.totem(player, site);
  if (item == null || !totem.carved || totem.decorations >= MAX_DECORATIONS) return false;
  player.getInventory().delete(item, 1);
  player.getInventory().refreshItems();
  const decorations = totem.decorations + 1;
  State.set(player, site, { decorations });
  Shared.addXp(player, "FLETCHING", wood.decorationXp * Math.max(0, 1 - DATA.wrongAnimalXpPenalty * wrongAnimals(player, site)));
  if (decorations >= MAX_DECORATIONS) {
    player.sendMessage("You add the final decoration to the totem.");
    return false;
  }
  player.sendMessage("You decorate the totem.");
  return true;
}

function attach(api) {
  api.onObjectInteraction("Totem site", { Build: build });
  for (const wood of DATA.woods) {
    const name = `${wood.name[0].toUpperCase()}${wood.name.slice(1)} totem`;
    api.onObjectInteraction(name, { Carve: carve, Decorate: decorate });
  }
}

module.exports = { attach, wrongAnimals, woodOf };
