"use strict";

const C = require("./Context.Hunter");
const { H, ANIM, level, requireLevel, hasTool, distance, nearby, active, available, roll, rewardItems,
  exchange, catchExchange, drop, xp, chance, begin, hide, removeObject, questComplete, questStage } = C;

// The trap timer the client draws over a laid trap (cache script add_overlaytimer_loc): coord, loc,
// shape, timer id, ticks, colour, 1. Yellow while it waits, green on a catch, red when it failed
// (rsprox captures 119, 1102, 1104, 1108, 1871, 4002).
const TIMER_SCRIPT = 5474;
const TIMER_ID = 4;
const TIMER_COLOURS = { idle: 16765184, caught: 2031427, failed: 16711696 };
// A caught or missed creature shows the trapping/failing loc this many ticks before the full or failed one.
const CLOSING_TICKS = 2;
// Reset lays the trap again three ticks after the dismantle (captures 1108, 1871, 4002).
const RESET_LAY_TICKS = 3;
const DISMANTLE_SOUND = 2632;
// rsprox captures play the net dismantle sound with the animation, 25 client cycles late.
const NET_DISMANTLE_SOUND_DELAY = 25;
const TRAP_SOUND_RADIUS = 10;

function find(object) {
  for (const trap of H.traps) {
    if (trap.area === object.getPrivateArea() && trap.objects.some(o => o.getLocation().equals(object.getLocation()))) return trap;
  }
  return null;
}

function owned(player, object) {
  const trap = find(object);
  if (!trap) return null;
  if (trap.player !== player) { player.sendMessage("This isn't your trap."); return null; }
  if (!trap.objects.some(o => o.getId() === object.getId() && o.getLocation().equals(object.getLocation()))) return null;
  return trap;
}

function limit(player, kind) {
  if (kind === "rabbit") return Math.min(5, Math.max(2, 1 + Math.floor(level(player) / 20)));
  if (H.data.traps[kind].max) return H.data.traps[kind].max;
  // The 19 August 2026 Hunter update permits two traps from level 1.
  return Math.min(5, Math.max(2, 1 + Math.floor(level(player) / 20)))
    + (player.getWildernessLevel() > 0 ? 1 : 0);
}

function materials(def, player) {
  const I = H.core.ItemIdentifiers;
  if (def.inputs) return def.inputs;
  if (def.tree) return [[I.ROPE, 1], [I.SMALL_FISHING_NET, 1]];
  if (def.logs) return [[player ? [I.LOGS, I.OAK_LOGS, I.WILLOW_LOGS, I.TEAK_LOGS, I.MAPLE_LOGS, I.MAHOGANY_LOGS, I.YEW_LOGS, I.MAGIC_LOGS]
    .find(id => player.getInventory().contains(id)) ?? I.LOGS : I.LOGS, 1]];
  return [[def.item, 1]];
}

// The Wiki asks for partial completion of Eagles' Peak: Nickolaus teaches box traps at the camp.
// EaglesPeak.Quest.js's stage table: 6 (STAGE_RESCUED) puts him at the camp for the ferret lesson,
// 8 completes the quest. The quest runtime keeps the stage in this attribute, so the stage alone
// decides (questComplete's ">= 2" fallback would let stages 2-5 through).
// ponytail: no captured refusal; the message is ours.
const EAGLES_PEAK_BOX_TRAP_STAGE = 6;

function boxTrapsUnlocked(player) {
  return questStage(player, "eagles_peak") >= EAGLES_PEAK_BOX_TRAP_STAGE;
}

function canLay(player, kind, location, base, ground) {
  const def = H.data.traps[kind];
  const pit = kind === "pit" && base ? H.data.creatures.find(c => c.trap === "pit"
    && H.core.CacheDefinitions.getObject(base.getId()).transforms?.includes(c.caught)) : null;
  if (!active(player) || !requireLevel(player, pit ? pit.level : def.level)) return false;
  if (def.knife && !hasTool(player, H.core.ItemIdentifiers.KNIFE)) { player.sendMessage(def.refusal ?? "You need a knife and logs to build this trap."); return false; }
  const traps = [...H.traps].filter(t => t.player === player);
  const count = def.max ? traps.filter(t => t.kind === kind).length : traps.filter(t => !H.data.traps[t.kind].max).length;
  const max = limit(player, kind);
  if (count >= max) { player.sendMessage(`You may set up only ${max === 1 ? "one trap" : `${max} traps`} at a time at your Hunter level.`); return false; }
  if (base ? !H.core.MapObjects.exists(base) || find(base) :
    H.core.MapObjects.getType(location, 10, player.getPrivateArea()) || H.core.MapObjects.getType(location, 22, player.getPrivateArea())
    || H.core.RegionManager.blocked(location, player.getPrivateArea())) {
    player.sendMessage("You can't set up a trap here."); return false;
  }
  if (kind === "monkey" && (!hasTool(player, H.core.ItemIdentifiers.KRUK_MONKEY_GREEGREE) || !questComplete(player, "monkey_madness_ii"))) {
    player.sendMessage("You need Monkey Madness II and a Kruk monkey greegree to hunt here."); return false;
  }
  if (kind === "box" && !boxTrapsUnlocked(player)) {
    player.sendMessage("You need to learn how to use box traps from Nickolaus during Eagles' Peak."); return false;
  }
  // The trap the player laid (or clicked) must still be on the floor; another one on the same tile doesn't count.
  if (ground) return !ground.isPendingRemoval?.();
  if (!exchange(player, materials(def, player), [], false)) { player.sendMessage(def.refusal ?? "You don't have the materials to set this trap."); return false; }
  return true;
}

function spawn(trap, id, location, type = 10, face = 0) {
  const object = new H.core.GameObject(id, location.clone(), type, face, trap.area);
  H.core.ObjectManager.register(object, true);
  trap.objects.push(object);
  return object;
}

function setState(trap, state, creature = null, animatedId = null) {
  for (const object of trap.objects) removeObject(object);
  trap.objects.length = 0;
  trap.state = state;
  trap.creature = creature;
  trap.expires = H.tick + 100;
  const def = H.data.traps[trap.kind];
  const id = animatedId ?? (state === "caught" ? creature.caught : state === "failed" ? def.fail : def.idle);
  const base = trap.base;
  if (def.tree) {
    spawn(trap, def.idleTree, base.getLocation(), base.getType(), base.getFace());
    const [dx, dy] = [[0, 1], [1, 0], [0, -1], [-1, 0]][base.getFace() & 3];
    const loc = base.getLocation().clone().add(dx, dy);
    spawn(trap, id, loc, base.getType(), base.getFace());
  } else {
    spawn(trap, id, trap.location, base?.getType() ?? 10, base?.getFace() ?? 0);
  }
  sendTimer(trap);
}

function sendTimer(trap) {
  const colour = TIMER_COLOURS[trap.state];
  if (colour === undefined || trap.kind === "pit") return;
  const object = trap.objects.at(-1), at = object.getLocation();
  const coordinate = (at.getZ() << 28) | (at.getX() << 14) | at.getY();
  trap.player.getPacketSender().sendClientScript(TIMER_SCRIPT, coordinate, object.getId(), object.getType(), TIMER_ID,
    trap.expires - H.tick + 1, colour, 1);
}

function trapSound(trap, soundId) {
  if (!soundId) return;
  const at = trap.objects.at(-1)?.getLocation() ?? trap.location;
  H.core.Sounds.playAreaSound({ soundId, x: at.getX(), y: at.getY(), level: at.getZ(), radius: TRAP_SOUND_RADIUS });
}

/**
 * Laying, from rsprox captures (box 4002, 1104, 1108; bird snare 70, 1102, 1788; nets 1108, 1115, 1858;
 * deadfall 1105, 1108, 1757): the animation, the set-up sound and the spam line come at once. A trap
 * from the inventory goes on the floor until the loc replaces it (box 2 ticks, bird snare 3); a tree
 * or boulder turns into its setting loc and the trap stands a tick later.
 */
function lay(player, kind, location, base = null, ground = null) {
  if (!nearby(player, base ?? { getPrivateArea: () => player.getPrivateArea(), getLocation: () => location }, 2)
    || !canLay(player, kind, location, base, ground)) return;
  const def = H.data.traps[kind];
  let placed = ground, setting = null;
  const restore = () => {
    if (!setting) return;
    removeObject(setting); setting = null;
    H.core.ObjectManager.register(base, true);
  };
  if (!begin(player, def.layTicks ?? 3, def.animation, () => {
    restore();
    if (!canLay(player, kind, location, base, placed)) return;
    if (placed) {
      H.core.ItemOnGroundManager.deregister(placed);
      if (placed.getItem().getAmount() > 1) drop(player, [[placed.getItem().getId(), placed.getItem().getAmount() - 1]], location);
    } else if (!exchange(player, materials(def, player), [])) return;
    const trap = { player, kind, location: location.clone(), area: player.getPrivateArea(), base, objects: [],
      state: "idle", expires: H.tick + 100, next: H.tick + 5, npc: null, bait: null, smoked: false, rewards: null };
    if (!["rabbit","pit"].includes(kind) && !def.noSmoke && player.getInventory().contains(H.core.ItemIdentifiers.ANTI_ODOUR_SALT)
      && exchange(player, [[H.core.ItemIdentifiers.ANTI_ODOUR_SALT, 1]], [])) trap.smoked = true;
    H.traps.add(trap);
    if (base) H.core.ObjectManager.deregister(base, true);
    setState(trap, "idle");
    if (def.item) player.performAnimation(new H.core.Animation(def.animation));
    if (kind === "pit") player.getPacketSender().sendSound(def.laySound, 1, 0);
    if (!base) {
      const queue = player.getMovementQueue();
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (queue.canWalk(dx, dy)) { queue.walkStep(dx, dy); break; }
      }
    }
  }, restore)) return;
  if (!placed && def.item && exchange(player, [[def.item, 1]], [])) {
    placed = H.core.ItemOnGroundManager.registerLocation(player, new H.core.Item(def.item, 1), location.clone());
  }
  if (base && def.setting) {
    H.core.ObjectManager.deregister(base, true);
    setting = new H.core.GameObject(def.setting, base.getLocation().clone(), base.getType(), base.getFace(), base.getPrivateArea());
    H.core.ObjectManager.register(setting, true);
    if (def.settingAnimation) {
      for (const viewer of new Set([player, ...(H.core.World.getNearbyPlayersForUpdate?.(player) ?? [])])) {
        viewer.getPacketSender().sendObjectAnimation(setting, new H.core.Animation(def.settingAnimation));
      }
    }
  }
  if (def.laySound && kind !== "pit") {
    if (def.layAreaSound) trapSound({ objects: [], location: base?.getLocation() ?? location }, def.laySound);
    else player.getPacketSender().sendSound(def.laySound, 1, 0);
  }
  const message = def.layMessage ?? (def.item ? "You begin setting up the trap." : null);
  if (message) player.getPacketSender().sendTypedMessage(H.core.ChatType.SPAM, message);
}

function releasePrey(trap) {
  if (trap.npc && H.reserved.get(trap.npc) === trap) {
    H.reserved.delete(trap.npc);
    trap.npc.getMovementQueue().reset();
  }
  trap.npc = null;
}

function remove(trap) {
  releasePrey(trap);
  H.traps.delete(trap);
  for (const object of trap.objects) removeObject(object);
  trap.objects.length = 0;
  if (trap.base) H.core.ObjectManager.register(trap.base, true);
}

function returnedItems(trap) {
  const def = H.data.traps[trap.kind];
  const items = def.logs || def.inputs ? [] : materials(def);
  if (trap.state === "caught" && trap.kind === "magic") return [];
  if (trap.bait && trap.state !== "caught") items.push([trap.bait.id, trap.bait.amount]);
  return items;
}

/**
 * Check, Dismantle and Reset, from rsprox captures (box 119, 120, 1108, 4051; bird snare 1102, 1788;
 * nets 1108, 1128, 1858; deadfall 1105, 1757; pitfalls 1108, 1757): the trap's own dismantle animation,
 * then two ticks later the dismantle sound, "You dismantle the trap." and the named catch, all spam.
 * Pitfalls send the dismantle line at once and the catch a tick later. Reset lays it again after that.
 */
function collect(event, reset = false, check = true) {
  const { player, object } = event;
  if (!find(object)) return false;
  const trap = owned(player, object);
  if (!trap || !nearby(player, object)) return true;
  if (["luring", "closing"].includes(trap.state)) { player.sendMessage("Wait until the creature has finished investigating your trap."); return true; }
  if (check && trap.state !== "caught") return true;
  const rewards = trap.state === "caught" ? (trap.rewards ??= rewardsFor(player, trap)) : [];
  const items = returnedItems(trap).concat(rewards);
  if (!catchExchange(player, [], items, false)) { player.getInventory().full(); return true; }
  const def = H.data.traps[trap.kind];
  if (!begin(player, def.dismantleTicks ?? 2, def.dismantle ?? ANIM.TAKE, () => {
    if (!H.traps.has(trap) || !owned(player, object) || !catchExchange(player, [], items)) return;
    if (trap.state === "caught") xp(player, trap.xp ?? trap.creature.xp, trap.kind, trap.creature.npc);
    const { kind, location, base } = trap;
    remove(trap);
    if (!def.dismantleSoundFirst) player.getPacketSender().sendSound(def.dismantleSound ?? DISMANTLE_SOUND, 1, 0);
    for (const line of dismantleLines(trap).slice(def.dismantleTicks === 1 ? 1 : 0)) {
      player.getPacketSender().sendTypedMessage(H.core.ChatType.SPAM, line);
    }
    if (reset) begin(player, RESET_LAY_TICKS, null, () => lay(player, kind, location, base));
  })) return true;
  if (def.dismantleSoundFirst) player.getPacketSender().sendSound(DISMANTLE_SOUND, 1, NET_DISMANTLE_SOUND_DELAY);
  if (def.dismantleTicks === 1) player.getPacketSender().sendTypedMessage(H.core.ChatType.SPAM, "You dismantle the trap.");
  return true;
}

/** "You dismantle the trap." and, for a catch, the creature it held. */
function dismantleLines(trap) {
  if (trap.state !== "caught") return ["You dismantle the trap."];
  const custom = H.data.catchLines[trap.creature.npc];
  if (custom) return custom;
  const name = String(trap.creature.name ?? H.core.CacheDefinitions.getNpc(trap.creature.npc)?.name ?? "creature").toLowerCase();
  const article = /^[aeiou]/.test(name) ? "an" : "a";
  return ["You dismantle the trap.", `You've caught ${article} ${name}${H.data.traps[trap.kind].caughtSuffix ?? "."}`];
}

function check(event) { return collect(event, false, true); }
function dismantle(event) { return collect(event, false, false); }
function reset(event) { return collect(event, true, false); }

function investigate({ player, object }) {
  if (!find(object)) return false;
  const trap = owned(player, object);
  if (trap) player.sendMessage(`Your trap is ${trap.state}. ${trap.bait ? "It has been baited." : "It has no bait."} ${trap.smoked ? "Its scent is masked." : "Your scent lingers around it."}`);
  return true;
}

function activate({ player, itemId }) {
  const kind = Object.keys(H.data.traps).find(key => H.data.traps[key].item === itemId);
  if (!kind) return false;
  lay(player, kind, player.getLocation());
  return true;
}

function groundActivate({ player, groundItem, groundItemId }) {
  const kind = Object.keys(H.data.traps).find(key => H.data.traps[key].item === groundItemId);
  if (!kind) return false;
  lay(player, kind, groundItem.getPosition(), null, groundItem);
  return true;
}

function build({ player, object, objectId }) {
  const O = H.core.ObjectIdentifiers;
  const kind = Object.keys(H.data.traps).find(key => H.data.traps[key].tree === objectId)
    ?? ([O.BOULDER_14, O.BOULDER_15].includes(objectId) ? "deadfall" : objectId === O.LARGE_BOULDER ? "monkey" : null);
  if (!kind) return false;
  lay(player, kind, object.getLocation(), object);
  return true;
}

function bait(event) {
  const { player, object, itemId } = event;
  if (!find(object)) return;
  event.handled = true;
  const trap = owned(player, object);
  if (!trap || trap.state !== "idle" || !nearby(player, object)) return;
  const I = H.core.ItemIdentifiers;
  const def = H.data.traps[trap.kind];
  if ([I.LIT_TORCH, I.BRUMA_TORCH].includes(itemId)) {
    // TSPS wording: no recording shows the refusal on a tecu salamander's trap.
    if (def.noSmoke) { player.sendMessage("Nothing interesting happens."); return; }
    trap.smoked = true;
    player.performAnimation(new H.core.Animation(ANIM.SMALL));
    player.sendMessage("You mask your scent with smoke.");
    return;
  }
  if (itemId === I.UNLIT_TORCH) { player.sendMessage("You must light the torch first."); return; }
  // Wiki preferred bait per creature: deadfall kebbits/pyre fox, box chinchompas.
  const N = H.core.NpcIdentifiers;
  const deadfallBaits = { [N.WILD_KEBBIT]: I.RAW_BEEF,
    [N.BARB_TAILED_KEBBIT]: I.RAW_RAINBOW_FISH,
    [N.PRICKLY_KEBBIT]: I.BARLEY,
    [N.SABRE_TOOTHED_KEBBIT]: I.RAW_BEEF,
    [N.PYRE_FOX]: I.JERBOA_TAIL };
  const boxBaits = { [N.CHINCHOMPA]: I.SPICY_TOMATO,
    [N.CARNIVOROUS_CHINCHOMPA]: I.SPICY_MINCED_MEAT,
    [N.BLACK_CHINCHOMPA]: I.SPICY_MINCED_MEAT };
  const baits = { ...deadfallBaits, ...boxBaits };
  const accepted = def.noBait ? false : def.bait ? itemId === def.bait
    : trap.kind === "magic" ? [I.RED_BEAD, I.YELLOW_BEAD, I.BLACK_BEAD, I.WHITE_BEAD].includes(itemId)
    : Object.values(trap.kind === "deadfall" ? deadfallBaits : trap.kind === "box" ? boxBaits : {}).includes(itemId);
  if (!accepted) { player.sendMessage("That isn't suitable bait for this trap."); return; }
  if (trap.bait) { player.sendMessage("This trap is already baited."); return; }
  const amount = def.bait ? 5 : 1;
  if (!exchange(player, [[itemId, amount]], [])) { player.sendMessage(`You need ${amount} of that bait.`); return; }
  trap.bait = { id: itemId, amount, baits };
  player.performAnimation(new H.core.Animation(ANIM.SMALL));
  player.sendMessage("You bait the trap.");
}

function eligible(trap, npc, creature) {
  if (!creature || creature.trap !== trap.kind || !available(npc) || npc.getPrivateArea() !== trap.area || level(trap.player) < creature.level) return false;
  if (trap.kind === "box" && !boxTrapsUnlocked(trap.player)) return false;
  if (trap.player.getLocation().equals(trap.location)) return false;
  if (trap.base && trap.kind === "pit" && !H.core.CacheDefinitions.getObject(trap.base.getId()).transforms?.includes(creature.caught)) return false;
  if (trap.kind === "deadfall" && (creature.npc === H.core.NpcIdentifiers.PYRE_FOX) !== (trap.location.getX() < 2000)) return false;
  if (npc.getCombat().getTarget() || npc.getCombat().getAttacker()) return false;
  const range = trap.kind === "bird" || trap.kind === "magic" ? 2 : 3;
  return distance(npc.getLocation(), trap.location) <= range;
}

/**
 * A catch shows the creature's trapping loc and a miss the failing loc, with the trap's catch sound,
 * then the full or failed trap two ticks later (rsprox captures: box 1104, 1108, 1871, 4051; bird
 * snare 1102; nets 1108, 1858; deadfall 1105). Live sends no message for either.
 */
function attempt(trap) {
  const { npc } = trap;
  const creature = H.data.creatures.find(c => c.npc === npc.getId());
  if (!creature) { releasePrey(trap); setState(trap, "idle"); return; }
  const bonus = trap.bait && (trap.kind === "magic" || H.data.traps[trap.kind].bait || trap.bait.baits?.[creature.npc] === trap.bait.id) ? 3 / 256 : 0;
  const success = chance(trap.player, creature, bonus + (trap.smoked ? 2 / 256 : 0));
  releasePrey(trap);
  const closing = closingLoc(trap, creature, success);
  if (closing) {
    trap.closing = { due: H.tick + CLOSING_TICKS, success, creature };
    setState(trap, "closing", null, closing);
    trapSound(trap, H.data.traps[trap.kind].trappingSound);
  } else setState(trap, success ? "caught" : "failed", success ? creature : null);
  if (success) {
    hide(npc);
    trap.bait = null;
  }
}

/** The loc a trap shows while it closes: the cache's trapping/catching loc of the catch, or the trap's failing loc. */
function closingLoc(trap, creature, success) {
  const O = H.core.ObjectIdentifiers, def = H.data.traps[trap.kind];
  if (trap.kind === "monkey") return success ? O.LARGE_BOULDER_3 : null;
  if (!success) return creature.npc === H.core.NpcIdentifiers.PYRE_FOX ? null : def.failing ?? null;
  const full = H.core.CacheDefinitions.getLocNames().get(creature.caught) ?? "";
  const stage = full.replace(/_full_/, full.startsWith("hunting_sapling_") ? "_catching_" : "_trapping_");
  if (stage === full) return null;
  return H.core.CacheDefinitions.getLocId(trap.kind === "box" ? `${stage}_${heading(trap)}` : stage) ?? null;
}

/** Which side of the box the creature came from, by where it was when it was lured. */
function heading(trap) {
  const from = trap.luredFrom ?? trap.location;
  const dx = from.getX() - trap.location.getX(), dy = from.getY() - trap.location.getY();
  return Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? "n" : "s") : (dx > 0 ? "e" : "w");
}

function process() {
  for (const trap of H.traps) {
    if (trap.area !== trap.player.getPrivateArea()) {
      // The owner changed instance: recover reusable tools rather than leave them in an
      // inaccessible area.
      for (const item of returnedItems(trap)) if (!exchange(trap.player, [], [item])) drop(trap.player, [item], trap.player.getLocation());
      remove(trap);
      continue;
    }
    if (H.tick >= trap.expires) {
      drop(trap.player, returnedItems(trap), trap.location, trap.area);
      remove(trap);
      const [message, type] = H.data.traps[trap.kind].collapse ?? ["Your trap has collapsed.", H.core.ChatType.GAME];
      trap.player.getPacketSender().sendTypedMessage(type, message);
      continue;
    }
    if (trap.state === "closing") {
      if (H.tick >= trap.closing.due) {
        const { success, creature } = trap.closing;
        trap.closing = null;
        setState(trap, success ? "caught" : "failed", success ? creature : null);
        if (success) trapSound(trap, H.data.traps[trap.kind].fullSound);
      }
    } else if (trap.state === "luring") {
      const npc = trap.npc;
      if (!npc?.isRegistered() || !npc.isVisible() || npc.getHitpoints() <= 0 || H.tick - trap.luredAt >= 12) {
        releasePrey(trap); setState(trap, "idle");
      } else if (distance(npc.getLocation(), trap.location) <= (H.data.traps[trap.kind].tree || trap.kind === "deadfall" ? 1 : 0)) attempt(trap);
    } else if (trap.state === "idle" && !["pit", "rabbit"].includes(trap.kind) && H.tick >= trap.next) {
      trap.next = H.tick + lureInterval(trap);
      for (const npc of H.core.World.getNearbyNpcsForUpdate(trap.objects[0])) {
        const creature = H.data.creatures.find(c => c.npc === npc.getId());
        if (!eligible(trap, npc, creature)) continue;
        H.reserved.set(npc, trap);
        trap.npc = npc;
        trap.state = "luring";
        trap.luredAt = H.tick;
        trap.luredFrom = npc.getLocation().clone();
        H.core.PathFinder.calculateWalkRoute(npc, trap.location.getX(), trap.location.getY());
        break;
      }
    }
  }
}

/** The catch's loot and XP, as content may change them ("hunter:rewards", a league relic's doubled box traps). */
function rewardsFor(player, trap) {
  const request = { player, kind: trap.kind, npcId: trap.creature.npc, rewards: catchRewards(trap), xp: trap.creature.xp };
  H.api.emitCustomEvent("hunter:rewards", request);
  trap.xp = request.xp;
  return request.rewards;
}

/** Ticks between an idle trap's looks for prey, as content may shorten them ("hunter:lure-interval"). */
function lureInterval(trap) {
  const request = { player: trap.player, kind: trap.kind, ticks: 5 };
  H.api.emitCustomEvent("hunter:lure-interval", request);
  return Math.max(1, request.ticks | 0);
}

function catchRewards(trap) {
  const I = H.core.ItemIdentifiers, N = H.core.NpcIdentifiers;
  const items = rewardItems(trap.creature.loot);
  if (trap.kind === "tecu" && roll(1, 1000) === 1) items[0][0] = I.TECU_SALAMANDER;
  if (trap.kind === "monkey" && roll(1, 5000) === 1) items[0][0] = I.MONKEY_TAIL;
  const furs = { [N.SPINED_LARUPIA]: [I.LARUPIA_FUR, I.TATTY_LARUPIA_FUR, I.RAW_LARUPIA],
    [N.HORNED_GRAAHK]: [I.GRAAHK_FUR, I.TATTY_GRAAHK_FUR, I.RAW_GRAAHK],
    [N.SABRE_TOOTHED_KYATT]: [I.KYATT_FUR, I.TATTY_KYATT_FUR, I.RAW_KYATT] };
  const fur = furs[trap.creature.npc];
  if (fur) {
    // ponytail: no published tatty-fur curve; a linear 0-255 level roll is an estimate.
    if (Math.random() >= C.probability(0, 255, level(trap.player))) items.find(item => item[0] === fur[0])[0] = fur[1];
    items.push([fur[2], 1]);
  }
  return items;
}

function cleanup({ player }) {
  for (const trap of H.traps) {
    if (trap.player !== player) continue;
    drop(player, returnedItems(trap), trap.location, trap.area);
    remove(trap);
  }
}

module.exports = { activate, groundActivate, build, check, dismantle, reset, investigate, bait, process, cleanup,
  find, owned, limit, materials, remove, lay, setState, returnedItems };
