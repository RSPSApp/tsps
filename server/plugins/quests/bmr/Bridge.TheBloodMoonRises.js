/** Wiki bridge defence: silvthrill shots destroy portals; defenders eventually fall back. */
module.exports = function registerBridge({ api, stage, attribute, ready, play, sync }) {
  const { PrivateArea, Boundary, Location, ItemIdentifiers: I, NpcIdentifiers: N, Equipment, CombatType, World } = api.core;
  const sessions = new WeakMap(), portals = new WeakMap();
  const SIEGE = 70, PORTAL = N.COL_00FFFF_PORTAL_COL_4;
  // shortcut: the Wiki publishes the 60% participation checkpoint, but not timings,
  // minimum shots or portal positions; calibrate these against a live OSRS capture.
  const POSITIONS = [[2974, 7693], [2976, 7693], [2974, 7696], [2976, 7696]];
  const MIN_SHOTS = 3, LOSS_INTERVAL = 5, PORTAL_LIFETIME = 18;
  const state = p => p.getAttribute(attribute);
  const equipped = p => p.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId() === I.SILVTHRILL_BALLISTA;

  function clear(area) {
    for (const npc of area.cast) { portals.delete(npc); api.removeNpc(npc); }
    area.cast.clear();
  }

  class BridgeArea extends PrivateArea {
    constructor(player) {
      super([new Boundary(2963, 2989, 7678, 7710, 0)]);
      this.player = player; this.cast = new Set(); this.count = 0;
      this.nextPortal = this.nextLoss = World.getProcessCycle() + LOSS_INTERVAL;
    }
    isMulti() { return true; }
    canAttack(attacker, target) {
      return attacker === this.player && portals.has(target) ? null : false;
    }
    process(member) {
      if (member !== this.player || member.getDialogueManager().isActive()) return;
      const current = state(member), tick = World.getProcessCycle();
      if (stage(member) !== SIEGE || current?.phase !== 'bridge') return;
      for (const npc of this.cast) {
        const expiry = portals.get(npc);
        if (expiry !== undefined && npc.getHitpoints() > 0 && tick >= expiry) {
          portals.delete(npc); this.cast.delete(npc); api.removeNpc(npc);
          current.integrity = Math.max(0, current.integrity - 3);
        }
      }
      if (tick >= this.nextLoss) { current.integrity = Math.max(0, current.integrity - 1); this.nextLoss = tick + LOSS_INTERVAL; }
      if (current.integrity <= 60 && !current.qualified) {
        if ((current.shots ?? 0) < MIN_SHOTS) {
          clear(this); current.integrity = 100; current.shots = 0;
          member.getCombat().reset();
          member.sendMessage('The defence failed. Shoot the blood portals with the silvthrill ballista to protect the Aranei.');
        } else current.qualified = true;
      }
      if (current.integrity === 0 && current.qualified) {
        clear(this); current.phase = 'fall-back'; member.setAttribute(attribute, current);
        sync?.(member);
        member.getCombat().reset();
        play(member, N.SAREI_5, 'drakan-s-siege-upon-reaching-0-defender-integrity');
        return;
      }
      member.setAttribute(attribute, current);
      if (tick >= this.nextPortal && this.cast.size < 8) {
        const [x, y] = POSITIONS[this.count++ % POSITIONS.length];
        const npc = api.spawnNpc({ id: PORTAL, x, y, z: 0, wanderRadius: 0, owner: member, ownerOnly: true });
        if (npc) {
          npc.setMaxHitpoints(1).setHitpoints(1); npc.setScriptedMovement(true);
          npc.getMovementQueue().setBlockMovement(true); this.enter(npc); this.cast.add(npc);
          portals.set(npc, tick + PORTAL_LIFETIME);
        }
        this.nextPortal = tick + Math.max(3, Math.floor(current.integrity / 10));
      }
    }
    postLeave(member, logout) {
      if (member === this.player) {
        clear(this); sessions.delete(member);
        if (logout) member.moveTo(new Location(3168, 7855, 1));
      }
      super.postLeave(member, logout);
    }
  }

  function start(player) {
    if (stage(player) !== SIEGE || !ready(player) || sessions.has(player)) return false;
    const inv = player.getInventory(), eq = player.getEquipment();
    const missing = [I.SILVTHRILL_BALLISTA, I.SILVTHRILL_JAVELIN].filter(id => !inv.contains(id) && !eq.contains(id));
    if (inv.getFreeSlots() < missing.length) {
      player.sendMessage('Make room for the silvthrill ballista and its javelins before defending the bridge.'); return false;
    }
    for (const id of missing) inv.adds(id, id === I.SILVTHRILL_JAVELIN ? 100 : 1);
    player.setAttribute(attribute, { phase: 'bridge', integrity: 100, shots: 0, qualified: false });
    const area = new BridgeArea(player); sessions.set(player, area); area.enter(player);
    player.getCombat().reset(); player.moveTo(new Location(2975, 7687, 0));
    player.sendMessage('Wield the silvthrill ballista and javelins, then shoot the blood portals to protect the defenders.');
    return true;
  }
  function finish(player) {
    if (state(player)?.phase !== 'fall-back') return false;
    // A logout removes the private BridgeArea but keeps the persisted fall-back
    // phase. The canonical vqg4qO conversation must still finish that phase and
    // land the player back in the hall, so do not require a live area.
    const area = sessions.get(player);
    if (area) area.leave(player, false);
    player.moveTo(new Location(3168, 7855, 1));
    return true;
  }
  function hit({ npc, hit }) {
    if (!portals.has(npc)) return;
    const player = hit.getAttacker();
    hit.setTotalDamage(sessions.get(player)?.cast.has(npc) && equipped(player) && hit.getCombatType() === CombatType.RANGED ? 1 : 0);
  }
  function roll(event) {
    if (portals.has(event.target) && sessions.get(event.attacker)?.cast.has(event.target) && equipped(event.attacker)) event.forceAccurate = true;
  }
  function death({ npc, killer }) {
    if (!portals.has(npc)) return;
    const owner = npc.getOwner(), area = owner && sessions.get(owner);
    portals.delete(npc); area?.cast.delete(npc);
    if (area && killer === owner) { const current = state(owner); current.shots = (current.shots ?? 0) + 1; owner.setAttribute(attribute, current); }
  }
  function doors(event) {
    const p = event.player, id = event.definition?.id ?? event.objectId, { x, y, z } = event.location ?? {};
    if (!p || stage(p) < 60 || stage(p) > SIEGE) return false;
    if (id === api.core.ObjectIdentifiers.DOORS_46 && x === 3167 && y === 7860 && z === 1) {
      if (stage(p) === 60) {
        if (ready(p)) play(p, N.SAREI_5, 'drakan-s-siege-going-outside');
        else p.moveTo(new Location(2975, 7683, 0));
      } else if (!state(p) || state(p)?.phase === 'bridge') start(p);
      else p.moveTo(new Location(2975, 7683, 0));
      return true;
    }
    if (id === api.core.ObjectIdentifiers.DOORS_43 && x === 2974 && y === 7677 && z === 0) {
      if (sessions.has(p)) p.sendMessage('Sarei orders you to keep defending the bridge until the barrier falls.');
      else p.moveTo(new Location(3168, 7859, 1));
      return true;
    }
    return false;
  }
  api.onNpcHitModify(hit); api.onCombatHitRoll(roll); api.onNpcDeath(death);
  api.onObjectInteraction('Doors', { Enter: doors });
  return { start, finish, hit, roll, death, doors, sessions, portals, BridgeArea };
};
