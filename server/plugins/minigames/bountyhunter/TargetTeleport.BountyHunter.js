"use strict";

/**
 * Teleport to Target (https://oldschool.runescape.wiki/w/Teleport_to_Target): level 85, a law,
 * death and chaos rune, 45 Magic xp, on every spellbook once a target teleport scroll is read
 * (scroll text from Transcript:Target_teleport_scroll). It is cast only in Daimon's Crater, lobby
 * included, with a target, not within 12 seconds of combat (Bounty Hunter changes, 2023), at most
 * five times per target, and lands within 12 squares of the target - here on a tile walkable
 * from the target's, so never across lava or a fort wall. The crater blocks every other teleport,
 * so the usual teleport checks are made here rather than through the crater's canTeleport, and a
 * cast from the lobby into the arena needs what the Arena gates need (coffer, supply crates).
 *
 * Refusal messages have no Wiki source and are our wording.
 */

const { inCrater } = require("./Fort.BountyHunter");

const UNLOCKED_ATTRIBUTE = "bounty-hunter:target-teleport-unlocked";
const UNLOCKED_VARBIT = "bounty_target_teleport";
const SPELL_NAME = "Teleport to Target";
const WARNING_OP = 10;
const LEVEL = 85;
const EXPERIENCE = 45;
const COMBAT_COOLDOWN_MS = 12_000;
const USES_PER_TARGET = 5;
const LANDING_RADIUS = 12;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

let core;
let pluginApi;
let bh;
const lastCombatAt = new WeakMap();
const usesByPlayer = new WeakMap();

function sendUnlocked(player) {
  if (player.getAttribute(UNLOCKED_ATTRIBUTE) !== true) return;
  const varbit = core.CacheDefinitions.getVarbitId(UNLOCKED_VARBIT);
  if (varbit != null) player.getPacketSender().sendVarbit(varbit, 1);
}

function syncUnlocked({ player }) {
  sendUnlocked(player);
}

function learn(player, slot) {
  const inventory = player.getInventory();
  if (inventory.getItems()[slot]?.getId() !== core.ItemIdentifiers.TARGET_TELEPORT_SCROLL) return;
  inventory.deleteAtSlot(slot, 1);
  player.setAttribute(UNLOCKED_ATTRIBUTE, true);
  sendUnlocked(player);
  box(player, "You have learnt the 'Teleport to Target' spell.");
}

function box(player, text, then) {
  const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = core;
  const chain = new DialogueChainBuilder().add(new ItemStatementDialogue(0, core.ItemIdentifiers.TARGET_TELEPORT_SCROLL, text));
  if (then) chain.add(new ActionDialogue(1, { execute: then }));
  player.getDialogueManager().startDialogues(chain);
}

function readScroll({ player, slot }) {
  if (player.getAttribute(UNLOCKED_ATTRIBUTE) === true) {
    box(player, "You have already unlocked the spell. The scroll can be sold if you no longer need it.");
    return;
  }
  box(player, "The 'Teleport to Target' spell requires level 85 Magic, and can be cast only within the Wilderness, while you have a Target. This scroll will be destroyed when it has been read.",
    () => pluginApi.sendMultiChatboxPrompt(player, "Are you sure you want to learn the spell?",
      "Yes, I want to learn the spell.", () => learn(player, slot),
      "No, I'll keep the scroll.", () => {}));
}

/** Both sides of a hit between players count as combat. */
function noteCombat({ attacker, target }) {
  if (attacker?.isPlayer?.() !== true || target?.isPlayer?.() !== true) return;
  const now = Date.now();
  lastCombatAt.set(attacker, now);
  lastCombatAt.set(target, now);
}

function targetOf(player) {
  const request = { player, target: null };
  pluginApi.emitCustomEvent("bounty-hunter:has-target", request);
  return request.target;
}

/** Tiles within `radius` of `from` reachable from it on foot (4-way flood fill). */
function reachableTiles(from, radius, canStep) {
  const x0 = from.getX(), y0 = from.getY(), z = from.getZ();
  const seen = new Set([`${x0},${y0}`]);
  const queue = [[x0, y0]];
  const tiles = [];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of STEPS) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (seen.has(key) || Math.abs(nx - x0) > radius || Math.abs(ny - y0) > radius) continue;
      seen.add(key);
      if (!canStep(x, y, nx, ny, z)) continue;
      queue.push([nx, ny]);
      tiles.push([nx, ny]);
    }
  }
  return tiles;
}

function landingNear(target) {
  const at = target.getLocation();
  const canStep = (x, y, nx, ny, z) => core.RegionManager.canMove(x, y, nx, ny, z, 1, 1, null);
  const tiles = reachableTiles(at, LANDING_RADIUS, canStep);
  const [x, y] = tiles.length ? tiles[Math.floor(Math.random() * tiles.length)] : [at.getX(), at.getY()];
  return new core.Location(x, y, at.getZ());
}

/** Uses left on the current target; a new target starts again at five. */
function usesOf(player, target) {
  const uses = usesByPlayer.get(player);
  return uses?.target === target ? uses.count : 0;
}

function refusal(player, target) {
  if (player.getAttribute(UNLOCKED_ATTRIBUTE) !== true) return "You need to learn this spell from a target teleport scroll first.";
  if (!inCrater(player)) return "You can only cast this spell in Bounty Hunter.";
  if (!target || !inCrater(target)) return "You don't have a target to teleport to.";
  if (Date.now() - (lastCombatAt.get(player) ?? 0) < COMBAT_COOLDOWN_MS) return "You can't cast this spell so soon after combat.";
  if (usesOf(player, target) >= USES_PER_TARGET) return "You have already teleported to this target five times.";
  if (!player.getCombat().getTeleblockTimer().finished()) return "A magical spell is blocking you from teleporting.";
  if (bh.inLobby(player) && !bh.inLobby(target)) return arenaRefusal(player);
  return null;
}

/** Entry.BountyHunter.js answers with the Arena gates' refusal, if any. */
function arenaRefusal(player) {
  const request = { player, reason: null };
  pluginApi.emitCustomEvent("bounty-hunter:arena-refusal", request);
  return request.reason;
}

function spellFor(player) {
  const { Item, ItemIdentifiers: Items } = core;
  const spellbook = player.getSpellbook();
  const widget = core.CacheDefinitions.getSpellByName(SPELL_NAME);
  if (!widget) throw new Error(`Missing cache spell: ${SPELL_NAME}`);
  const spell = new (class extends core.Spell {
    spellId() { return widget.widgetId; }
    levelRequired() { return LEVEL; }
    baseExperience() { return EXPERIENCE; }
    itemsRequired() { return [new Item(Items.LAW_RUNE, 1), new Item(Items.DEATH_RUNE, 1), new Item(Items.CHAOS_RUNE, 1)]; }
    equipmentRequired() { return []; }
    startCast() {}
    getSpellbook() { return spellbook; }
  })();
  spell.members = true;
  return spell;
}

function cast(event) {
  // op10 toggles the spell's Wilderness warning (SpellTeleports.plugin.js), it doesn't cast.
  if (event.spellName !== SPELL_NAME || event.opId === WARNING_OP) return;
  event.handled = true;
  const { player } = event;
  if (player.busy() || player.getMovementQueue().isMovementBlocked()) return;
  const target = targetOf(player);
  const refused = refusal(player, target);
  if (refused) {
    player.sendMessage(refused);
    return;
  }
  const spell = spellFor(player);
  if (!spell.canCast(player, false) || !spell.canCast(player, true)) return;
  usesByPlayer.set(player, { target, count: usesOf(player, target) + 1 });
  core.TeleportHandler.teleport(player, landingNear(target), player.getSpellbook().getTeleportType(), false);
  player.getSkillManager().addExperiences(core.Skill.MAGIC, EXPERIENCE);
}

module.exports = function attachTargetTeleport(api, state) {
  core = api.core;
  pluginApi = api;
  bh = state;
  api.persistAttribute(UNLOCKED_ATTRIBUTE, false);
  api.onPlayerLogin(syncUnlocked);
  api.onItemAction("Target teleport scroll", { Read: readScroll });
  api.onSpellCast(cast);
  api.onCombatHitResolved(noteCombat);
};

Object.assign(module.exports, {
  _test: { reachableTiles, refusal, readScroll, learn, cast, noteCombat, usesOf, UNLOCKED_ATTRIBUTE },
});
