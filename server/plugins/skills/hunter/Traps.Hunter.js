"use strict";

const C = require("./Context.Hunter");
const { H, ANIM, level, requireLevel, hasTool, distance, nearby, active, available, roll, rewardItems,
  exchange, drop, xp, chance, begin, hide, removeObject, questComplete } = C;

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
  return Math.min(5, 1 + Math.floor(level(player) / 20))
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

function canLay(player, kind, location, base, ground) {
  const def = H.data.traps[kind];
  const pit = kind === "pit" && base ? H.data.creatures.find(c => c.trap === "pit"
    && H.core.CacheDefinitions.getObject(base.getId()).transforms?.includes(c.caught)) : null;
  if (!active(player) || !requireLevel(player, pit ? pit.level : def.level)) return false;
  if (def.knife && !hasTool(player, H.core.ItemIdentifiers.KNIFE)) { player.sendMessage("You need a knife and logs to build this trap."); return false; }
  const traps = [...H.traps].filter(t => t.player === player);
  const count = def.max ? traps.filter(t => t.kind === kind).length : traps.filter(t => !H.data.traps[t.kind].max).length;
  if (count >= limit(player, kind)) { player.sendMessage("You have already laid the maximum number of traps for your Hunter level."); return false; }
  if (base ? !H.core.MapObjects.exists(base) || find(base) :
    H.core.MapObjects.getType(location, 10, player.getPrivateArea()) || H.core.MapObjects.getType(location, 22, player.getPrivateArea())
    || H.core.RegionManager.blocked(location, player.getPrivateArea())) {
    player.sendMessage("You can't lay a trap here."); return false;
  }
  if (ground) return H.core.ItemOnGroundManager.getGroundItem(player.getUsername(), def.item, location, player.getPrivateArea()) === ground;
  if (kind === "monkey" && (!hasTool(player, H.core.ItemIdentifiers.KRUK_MONKEY_GREEGREE) || !questComplete(player, "monkey_madness_ii"))) {
    player.sendMessage("You need Monkey Madness II and a Kruk monkey greegree to hunt here."); return false;
  }
  if (!exchange(player, materials(def, player), [], false)) { player.sendMessage("You don't have the materials to set this trap."); return false; }
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
}

function lay(player, kind, location, base = null, ground = null) {
  if (!nearby(player, base ?? { getPrivateArea: () => player.getPrivateArea(), getLocation: () => location }, 2)
    || !canLay(player, kind, location, base, ground)) return;
  begin(player, 3, H.data.traps[kind].animation, () => {
    if (!canLay(player, kind, location, base, ground)) return;
    if (ground) {
      H.core.ItemOnGroundManager.deregister(ground);
      if (ground.getItem().getAmount() > 1) drop(player, [[ground.getItem().getId(), ground.getItem().getAmount() - 1]], location);
    } else if (!exchange(player, materials(H.data.traps[kind], player), [])) return;
    const trap = { player, kind, location: location.clone(), area: player.getPrivateArea(), base, objects: [],
      state: "idle", expires: H.tick + 100, next: H.tick + 5, npc: null, bait: null, smoked: false, rewards: null };
    if (!["rabbit","pit"].includes(kind) && player.getInventory().contains(H.core.ItemIdentifiers.ANTI_ODOUR_SALT)
      && exchange(player, [[H.core.ItemIdentifiers.ANTI_ODOUR_SALT, 1]], [])) trap.smoked = true;
    H.traps.add(trap);
    if (base) H.core.ObjectManager.deregister(base, true);
    setState(trap, "idle");
    if (!base) {
      const queue = player.getMovementQueue();
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (queue.canWalk(dx, dy)) { queue.walkStep(dx, dy); break; }
      }
    }
    player.sendMessage("You set up the trap.");
  });
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

function collect(event, reset = false, check = true) {
  const { player, object } = event;
  if (!find(object)) return false;
  const trap = owned(player, object);
  if (!trap || !nearby(player, object)) return true;
  if (["luring", "closing"].includes(trap.state)) { player.sendMessage("Wait until the creature has finished investigating your trap."); return true; }
  if (check && trap.state !== "caught") return true;
  const rewards = trap.state === "caught" ? (trap.rewards ??= catchRewards(trap)) : [];
  const items = returnedItems(trap).concat(rewards);
  if (!exchange(player, [], items, false)) { player.getInventory().full(); return true; }
  begin(player, 2, ANIM.TAKE, () => {
    if (!H.traps.has(trap) || !owned(player, object) || !exchange(player, [], items)) return;
    if (trap.state === "caught") xp(player, trap.creature.xp, trap.kind, trap.creature.npc);
    const { kind, location, base } = trap;
    remove(trap);
    player.sendMessage(check ? "You check the trap and collect your catch." : "You dismantle the trap.");
    if (reset) lay(player, kind, location, base);
  });
  return true;
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
  if ([I.LIT_TORCH, I.BRUMA_TORCH].includes(itemId)) {
    trap.smoked = true;
    player.performAnimation(new H.core.Animation(ANIM.SMALL));
    player.sendMessage("You mask your scent with smoke.");
    return;
  }
  if (itemId === I.UNLIT_TORCH) { player.sendMessage("You must light the torch first."); return; }
  const def = H.data.traps[trap.kind];
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
  const accepted = def.bait ? itemId === def.bait
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
  if (trap.kind === "box" && !questComplete(trap.player, "eagles_peak")) return false;
  if (trap.player.getLocation().equals(trap.location)) return false;
  if (trap.base && trap.kind === "pit" && !H.core.CacheDefinitions.getObject(trap.base.getId()).transforms?.includes(creature.caught)) return false;
  if (trap.kind === "deadfall" && (creature.npc === H.core.NpcIdentifiers.PYRE_FOX) !== (trap.location.getX() < 2000)) return false;
  if (npc.getCombat().getTarget() || npc.getCombat().getAttacker()) return false;
  const range = trap.kind === "bird" || trap.kind === "magic" ? 2 : 3;
  return distance(npc.getLocation(), trap.location) <= range;
}

function attempt(trap) {
  const { npc } = trap;
  const creature = H.data.creatures.find(c => c.npc === npc.getId());
  if (!creature) { releasePrey(trap); setState(trap, "idle"); return; }
  const bonus = trap.bait && (trap.kind === "magic" || H.data.traps[trap.kind].bait || trap.bait.baits?.[creature.npc] === trap.bait.id) ? 3 / 256 : 0;
  const success = chance(trap.player, creature, bonus + (trap.smoked ? 2 / 256 : 0));
  releasePrey(trap);
  const O = H.core.ObjectIdentifiers;
  const closing = trap.kind === "deadfall" ? creature.npc === H.core.NpcIdentifiers.PYRE_FOX
    ? success ? O.DEADFALL_11 : null : success ? O.DEADFALL_2 : O.DEADFALL_10
    : trap.kind === "monkey" && success ? O.LARGE_BOULDER_3 : null;
  if (closing) {
    trap.closing = { due: H.tick + 2, success, creature };
    setState(trap, "closing", null, closing);
  } else setState(trap, success ? "caught" : "failed", success ? creature : null);
  if (success) {
    hide(npc);
    trap.bait = null;
    trap.player.sendMessage("Something has been caught in your trap!");
  }
}

function process() {
  for (const trap of H.traps) {
    if (H.tick >= trap.expires) {
      drop(trap.player, returnedItems(trap), trap.location, trap.area);
      remove(trap);
      trap.player.sendMessage("Your trap has collapsed.");
      continue;
    }
    if (trap.state === "closing") {
      if (H.tick >= trap.closing.due) {
        const { success, creature } = trap.closing;
        trap.closing = null;
        setState(trap, success ? "caught" : "failed", success ? creature : null);
      }
    } else if (trap.state === "luring") {
      const npc = trap.npc;
      if (!npc?.isRegistered() || !npc.isVisible() || npc.getHitpoints() <= 0 || H.tick - trap.luredAt >= 12) {
        releasePrey(trap); setState(trap, "idle");
      } else if (distance(npc.getLocation(), trap.location) <= (H.data.traps[trap.kind].tree || trap.kind === "deadfall" ? 1 : 0)) attempt(trap);
    } else if (trap.state === "idle" && !["pit", "rabbit"].includes(trap.kind) && H.tick >= trap.next) {
      trap.next = H.tick + 5;
      for (const npc of H.core.World.getNearbyNpcsForUpdate(trap.objects[0])) {
        const creature = H.data.creatures.find(c => c.npc === npc.getId());
        if (!eligible(trap, npc, creature)) continue;
        H.reserved.set(npc, trap);
        trap.npc = npc;
        trap.state = "luring";
        trap.luredAt = H.tick;
        H.core.PathFinder.calculateWalkRoute(npc, trap.location.getX(), trap.location.getY());
        break;
      }
    }
  }
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
