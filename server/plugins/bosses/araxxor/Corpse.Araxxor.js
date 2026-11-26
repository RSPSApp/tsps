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
 * As captured (ticks from the death animation; rsprox 550, 1768, 788, 3280, 3347, 490 kills): the
 * living araxytes die with her (+0), the eggs crumble (+1), and at +5 she becomes the corpse on her
 * middle, its 3x3 blocked by loc 26209, "Noxious Awakening" starts again and the kill count goes up
 * ("Your Araxxor kill count is: N.", varp total_araxxor_kills) with the fight's length against the
 * personal best, timed from the spawn to +3. The health bar fades at +9 and clears four ticks
 * later. Harvest and Destroy both play 2282; two ticks later the loot (or, after a Destroy, "You
 * root aggressively...") comes with sound 9485, the corpse sinks the tick after and goes two ticks
 * later, its locs with it.
 */
const Shared = require("./Shared.Araxxor");
const Hud = require("./Hud.Araxxor");
const Minions = require("./Minions.Araxxor");
const Specials = require("./Specials.Araxxor");
const CombatAchievements = require("./CombatAchievements.Araxxor");
const Scoreboard = require("./Scoreboard.Araxxor");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");
const BOSS_NAME = "Araxxor";

/** Cache varp total_araxxor_kills: the kill count the boss log reads. Combat Achievements sends
 * it (its count is the one the boss page shows); this plugin only does when that is not running. */
const TOTAL_KILLS_VARP = 4260;
/** Captured, in ticks from the death animation. */
const CORPSE_AT_DEATH_TICK = 5;
const DURATION_END_TICKS = 3;
const HUD_FADE_AT_DEATH_TICK = 9;
/** Captured, in ticks from the Harvest or Destroy animation. */
const HARVEST_LOOT_TICKS = 2;
const HARVEST_SINK_TICKS = 3;
/** Captured: the 3x3 corpse sits on her middle, two tiles in from her south-west corner. */
const CORPSE_OFFSET = 2;
const CORPSE_SIZE = 3;
const CORPSE_BLOCKING_OBJECT = 26209;
const DESTROY_MESSAGE = "You root aggressively through the corpse and the body decays before you can harvest any resources.";
/** Captured (rsprox 1094): the menu Destroy opens, and its options in order. */
const DESTROY_TITLE = "Destroy regular loot for doubled pet chance?";
const DESTROY_OPTIONS = Object.freeze(["Yes.", "Yes, and don't ask again.", "No."]);
/**
 * Ticks from appendDeath (onNpcBeforeDeath) to the death animation: NPCDeathTask is submitted
 * there and plays the animation on its first run.
 */
const DEATH_ANIMATION_LAG = 1;

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

/**
 * Her death starts (the tick before its animation): the fight stops, her brood dies with her and
 * the health bar's fade is set for +9.
 */
function bossDying({ npc }) {
  if (npc?.getId?.() !== Shared.BOSS_ID || npc.getAttribute?.(Shared.ATTR_DYING) === true) return;
  const session = sessionOf(npc);
  if (!session) return;
  npc.setAttribute?.(Shared.ATTR_DYING, true);
  session.deathAt = core.World.getProcessCycle() + DEATH_ANIMATION_LAG;
  Specials.endFight(npc);
  Minions.dieWithBoss(npc, DEATH_ANIMATION_LAG);
  Hud.killed(npc, DEATH_ANIMATION_LAG + HUD_FADE_AT_DEATH_TICK);
}

/**
 * The death animation has run its definition's death ticks: she stays as the remains, and turns
 * into the corpse at +5.
 */
function bossDied(event) {
  const { npc } = event;
  if (!npc || npc.getId?.() !== Shared.BOSS_ID) return;
  const session = sessionOf(npc);
  if (!session) return;
  // Keep her in the world as the harvestable corpse until the timer runs out.
  event.remains = { ticks: Shared.CORPSE_TICKS };
  npc.setAttribute?.(Shared.ATTR_DYING, true);
  npc.getCombat?.().reset?.();
  const now = core.World.getProcessCycle();
  const deathAt = session.deathAt ?? now - (npc.getCurrentDefinition?.()?.getDeathTicks?.() ?? 0);
  session.respawnAt = now + Shared.CORPSE_TICKS + Shared.RESPAWN_TICKS;
  const ticks = deathAt + DURATION_END_TICKS - (session.spawnedAt ?? deathAt);
  const wait = deathAt + CORPSE_AT_DEATH_TICK - now;
  if (wait > 0) later(wait, npc, () => becomeCorpse(npc, session, ticks));
  else becomeCorpse(npc, session, ticks);
}

/** +5: the corpse on her middle, its locs, the music again and the kill messages. */
function becomeCorpse(npc, session, ticks) {
  if (!npc.isRegistered?.() || session.area?.isDestroyed?.() === true) return;
  npc.setModelCustomisation?.(null);
  npc.setNpcTransformationId(Shared.CORPSE_ID);
  // Captured as a jump: the 3x3 corpse is drawn where her middle was.
  npc.moveTo(npc.getLocation().transform(CORPSE_OFFSET, CORPSE_OFFSET, 0));
  blockCorpse(npc, session);
  // The walk-to validity gate needs HP above 0, so the corpse keeps 1: with 0, clicks
  // from any distance are silently dropped and only adjacent Harvest/Destroy works.
  // Nothing reads this as "alive": combat is id-gated to the boss, and the fight's
  // own alive() checks are additionally guarded by ATTR_DYING.
  npc.setHitpoints?.(1);
  session.corpse = npc;
  const player = session.player;
  if (!player?.isRegistered?.()) return;
  player.getPacketSender?.()?.sendSong?.(Shared.FIGHT_MUSIC);
  recordKill(player, ticks);
}

/** The corpse's 3x3 is blocked by loc 26209 while it lies there (captured). */
function blockCorpse(npc, session) {
  const at = npc.getLocation();
  const area = npc.getPrivateArea?.() ?? null;
  session.corpseLocs = [];
  for (let dx = 0; dx < CORPSE_SIZE; dx++) {
    for (let dy = 0; dy < CORPSE_SIZE; dy++) {
      const object = new core.GameObject(
        CORPSE_BLOCKING_OBJECT, new core.Location(at.getX() + dx, at.getY() + dy, at.getZ()), 10, 0, area,
      );
      core.ObjectManager.register(object, true);
      area?.add?.(object);
      session.corpseLocs.push(object);
    }
  }
}

/** Frees the corpse's tiles: it has gone, or the fight was reset. */
function unblockCorpse(session) {
  for (const object of session?.corpseLocs ?? []) core.ObjectManager.deregister(object, true);
  if (session) session.corpseLocs = [];
}

/** Whether the player has precise timing on (the "option_precise_timing" varbit). */
function preciseTiming(player) {
  const id = core?.CacheDefinitions?.getVarbitId?.("option_precise_timing");
  return Number.isInteger(id) && player?.getPacketSender?.()?.getVarbit?.(id) === 1;
}

/**
 * The fight duration as the message shows it: m:ss.cc with precise timing on, otherwise m:ss to the
 * nearest second (rsprox 550, 1768, 788, 3280, 3347: 290 kills precise, 200 not).
 */
function formatTicks(ticks, precise = true) {
  const pad = (value) => String(value).padStart(2, "0");
  if (!precise) {
    const total = Math.round(ticks * 0.6);
    return `${Math.floor(total / 60)}:${pad(total % 60)}`;
  }
  const centis = Math.round(ticks * 60);
  return `${Math.floor(centis / 6000)}:${pad(Math.floor((centis % 6000) / 100))}.${pad(centis % 100)}`;
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
  sendBossKillCount(player, `Your Araxxor kill count is: <col=ff0000>${kills}</col>.`);
  const best = Number(player.getAttribute(Shared.ATTR_BEST_TICKS)) || 0;
  const precise = preciseTiming(player);
  if (!best || ticks < best) {
    player.setAttribute(Shared.ATTR_BEST_TICKS, ticks);
    api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
    player.sendMessage(`Fight duration: <col=ff0000>${formatTicks(ticks, precise)}</col> (new personal best)`);
  } else {
    player.sendMessage(`Fight duration: <col=ff0000>${formatTicks(ticks, precise)}</col>. Personal best: ${formatTicks(best, precise)}`);
  }
}


/**
 * The death roll: Nid is lifted out of the drops so the pet is only awarded when the
 * player actually harvests or destroys; everything else is held off the floor. The rolls a
 * harvested or destroyed corpse emits itself are that award, so they are left alone.
 */
function stashRoll(event) {
  const session = sessionOf(event?.npc);
  if (event?.npcId !== Shared.BOSS_ID || !session || !Array.isArray(event.drops)) return;
  if (session.harvested === true || session.destroyed === true) return;
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
  session.stash = [...(event.drops ?? [])];
  // Nothing is received at the death (the collection log reads the roll a microtask later): the stash is logged as it
  // is harvested, and a Destroy logs only what it keeps, or the log filled with loot that was thrown away.
  if (Array.isArray(event.drops)) event.drops.length = 0;
}

/** What a corpse hands over, into the collection log. */
function logReceived(player, drops) {
  for (const drop of drops) {
    if (Number.isInteger(drop?.itemId) && drop.amount > 0) {
      api.emitCustomEvent("collection-log:obtain", { player, itemId: drop.itemId, amount: drop.amount });
    }
  }
}

/**
 * How many of `itemId` the player holds: the inventory and the bank, what storage items among them
 * hold (a looting bag, through its owner's "storage:contents"), and their group storage
 * ("group-storage:amount").
 */
function heldAmount(player, itemId) {
  const containers = [player.getInventory?.()];
  const { Bank } = core;
  const tabs = Bank?.TOTAL_BANK_TABS ?? 0;
  for (let tab = 0; tab < tabs; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX) containers.push(player.getBank?.(tab));
  }
  let amount = 0;
  for (const container of containers) {
    if (!container) continue;
    amount += container.getAmount?.(itemId) ?? 0;
    for (const item of container.getValidItems?.() ?? []) {
      const request = { player, item, contents: [], handled: false };
      api.emitCustomEvent("storage:contents", request);
      if (!request.handled) continue;
      for (const entry of request.contents) if (entry?.id === itemId) amount += entry.amount ?? 0;
    }
  }
  const stored = { player, itemId, amount: 0 };
  api.emitCustomEvent("group-storage:amount", stored);
  return amount + (Number(stored.amount) || 0);
}

/** What the player holds as a piece bitmask: the counter's first value for a player who looted before it existed. */
function heldHalberdPieces(player) {
  let mask = 0;
  Shared.HALBERD_PIECES.forEach((itemId, index) => {
    if (heldAmount(player, itemId) > 0) mask |= 1 << index;
  });
  return mask;
}

/**
 * A halberd piece drop is the next piece the player lacks (Wiki: "Players will not receive
 * duplicate pieces until each full set is obtained"), picked among those missing since their last
 * full set; a new set starts after all three. An account whose counter has never run adopts what it
 * already holds, so pieces looted before this existed are not handed out again.
 */
function nextHalberdPiece(player) {
  const full = (1 << Shared.HALBERD_PIECES.length) - 1;
  const saved = player.getAttribute?.(Shared.ATTR_HALBERD_PIECES);
  let had = (Number.isInteger(saved) ? saved : heldHalberdPieces(player)) & full;
  if (had === full) had = 0;
  const missing = Shared.HALBERD_PIECES.filter((_itemId, index) => !(had & (1 << index)));
  const index = Shared.HALBERD_PIECES.indexOf(missing[Math.floor(Math.random() * missing.length)]);
  player.setAttribute?.(Shared.ATTR_HALBERD_PIECES, had | (1 << index));
  return Shared.HALBERD_PIECES[index];
}

/** The stashed halberd piece, if one rolled, becomes the next piece the player lacks; other loot is unchanged. */
function resolveHalberdPieces(player, drops) {
  let piece = null;
  return drops.map((drop) => {
    if (piece !== null || !Shared.HALBERD_PIECES.includes(drop?.itemId)) return drop;
    piece = nextHalberdPiece(player);
    return { ...drop, itemId: piece };
  });
}

function validCorpse(npc, session) {
  return !!npc && npc.getId?.() === Shared.CORPSE_ID && !!session && session.corpse === npc
    && session.harvested !== true && session.destroyed !== true;
}

/** The ground options NpcDrops gives a kill's loot ("npc-drops:ground-options": the Wiki's 200-tick tradeable lifetime). */
function lootOptions(player, itemId, area) {
  const request = { player, itemId, area, options: {} };
  api.emitCustomEvent("npc-drops:ground-options", request);
  return request.options;
}

/** Turns drops (and a stashed Nid) into the player's inventory, excess to the floor (Wiki). */
function spawnDrops(player, session, drops) {
  const { Item, ItemDefinition } = core;
  const manager = api.getItemOnGroundManager();
  const where = session.corpse?.getLocation?.() ?? null;
  if (!where) return;
  // The loot tracker hears it as Araxxor's, at the harvest (rsprox_transcripts/237/01088.txt, 237/04086.txt).
  api.emitCustomEvent("npc-drops:report", { player, npcId: Shared.BOSS_ID, drops });
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
      manager.registerLocation(player, new Item(itemId, drop.amount), where, area, lootOptions(player, itemId, area));
    } else {
      for (let index = 0; index < drop.amount; index++) {
        manager.registerLocation(player, new Item(itemId, 1), where, area, lootOptions(player, itemId, area));
      }
    }
  }
}

function endCorpse(npc, session, afterTicks) {
  npc.performAnimation(new core.Animation(11486));
  later(afterTicks, npc, () => {
    unblockCorpse(session);
    core.World.getRemoveNPCQueue().push(npc);
  });
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
  const pet = session.pendingPet ?? [];
  later(HARVEST_LOOT_TICKS, npc, () => {
    if (!npc.isRegistered?.()) return;
    const loot = resolveHalberdPieces(player, session.stash ?? []);
    Shared.playSound(player, Shared.CORPSE_LOOT_SOUND);
    spawnDrops(player, session, loot);
    // The harvested loot is this roll, so the collection log, the clan loot broadcast and the loot notifications (which
    // read the emptied death roll a microtask later) see it here. The death roll already counted the kill.
    api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: Shared.BOSS_ID, drops: [...loot, ...pet], countKill: false });
  });
  later(HARVEST_SINK_TICKS, npc, () => {
    if (npc.isRegistered?.()) endCorpse(npc, session, 2);
  });
  return true;
}

/**
 * Destroy: forfeit the loot, keep elite clues, and roll Nid at 1/1500 (Wiki). Captured (rsprox 1094,
 * 4086, 550, 1768): the Harvest animation, two ticks later the decay message with sound 9485, then
 * the corpse sinks and goes as after a harvest.
 */
function destroyConfirmed({ player, npc }) {
  const session = sessionOf(npc);
  if (!validCorpse(npc, session)) return;
  session.destroyed = true;
  player.performAnimation(new core.Animation(Shared.HARVEST_ANIMATION));
  const clues = (session.stash ?? []).filter((drop) => drop.itemId === Shared.ELITE_CLUE_ITEM_ID);
  const nid = Math.random() < 1 / Shared.DESTROY_PET_RATE
    ? [{ itemId: Shared.NID_ITEM_ID, amount: 1 }]
    : [];
  later(HARVEST_LOOT_TICKS, npc, () => {
    if (!npc.isRegistered?.()) return;
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, DESTROY_MESSAGE);
    Shared.playSound(player, Shared.CORPSE_LOOT_SOUND);
    spawnDrops(player, session, clues);
    logReceived(player, clues);
    if (nid.length > 0) {
      // The death roll already counted the kill; Nid is only extra loot.
      api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: Shared.BOSS_ID, drops: nid, countKill: false });
    }
  });
  later(HARVEST_SINK_TICKS, npc, () => {
    if (npc.isRegistered?.()) endCorpse(npc, session, 2);
  });
}

/**
 * The captured prompt (rsprox 1094): one menu, with a "don't ask again" that is remembered on the
 * player (rsprox 4086 destroys with no menu).
 */
function destroy({ player, npc }) {
  const session = sessionOf(npc);
  if (!validCorpse(npc, session)) return false;
  if (player.getAttribute?.(Shared.ATTR_DESTROY_NO_PROMPT) === true) {
    destroyConfirmed({ player, npc });
    return true;
  }
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        const index = Number(option);
        if (index === 1) player.setAttribute?.(Shared.ATTR_DESTROY_NO_PROMPT, true);
        if (index === 0 || index === 1) destroyConfirmed({ player, npc });
      },
    }, ...DESTROY_OPTIONS).setTitle(DESTROY_TITLE),
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
  pluginApi.persistAttribute(Shared.ATTR_HALBERD_PIECES);
  pluginApi.onNpcBeforeDeath(bossDying);
  pluginApi.onNpcDeath(bossDied);
  pluginApi.onCustomEvent("npc-drops:roll", stashRoll);
  pluginApi.onCustomEvent("npc-drops:generated", stashGenerated);
  pluginApi.onNpcInteraction("Araxxor", { Harvest: harvest, Destroy: destroy, Attack: denyAttack });
}

module.exports = {
  attach,
  bossDying,
  bossDied,
  becomeCorpse,
  unblockCorpse,
  harvest,
  destroy,
  destroyConfirmed,
  stashRoll,
  stashGenerated,
  spawnDrops,
  validCorpse,
  formatTicks,
  nextHalberdPiece,
  resolveHalberdPieces,
};
