/**
 * Island amenities built from their spaces on Sailing islands (Wiki: Island amenity). Only the
 * rowboats exist so far (Wiki: Rowboat (amenity)): Build at a rowboat space with 50 Construction, a
 * hammer and a saw uses 8 camphor planks and 10 swamp paste for 1297 Construction XP. The site's
 * varbit then shows the rowboat on the island and its twin on the mainland, and both rows across
 * (the ferries' rowboat-* routes). The varbit is saved per player and sent again at login.
 * Data: plugins/skills/sailing/data/amenities.json.
 */
const DATA = require("./data/amenities.json");
const Saws = require("../../items/Saws");
const Hammers = require("../../items/Hammers");

/** A site's saved state: "sailing:amenity-rowboat-ynysdail" for varbit amenity_rowboat_ynysdail. */
const BUILT_ATTRIBUTE = (varbit) => `sailing:${varbit.replace(/_/g, "-")}`;

let api;
const cache = () => api.core.CacheDefinitions;
const sites = () => Object.values(DATA.amenities).flatMap((amenity) => amenity.sites.map((site) => ({ amenity, site })));

/** The amenity and site whose space the click is on, by the base multiloc's gameval. */
function siteAt(objectId) {
  const gameval = cache().getLocNames().get(objectId);
  return sites().find(({ site }) => site.loc === gameval) ?? null;
}

function setBuilt(player, site, value) {
  player.setAttribute(BUILT_ATTRIBUTE(site.varbit), value);
  player.getPacketSender().sendVarbit(cache().getVarbitId(site.varbit), value);
}

function inspect({ player, objectId }) {
  const found = siteAt(objectId);
  if (!found) return false;
  player.sendMessage(found.amenity.messages.inspect);
  return true;
}

function build({ player, objectId }) {
  const found = siteAt(objectId);
  if (!found) return false;
  const { amenity, site } = found;
  const { core } = api;
  const skills = player.getSkillManager();
  const inventory = player.getInventory();
  if (skills.getCurrentLevel(core.Skill.CONSTRUCTION) < amenity.level) {
    player.sendMessage(amenity.messages.level);
    return true;
  }
  if (!Hammers.holdsHammer(core, player) || !Saws.holdsSaw(core, player)) {
    player.sendMessage(amenity.messages.tools);
    return true;
  }
  const materials = amenity.materials.map(([name, amount]) => [cache().getObjId(name), amount]);
  if (materials.some(([id, amount]) => inventory.getAmount(id) < amount)) {
    player.sendMessage(amenity.messages.materials);
    return true;
  }
  for (const [id, amount] of materials) inventory.deleteNumber(id, amount);
  inventory.refreshItems();
  player.performAnimation(new core.Animation(cache().getSeqId(amenity.anim)));
  skills.addExperiences(core.Skill.CONSTRUCTION, amenity.xp);
  setBuilt(player, site, 1);
  player.sendMessage(amenity.messages.built);
  return true;
}

function login({ player }) {
  for (const { site } of sites()) {
    const built = Number(player.getAttribute(BUILT_ATTRIBUTE(site.varbit))) || 0;
    if (built) player.getPacketSender().sendVarbit(cache().getVarbitId(site.varbit), built);
  }
}

/** Every site starts unbuilt. */
function persistAmenities() {
  for (const { site } of sites()) api.persistAttribute(BUILT_ATTRIBUTE(site.varbit), 0);
}

function register(pluginApi) {
  api = pluginApi;
  persistAmenities();
  api.onObjectInteraction("Rowboat space", { Build: build, Inspect: inspect });
  api.onPlayerLogin(login);
}

module.exports = { register, _test: { siteAt, BUILT_ATTRIBUTE } };
