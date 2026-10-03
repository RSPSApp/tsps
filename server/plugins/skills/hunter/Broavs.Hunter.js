"use strict";

const C = require("./Context.Hunter"), { H } = C;
const traps = new Map(), released = new Map();

function owns(player) {
  const I = H.core.ItemIdentifiers;
  return [I.BROAV, I.UNCONSCIOUS_BROAV].some(id => C.hasTool(player, id)
    || Array.from({ length: H.core.Bank.TOTAL_BANK_TABS }, (_, tab) => player.getBank(tab)).some(bank => bank?.contains(id)))
    || [...released.values()].includes(player);
}

function permitted(player) {
  if (!C.requireLevel(player, 62)) return false;
  if (!C.questComplete(player, "while_guthix_sleeps") && !Number(player.getAttribute("quest.while_guthix_sleeps.stage"))) {
    player.sendMessage("Start While Guthix Sleeps before catching a broav."); return false;
  }
  if (owns(player)) { player.sendMessage("You already have a broav."); return false; }
  return true;
}

function base(object) { return H.core.CacheDefinitions.getObject(object.getId()).transforms?.[0] === H.core.ObjectIdentifiers.PIT_5; }

function build({ player, object }) {
  if (!base(object)) return false;
  if (!C.nearby(player, object) || !permitted(player)) return true;
  if ([...traps.values()].some(t => t.base.getLocation().equals(object.getLocation()) && t.base.getPrivateArea() === object.getPrivateArea())) return true;
  const I = H.core.ItemIdentifiers;
  const logs = require("./Traps.Hunter").materials({ logs: true }, player);
  if (!C.hasTool(player, I.KNIFE)) { player.sendMessage("You need a knife and logs."); return true; }
  C.begin(player, 3, C.ANIM.SET, () => {
    if ([...traps.values()].some(t => t.base.getLocation().equals(object.getLocation()) && t.base.getPrivateArea() === object.getPrivateArea()) || traps.has(player) || !permitted(player) || !C.hasTool(player, I.KNIFE) || !C.exchange(player, logs, [])) return;
    const trap = { base: object, player, state: "empty", due: H.tick + 100 };
    traps.set(player, trap); H.players.add(player);
    H.core.ObjectManager.deregister(object, true);
    transform(trap, H.core.ObjectIdentifiers.PIT_TRAP);
  });
  return true;
}

function transform(trap, id) {
  if (trap.object) C.removeObject(trap.object);
  trap.object = new H.core.GameObject(id, trap.base.getLocation().clone(), trap.base.getType(), trap.base.getFace(), trap.base.getPrivateArea());
  H.core.ObjectManager.register(trap.object, true);
}

function bait({ player, object }) {
  const trap = traps.get(player);
  if (object.getId() !== H.core.ObjectIdentifiers.PIT_TRAP) return false;
  if (!trap || trap.object !== object || trap.state !== "empty" || !C.nearby(player, object) || !permitted(player)) return true;
  C.begin(player, 2, C.ANIM.SMALL, () => {
    if (traps.get(player) !== trap || !permitted(player) || !C.exchange(player, [[H.core.ItemIdentifiers.MORT_MYRE_FUNGUS, 1]], [])) return;
    trap.state = "baited"; trap.capture = H.tick + C.roll(8, 20); trap.due = H.tick + 100;
    transform(trap, H.core.ObjectIdentifiers.BAITED_PIT_TRAP);
    const loc = trap.base.getLocation();
    trap.npc = H.api.spawnNpc({ id: H.core.NpcIdentifiers.WILD_BROAV, x: loc.getX() - 5, y: loc.getY() - 3, z: loc.getZ(), wanderRadius: 3 });
    if (trap.npc && player.getPrivateArea()) trap.npc.setArea(player.getPrivateArea());
  });
  return true;
}

function dismantle({ player, object }) {
  const trap = traps.get(player);
  if (object.getId() !== H.core.ObjectIdentifiers.COLLAPSED_TRAP_10 && object.getId() !== H.core.ObjectIdentifiers.PIT_TRAP) return false;
  if (!trap || trap.object !== object || !C.nearby(player, object)) return true;
  C.begin(player, 2, C.ANIM.TAKE, () => {
    if (traps.get(player) !== trap) return;
    if (trap.state === "caught") {
      if (!C.requireLevel(player, 62) || owns(player) || !C.exchange(player, [], [[H.core.ItemIdentifiers.UNCONSCIOUS_BROAV, 1]])) return;
      C.xp(player, 19.2, "broav", H.core.NpcIdentifiers.WILD_BROAV);
    }
    cleanup({ player });
  });
  return true;
}

function use(event) {
  if (event.itemId !== H.core.ItemIdentifiers.MORT_MYRE_FUNGUS || event.objectId !== H.core.ObjectIdentifiers.PIT_TRAP) return;
  event.handled = true; bait(event);
}

function train(event) {
  if (event.itemId !== H.core.ItemIdentifiers.UNCONSCIOUS_BROAV || event.target.getDefinition().getName() !== "Hunting expert") return;
  event.handled = true;
  if (C.nearby(event.player, event.target) && C.exchange(event.player, [[event.itemId, 1]], [[H.core.ItemIdentifiers.BROAV, 1]]))
    event.player.sendMessage("The hunting expert trains your broav to track scents.");
}

function release({ player, itemId }) {
  const I = H.core.ItemIdentifiers;
  if (![I.BROAV, I.UNCONSCIOUS_BROAV].includes(itemId)) return false;
  if (!player.getInventory().contains(itemId)) return true;
  const loc = player.getLocation();
  const npc = H.api.spawnNpc({ id: itemId === I.BROAV ? H.core.NpcIdentifiers.BROAV : H.core.NpcIdentifiers.WILD_BROAV,
    x: loc.getX(), y: loc.getY(), z: loc.getZ(), wanderRadius: 3, owner: player, ownerOnly: itemId === I.BROAV });
  if (!npc) return true;
  if (player.getPrivateArea()) npc.setArea(player.getPrivateArea());
  C.exchange(player, [[itemId, 1]], []); released.set(npc, player); H.players.add(player);
  return true;
}

function pickup({ player, npc }) {
  if (npc.getId() !== H.core.NpcIdentifiers.BROAV) return false;
  if (released.get(npc) === player && C.nearby(player, npc) && C.exchange(player, [], [[H.core.ItemIdentifiers.BROAV, 1]])) {
    released.delete(npc); H.api.removeNpc(npc); npc.getPrivateArea()?.detach(npc);
  }
  return true;
}

function cleanup({ player }) {
  const trap = traps.get(player);
  if (trap) {
    traps.delete(player); C.removeObject(trap.object); H.core.ObjectManager.register(trap.base, true);
    if (trap.npc) { H.api.removeNpc(trap.npc); trap.npc.getPrivateArea()?.detach(trap.npc); }
  }
  for (const [npc, owner] of released) if (owner === player) {
    released.delete(npc); H.api.removeNpc(npc); npc.getPrivateArea()?.detach(npc);
    if (npc.getId() === H.core.NpcIdentifiers.BROAV && !C.exchange(player, [], [[H.core.ItemIdentifiers.BROAV, 1]]))
      C.drop(player, [[H.core.ItemIdentifiers.BROAV, 1]], player.getLocation());
  }
}

function process() {
  for (const [player, trap] of traps) {
    if (!C.active(player) || !C.nearby(player, trap.base, 32) || H.tick >= trap.due) { cleanup({ player }); continue; }
    if (trap.state !== "baited") continue;
    if (H.tick >= trap.capture - 3 && trap.npc) H.core.PathFinder.calculateWalkRoute(trap.npc, trap.base.getLocation().getX(), trap.base.getLocation().getY());
    if (H.tick >= trap.capture && C.level(player) >= 62) {
      trap.state = "caught"; transform(trap, H.core.ObjectIdentifiers.COLLAPSED_TRAP_10);
      if (trap.npc) { H.api.removeNpc(trap.npc); trap.npc.getPrivateArea()?.detach(trap.npc); trap.npc = null; }
    }
  }
}

module.exports = { build, bait, dismantle, use, train, release, pickup, cleanup, process };
