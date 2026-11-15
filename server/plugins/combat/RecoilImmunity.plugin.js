/**
 * Monsters immune to recoil (https://oldschool.runescape.wiki/w/Category:Monsters_immune_to_recoil:
 * "immune to recoil effects such as ring of recoil and vengeance"). Core asks
 * `CombatFactory.canReceiveRecoil`, which emits `combat:recoil-target` for the ring of recoil, the
 * ring of suffering's recoil, vengeance and the league reflects; this answers it for the Wiki's list.
 * It is its own plugin so that turning off one recoil source (RingOfRecoil) keeps the others' immunity.
 */
const IMMUNE_DATA = require("./data/recoil-immune-npcs.json");
const IMMUNE_NPCS = new Set(IMMUNE_DATA.names);
/** By id where the name is shared with a monster that is not immune (the two Judges of Yama). */
const IMMUNE_NPC_IDS = new Set(IMMUNE_DATA.ids ?? []);

/** `combat:recoil-target`: the Wiki's immune monsters take no recoil and no vengeance rebound. */
function recoilTarget(check) {
  const npc = check.target?.isNpc?.() ? check.target.getAsNpc() : null;
  if (npc && (IMMUNE_NPC_IDS.has(npc.getId?.()) || IMMUNE_NPCS.has(npc.getCurrentDefinition().getName()))) {
    check.allow = false;
  }
}

module.exports = {
  name: "RecoilImmunity",
  description: "Exempts the Wiki's list of monsters immune to recoil from ring of recoil, ring of suffering and vengeance rebound damage.",
  members: true,
  register(api) {
    api.onCustomEvent("combat:recoil-target", recoilTarget);
  },
};
