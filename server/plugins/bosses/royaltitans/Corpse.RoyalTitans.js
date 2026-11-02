/**
 * Titan deaths, the claim-anchored corpse schedule and contribution loot.
 *
 * As captured: the final blows land on one tick and the same tick brings the kill count
 * (varp total_royal_titan_kills, 4648), the duration and "eligible to take loot from
 * either" for each player; both titans swap to their corpse forms on their static tiles.
 * Each player claims ONE corpse with one option; the other (or a second) claim is refused
 * with "not worthy". op1 on Eldric at 1825 turned drops out at 1830 (5 ticks). Everything
 * after the kill is anchored to the claim: reinvigorate +3/+5, drops +5, corpse death
 * anims + floors +23/+26, dels +5 later, fresh spawns +2/+3 after that (both fights).
 *
 * Contribution (Wiki): whole-percent share of combined titan damage (recoil counts,
 * elementals do not; poison/burn/thralls do not). Loot scales linearly above 1%, yields 1
 * of each item below 1% (1-11 damage), nothing at zero. Pet/clue rates ignore contribution.
 * Sacrifice forfeits drops (clues kept — estimate) for a doubled pet rate (miss:
 * "You don't feel lucky..."); Take pages gives 10-19 desiccated pages (possible from 72
 * damage, guaranteed at 120 — estimated thresholds, docs assumption) plus tertiary. Corpse
 * options [Loot, null, Sacrifice, Take pages] confirmed by cache dump and live clicks.
 */
const Shared = require("./Shared.RoyalTitans");
const CombatAchievements = require("./CombatAchievements.RoyalTitans");

/** Desiccated pages (both tables roll this id). */
const PAGES_ITEM_ID = 30640;
const BRAN_ITEM_ID = 30622;
const SACRIFICE_PET_RATE = 1500;
const BOSS_NAME = "Royal Titans";
/** Below 1% share (1-11 damage of 1200) rolls twice but yields 1 of each (Wiki). */
const MIN_SHARE_PERCENT = 0.01;
/** Take pages: possible from ~72 damage, guaranteed at 120 (Wiki; estimated mapping). */
const PAGES_MIN_DAMAGE = 72;
const PAGES_FULL_DAMAGE = 120;

/** The loot animation for every claim option (captured). */
const CLAIM_ANIMATION = 2282;
/** The fight duration message reads kill tick - spawn tick - 3 (captured across kills). */
const KILL_DURATION_OFFSET_TICKS = 3;
/** Unclaimed corpses run the claim schedule as if claimed this long after the kill [EST]. */
const UNCLAIMED_DELAY_TICKS = 19;
/** A corpse waits for its partner however long the fight runs (an hour here); the claim
 * schedule's removeCorpses takes both out. */
const CORPSE_REMAINS_TICKS = 6000;

let api = null;
let core = null;
/** corpse -> the session kill it belongs to, so a lingering corpse is never claimable. */
const corpseKills = new WeakMap();

const { alive, later, sessionOfNpc } = Shared;

/** Whole-percent share of one player's combined titan damage (Wiki). */
function shareOf(session, player) {
  if (!session || !player) return 0;
  let mine = 0;
  let total = 0;
  for (const titan of [session.branda, session.eldric]) {
    const dealt = titan?.getAttribute(Shared.DAMAGE_DEALT_ATTRIBUTE);
    if (!dealt) continue;
    for (const [key, amount] of Object.entries(dealt)) {
      total += amount;
      if (key === keyOf(player)) mine += amount;
    }
  }
  if (total <= 0 || mine <= 0) return 0;
  return Math.floor((mine * 100) / total) / 100;
}

function keyOf(player) {
  return player.getUsername();
}

/** Every player-attributed hit on a live titan feeds contribution (Wiki: recoil counts). */
function trackDamage({ attacker, target, hit }) {
  if (!attacker?.isPlayer() || !target?.isNpc() || !Shared.isLiveTitan(target.getId())) return;
  const damage = hit.getTotalDamage();
  if (!(damage > 0)) return;
  const dealt = target.getAttribute(Shared.DAMAGE_DEALT_ATTRIBUTE) ?? {};
  const key = keyOf(attacker.getAsPlayer());
  dealt[key] = (dealt[key] ?? 0) + damage;
  target.setAttribute(Shared.DAMAGE_DEALT_ATTRIBUTE, dealt);
}

/** First titan down: corpse now, lootable only once both are down (estimate). Deaths are
 * counted on the session's two principals, so order and timing cannot lose the kill. */
function titanDied(event) {
  const { npc } = event;
  if (!Shared.isLiveTitan(npc.getId())) return;
  const session = sessionOfNpc(npc);
  if (!session || session.over === true) return;
  if (npc !== session.branda && npc !== session.eldric) {
    // Stray duplicate from a raced spawn: remove it, it is not part of the fight.
    if (npc.isRegistered()) core.World.getRemoveNPCQueue().push(npc);
    return;
  }
  // The corpse stays until the claim schedule removes it; the engine played inactive01 as
  // the death animation (npc-combat-defs), and the transformation follows it (captured).
  event.remains = { ticks: CORPSE_REMAINS_TICKS };
  npc.setAttribute(Shared.DYING_ATTRIBUTE, true);
  npc.getCombat().reset();
  npc.setNpcTransformationId(npc.getId() === Shared.BRANDA_ID ? Shared.BRANDA_CORPSE_ID : Shared.ELDRIC_CORPSE_ID);
  // Corpses face the arena: Branda south, Eldric north (captured face angles 0 / 1024).
  require("./Specials.RoyalTitans").faceAcross(npc);
  npc.setHitpoints(1);
  if (npc === session.branda) session.brandaDown = true;
  else session.eldricDown = true;
  if (!session.brandaDown || !session.eldricDown) {
    // The partner fights on alone from its static tile (captured: it teleports at once).
    const survivor = npc === session.branda ? session.eldric : session.branda;
    if (survivor) require("./Specials.RoyalTitans").teleportTitans(survivor);
    return;
  }
  killPair(session);
}

/** Both titans down: messages now, claims open, fallback schedule for no claim (estimate). */
function killPair(session) {
  if (session.over === true) return;
  session.over = true;
  session.killId = (session.killId ?? 0) + 1;
  session.claims = null;
  session.claimedBy = null;
  session.corpses = [session.branda, session.eldric].filter(Boolean);
  for (const npc of session.corpses) corpseKills.set(npc, session.killId);
  const now = core.World.getProcessCycle();
  const ticks = Math.max(0, now - session.spawnedAt - KILL_DURATION_OFFSET_TICKS);
  require("./Specials.RoyalTitans").endFight(session);
  require("./Hud.RoyalTitans").killed(session);
  // Base respawn even if nobody claims (the claim chain brings it forward).
  session.respawnAt = now + UNCLAIMED_DELAY_TICKS + Shared.CLAIM_SPAWN_TICKS;
  for (const player of [...session.players]) {
    if (!alive(player)) continue;
    recordKill(player, session, ticks);
  }
  const { world } = require("./Area.RoyalTitans");
  world.kills += 1;
  if (world.best <= 0 || ticks < world.best) world.best = ticks;
  // Unclaimed fallback [EST]: the claim schedule from kill + 19, minus message and drops.
  // Each timer belongs to this kill: a respawn starts a new fight these must not touch.
  const kill = session.killId;
  const unclaimed = (action) => () => {
    if (session.killId === kill && session.over && !session.claimedBy && !session.area.isDestroyed()) action();
  };
  later(UNCLAIMED_DELAY_TICKS + Shared.CLAIM_DEATH_TICKS, unclaimed(() => corpseDeathAnims(session)));
  later(UNCLAIMED_DELAY_TICKS + Shared.CLAIM_REMOVE_TICKS, unclaimed(() => removeCorpses(session)));
  later(UNCLAIMED_DELAY_TICKS + Shared.CLAIM_SPAWN_TICKS, unclaimed(() => {
    session.respawnAt = core.World.getProcessCycle();
  }));
}

function recordKill(player, session, ticks) {
  const own = player.getAttribute(Shared.KILLS_ATTRIBUTE) + 1;
  const total = CombatAchievements.killed(player, session, own, (kills) => announceKill(player, kills, ticks));
  player.setAttribute(Shared.KILLS_ATTRIBUTE, Math.max(own, total ?? 0));
  if (total == null) player.getPacketSender().sendConfig(Shared.TOTAL_KILLS_VARP, own);
}

function announceKill(player, kills, ticks) {
  player.sendMessage(`Your Royal Titans kill count is: <col=ff0000>${kills}</col>.`);
  const best = player.getAttribute(Shared.BEST_TICKS_ATTRIBUTE);
  if (!best || ticks < best) {
    player.setAttribute(Shared.BEST_TICKS_ATTRIBUTE, ticks);
    api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
    player.sendMessage(`Fight duration: <col=ff0000>${Shared.formatTicks(ticks)}</col> (new personal best)`);
  } else {
    player.sendMessage(`Fight duration: <col=ff0000>${Shared.formatTicks(ticks)}</col>. Personal best: ${Shared.formatTicks(best)}`);
  }
  player.sendMessage(Shared.ELIGIBLE_MESSAGE);
}

/** The engine's death roll, stashed per titan until its claim. */
function stashGenerated(event) {
  const session = sessionOfNpc(event.npc);
  if (!session || !Array.isArray(event.drops)) return;
  const id = event.npcId ?? event.npc.getId();
  if (id !== Shared.BRANDA_ID && id !== Shared.ELDRIC_ID) return;
  event.handled = true;
  session.stash = session.stash ?? {};
  session.stash[id] = [...event.drops];
  // Nothing is received at the death: emptying the roll keeps the collection log (which
  // reads it a microtask later) for the claim's own npc-drops:roll.
  event.drops.length = 0;
}

function validCorpse(npc, session) {
  if (!npc || !Shared.isCorpse(npc.getId()) || !session || session.over !== true) return false;
  // Stamped at the kill: lingering corpses from a previous kill are never claimable.
  return npc.isRegistered() && corpseKills.get(npc) === session.killId;
}

function unworthy(player, npc, option) {
  const name = npc.getId() === Shared.BRANDA_CORPSE_ID ? Shared.BRANDA_NAME : Shared.ELDRIC_NAME;
  const verb = option === "Loot" ? "loot" : option === "Sacrifice" ? "sacrifice" : "take pages from";
  player.sendMessage(`You do not feel worthy enough to ${verb} ${name}.`);
}

/** Scale a stash by contribution share (Wiki); pet/clues pass through untouched. */
function scaleDrops(drops, share, keepAlways) {
  const out = [];
  for (const drop of drops ?? []) {
    if (drop.itemId === PAGES_ITEM_ID) {
      if (keepAlways) out.push({ ...drop });
      continue;
    }
    if (share <= 0) continue;
    if (drop.itemId === BRAN_ITEM_ID || /clue scroll/i.test(drop.name ?? "")) {
      out.push({ ...drop });
      continue;
    }
    const scaled = share >= MIN_SHARE_PERCENT ? Math.max(1, Math.round(drop.amount * share)) : 1;
    if (scaled > 0) out.push({ ...drop, amount: scaled });
  }
  return out;
}

/**
 * Turns drops into the player's inventory, excess to the floor (Araxxor pattern) at the
 * claimed corpse, where the capture plays its titan's loot sound.
 */
function spawnDrops(player, session, corpse, drops) {
  const { Item, ItemDefinition } = core;
  const manager = api.getItemOnGroundManager();
  const where = corpse?.isRegistered() ? corpse.getLocation() : player.getLocation();
  const { area } = session;
  const inventory = player.getInventory();
  for (const drop of drops ?? []) {
    if (!Number.isInteger(drop.itemId) || drop.amount <= 0) continue;
    const noteId = ItemDefinition.forId(drop.itemId).getNoteId();
    const itemId = drop.noted && noteId >= 0 && ItemDefinition.forId(noteId).isNoted() ? noteId : drop.itemId;
    const stackable = ItemDefinition.forId(itemId).isStackable();
    if (stackable ? inventory.contains(itemId) || inventory.getFreeSlots() > 0 : inventory.getFreeSlots() >= drop.amount) {
      inventory.adds(itemId, drop.amount);
      continue;
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

/** One claim per player per kill: which corpse and option, or the refusal. */
function claim({ player, npc }, option) {
  const session = sessionOfNpc(npc);
  // A corpse can't be touched while its partner still fights.
  if (session && session.over !== true) return true;
  if (!validCorpse(npc, session)) return false;
  session.claims = session.claims ?? new Map();
  if (session.claims.has(keyOf(player))) {
    unworthy(player, npc, option);
    return true;
  }
  session.claims.set(keyOf(player), { corpse: npc.getId(), option });
  if (!session.claimedBy) {
    session.claimedBy = keyOf(player);
    startClaimSchedule(session);
  }
  const share = shareOf(session, player);
  if (option === "Loot") loot(player, session, npc, share);
  else if (option === "Sacrifice") sacrifice(player, session, npc);
  else pages(player, session, npc, share);
  return true;
}

/** Loot: two primary rolls (death roll + one extra), scaled; no pages; tertiary as rolled. */
function loot(player, session, npc, share) {
  const id = npc.getId() === Shared.BRANDA_CORPSE_ID ? Shared.BRANDA_ID : Shared.ELDRIC_ID;
  const stash = (session.stash ?? {})[id] ?? [];
  const extra = { player, npc, npcId: id, rolls: 1, drops: [] };
  api.emitCustomEvent("npc-drops:extra-rolls", extra);
  const drops = scaleDrops([...stash, ...extra.drops], share, false);
  player.performAnimation(new core.Animation(CLAIM_ANIMATION));
  later(Shared.CLAIM_LOOT_TICKS, () => {
    if (!player.isRegistered()) return;
    api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: id, drops });
    spawnDrops(player, session, npc, drops);
    player.getPacketSender().sendSoundEffect(Shared.CLAIM_SOUND[id], 1, 0);
  });
}

/** Sacrifice: forfeit drops (clues kept), Bran at 1/1500. */
function sacrifice(player, session, npc) {
  const id = npc.getId() === Shared.BRANDA_CORPSE_ID ? Shared.BRANDA_ID : Shared.ELDRIC_ID;
  const stash = (session.stash ?? {})[id] ?? [];
  const clues = stash.filter((drop) => /clue scroll/i.test(drop.name ?? ""));
  player.performAnimation(new core.Animation(CLAIM_ANIMATION));
  later(Shared.CLAIM_LOOT_TICKS, () => {
    if (!player.isRegistered()) return;
    const drops = [...clues];
    if (Math.random() < 1 / SACRIFICE_PET_RATE) {
      drops.push({ itemId: BRAN_ITEM_ID, amount: 1 });
    } else {
      player.sendMessage(Shared.SACRIFICE_MISS);
    }
    api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: id, drops });
    spawnDrops(player, session, npc, drops);
    player.getPacketSender().sendSoundEffect(Shared.CLAIM_SOUND[id], 1, 0);
  });
}

/** Take pages: 10-19 desiccated pages (estimated scaling) plus tertiary as rolled. */
function pages(player, session, npc, share) {
  const id = npc.getId() === Shared.BRANDA_CORPSE_ID ? Shared.BRANDA_ID : Shared.ELDRIC_ID;
  const stash = (session.stash ?? {})[id] ?? [];
  const tertiary = stash.filter((drop) =>
    drop.itemId === BRAN_ITEM_ID || /clue scroll/i.test(drop.name ?? ""));
  const dealt = combinedDamage(session, player);
  let amount = 0;
  if (dealt >= PAGES_FULL_DAMAGE) {
    amount = Math.max(1, Math.round(Shared.randomBetween(10, 19) * Math.max(share, 0.2)));
  } else if (dealt >= PAGES_MIN_DAMAGE) {
    amount = 1;
  }
  player.performAnimation(new core.Animation(CLAIM_ANIMATION));
  later(Shared.CLAIM_LOOT_TICKS, () => {
    if (!player.isRegistered()) return;
    const drops = [...tertiary];
    if (amount > 0) drops.push({ itemId: PAGES_ITEM_ID, amount });
    api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: id, drops });
    spawnDrops(player, session, npc, drops);
    player.getPacketSender().sendSoundEffect(Shared.CLAIM_SOUND[id], 1, 0);
  });
}

function combinedDamage(session, player) {
  let total = 0;
  for (const titan of [session.branda, session.eldric]) {
    const dealt = titan?.getAttribute(Shared.DAMAGE_DEALT_ATTRIBUTE) ?? {};
    total += dealt[keyOf(player)] ?? 0;
  }
  return total;
}

/** Claim-anchored schedule: message+drops, then death anims, dels, fresh spawn. */
function startClaimSchedule(session) {
  const kill = session.killId;
  const live = (action) => () => {
    if (session.killId === kill && session.over && !session.area.isDestroyed()) action();
  };
  later(Shared.CLAIM_MESSAGE_TICKS, () => {
    if (session.killId !== kill) return;
    for (const player of session.players) {
      if (player.isRegistered()) player.sendMessage(Shared.REINVIGORATE_MESSAGE);
    }
  });
  later(Shared.CLAIM_DEATH_TICKS, live(() => corpseDeathAnims(session)));
  later(Shared.CLAIM_REMOVE_TICKS, live(() => removeCorpses(session)));
  later(Shared.CLAIM_SPAWN_TICKS, live(() => {
    session.respawnAt = core.World.getProcessCycle();
  }));
}

function corpseDeathAnims(session) {
  const Specials = require("./Specials.RoyalTitans");
  for (const [npc, anims, floors] of [
    [session.branda, Shared.BRANDA_ANIMATIONS, [Shared.BRANDA_DEATH_FLOOR_1, Shared.BRANDA_DEATH_FLOOR_2]],
    [session.eldric, Shared.ELDRIC_ANIMATIONS, [Shared.ELDRIC_DEATH_FLOOR_1, Shared.ELDRIC_DEATH_FLOOR_2]],
  ]) {
    if (!npc?.isRegistered()) continue;
    npc.performAnimation(new core.Animation(anims.death));
    if (npc.getId() === Shared.BRANDA_CORPSE_ID) {
      npc.performGraphic(new core.Graphic(Shared.BRANDA_CAST_GFX.death));
    }
    const at = npc.getLocation();
    Specials.addLoc(session, floors[0], at.getX() - 1, at.getY(), 10, 0);
    Specials.addLoc(session, floors[1], at.getX() + 3, at.getY(), 10, 0);
  }
}

function removeCorpses(session) {
  for (const key of ["branda", "eldric"]) {
    const npc = session[key];
    if (npc?.isRegistered()) core.World.getRemoveNPCQueue().push(npc);
    session[key] = null;
  }
  session.respawnAt = core.World.getProcessCycle() + 2;
}

const claimLoot = (event) => claim(event, "Loot");
const claimSacrifice = (event) => claim(event, "Sacrifice");
const claimPages = (event) => claim(event, "Take pages");

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onNpcDeath(titanDied);
  pluginApi.onCustomEvent("npc-drops:generated", stashGenerated);
  pluginApi.onCombatHitResolved(trackDamage);
  pluginApi.onNpcsInteraction([Shared.BRANDA_NAME, Shared.ELDRIC_NAME], {
    Loot: claimLoot, Sacrifice: claimSacrifice, "Take pages": claimPages,
  });
}

module.exports = {
  attach,
  _test: { shareOf, scaleDrops, spawnDrops },
};
