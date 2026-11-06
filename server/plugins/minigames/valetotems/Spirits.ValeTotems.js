"use strict";

const Shared = require("./Shared.ValeTotems");
const spirits = new Map();
// The cache calls the buffalo's animation family "bison".
const EFFECT_ANIMALS = ["bison", "jaguar", "eagle", "snake", "scorpion"];

function retain(site, animal, npc) {
  if (npc) spirits.set(`${site}:${animal}`, npc);
}

/** Transient effects for one viewer; PacketSender checks actor visibility after NPC sync. */
function animate(player, site, animals, phase) {
  const { CacheDefinitions, Animation, Graphic } = Shared.core();
  for (const animal of animals) {
    const npc = spirits.get(`${site}:${animal}`);
    if (!npc) continue;
    const name = EFFECT_ANIMALS[animal - 1];
    const seq = CacheDefinitions.getSeqId(`npc_nature_spirit_${name}_${phase}`);
    const spot = CacheDefinitions.getSpotanimId(`vfx_nature_spirit_${name}_${phase}`);
    if (seq == null || spot == null) throw new Error(`ValeTotems: missing ${name} ${phase} effect`);
    player.getPacketSender().sendNpcAnimationSpecific(npc, new Animation(seq));
    player.getPacketSender().sendNpcSpotAnimationSpecific(npc, new Graphic(spot), 2);
  }
}

module.exports = { retain, animate };
