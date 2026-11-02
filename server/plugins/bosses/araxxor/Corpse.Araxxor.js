/**
 * The Araxxor corpse: the captured death (11481, then the corpse 13669 five ticks later),
 * Harvest (rolls the drop table onto the floor, pet included) and Destroy (no loot, but the
 * Nid roll doubles to 1/1500 and elite clues still drop - Wiki).
 *
 * The engine rolls npc-drops.json's araxxor table the moment the boss dies; this module
 * catches that roll on "npc-drops:generated", marks it handled so nothing hits the floor
 * yet, and keeps the drops (and any Nid) until the player chooses. Harvest turns them out;
 * Destroy keeps only elite clues and re-rolls Nid at 1/1500. Either way the corpse sinks
 * (11486) and the fight resets on the lair's respawn timer.
 *
 * As captured: five ticks into the death the kill count goes up ("Your Araxxor kill count is:
 * N.", varp total_araxxor_kills) and the fight's length is told against the personal best,
 * timed from the spawn to three ticks into the death. Harvest (2282) turns the loot out two
 * ticks after the click, the corpse sinks the tick after and goes two ticks later.
 */
const Shared = require("./Shared.Araxxor");
const Hud = require("./Hud.Araxxor");
const Minions = require("./Minions.Araxxor");
const Specials = require("./Specials.Araxxor");
const CombatAchievements = require("./CombatAchievements.Araxxor");
const Scoreboard = require("./Scoreboard.Araxxor");
const BOSS_NAME = "Araxxor";

/** Cache varp total_araxxor_kills: the kill count the boss log reads. Combat Achievements sends
 * it (its count is the one the boss page shows); this plugin only does when that is not running. */
const TOTAL_KILLS_VARP = 4260;
/** Captured: the kill messages five ticks into the death, timed to three ticks into it. */
const KILL_MESSAGE_TICKS = 5;
const DURATION_END_TICKS = 3;
const HARVEST_LOOT_TICKS = 2;
const HARVEST_SINK_TICKS = 3;

let api = null;
let core = null;

function later(ticks, target, execFunc) {
  class DelayedTask extends core.Task {
    constructor() {
      super(Math.max(1, ticks), target, false);
    }

    execute() {
      this.stop();
      execFunc();
    }
  }
  core.TaskManager.submit(new DelayedTask());
}

function sessionOf(npc) {
  return npc?.getAttribute?.(Shared.ATTR_ENCOUNTER) ?? null;
}

/** The captured death: the 11481 anim, five ticks later the harvestable corpse. */
function bossDied(event) {
  const { npc } = event;
  if (!npc || npc.getId?.() !== Shared.BOSS_ID) return;
  const session = sessionOf(npc);
  if (!session) return;
  // Keep her in the world as the harvestable corpse until the timer runs out.
  event.remains = { ticks: Shared.CORPSE_TICKS };
  npc.setAttribute?.(Shared.ATTR_DYING, true);
  npc.getCombat?.().reset?.();
  Minions.crumbleAll(npc);
  Specials.endFight(npc);
  Hud.killed(npc);
  npc.setModelCustomisation?.(null);
  npc.setNpcTransformationId(Shared.CORPSE_ID);
  // The walk-to validity gate needs HP above 0, so the corpse keeps 1: with 0, clicks
  // from any distance are silently dropped and only adjacent Harvest/Destroy works.
  // Nothing reads this as "alive": combat is id-gated to the boss, and the fight's
  // own alive() checks below are additionally guarded by ATTR_DYING (set above).
  npc.setHitpoints?.(1);
  session.corpse = npc;
  session.respawnAt = core.World.getProcessCycle() + Shared.CORPSE_TICKS + Shared.RESPAWN_TICKS;
  const ticks = core.World.getProcessCycle() + DURATION_END_TICKS - (session.spawnedAt ?? core.World.getProcessCycle());
  const player = session.player;
  later(KILL_MESSAGE_TICKS, npc, () => {
    if (player?.isRegistered?.()) recordKill(player, ticks);
  });
}

/** Minutes, seconds and hundredths, as the fight-duration message shows them. */
function formatTicks(ticks) {
  const centis = Math.round(ticks * 60);
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

/**
 * One kill: Combat Achievements counts it (and finishes the tasks the fight earned), and its
 * total is the one told, so the message, the boss page and the kill-count tasks agree.
 */
function recordKill(player, ticks) {
  const own = (Number(player.getAttribute(Shared.ATTR_KILLS)) || 0) + 1;
  const total = CombatAchievements.killed(player, own, (kills) => announceKill(player, kills, ticks));
  player.setAttribute(Shared.ATTR_KILLS, Math.max(own, total ?? 0));
  if (total == null) player.getPacketSender().sendConfig(TOTAL_KILLS_VARP, own);
  Scoreboard.won(ticks);
}

/** The kill count and the fight's length against the personal best (captured messages). */
function announceKill(player, kills, ticks) {
  player.sendMessage(`Your Araxxor kill count is: <col=ff0000>${kills}</col>.`);
  const best = Number(player.getAttribute(Shared.ATTR_BEST_TICKS)) || 0;
  if (!best || ticks < best) {
    player.setAttribute(Shared.ATTR_BEST_TICKS, ticks);
    api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
    player.sendMessage(`Fight duration: <col=ff0000>${formatTicks(ticks)}</col> (new personal best)`);
  } else {
    player.sendMessage(`Fight duration: <col=ff0000>${formatTicks(ticks)}</col>. Personal best: ${formatTicks(best)}`);
  }
}


/**
 * The death roll: Nid is lifted out of the drops so the pet is only awarded when the
 * player actually harvests or destroys; everything else is held off the floor.
 */
function stashRoll(event) {
  const session = sessionOf(event?.npc);
  if (event?.npcId !== Shared.BOSS_ID || !session || !Array.isArray(event.drops)) return;
  session.pendingPet = session.pendingPet ?? [];
  for (let index = event.drops.length - 1; index >= 0; index--) {
    if (event.drops[index]?.itemId === Shared.NID_ITEM_ID) {
      session.pendingPet.push(...event.drops.splice(index, 1));
    }
  }
}

function stashGenerated(event) {
  const session = sessionOf(event?.npc);
  if (event?.npcId !== Shared.BOSS_ID || !session) return;
  event.handled = true;
  session.stash = event.drops ?? [];
}

function validCorpse(npc, session) {
  return !!npc && npc.getId?.() === Shared.CORPSE_ID && !!session && session.corpse === npc
    && session.harvested !== true && session.destroyed !== true;
}

/** Turns drops (and a stashed Nid) into the player's inventory, excess to the floor (Wiki). */
function spawnDrops(player, session, drops) {
  const { Item, ItemDefinition } = core;
  const manager = api.getItemOnGroundManager();
  const where = session.corpse?.getLocation?.() ?? null;
  if (!where) return;
  const area = session.corpse?.getPrivateArea?.() ?? null;
  const inventory = player.getInventory?.() ?? null;
  for (const drop of drops) {
    if (!Number.isInteger(drop.itemId) || drop.amount <= 0) continue;
    const noteId = ItemDefinition.forId(drop.itemId).getNoteId();
    const itemId = drop.noted && noteId >= 0 && ItemDefinition.forId(noteId).isNoted() ? noteId : drop.itemId;
    const stackable = ItemDefinition.forId(itemId).isStackable();
    if (inventory) {
      if (stackable && (inventory.contains(itemId) || inventory.getFreeSlots() > 0)) {
        inventory.adds(itemId, drop.amount);
        continue;
      }
      if (!stackable && inventory.getFreeSlots() >= drop.amount) {
        inventory.adds(itemId, drop.amount);
        continue;
      }
    }
    if (stackable) {
      manager.registerLocation(player, new Item(itemId, drop.amount), where, area);
    } else {
      for (let index = 0; index < drop.amount; index++) {
        manager.registerLocation(player, new Item(itemId, 1), where, area);
      }
    }
  }
}

function endCorpse(npc, session, afterTicks) {
  npc.performAnimation(new core.Animation(11486));
  later(afterTicks, npc, () => core.World.getRemoveNPCQueue().push(npc));
  session.respawnAt = Math.min(
    session.respawnAt ?? Number.MAX_SAFE_INTEGER,
    core.World.getProcessCycle() + afterTicks + Shared.RESPAWN_TICKS,
  );
}

function harvest({ player, npc }) {
  const session = sessionOf(npc);
  if (!validCorpse(npc, session)) return false;
  session.harvested = true;
  player.performAnimation(new core.Animation(Shared.HARVEST_ANIMATION));
  const stash = session.stash ?? [];
  const pet = session.pendingPet ?? [];
  later(HARVEST_LOOT_TICKS, npc, () => {
    if (!npc.isRegistered?.()) return;
    spawnDrops(player, session, stash);
    if (pet.length > 0) {
      api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: Shared.BOSS_ID, drops: pet });
    }
  });
  later(HARVEST_SINK_TICKS, npc, () => {
    if (npc.isRegistered?.()) endCorpse(npc, session, 2);
  });
  return true;
}

/** Destroy: forfeit the loot, keep elite clues, and roll Nid at 1/1500 (Wiki). */
function destroyConfirmed({ player, npc }) {
  const session = sessionOf(npc);
  if (!validCorpse(npc, session)) return;
  session.destroyed = true;
  const clues = (session.stash ?? []).filter((drop) => drop.itemId === Shared.ELITE_CLUE_ITEM_ID);
  const nid = Math.random() < 1 / Shared.DESTROY_PET_RATE
    ? [{ itemId: Shared.NID_ITEM_ID, amount: 1 }]
    : [];
  later(1, npc, () => {
    if (!npc.isRegistered?.()) return;
    spawnDrops(player, session, clues);
    if (nid.length > 0) {
      api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: Shared.BOSS_ID, drops: nid });
    }
    endCorpse(npc, session, 2);
  });
}

/**
 * The Wiki's prompt: destroy for the doubled pet chance, with a "don't ask again" that is
 * remembered on the player.
 */
function destroy({ player, npc }) {
  const session = sessionOf(npc);
  if (!validCorpse(npc, session)) return false;
  if (player.getAttribute?.(Shared.ATTR_DESTROY_NO_PROMPT) === true) {
    destroyConfirmed({ player, npc });
    return true;
  }
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.StatementDialogue(0, Shared.CORPSE_DESTROY_PROMPT),
    new core.OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        const index = Number(option);
        if (index === 0) {
          destroyConfirmed({ player, npc });
        } else if (index === 2) {
          player.setAttribute?.(Shared.ATTR_DESTROY_NO_PROMPT, true);
          destroyConfirmed({ player, npc });
        }
      },
    }, "Yes, destroy it.", "No, keep it.", "Yes, and don't ask again."),
  ));
  return true;
}

/** A corpse has no "Attack": swallow the interaction if one is ever attempted. */
function denyAttack({ npc }) {
  return npc?.getId?.() === Shared.CORPSE_ID;
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.persistAttribute(Shared.ATTR_KILLS);
  pluginApi.persistAttribute(Shared.ATTR_BEST_TICKS);
  pluginApi.onNpcDeath(bossDied);
  pluginApi.onCustomEvent("npc-drops:roll", stashRoll);
  pluginApi.onCustomEvent("npc-drops:generated", stashGenerated);
  pluginApi.onNpcInteraction("Araxxor", { Harvest: harvest, Destroy: destroy, Attack: denyAttack });
}

module.exports = {
  attach,
  bossDied,
  harvest,
  destroy,
  destroyConfirmed,
  stashRoll,
  stashGenerated,
  spawnDrops,
  validCorpse,
  formatTicks,
};
