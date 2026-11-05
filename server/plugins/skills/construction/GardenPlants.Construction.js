"use strict";

const { api, Animation, CacheDefinitions, Graphic, Skill } = require("./Core.Construction");
const Ids = require("./Ids.Construction");

/**
 * Garden plants: furniture built from a bagged plant, the cache's poh_sapling_* objs (bagged
 * trees, plants, flowers and the hedges). rsprox captures (poh_furniture_creation:contents, rev
 * 230-234, recordings 2856, 3267, 3275): the pick waters the plant in. On that tick the player
 * plays farming_watering with spotanim farming_wateringcan_water_spotanim at height 92, the
 * watering can loses a charge, synth 2446 plays, and Farming and Construction experience arrive
 * together. With no water: gamemessage "You need a watering can with water in order to plant
 * garden plants."
 *
 * Wiki (Bagged plants): the plants give "the same amount of experience to both Construction and
 * Farming", the Zen theme included (474 each). The menagerie's habitats also take a bagged plant
 * and need a watering can (Wiki: Pet house), but give no Farming experience.
 */
const WATERING_ANIMATION = Ids.seq("farming_watering");
const WATERING_GRAPHIC = Ids.spotanim("farming_wateringcan_water_spotanim");
const WATERING_GRAPHIC_HEIGHT = 92;
const WATERING_SOUND = 2446;
const NO_WATER = "You need a watering can with water in order to plant garden plants.";
const NO_FARMING_EXPERIENCE = new Set(["GRASSLAND_HABITAT", "FOREST_HABITAT", "DESERT_HABITAT"]);

const BAGGED_PLANTS = new Set([...CacheDefinitions.getObjNames()]
  .filter(([, name]) => name.startsWith("poh_sapling_"))
  .map(([id]) => id));

/** A piece planted from a bagged plant, which waters it in. */
function isGardenPlant(buildable) {
  return buildable.materials.some(material => BAGGED_PLANTS.has(material.itemId));
}

/** Farming's watering ("farming:use-water"): `check` only asks whether a carried can has water. */
function water(player, check) {
  const request = { player, check, used: false };
  api.emitCustomEvent("farming:use-water", request);
  return request.used === true;
}

/** Why the plant can't go in yet, or null. */
function refusal(player, buildable) {
  return isGardenPlant(buildable) && !water(player, true) ? NO_WATER : null;
}

/** The pick's animation: watering for a plant. False for other furniture (the hammer plays). */
function animate(player, buildable) {
  if (!isGardenPlant(buildable)) return false;
  player.performAnimation(new Animation(WATERING_ANIMATION));
  player.performGraphic(new Graphic(WATERING_GRAPHIC, 0, WATERING_GRAPHIC_HEIGHT));
  player.getPacketSender().sendSound(WATERING_SOUND, 0, 0);
  return true;
}

/** On completion: a plant takes a charge of water and gives its experience in Farming as well. */
function complete(player, buildable) {
  if (!isGardenPlant(buildable)) return;
  water(player, false);
  if (!NO_FARMING_EXPERIENCE.has(buildable.key)) player.getSkillManager().addExperiences(Skill.FARMING, buildable.experience);
}

module.exports = { isGardenPlant, refusal, animate, complete, NO_WATER };
