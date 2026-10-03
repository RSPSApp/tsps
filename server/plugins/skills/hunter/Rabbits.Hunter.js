"use strict";

const C = require("./Context.Hunter"), { H } = C;
const Traps = require("./Traps.Hunter");
const holes = new Map();
const runs = new Set();
// RuneLite SpotanimID.HUNTING_RABBIT_TRAVEL, validated against rev237.
const RABBIT_TRAVEL = 943;

function flush({ player, object }) {
  if (object.getId() !== H.core.ObjectIdentifiers.RABBIT_HOLE) return false;
  if (!C.nearby(player, object) || !C.requireLevel(player, 27)) return true;
  if (!C.questComplete(player, "eagles_peak")) { player.sendMessage("Complete Eagles' Peak before hunting rabbits."); return true; }
  if (!player.getInventory().contains(H.core.ItemIdentifiers.FERRET)) { player.sendMessage("You need a ferret to flush this hole."); return true; }
  if (holes.has(object)) { player.sendMessage("There are no rabbits in this hole at the moment."); return true; }
  C.begin(player, 2, C.ANIM.SMALL, () => {
    if (holes.has(object) || !C.requireLevel(player, 27) || !player.getInventory().contains(H.core.ItemIdentifiers.FERRET)) return;
    const groups = [[[2323,3533],[2328,3524],[2329,3537],[2336,3525],[2337,3535],[2339,3530]],
      [[2308,3633],[2313,3628],[2314,3639],[2320,3627],[2322,3638],[2326,3632]],
      [[2325,3608],[2328,3612],[2329,3604],[2334,3605],[2334,3613],[2338,3608]]];
    const group = groups.find(g => g.some(([x,y]) => x===object.getLocation().getX() && y===object.getLocation().getY()));
    if (!group) return;
    const source = C.roll(0,group.length-1), destination = (source + C.roll(1,group.length-1)) % group.length;
    const [sx,sy] = group[source], [ex,ey] = group[destination], path=[];
    let x=sx,y=sy;
    while(x!==ex || y!==ey){x+=Math.sign(ex-x);y+=Math.sign(ey-y);path.push([x,y]);}
    const trap = [...H.traps].find(t=>t.player===player && t.kind==="rabbit" && t.state==="idle"
      && t.area===object.getPrivateArea() && path.some(([x,y])=>t.location.getX()===x && t.location.getY()===y));
    holes.set(object, H.tick + 20);
    if (Math.random() >= C.probability(190, 255, C.level(player))) {
      C.exchange(player, [[H.core.ItemIdentifiers.FERRET, 1]], []);
      player.sendMessage("Your ferret escapes after flushing the rabbit.");
    }
    const start = new H.core.Location(sx, sy, object.getLocation().getZ());
    const end = trap?.location ?? new H.core.Location(ex, ey, start.getZ());
    const ticks = Math.max(1, Math.ceil(C.distance(start,end) / 2));
    for (const viewer of new Set([player, ...(H.core.World.getNearbyPlayersForUpdate?.(player) ?? [])])) {
      if (viewer.getPrivateArea() === player.getPrivateArea())
        viewer.getPacketSender().sendProjectile(start,end,0,ticks*30,RABBIT_TRAVEL,0,0,null,0,0,0);
    }
    if (trap) runs.add({ player, trap, due: H.tick + ticks });
    else player.sendMessage("The rabbit runs between the holes and escapes your snares.");
  });
  return true;
}

function use(event) {
  if (event.itemId !== H.core.ItemIdentifiers.FERRET || event.objectId !== H.core.ObjectIdentifiers.RABBIT_HOLE) return;
  event.handled = true;
  flush(event);
}

function process() {
  for (const [object, due] of holes) if (H.tick >= due) holes.delete(object);
  for (const run of runs) if (H.tick >= run.due) {
    runs.delete(run);
    const {player,trap}=run;
    if (!C.active(player) || !H.traps.has(trap) || trap.state !== "idle" || trap.area !== player.getPrivateArea() || C.level(player)<27) continue;
    const I=H.core.ItemIdentifiers;
    Traps.setState(trap,"caught",{level:27,xp:144,caught:H.core.ObjectIdentifiers.RABBIT_SNARE_2,
      loot:[[I.BONES,1],[I.RAW_RABBIT,1],[I.RABBIT_FOOT,1]]});
    player.sendMessage("Your ferret flushes a rabbit into your snare.");
  }
}
function shutdown() { holes.clear(); runs.clear(); }

module.exports = { flush, use, process, shutdown };
