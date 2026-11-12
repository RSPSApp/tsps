/**
 * Free-to-play world (world.json plugins.FreeToPlay: true), after
 * https://oldschool.runescape.wiki/w/Free-to-play. Members plugins and quests are
 * left unloaded by the core; this plugin gates everything else through hooks.
 * Free land is the union of world.json zones tagged "f2p" (WorldDefinition.isMembersArea).
 */

const ITEM_MESSAGE = "To use this item please login to a members' world.";
// Wiki: prayers up to Mystic Might (level 45) are free-to-play.
const MAX_F2P_PRAYER_LEVEL = 45;
const BORDER_OBJECT_NAME = /gate|door|curtain/i;

let core;
let MEMBERS_SKILLS;
let FREE_ENCHANT_ITEMS;

function defineData({ Skill, ItemIds }) {
  MEMBERS_SKILLS = new Set([
    Skill.AGILITY, Skill.HERBLORE, Skill.THIEVING, Skill.FLETCHING, Skill.SLAYER,
    Skill.FARMING, Skill.CONSTRUCTION, Skill.HUNTER, Skill.SAILING,
  ]);
  // Wiki Lvl-1 through Lvl-4 Enchant: only the corresponding amulet is free to enchant.
  FREE_ENCHANT_ITEMS = new Map([
    ["Lvl-1 Enchant", ItemIds.SAPPHIRE_AMULET],
    ["Lvl-2 Enchant", ItemIds.EMERALD_AMULET],
    ["Lvl-3 Enchant", ItemIds.RUBY_AMULET],
    ["Lvl-4 Enchant", ItemIds.DIAMOND_AMULET],
  ]);
}

function inF2pLand(x, y) {
  return !core.WorldDefinition.isMembersArea(x, y);
}

function isMembersItem(itemId) {
  const { CacheDefinitions } = core;
  return Number.isInteger(itemId) && itemId >= 0 &&
    itemId < CacheDefinitions.getCounts().items &&
    CacheDefinitions.getItem(itemId).isMembers === true;
}

function blockItemUse(event) {
  // Members items can still be dropped and examined, like the OSRS client allows.
  if (event.option === "Drop" || event.option === "Examine" || !isMembersItem(event.itemId)) return;
  event.allow = false;
  // "bonus": a worn members item (equipped before the world went free) gives no stats.
  if (event.action !== "bonus") event.player.sendMessage(ITEM_MESSAGE);
}

function blockEquip(event) {
  if (!isMembersItem(event.item.getId())) return;
  event.player.sendMessage(ITEM_MESSAGE);
  event.allow = false;
}

function blockMembersSkillExperience(event) {
  if (MEMBERS_SKILLS.has(event.skill)) event.allow = false;
}

function blockMembersSpawn(event) {
  if (core.NpcDefinition.forId(event.npcId).isMembers() ||
      !inF2pLand(event.location.getX(), event.location.getY())) {
    event.allow = false;
  }
}

function blockMembersStock(event) {
  if (isMembersItem(event.itemId)) event.allow = false;
}

function removeMembersDrops({ drops }) {
  for (let index = drops.length - 1; index >= 0; index--) {
    if (isMembersItem(drops[index].itemId)) drops.splice(index, 1);
  }
}

// Standard-book spells carry their own members flag (CombatSpells.ts / EffectSpells.ts);
// every other spellbook is members-only. Higher enchants need members jewellery, which
// the item gate already blocks.
function disableMembersSpell(event) {
  if (event.spellbook === core.MagicSpellbook.NORMAL && !event.spell?.isMembers?.()) return;
  event.player.sendMessage("You need to be on a members' world to cast this spell.");
  event.disabled = true;
}

function blockMembersEnchantment(recipe) {
  if (recipe.declined || recipe.resultId === undefined || FREE_ENCHANT_ITEMS.get(recipe.spellName) === recipe.itemId) return;
  recipe.declined = true;
  recipe.message = "You need to be on a members' world to enchant that item.";
}

function disableMembersPrayer(event) {
  if (event.prayer.requirement <= MAX_F2P_PRAYER_LEVEL) return;
  event.message = "You need to be on a members' world to use this prayer.";
  event.disabled = true;
}

function blockMembersTeleport(event) {
  const destination = event.destination;
  if (!destination || inF2pLand(destination.getX(), destination.getY())) return;
  event.player.sendMessage("You can't teleport to a members-only area.");
  event.allow = false;
}

// Gates and doors on the edge of free land, e.g. Taverley gate.
function blockBorderObject(event) {
  if (!BORDER_OBJECT_NAME.test(event.definition?.getName?.() ?? "")) return;
  const { x, y } = event.location;
  if (inF2pLand(x - 1, y) && inF2pLand(x + 1, y) && inF2pLand(x, y - 1) && inF2pLand(x, y + 1)) return;
  event.player.sendMessage("You need to be on a members' world to go through here.");
  event.handled = true;
}

// Catch-all for any route the border objects miss (ladders, boats, npc dialogue).
// isMembersArea is one map-square lookup, so running it per player per tick is cheap.
function evictFromMembersArea({ player }) {
  const location = player.getLocation();
  if (inF2pLand(location.getX(), location.getY())) return;
  // world.json spawn; startup validation guarantees it is free land.
  const spawn = core.WorldDefinition.WORLD_SPAWN;
  player.moveTo(new core.Location(spawn.getX(), spawn.getY(), spawn.getZ()));
  player.sendMessage("You are standing in a members-only area.");
}

module.exports = {
  name: "FreeToPlay",
  enabled: false,
  description: "Switches this world to free-to-play. The spawn must be inside a free-to-play area.",
  ITEM_MESSAGE,
  register(api) {
    // Members worlds need none of these hooks.
    if (api.core.WorldDefinition.isMembersWorld()) return;
    core = api.core;
    defineData(core);
    api.onCanUseItem(blockItemUse);
    api.onCanEquip(blockEquip);
    api.onCanGainExperience(blockMembersSkillExperience);
    api.onCanSpawnNpc(blockMembersSpawn);
    api.onCanStockItem(blockMembersStock);
    api.onCustomEvent("npc-drops:roll", removeMembersDrops);
    api.onCustomEvent("magic:enchant-item-policy", blockMembersEnchantment);
    api.onSpellDisabled(disableMembersSpell);
    api.onPrayerDisabled(disableMembersPrayer);
    api.onCanTeleport(blockMembersTeleport);
    api.onObjectInteraction(blockBorderObject);
    api.onPlayerProcess(evictFromMembersArea);
  },
};
