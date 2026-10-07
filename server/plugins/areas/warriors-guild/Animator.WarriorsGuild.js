/**
 * Warriors' Guild: Shanomi's animation room. A plain full helm, platebody and platelegs of one
 * metal placed on a magical animator come alive as animated armour, which drops tokens and
 * (most of) the armour when killed. Armour left alive for five minutes, or that outlives its
 * owner, is kept by Shanomi until claimed. Behaviour is the Wiki's; the timings and animations
 * follow Near-Reality's port.
 */
const Guild = require("./Common.WarriorsGuild");

const PLACE_ANIMATION = 827;
const RISE_ANIMATION = 4166;
const PLACE_TICKS = 3;
const SPAWN_TICKS = 6;
const ATTACK_TICKS = 8;
/** "It will despawn if not defeated within five minutes." */
const LIFETIME_TICKS = 500;
const LOST_ARMOUR_ATTRIBUTE = "warriors-guild:lost-armour";
const SHANOMI_LOST_VARIANT = "standard-dialogue-if-the-animated-armour-despawns-after-5-minutes-of-not-being-killed";
const SHANOMI_WRONG_ITEM_VARIANT = "using-any-item-that-isn-t-a-standard-metal-full-helm-platebody-or-platelegs-on-the-animator";

let api;
/** [helm, platebody, platelegs, animated armour npc], bronze to rune. */
let SETS = [];
/** player -> { npc, set, ticks } while their armour is being animated or is alive. */
const animated = new Map();

function buildSets() {
  const Items = Guild.core.ItemIdentifiers;
  const Npcs = Guild.core.NpcIdentifiers;
  return ["BRONZE", "IRON", "STEEL", "BLACK", "MITHRIL", "ADAMANT", "RUNE"].map((metal) => [
    Items[`${metal}_FULL_HELM`], Items[`${metal}_PLATEBODY`], Items[`${metal}_PLATELEGS`], Npcs[`ANIMATED_${metal}_ARMOUR`],
  ]);
}

function hasSet(player, set) {
  return set.slice(0, 3).every((itemId) => player.getInventory().contains(itemId));
}

function animate(player, set, animator) {
  if (animated.has(player)) {
    player.sendMessage("You've already summoned an animated armour.");
    return;
  }
  const inventory = player.getInventory();
  for (const itemId of set.slice(0, 3)) inventory.deleteNumber(itemId, 1);
  const state = { npc: null, set, ticks: 0 };
  animated.set(player, state);
  player.getMovementQueue().reset();
  player.performAnimation(new Guild.core.Animation(PLACE_ANIMATION));
  Guild.talk(player, [{ statement: "You place your armour on the platform where it disappears... The animator hums; something appears to be working..." }]);
  const { x, y, z } = animator;
  Guild.later(player, PLACE_TICKS, () => player.getMovementQueue().walkStep(0, 2));
  Guild.later(player, SPAWN_TICKS, () => {
    if (animated.get(player) !== state) return;
    const npc = Guild.spawnFor(player, set[3], Guild.tile(x, y, z));
    state.npc = npc;
    npc.performAnimation(new Guild.core.Animation(RISE_ANIMATION));
    npc.forceChat("I'm ALIVE!");
    player.getPacketSender().sendInterfaceRemoval();
    player.getPacketSender().sendEntityHint(npc);
    Guild.later(player, ATTACK_TICKS - SPAWN_TICKS - 1, () => npc.getMovementQueue().walkStep(0, 1));
  });
  Guild.later(player, ATTACK_TICKS, () => {
    if (animated.get(player) === state && state.npc?.isRegistered()) state.npc.getCombat().attack(player);
  });
}

function useAnimator({ player, location }) {
  const set = SETS.find((candidate) => hasSet(player, candidate));
  if (!set) {
    Guild.talk(player, [{ statement: "You need a suitable platebody, legs and full helm of the same type to activate the armour animator." }]);
    return;
  }
  animate(player, set, location);
}

function useItemOnAnimator(event) {
  if (event.objectId !== Guild.core.ObjectIdentifiers.MAGICAL_ANIMATOR) return;
  event.handled = true;
  const set = SETS.find((candidate) => candidate.slice(0, 3).includes(event.itemId));
  if (!set) {
    Guild.playTranscript(api, event.player, Guild.NPCS.SHANOMI, SHANOMI_WRONG_ITEM_VARIANT);
    return;
  }
  if (!hasSet(event.player, set)) {
    Guild.talk(event.player, [{ statement: "You need a suitable platebody, legs and full helm of the same type to activate the armour animator." }]);
    return;
  }
  animate(event.player, set, event.location);
}

// --- Shanomi keeps armour that was never killed.

function lostSets(player) {
  const sets = player.getAttribute(LOST_ARMOUR_ATTRIBUTE);
  return Array.isArray(sets) ? sets : [];
}

/** The armour goes back to Shanomi: it outlived its five minutes, or its owner died or left. */
function abandon(player) {
  const state = animated.get(player);
  if (!state) return;
  animated.delete(player);
  if (state.npc) Guild.despawn(state.npc);
  player.getPacketSender().sendEntityHintRemoval(false);
  player.setAttribute(LOST_ARMOUR_ATTRIBUTE, [...lostSets(player), state.set.slice(0, 3)]);
}

function abandonArmour({ player }) {
  abandon(player);
}

function tickArmour({ player }) {
  const state = animated.get(player);
  if (state?.npc && ++state.ticks >= LIFETIME_TICKS) abandon(player);
}

function armourKilled({ npc }) {
  const owner = npc.getOwner?.();
  const state = owner ? animated.get(owner) : null;
  if (!state || state.npc !== npc) return;
  animated.delete(owner);
  owner.getPacketSender().sendEntityHintRemoval(false);
}

function shanomiVariant({ player, npcId }) {
  return npcId === Guild.NPCS.SHANOMI && lostSets(player).length > 0 ? SHANOMI_LOST_VARIANT : null;
}

function shanomiCondition({ player, npcId, text }) {
  if (npcId !== Guild.NPCS.SHANOMI) return null;
  if (text === "If the player does not have inventory space:") return player.getInventory().getFreeSlots() < 3;
  if (text === "If the player has inventory space:") return player.getInventory().getFreeSlots() >= 3;
  return null;
}

function returnLostArmour(event) {
  if (event.npcId !== Guild.NPCS.SHANOMI || event.text !== "the set of lost armour") return;
  const [set, ...rest] = lostSets(event.player);
  if (set && event.player.getInventory().getFreeSlots() >= set.length) {
    for (const itemId of set) event.player.getInventory().adds(itemId, 1);
    event.player.setAttribute(LOST_ARMOUR_ATTRIBUTE, rest);
  }
  event.handled = true;
}

module.exports = function attachAnimator(pluginApi) {
  api = pluginApi;
  SETS = buildSets();
  api.persistAttribute(LOST_ARMOUR_ATTRIBUTE);
  api.onObjectInteraction("Magical Animator", { Animate: useAnimator });
  api.onItemOnObject(useItemOnAnimator);
  api.onPlayerProcess(tickArmour);
  api.onNpcDeath(armourKilled);
  api.onPlayerDeath(abandonArmour);
  api.onPlayerLogout(abandonArmour);
  api.onNpcDialogueVariant(shanomiVariant);
  api.onNpcDialogueCondition(shanomiCondition);
  api.onCustomEvent("npc-dialogue:action", returnLostArmour);
};

/** Animated armour, like the guild's cyclopes, can only be hurt in melee. */
module.exports.ANIMATED_ARMOUR_IDS = () => SETS.map((set) => set[3]);
