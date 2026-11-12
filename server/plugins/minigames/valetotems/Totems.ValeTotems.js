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
const CARVE_REOPEN_TICKS = 2;
const KNIVES = ["knife", "fletching_knife"];

// The miniquest (quests/quests/ValeTotems.Quest.js) writes these same varbits. The site is
// usable during the quest only for the quest's own totem; after the miniquest every site is.
const QUEST_STAGE_VARBIT = 17227; // ent_totems_intro
const QUEST_CARVE_CHAT_VARBIT = 17229; // ent_totems_carve_chat
const QUEST_DECORATE_CHAT_VARBIT = 17230; // ent_totems_decorate_chat
const QUEST_SITE = 1;
/** A site the quest only opens once it is complete. */
const OTHER_SITE = 2;
const QUEST_FIRST_STAGE = 10;
const QUEST_BROKEN_STAGE = 30;
const QUEST_DECORATED_STAGE = 40;
// The client's ent_totems_intro reads 100 once the miniquest is complete.
const QUEST_COMPLETE_STAGE = 70;

function questStage(player) {
  return Number(player.getPacketSender().getVarbit(QUEST_STAGE_VARBIT)) || 0;
}

function questActive(player) {
  const stage = questStage(player);
  return stage >= QUEST_FIRST_STAGE && stage < QUEST_COMPLETE_STAGE;
}

function questChat(player, varbit) {
  return Number(player.getPacketSender().getVarbit(varbit)) === 1;
}

/**
 * The quest decides which sites are open. The request defaults to allowed so the minigame
 * still works on its own (the plugin tests load it without the quest plugin).
 */
function questAllows(player, site) {
  const request = { player, site, allowed: true };
  Shared.api().emitCustomEvent?.("vale-totems:access", request);
  return request.allowed !== false;
}

/**
 * A site the quest keeps closed. RSProx 20261109T224258-5ab63b4 tick 452: before the miniquest,
 * the site 1 totem says "You're not really sure what to do with that, but maybe there's someone
 * in the valley who does." (mesbox). Ours: the same refusal at the other sites before it.
 */
function blocked(player) {
  if (questActive(player)) {
    Shared.statement(player, "You should probably talk to Ranulph and Isadora before doing that.");
    return;
  }
  Shared.statement(player, "You're not really sure what to do with that, but maybe there's someone in the valley who does.");
}

/**
 * The quest's own totem until the intro breaks it (stage 30): the old, intact totem, which
 * ents leave alone and which can't be carved or decorated.
 */
function questKeeps(player, site) {
  if (site !== QUEST_SITE || questStage(player) >= QUEST_BROKEN_STAGE) return false;
  return questStage(player) > 0 || !questAllows(player, site);
}

/**
 * Whether ents pass this site by: the quest's totem until the miniquest is complete. RSProx
 * 20261109T224258-5ab63b4: site 1 keeps its spirits, its durability (4) and an empty pile from
 * the carving (tick 621) to the scripted visit (tick 710), and the old totem is never visited.
 */
function questHolds(player, site) {
  return site === QUEST_SITE && questStage(player) < QUEST_COMPLETE_STAGE && !questAllows(player, OTHER_SITE);
}

/** The miniquest's totem while the miniquest runs. */
function questTotem(player, site) {
  return site === QUEST_SITE && questActive(player);
}

/** Whether Build may start here; a closed site says why. */
function open(player, site) {
  if (questAllows(player, site)) return true;
  blocked(player);
  return false;
}

/**
 * Carve and Decorate only stay closed on the quest's own totem before the miniquest (the
 * intact totem live shows there until the intro breaks it). A totem built at sites 2-8 before
 * the gate existed keeps its options.
 */
function untouchable(player, site) {
  if (!questKeeps(player, site)) return false;
  blocked(player);
  return true;
}

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
  if (!open(player, site)) return true;
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
  State.count(player, "totems-built");
  Shared.addXp(player, "FLETCHING", wood.carveXp);
  if (Shared.ownsHouse(player)) Shared.addXp(player, "CONSTRUCTION", player.getSkillManager().getMaxLevel(Shared.core().Skill.CONSTRUCTION));
  player.setRunEnergy(player.getRunEnergy() + DATA.runEnergyRestore);
  player.getPacketSender().sendRunEnergy();
  if (questActive(player) && site === QUEST_SITE && !questChat(player, QUEST_CARVE_CHAT_VARBIT)) {
    Shared.statement(player, `You erect ${article(wood.name)} totem. It's now ready to be carved. Ranulph and Isadora might be able to tell you how.`);
    return;
  }
  player.sendMessage(`You erect ${article(wood.name)} totem.`);
  openCarveMenu(player, site);
}

function carve(event) {
  const { player } = event;
  const site = siteOf(event);
  if (site == null) return false;
  if (untouchable(player, site)) return true;
  if (questActive(player) && site === QUEST_SITE && !questChat(player, QUEST_CARVE_CHAT_VARBIT)) {
    Shared.statement(player, "You're not quite sure how to carve the totem. Ranulph and Isadora might be able to help.");
    return true;
  }
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
  const last = State.carve(player, site, animal, wood.durability);
  Shared.addXp(player, "FLETCHING", wood.carveXp);
  const quest = questActive(player) && site === QUEST_SITE;
  const carved = `You carve ${article(DATA.animals[animal - 1].name)} into the totem.`;
  if (last) {
    // RSProx 20261109T224258-5ab63b4: during the miniquest the third carving still says what
    // was carved, and the finish mesbox follows a tick later (ticks 620-621); after it, the
    // third carving's only message is "You finish carving the totem." (ticks 1103, 1317).
    if (quest) {
      player.sendMessage(carved);
      Shared.later(1, () => Shared.statement(player, "You finish carving the totem, but it still seems to be missing something. Ranulph and Isadora might know what to do next."));
    } else {
      player.sendMessage("You finish carving the totem.");
    }
    return;
  }
  player.sendMessage(carved);
  // The quest's warning dialogue takes the chatbox instead of the menu.
  if (quest && !State.animals(player, site).includes(animal)) {
    Shared.api().emitCustomEvent("vale-totems:wrong-carve", { player, site, animal });
    return;
  }
  reopenCarveMenu(player, site);
}

/**
 * The same recording: the menu comes back by itself two ticks after each carving that leaves
 * the totem unfinished (ticks 613-615, 617-619, 1094-1096, 1099-1101), with the carved animals'
 * icons disabled. Walking away, or anything else taking the chatbox or screen, stops it.
 */
function reopenCarveMenu(player, site) {
  const at = player.getLocation().clone();
  Shared.later(CARVE_REOPEN_TICKS, () => {
    if (player.isRegistered?.() === false || !player.getLocation().equals(at)) return;
    if (player.getInterfaceId?.() > 0 || player.getDialogueManager?.().getCurrent?.()) return;
    if (player.getMovementQueue?.().isMovings?.() === true) return;
    const totem = State.totem(player, site);
    if (totem.wood === 0 || totem.carved) return;
    openCarveMenu(player, site);
  });
}

/** The first decoration of the totem's wood in the inventory, or null. */
function decorationFor(player, wood) {
  const name = wood.decorations.find((item) => player.getInventory().contains(Shared.obj(item)));
  return name ? Shared.obj(name) : null;
}

/** Whether the player is carrying a decoration of some other wood. */
function hasOtherWoodDecoration(player, wood) {
  return DATA.woods.some((candidate) => candidate !== wood
    && candidate.decorations.some((item) => player.getInventory().contains(Shared.obj(item))));
}

function decorate(event) {
  const { player } = event;
  const site = siteOf(event);
  if (site == null) return false;
  if (untouchable(player, site)) return true;
  if (questActive(player) && site === QUEST_SITE && !questChat(player, QUEST_DECORATE_CHAT_VARBIT)) {
    Shared.statement(player, "You're not quite sure how to decorate the totem. Ranulph and Isadora might be able to help.");
    return true;
  }
  State.join(player);
  const totem = State.totem(player, site);
  if (!totem.carved) return carve(event);
  Shared.face(player, State.tileOf(site));
  if (totem.decorations >= MAX_DECORATIONS) {
    // RSProx 20261109T224258-5ab63b4 tick 685 (stage 30) and tick 733 (stage 50).
    const quest = questActive(player) && site === QUEST_SITE;
    Shared.statement(player, !quest
      ? "You have already added as many decorations as possible to the<br>totem."
      : questStage(player) >= QUEST_DECORATED_STAGE
        ? "You have already fully carved and decorated the totem. Ranulph and Isadora might know what to do next."
        : "You have already fully decorated the totem. Ranulph and Isadora might know what to do next.");
    return true;
  }
  const wood = woodOf(totem.wood);
  if (decorationFor(player, wood) == null) {
    if (hasOtherWoodDecoration(player, wood)) {
      Shared.statement(player, "You may only add decorations which match the wood used to build the totem.");
    } else {
      player.sendMessage("You don't have anything to decorate the totem with.");
    }
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
    // "vale-totems:decorated" { player, wood }: a totem fully decorated (a league's "Fully decorate a Maple totem").
    Shared.api().emitCustomEvent("vale-totems:decorated", { player, wood: wood.name });
    if (questActive(player) && site === QUEST_SITE) {
      Shared.statementThenPlayer(player, "You add the final decoration to the totem.", "There we go! I's say that's the totem finished!");
    } else {
      Shared.statement(player, "You add the final decoration to the totem.");
    }
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

module.exports = { attach, wrongAnimals, woodOf, questKeeps, questHolds, questTotem };
