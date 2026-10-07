"use strict";

// Search coordinates from RuneLite (BSD-2-Clause, Herbiboar.LICENSE).
const C = require("./Context.Hunter"), { H } = C;
const data = require("./HerbiboarData.json");
const hunts = new Map();
const near = (point, location, range = 0) => location.getZ() === 0 && Math.max(Math.abs(point[0] - location.getX()), Math.abs(point[1] - location.getY())) <= range;

function clear({ player }) {
  const hunt = hunts.get(player);
  if (!hunt) return;
  hunts.delete(player);
  for (const [varbit] of data.edges) player.getPacketSender().sendVarbit(varbit, 0);
  player.getPacketSender().sendVarbit(5766, 0);
  player.getPacketSender().sendVarbit(5767, 0);
  if (hunt.npc) { H.api.removeNpc(hunt.npc); hunt.npc.getPrivateArea()?.detach(hunt.npc); }
}

// ponytail: cache trails define adjacency; rotation lengths/failure odds await live measurement.
function next(player, hunt) {
  const candidates = data.edges.flatMap(([varbit, a, b]) => [[varbit, a, b, 2], [varbit, b, a, 1]])
    .filter(([varbit, a, b]) => a[0] === hunt.node && !hunt.used.includes(varbit) && !hunt.visited.includes(b[0]));
  if (!candidates.length || hunt.used.length >= 5) {
    hunt.end = data.ends.reduce((a, b) => Math.hypot(a[0] - hunt.point[0], a[1] - hunt.point[1]) < Math.hypot(b[0] - hunt.point[0], b[1] - hunt.point[1]) ? a : b);
    player.getPacketSender().sendVarbit(5766, data.ends.indexOf(hunt.end) + 1);
    player.sendMessage("The tracks lead to a tunnel. Attack it to flush out the herbiboar.");
    return;
  }
  const [varbit, , target, direction] = candidates[C.roll(0, candidates.length - 1)];
  hunt.used.push(varbit); hunt.next = target; hunt.direction = direction;
  player.getPacketSender().sendVarbit(varbit, direction + 2);
  player.sendMessage("You discover tracks. Inspect the objects at the end of the trail.");
}

function inspect({ player, object }) {
  const loc = object.getLocation();
  if (loc.getX() < 3650 || loc.getX() > 3770 || loc.getY() < 3780 || loc.getY() > 3905 || loc.getZ() !== 0) return false;
  const start = data.starts.findIndex(point => near(point, loc));
  const hunt = hunts.get(player);
  if (start < 0 && !hunt) return false;
  if (!C.nearby(player, object)) return true;
  if (start >= 0 && (!hunt || hunt.end || !hunt.next || !near(hunt.next.slice(1), loc))) {
    if (!C.requireLevel(player, 80) || !C.questComplete(player, "bone_voyage")) return true;
    clear({ player });
    const node = ["start0", "start1", "K", "start3", "start4"][start];
    const state = { node, point: data.starts[start], used: [], visited: [node], area: player.getPrivateArea(), due: H.tick + 1000 };
    hunts.set(player, state); H.players.add(player); next(player, state);
  } else if (!hunt.end && hunt.next && near(hunt.next.slice(1), loc)) {
    player.getPacketSender().sendVarbit(hunt.used.at(-1), hunt.direction);
    player.getPacketSender().sendVarbit(5767, hunt.used.length);
    hunt.node = hunt.next[0]; hunt.visited.push(hunt.node); hunt.point = hunt.next.slice(1); hunt.due = H.tick + 1000;
    if (hunt.node.startsWith("end") || hunt.node.startsWith("start")) {
      hunt.end = data.ends[hunt.node.startsWith("end") ? Number(hunt.node.slice(3)) : [7, 2, 1, 0, 6][Number(hunt.node.slice(5))]];
      player.getPacketSender().sendVarbit(5766, data.ends.indexOf(hunt.end) + 1);
      player.sendMessage("The tracks lead to a tunnel.");
    } else {
      if (C.roll(1, 100) === 1) { clear({ player }); player.sendMessage("The creature has confused you with its tracks. Start again."); }
      else {
        C.xp(player, 50, "herbiboar-tracking");
        const fossil = require("./DriftNets.Hunter").fossil(7, 24);
        if (fossil && !C.exchange(player, [], [fossil])) C.drop(player, [fossil], player.getLocation());
        next(player, hunt);
      }
    }
  } else player.sendMessage("You find no new tracks here.");
  return true;
}

function experience(base) { return base <= 94 ? 1950 + (base - 80) * 30 : 2385 + (base - 95) * 19; }

function attack({ player, object }) {
  const hunt = hunts.get(player);
  if (object.getId() !== H.core.ObjectIdentifiers.TUNNEL_47) return false;
  if (!hunt?.end || !near(hunt.end, object.getLocation()) || hunt.npc || !C.nearby(player, object)) return true;
  C.begin(player, 2, C.ANIM.KICK, () => {
    if (hunts.get(player) !== hunt || hunt.npc) return;
    const npc = H.api.spawnNpc({ id: H.core.NpcIdentifiers.HERBIBOAR, x: hunt.end[0], y: hunt.end[1], z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) return;
    if (player.getPrivateArea()) npc.setArea(player.getPrivateArea());
    hunt.npc = npc; hunt.due = H.tick + 100; hunt.stun = H.tick + 1;
    npc.performAnimation(new H.core.Animation(C.ANIM.HERBI_APPEAR));
    npc.getMovementQueue().setBlockMovement(true); npc.untargetable = true;
    player.getPacketSender().sendVarbit(5767, 1);
    C.xp(player, experience(player.getSkillManager().getMaxLevel(H.core.Skill.HUNTER)), "herbiboar-tracking");
  });
  return true;
}

function herb(player) {
  const I = H.core.ItemIdentifiers, l = C.level(player, H.core.Skill.HERBLORE);
  for (const [id, low, high] of [[I.GRIMY_RANARR_WEED,-10,20],[I.GRIMY_TORSTOL,-70,20],[I.GRIMY_SNAPDRAGON,-60,20],
    [I.GRIMY_DWARF_WEED,-50,30],[I.GRIMY_LANTADYME,-30,40],[I.GRIMY_CADANTINE,-10,50],[I.GRIMY_KWUARM,10,60],
    [I.GRIMY_AVANTOE,20,60],[I.GRIMY_IRIT_LEAF,30,70],[I.GRIMY_TARROMIN,70,-20],[I.GRIMY_HARRALANDER,100,-30],[I.GRIMY_MARRENTILL,170,-40]])
    if (Math.random() < C.probability(low, high, l)) return id;
  return I.GRIMY_GUAM_LEAF;
}

function harvest({ player, npc }) {
  const hunt = hunts.get(player);
  if (!hunt || hunt.npc !== npc) return false;
  if (hunt.leaving || !C.nearby(player, npc) || !C.requireLevel(player, 31, H.core.Skill.HERBLORE)) return true;
  hunt.rewards ??= Array.from({ length: C.roll(1, 3) + (C.hasTool(player, H.core.ItemIdentifiers.MAGIC_SECATEURS) ? 1 : 0) }, () => [herb(player), 1]);
  C.begin(player, 2, C.ANIM.PICKUP, () => {
    if (hunts.get(player) !== hunt || !C.requireLevel(player, 31, H.core.Skill.HERBLORE) || !C.exchange(player, [], hunt.rewards)) return;
    player.getSkillManager().addExperiences(H.core.Skill.HERBLORE, (hunt.rewards.length - 1) * 25);
    H.api.emitCustomEvent("hunter:success", { player, skill: H.core.Skill.HUNTER, method: "herbiboar", npcId: H.core.NpcIdentifiers.HERBIBOAR, petChance: 6500, xp: 0 });
    player.setAttribute("hunter.herbiboars", Number(player.getAttribute("hunter.herbiboars") ?? 0) + 1);
    npc.performAnimation(new H.core.Animation(C.ANIM.HERBI_BURROW));
    hunt.leaving = true; hunt.due = H.tick + 2;
  });
  return true;
}
function process() {
  for (const [player, hunt] of hunts) {
    if (H.tick >= hunt.due || hunt.area !== player.getPrivateArea() || !C.active(player)) clear({ player });
    else if (hunt.npc && !hunt.leaving && H.tick >= hunt.stun) {
      hunt.npc.performAnimation(new H.core.Animation(C.ANIM.HERBI_STUN));
      hunt.stun = H.tick + 4;
    }
  }
}
module.exports = { inspect, attack, harvest, clear, process, experience, herb, data };
