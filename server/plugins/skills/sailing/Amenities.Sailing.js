/**
 * Island amenities built from their spaces on Sailing islands (Wiki: Island amenity): water
 * pumps, cooking pots, a spinning wheel, a potter's wheel, a loom, a pottery oven, anvils,
 * rowboats, furnaces and bank chests. Build, with the amenity's Construction level, a hammer and a
 * saw, uses its materials for its Construction XP (each amenity's Wiki page). The site's varbit then
 * shows the built amenity (for a rowboat, its mainland twin too); the varbit is saved per player
 * and sent again at login. A built amenity works through the plugin that owns its kind by name
 * (Cooking, Crafting, Smithing, BankBooths, WaterSources; rowboats are ferries routes).
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

/** An amenity's message, with its name, level and materials filled in. */
function text(key, amenity) {
  const values = { name: amenity.name, level: amenity.level, materials: amenity.materialsText };
  return DATA.messages[key].replace(/\{(\w+)\}/g, (_, name) => values[name]);
}

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
  player.sendMessage(text("inspect", found.amenity));
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
    player.sendMessage(text("level", amenity));
    return true;
  }
  if (!Hammers.holdsHammer(core, player) || !Saws.holdsSaw(core, player)) {
    player.sendMessage(text("tools", amenity));
    return true;
  }
  const materials = amenity.materials.map(([name, amount]) => [cache().getObjId(name), amount]);
  if (materials.some(([id, amount]) => inventory.getAmount(id) < amount)) {
    player.sendMessage(text("materials", amenity));
    return true;
  }
  for (const [id, amount] of materials) inventory.deleteNumber(id, amount);
  inventory.refreshItems();
  player.performAnimation(new core.Animation(cache().getSeqId(DATA.anim)));
  skills.addExperiences(core.Skill.CONSTRUCTION, amenity.xp);
  setBuilt(player, site, 1);
  player.sendMessage(text("built", amenity));
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

const SPACE_OPTIONS = { Build: build, Inspect: inspect };

function register(pluginApi) {
  api = pluginApi;
  persistAmenities();
  api.onObjectInteraction("Water pump space", SPACE_OPTIONS);
  api.onObjectInteraction("Cooking pot space", SPACE_OPTIONS);
  api.onObjectInteraction("Spinning wheel space", SPACE_OPTIONS);
  api.onObjectInteraction("Potter's wheel space", SPACE_OPTIONS);
  api.onObjectInteraction("Loom space", SPACE_OPTIONS);
  api.onObjectInteraction("Pottery oven space", SPACE_OPTIONS);
  api.onObjectInteraction("Anvil space", SPACE_OPTIONS);
  api.onObjectInteraction("Rowboat space", SPACE_OPTIONS);
  api.onObjectInteraction("Furnace space", SPACE_OPTIONS);
  api.onObjectInteraction("Bank chest space", SPACE_OPTIONS);
  api.onPlayerLogin(login);
}

module.exports = { register, _test: { siteAt, BUILT_ATTRIBUTE } };
