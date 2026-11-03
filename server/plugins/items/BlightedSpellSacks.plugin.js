// https://oldschool.runescape.wiki/w/Blighted: one sack replaces the entire
// rune cost; the spell still checks its book, levels, target and cooldown before payment.
const MAGE_ARENA_BANK_REGION = 10057; // The cave reached by magearena_lever_to_cellar (2539, 4712).
const BLIGHTED_MINIGAMES = new Set(["Castle Wars", "Clan Wars", "Soul Wars", "BountyHunterLobby", "BountyHunterArena"]);
const SPELL_SACKS = [
  ["ANCIENT", "BLIGHTED_ANCIENT_ICE_SACK", ["ICE_RUSH", "ICE_BURST", "ICE_BLITZ", "ICE_BARRAGE"]],
  ["NORMAL", "BLIGHTED_ENTANGLE_SACK", ["BIND", "SNARE", "ENTANGLE"]],
  ["NORMAL", "BLIGHTED_TELEPORT_SPELL_SACK", ["TELEBLOCK"]],
  ["NORMAL", "BLIGHTED_SURGE_SACK", ["WIND_WAVE", "WATER_WAVE", "EARTH_WAVE", "FIRE_WAVE", "WIND_SURGE", "WATER_SURGE", "EARTH_SURGE", "FIRE_SURGE"]],
  ["LUNAR", "BLIGHTED_VENGEANCE_SACK", ["VENGEANCE", "VENGEANCE_OTHER"]],
];

function supplySack(core, event) {
  const { player, spell } = event;
  if (!event.items.length) return;
  const location = player.getLocation();
  const allowed = core.WorldDefinition.hasGlobalWorldTag("pvp") ||
    core.Wilderness.levelAt(location.getX(), location.getY()) > 0 ||
    (((location.getX() >> 6) << 8) | (location.getY() >> 6)) === MAGE_ARENA_BANK_REGION ||
    BLIGHTED_MINIGAMES.has(player.getArea()?.getName());
  if (!allowed) return;
  const id = spell.spellId();
  const match = SPELL_SACKS.find(([book, , names]) => spell.getSpellbook() === core.MagicSpellbook[book] &&
    names.some(name => (book === "LUNAR" ? core.EffectSpells : core.CombatSpells)[name].spellId() === id));
  const sackId = match ? core.ItemIdentifiers[match[1]]
    : id === core.CacheDefinitions.getSpellByName("Teleport to Target")?.widgetId
      ? core.ItemIdentifiers.BLIGHTED_TELEPORT_SPELL_SACK : null;
  if (sackId != null && player.getInventory().getAmount(sackId) > 0) event.items = [new core.Item(sackId, 1)];
}

module.exports = {
  name: "BlightedSpellSacks",
  members: true,
  register(api) {
    api.onCustomEvent("magic:spell-cost", supplySack.bind(null, api.core));
  },
};
