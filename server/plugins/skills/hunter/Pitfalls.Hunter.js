"use strict";

const C = require("./Context.Hunter"), { H, ANIM, requireLevel, hasTool, nearby, available, distance, begin, chance, hide } = C;
const Traps = require("./Traps.Hunter");
const teased = new Map();
const lastPit = new WeakMap();
const leaps = new Map();
// RuneLite SpotanimID, validated with dump:spotanim against rev237.
const LEAP_GRAPHICS = { SABRE_TOOTHED_KYATT: [937,938], SPINED_LARUPIA: [939,940], HORNED_GRAAHK: [941,942],
  SUNLIGHT_ANTELOPE: [2800,2801], MOONLIGHT_ANTELOPE: [2802,2803] };

function build({ player, object }) {
  const def = H.core.CacheDefinitions.getObject(object.getId());
  if (def.transforms?.[0] !== H.core.ObjectIdentifiers.PIT_4) return false;
  Traps.lay(player, "pit", object.getLocation(), object);
  return true;
}

function tease({ player, npc, npcId }) {
  const creature = H.data.creatures.find(c => c.npc === npcId && c.trap === "pit");
  if (!creature) return false;
  if (!hasTool(player, H.core.ItemIdentifiers.TEASING_STICK) && !hasTool(player, H.core.ItemIdentifiers.HUNTERS_SPEAR)) { player.sendMessage("You need a teasing stick or hunter's spear."); return true; }
  if (!requireLevel(player, creature.level) || !nearby(player, npc) || !available(npc) || teased.has(player)) return true;
  const state = { player, npc, creature, due: H.tick + 50, attack: H.tick + 4 };
  if (begin(player, 1, ANIM.TEASE, () => {
    if (!available(npc) || !nearby(player, npc) || !requireLevel(player, creature.level)) return;
    H.reserved.set(npc, state); teased.set(player, state);
    player.sendMessage("The creature follows you. Lead it to your pit and jump across.");
  })) return true;
  return true;
}

function clear({ player }) {
  const state = teased.get(player);
  if (!state) return;
  const leap = leaps.get(state.npc);
  if (leap) land(state.npc, leap);
  teased.delete(player);
  if (H.reserved.get(state.npc) === state) H.reserved.delete(state.npc);
  state.npc.getMovementQueue().reset();
}

function jump({ player, object }) {
  const trap = Traps.owned(player, object);
  if (!trap || trap.kind !== "pit") return false;
  if (!nearby(player, object, 3) || trap.state !== "idle") return true;
  const state = teased.get(player);
  if (state && (!H.core.CacheDefinitions.getObject(trap.base.getId()).transforms?.includes(state.creature.caught)
    || lastPit.get(state.npc) === trap.base)) { player.sendMessage("Lure this creature across a different pit."); return true; }
  const from = player.getLocation(), center = trap.location;
  const dx = Math.abs(from.getX() - center.getX()), dy = Math.abs(from.getY() - center.getY());
  const destination = center.clone().add(dx > dy ? (from.getX() <= center.getX() ? 3 : -3) : 0,
    dx > dy ? 0 : (from.getY() <= center.getY() ? 3 : -3));
  if (H.core.RegionManager.blocked(destination, trap.area)) { player.sendMessage("You cannot land on the other side of this pit."); return true; }
  const started = begin(player, 2, ANIM.JUMP, () => {
    player.setForceMovement(null);
    if (!H.traps.has(trap) || trap.state !== "idle") return;
    player.moveTo(destination);
    if (!state || teased.get(player) !== state || distance(state.npc.getLocation(), center) > 5) return;
    if (!requireLevel(player, state.creature.level)) return;
    const success = chance(player, state.creature, hasTool(player, H.core.ItemIdentifiers.HUNTERS_SPEAR) ? 0.05 : 0);
    lastPit.set(state.npc, trap.base);
    if (success) {
      clear({ player });
      state.npc.performAnimation(new H.core.Animation(state.creature.npc === H.core.NpcIdentifiers.SUNLIGHT_ANTELOPE
        || state.creature.npc === H.core.NpcIdentifiers.MOONLIGHT_ANTELOPE ? ANIM.ANTELOPE_FALL : ANIM.CAT_FALL));
      Traps.setState(trap, "caught", state.creature);
      hide(state.npc, 10, 2);
    } else {
      const npc=state.npc, queue=npc.getMovementQueue(), start=npc.getLocation().clone();
      const graphics=Object.entries(LEAP_GRAPHICS).find(([key])=>H.core.NpcIdentifiers[key]===npc.getId())?.[1] ?? [];
      const viewers=new Set([player,...(H.core.World.getNearbyPlayersForUpdate?.(player)??[])]);
      for(const viewer of viewers)if(viewer.getPrivateArea()===trap.area)for(const graphic of graphics)
        viewer.getPacketSender().sendProjectile(start,destination,0,90,graphic,0,0,null,0,0,0);
      leaps.set(npc,{due:H.tick+3,destination,blocked:queue.isMovementBlocked()});
      queue.reset();queue.setBlockMovement(true);npc.setVisible(false);
    }
    player.sendMessage(success ? "The creature falls into your pit!" : "The creature leaps over your trap.");
  }, () => player.setForceMovement(null));
  if (started) {
    const delta = new H.core.Location(destination.getX() - from.getX(), destination.getY() - from.getY());
    player.getMovementQueue().reset();
    player.setForceMovement(new H.core.ForceMovement(from.clone(), delta, 0, 60,
      dx > dy ? (delta.getX() > 0 ? 1 : 3) : (delta.getY() > 0 ? 0 : 2), ANIM.JUMP));
  }
  return true;
}

function land(npc,leap) {
  leaps.delete(npc);
  if (!npc.isRegistered()) return;
  npc.moveTo(leap.destination);npc.setVisible(true);npc.getMovementQueue().setBlockMovement(leap.blocked);
}

function process() {
  for(const[npc,leap]of leaps)if(H.tick>=leap.due||!npc.isRegistered())land(npc,leap);
  for (const [player, state] of teased) {
    if (leaps.has(state.npc)) continue;
    if (H.tick >= state.due || !state.npc.isRegistered() || !state.npc.isVisible() || !player.isRegistered()
      || !nearby(player, state.npc, 16)) { clear({ player }); continue; }
    if (H.tick % 2 === 0) H.core.PathFinder.calculateWalkRoute(state.npc, player.getLocation().getX(), player.getLocation().getY());
    if (H.tick >= state.attack && nearby(player, state.npc, 1) && !player.getForceMovement()) {
      state.attack = H.tick + 4;
      const protectedMelee = H.core.PrayerHandler.isActivated(player, H.core.PrayerHandler.PROTECT_FROM_MELEE);
      if (!protectedMelee) {
        const I = H.core.ItemIdentifiers;
        const gear = [[I.KYATT_HAT,I.KYATT_TOP,I.KYATT_LEGS,0.4],[I.GRAAHK_HEADDRESS,I.GRAAHK_TOP,I.GRAAHK_LEGS,0.6],[I.LARUPIA_HAT,I.LARUPIA_TOP,I.LARUPIA_LEGS,0.8]];
        const multiplier = gear.find(set => set.slice(0,3).every(id => player.getEquipment().getItems().some(item => item?.getId() === id)))?.[3] ?? 1;
        const max = [H.core.NpcIdentifiers.SABRE_TOOTHED_KYATT,H.core.NpcIdentifiers.HORNED_GRAAHK].includes(state.creature.npc) ? 7 : 5;
        player.getCombat().getHitQueue().addPendingDamage([new H.core.HitDamage(Math.floor(C.roll(0,max) * multiplier),H.core.HitMask.RED)]);
      }
    }
  }
}

module.exports = { build, tease, jump, clear, process };
