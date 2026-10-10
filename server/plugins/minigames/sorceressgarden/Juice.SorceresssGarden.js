"use strict";

/**
 * Sq'irk juice: brewing the fruit and handing the glasses to Osman (or Selim).
 *
 * A pestle and mortar used on a sq'irk while the season's fruits and an empty beer glass
 * are in the inventory brews one glass for 5 Cooking XP; each season needs 5/4/3/2 fruit
 * (winter/spring/autumn/summer). Talking to Osman or Selim while carrying a glass gives
 * the Wiki's hand-in - one glass is taken and 350/1,350/2,350/3,000 Thieving XP is
 * granted - and then the normal conversation runs. Without a glass the handler falls
 * through to the NPC's regular transcript.
 *
 * Wiki quirk the plugin cannot reach: sq'irkjuice has no Drink option in the cache's item
 * definitions, so the documented Thieving boost and run-energy restore are not wired.
 */

const Gardens = require("./Gardens.SorceresssGarden");

const {
  BEER_GLASS_ID,
  COOKING_XP_PER_BREW,
  PESTLE_AND_MORTAR_ID,
  SEASON_ORDER,
  SEASONS,
  seasonForFruit,
} = Gardens;

const SPYMASTER_NAMES = ["Osman", "Selim"];

const TOO_FEW_FRUIT_LINE = "I think I should wait until I have enough fruit to make a full glass.";

let api;
let core;

function playerName(player) {
  return player.getUsername?.() ?? "friend";
}

/** The first juice held, in winter..summer order, or null. */
function heldJuice(player) {
  const inventory = player.getInventory();
  for (const key of SEASON_ORDER) {
    const season = SEASONS[key];
    if (inventory.getAmount(season.juiceId) > 0) return season;
  }
  return null;
}

function brew(event) {
  const ids = [event.usedItemId, event.usedWithItemId];
  if (!ids.includes(PESTLE_AND_MORTAR_ID)) return false;
  const season = ids.map(seasonForFruit).find(Boolean);
  if (!season) return false;
  const player = event.player;
  const inventory = player.getInventory();
  if (inventory.getAmount(season.fruitId) < season.fruits) {
    // rsprox captures (rev 227): the player says it, for every season.
    const { DialogueChainBuilder, PlayerDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new PlayerDialogue(0, TOO_FEW_FRUIT_LINE),
    ));
    return true;
  }
  if (!inventory.contains(BEER_GLASS_ID)) {
    player.sendMessage("You need an empty beer glass to collect the juice.");
    return true;
  }
  inventory.delete(season.fruitId, season.fruits);
  inventory.delete(BEER_GLASS_ID, 1);
  inventory.adds(season.juiceId, 1);
  inventory.refreshItems();
  player.getSkillManager().addExperiences(core.Skill.COOKING, COOKING_XP_PER_BREW);
  player.sendMessage(`You squeeze the sq'irks into the beer glass and make ${season.juiceName}.`);
  return true;
}

function handIn(event, season) {
  const { player, npcId } = event;
  player.getInventory().delete(season.juiceId, 1);
  player.getInventory().refreshItems();
  player.getSkillManager().addExperiences(core.Skill.THIEVING, season.handInXp);
  player.sendMessage(
    `Osman imparts some Thieving advice to you (${season.handInXp} Thieving experience points) `
    + "as a reward for the sq'irk juice."
  );
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue } = core;
  const builder = new DialogueChainBuilder();
  builder.add(new PlayerDialogue(0, "I have some sq'irk juice for you."));
  builder.add(new NpcDialogue(1, npcId, `Thank you very much ${playerName(player)}. If you get some more sq'irks be sure to come back.`));
  builder.add(new PlayerDialogue(2, "I will. It's been a pleasure doing business with you."));
  player.getDialogueManager().startDialogues(builder);
}

function talkToSpymaster(event) {
  const season = heldJuice(event.player);
  if (!season) return false;
  handIn(event, season);
  return true;
}

module.exports = function registerJuice(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  for (const key of SEASON_ORDER) {
    api.onItemOnItem("Pestle and mortar", SEASONS[key].fruitName, brew);
  }
  api.onNpcsInteraction(SPYMASTER_NAMES, { "Talk-to": talkToSpymaster });
};

module.exports._test = {
  setCore(value) {
    core = value;
  },
  SPYMASTER_NAMES,
  heldJuice,
  brew,
  handIn,
  talkToSpymaster,
  _setApi(value) {
    api = value;
  },
};
