"use strict";

const C = require("./Context.Hunter"), { H } = C;
const traps = new Map();

function bats() {
  const I = H.core.ItemIdentifiers, N = H.core.NpcIdentifiers;
  return [
    [N.GUANIC_BAT, 1, 5, I.RAW_GUANIC_BAT_0_],
    [N.PRAEL_BAT, 15, 9, I.RAW_PRAEL_BAT_1_],
    [N.GIRAL_BAT, 30, 13, I.RAW_GIRAL_BAT_2_],
    [N.PHLUXIA_BAT, 45, 17, I.RAW_PHLUXIA_BAT_3_],
    [N.KRYKET_BAT, 60, 21, I.RAW_KRYKET_BAT_4_],
    [N.MURNG_BAT, 75, 25, I.RAW_MURNG_BAT_5_],
    [N.PSYKK_BAT, 90, 29, I.RAW_PSYKK_BAT_6_],
  ];
}

function catchBat({ player, npc, npcId }) {
  const def = bats().find(b => b[0] === npcId);
  if (!def) return false;
  const I = H.core.ItemIdentifiers;
  const weapon = player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId();
  if (![I.BUTTERFLY_NET, I.MAGIC_BUTTERFLY_NET].includes(weapon)) {
    player.sendMessage("You need an equipped butterfly net to catch bats."); return true;
  }
  if (!C.available(npc) || !C.nearby(player, npc) || !C.requireLevel(player, def[1])) return true;
  const token = { player };
  H.reserved.set(npc, token);
  const cancel = () => { if (H.reserved.get(npc) === token) H.reserved.delete(npc); };
  if (!C.begin(player, 2, C.ANIM.NET, () => {
    cancel();
    if (!C.available(npc) || !C.nearby(player, npc) || !C.requireLevel(player, def[1])
      || player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId() !== weapon) return;
    if (!C.exchange(player, [], [[def[3], 1]])) { player.getInventory().full(); return; }
    C.xp(player, def[2], "raid-bat", npcId);
    C.hide(npc, 10);
  }, cancel)) cancel();
  return true;
}

function occupied(object) {
  return [...traps.values()].some(t => t.base.getPrivateArea() === object.getPrivateArea()
    && t.base.getLocation().equals(object.getLocation()));
}

function rock({ player, object }) {
  if (object.getId() !== H.core.ObjectIdentifiers.ROCK_167) return false;
  if (!C.nearby(player, object) || !C.requireLevel(player, 20)) return true;
  if (traps.has(player) || occupied(object)) { player.sendMessage("You already have a lizard trap set."); return true; }
  C.begin(player, 2, C.ANIM.SMALL, () => {
    if (traps.has(player) || occupied(object) || !C.requireLevel(player, 20)
      || !C.exchange(player, [[H.core.ItemIdentifiers.ROPE, 1]], [])) return;
    const trap = new H.core.GameObject(H.core.ObjectIdentifiers.LIZARD_TRAP, object.getLocation().clone(),
      object.getType(), object.getFace(), player.getPrivateArea());
    H.core.ObjectManager.deregister(object, true);
    H.core.ObjectManager.register(trap, true);
    traps.set(player, { base: object, object: trap, due: H.tick + 100 });
    H.players.add(player);
  });
  return true;
}

function rustle({ player, object }) {
  if (object.getId() !== H.core.ObjectIdentifiers.BUSH_63) return false;
  const trap = traps.get(player);
  if (!trap || !C.nearby(player, object) || C.distance(trap.object.getLocation(), object.getLocation()) > 10) return true;
  C.begin(player, 3, C.ANIM.SMALL, () => {
    if (traps.get(player) !== trap || !C.requireLevel(player, 20)) return;
    const I = H.core.ItemIdentifiers, quest = Number(player.getAttribute("quest.perilous_moons.stage"));
    const rewards = [[I.ROPE, 1],
      [quest > 0 && !C.questComplete(player, "perilous_moons") ? I.MOSS_LIZARD_TAIL : I.RAW_MOSS_LIZARD, 1]];
    if (!C.exchange(player, [], rewards)) { player.getInventory().full(); return; }
    C.xp(player, Math.min(90, C.level(player) * 0.9), "moss-lizard", H.core.NpcIdentifiers.MOSS_LIZARD);
    remove(player, false);
  });
  return true;
}

function remove(player, refund = true) {
  const t = traps.get(player);
  if (!t) return;
  traps.delete(player);
  C.removeObject(t.object);
  H.core.ObjectManager.register(t.base, true);
  if (refund && !C.exchange(player, [], [[H.core.ItemIdentifiers.ROPE, 1]])) {
    C.drop(player, [[H.core.ItemIdentifiers.ROPE, 1]], player.getLocation());
  }
}

function cleanup({ player }) { remove(player); }

function process() {
  for (const [player, t] of traps) {
    if (H.tick >= t.due || !C.nearby(player, t.object, 32) || !C.active(player)) remove(player);
  }
}

function use(event) {
  if (event.itemId !== H.core.ItemIdentifiers.ROPE || event.objectId !== H.core.ObjectIdentifiers.ROCK_167) return;
  event.handled = true;
  rock(event);
}

module.exports = { bats, catchBat, rock, rustle, use, cleanup, process };
