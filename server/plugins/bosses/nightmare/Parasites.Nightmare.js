/**
 * Parasites, as captured: her animation, two ticks later the parasite flies at the player, three
 * after that it takes hold (the message, and varbit 10151 turns the hitpoints orb pink), and
 * twenty ticks later it bursts out: 40-52 damage fully grown, 4-9 if a Sanfew serum or Relicym's
 * balm weakened it first, with its own message and the parasite rising where the player stands.
 *
 * Then it helps her (Wiki): every 4 ticks it restores 31-50 of her shield, or takes as much charge
 * from the least charged totem; with neither to help, it attacks the player, ranged first, then
 * magic, then ranged, which the right protection stops in full.
 */
const Common = require("./Common.Nightmare");

function targets(fight) {
  const players = Common.shuffled(fight.players());
  return players.slice(0, Math.max(1, Math.floor(players.length / 5)));
}

function start(fight) {
  const { parasite } = Common.data;
  fight.boss.performAnimation(Common.animation(parasite.anim));
  for (const player of fight.players()) Common.sounds(player, parasite.sounds);
  const chosen = targets(fight);
  fight.at(parasite.projectileTicks, () => {
    for (const player of chosen) {
      if (!player.isRegistered()) continue;
      Common.projectile(fight.dream.area, fight.boss, player, parasite.projectile);
      Common.sounds(player, [parasite.projectileSound]);
    }
  });
  fight.at(parasite.infectTicks, () => {
    for (const player of chosen) if (player.isRegistered() && fight.players().includes(player)) infect(fight, player);
  });
  return null;
}

function infect(fight, player) {
  const { parasite, varbits } = Common.data;
  if (fight.parasites.has(player)) return;
  fight.parasites.set(player, { burstAt: fight.tick + parasite.burstTicks, weak: false });
  player.sendMessage(parasite.infected);
  player.getPacketSender().sendVarbit(varbits.parasite, 1);
}

/** A Sanfew serum or Relicym's balm, drunk while it grows, weakens it. */
function weaken(fight, player) {
  const state = fight.parasites.get(player);
  if (!state || state.weak) return;
  state.weak = true;
  player.getPacketSender().sendVarbit(Common.data.varbits.parasite, 0);
  player.sendMessage(Common.data.parasite.weakened);
}

function burst(fight, player, state) {
  const { parasite, varbits, npcs } = Common.data;
  fight.parasites.delete(player);
  player.getPacketSender().sendVarbit(varbits.parasite, 0);
  if (!player.isRegistered() || !fight.players().includes(player)) return;
  const range = state.weak
    ? (fight.phosani ? parasite.burstDamage.phosaniWeak : parasite.burstDamage.weak)
    : (fight.phosani ? parasite.burstDamage.phosaniFull : parasite.burstDamage.full);
  player.sendMessage(state.weak ? parasite.burstWeak : parasite.burstFull);
  player.performGraphic(Common.graphic(state.weak ? parasite.vomitWeak : parasite.vomit));
  Common.sounds(player, parasite.burstSounds);
  Common.damage(player, Common.randomInt(...range));
  const ids = fight.phosani ? npcs.phosani : npcs;
  const id = state.weak ? ids.parasiteWeak : ids.parasite;
  const npc = fight.dream.spawn(id, [...fight.dream.arenaTile(player.getLocation()), Common.data.arena.plane]);
  if (!npc) return;
  npc.__nightmareFight = fight;
  npc.__nightmareParasite = { weak: state.weak, next: fight.tick + parasite.speed, ranged: true, player };
  npc.performAnimation(Common.animation(parasite.spawnAnim));
  fight.minions.add(npc);
}

function process(fight) {
  for (const [player, state] of [...fight.parasites]) if (fight.tick >= state.burstAt) burst(fight, player, state);
  for (const npc of fight.minions) {
    const state = npc.__nightmareParasite;
    if (!state || !npc.isRegistered() || npc.getHitpoints() <= 0 || fight.tick < state.next) continue;
    state.next = fight.tick + Common.data.parasite.speed;
    act(fight, npc, state);
  }
}

function act(fight, npc, state) {
  const { parasite } = Common.data;
  const amount = Common.randomInt(...parasite.heal.amount);
  if (fight.stage === "shield" && fight.shield < fight.shieldMax) {
    npc.performAnimation(Common.animation(parasite.heal.anim));
    npc.setPositionToFace(fight.boss.getLocation());
    Common.projectile(fight.dream.area, npc, fight.boss, parasite.heal.projectile);
    fight.at(2, () => fight.healShield(amount));
    return;
  }
  if (fight.stage === "totems") {
    const totem = require("./Totems.Nightmare").leastCharged(fight);
    if (totem) {
      npc.performAnimation(Common.animation(parasite.drain.anim));
      npc.setPositionToFace(totem.npc.getLocation());
      Common.projectile(fight.dream.area, npc, totem.npc, parasite.drain.projectile);
      fight.at(2, () => require("./Totems.Nightmare").drain(fight, totem, amount));
      return;
    }
  }
  const player = fight.players().includes(state.player) ? state.player : fight.target();
  if (!player) return;
  const style = state.ranged ? "ranged" : "magic";
  state.ranged = !state.ranged;
  const spec = parasite[style];
  npc.performAnimation(Common.animation(spec.anim));
  npc.setPositionToFace(player.getLocation());
  Common.projectile(fight.dream.area, npc, player, spec.projectile);
  const max = state.weak ? parasite.maxHit.weak : parasite.maxHit.full;
  Common.strike(npc, player, style, max, 2, {
    prayed: (s, prayer) => (prayer && require("./Specials.Nightmare").blockedBy(fight, player, prayer) === s ? 0 : 1),
  });
}

/** Drinking: a cure while infected weakens it ("You haven't got anything..." comes from the orb). */
function drink({ player, itemId }) {
  const fight = require("./Dream.Nightmare").dreamOf(player)?.fight;
  if (!fight?.parasites.has(player)) return;
  const name = Common.core.ItemDefinition.forId(itemId)?.getName?.() ?? "";
  if (/^(Sanfew serum|Relicym's balm)/.test(name)) weaken(fight, player);
}

function parasiteDied({ npc }) {
  const fight = npc?.__nightmareFight;
  if (fight && npc.__nightmareParasite) fight.minions.delete(npc);
}

function playerLeft(fight, player) {
  if (!fight.parasites.delete(player)) return;
  player.getPacketSender().sendVarbit(Common.data.varbits.parasite, 0);
}

/** Parasites outlast a blast (as captured); her death or the fight's end takes them all. */
function clear(fight) {
  if (fight.stage !== "dead" && !fight.stopped) return;
  for (const player of [...fight.parasites.keys()]) playerLeft(fight, player);
  for (const npc of [...fight.minions]) {
    if (!npc.__nightmareParasite) continue;
    fight.minions.delete(npc);
    if (npc.isRegistered()) Common.api.removeNpc(npc);
  }
}

function attachParasites(api) {
  api.onCanDrink(drink);
  api.onNpcDeath(parasiteDied);
}

module.exports = { start, process, clear, playerLeft, weaken, attachParasites };
