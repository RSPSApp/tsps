// Acquisition conditions and activity rolls; generated NPC drop rows remain canonical.
let api;
const PLUCKED = new WeakSet();
const KILLED = new WeakSet();
function eligible(player, pet) {
  if (!player || !pet) return false;
  const reward = pet.requiredDiaryReward;
  if (reward === undefined) return true;
  if (!reward || typeof reward !== "object" || typeof reward.diary !== "string" || typeof reward.tier !== "string") return false;
  const request = {player, diary: reward.diary, tier: reward.tier, claimed: false};
  api.emitCustomEvent("diary:is-reward-claimed", request);
  return request.claimed === true;
}
function chickEntry(entry) {
  return entry.item_id === api.core.ItemIdentifiers.CHOMPY_CHICK;
}
/** A chompy carcass is the killed bird itself, shown as 1476 (chompybird_dead) where it fell. */
function isCarcass(npc) {
  const carcass = api.core.NpcIdentifiers.CHOMPY_BIRD_2;
  return npc.getId() === carcass || npc.getNpcTransformationId?.() === carcass;
}
/** Wiki (Chompy chick): killing and plucking each roll the chick's 1/500, once per bird each. */
function rollChick(player, npc) {
  const request = {player, itemId: api.core.ItemIdentifiers.CHOMPY_CHICK, eligible: false};
  api.emitCustomEvent("pets:eligible", request);
  if (!request.eligible) return;
  const drops = [];
  api.emitCustomEvent("npc-drops:roll-table", {
    player, npc, npcId: api.core.NpcIdentifiers.CHOMPY_BIRD,
    entryFilter: chickEntry, drops,
  });
  api.emitCustomEvent("npc-drops:roll", {player, npc, npcId: api.core.NpcIdentifiers.CHOMPY_BIRD, drops});
}
function plucked({player, npc}) {
  // The quest emits this after consuming its exact owned carcass. Keep identity,
  // not index: an NPC slot may later be reused by another bird.
  if (!player || !npc || !isCarcass(npc) || npc.getOwner() !== player || PLUCKED.has(npc)) return;
  PLUCKED.add(npc);
  rollChick(player, npc);
}
/** The quest takes a hunted bird's kill loot over (live drops nothing at the kill) and asks for the kill's roll. */
function killed({player, npc}) {
  if (!player || !npc || npc.getOwner() !== player || KILLED.has(npc)) return;
  KILLED.add(npc);
  rollChick(player, npc);
}
function attach(pluginApi) {
  api = pluginApi;
  api.onCustomEvent("chompy:plucked", plucked);
  api.onCustomEvent("chompy:killed", killed);
}
module.exports = {attach, eligible};
