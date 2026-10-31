"use strict";

/**
 * The cove's fishing: two harpoonfish spots by the north island and two by the south, each
 * jumping between its group's sites now and then; a spot with jumping fish that comes and goes;
 * and the two spirit pools by the jetties, which open once Tempoross submerges.
 *
 * Captures: "You start harpooning fish.", "You catch a harpoonfish!", "You manage to catch an
 * extra harpoonfish as it jumps out of the water.", "The glowing fish scatter, shedding their
 * magical scales."; the jumping spot's splash (spotanim 3) and the pools' sound 4944.
 * Wiki: the catch chart (170/255, dragon 178/267, crystal 187/280), a 50% bonus fish at the
 * jumping spot, a crystal harpoon's 1 in 3 crystallised fish, the XP formulas, 5 points a fish,
 * 55 a scatter, 3% run energy a scatter and at most 12 essence. Tick rates: docs/tempoross.md.
 */

const Shared = require("./Shared.Tempoross");
const { coveOf, coveOfNpc } = require("./Cove.Tempoross");

const { DATA, NPC, ITEM, ANIM, GFX, SOUND } = Shared;
const F = DATA.fight;

/** Harpoons by catch tier, best first. Barb-tail and plain harpoons are the base tier. */
const HARPOONS = [
  { tier: "crystal", ids: ["CRYSTAL_HARPOON", "CRYSTAL_HARPOON_3"], level: 71 },
  { tier: "dragon", ids: ["INFERNAL_HARPOON", "INFERNAL_HARPOON_OR_", "INFERNAL_HARPOON_OR__3",
    "INFERNAL_HARPOON_UNCHARGED_", "INFERNAL_HARPOON_UNCHARGED__2", "INFERNAL_HARPOON_UNCHARGED__4",
    "CRYSTAL_HARPOON_INACTIVE_", "DRAGON_HARPOON", "DRAGON_HARPOON_OR_", "DRAGON_HARPOON_OR__3"], level: 61 },
  { tier: "harpoon", ids: ["HARPOON", "BARB_TAIL_HARPOON"], level: 1 },
];

class Spots {
  constructor(fight) {
    this.fight = fight;
    this.cove = fight.cove;
    /** { npc, group, site, moveAt } */
    this.regular = [];
    this.special = null;
    this.nextSpecialAt = 0;
    this.pools = [];
    this.poolsOpenAt = -1;
  }

  setUp() {
    for (const group of ["north", "south"]) {
      const sites = [...DATA.cove.spotSites[group]];
      for (let i = 0; i < 2; i++) {
        const site = sites.splice(Math.floor(Math.random() * sites.length), 1)[0];
        const npc = this.cove.spawnNpc(group === "north" ? NPC.SPOT_NORTH : NPC.SPOT_SOUTH, site);
        this.regular.push({ npc, group, site, moveAt: Shared.randomInt(...F.spotMoveTicks) });
      }
    }
    for (const tile of DATA.cove.spiritPools) this.pools.push(this.cove.spawnNpc(NPC.POOL_INACTIVE, tile));
    this.nextSpecialAt = Shared.randomInt(...F.specialSpotTicks);
  }

  stop() {}

  tick() {
    const now = this.fight.ticks;
    for (const spot of this.regular) {
      if (now >= spot.moveAt) this.move(spot);
    }
    if (this.special && now >= this.special.until) {
      this.cove.removeNpc(this.special.npc);
      this.special = null;
      this.nextSpecialAt = now + Shared.randomInt(...F.specialSpotTicks);
    }
    if (!this.special && now >= this.nextSpecialAt && this.fight.phase !== "over") this.spawnSpecial();
    if (this.special && now % 2 === 0) this.cove.mapGraphic(GFX.SPOT_SPLASH, this.special.npc.getLocation());
  }

  occupied(site) {
    return this.regular.some((spot) => spot.site === site) || this.special?.site === site;
  }

  /** A spot jumps to a free site of its group; whoever fished it has to click again. */
  move(spot) {
    spot.moveAt = this.fight.ticks + Shared.randomInt(...F.spotMoveTicks);
    const free = DATA.cove.spotSites[spot.group].filter((site) => !this.occupied(site));
    if (free.length === 0) return;
    spot.site = Shared.pick(free);
    spot.npc?.moveTo(this.cove.tile([...spot.site, 0]));
  }

  spawnSpecial() {
    const sites = [...DATA.cove.spotSites.north, ...DATA.cove.spotSites.south];
    const site = Shared.pick(sites);
    const npc = this.cove.spawnNpc(NPC.SPOT_SPECIAL, site);
    if (!npc) return;
    this.special = { npc, site, until: this.fight.ticks + F.specialSpotLifeTicks };
  }

  tickSubmerged() {
    if (this.poolsOpenAt >= 0 && this.fight.ticks >= this.poolsOpenAt) {
      this.poolsOpenAt = -1;
      for (const pool of this.pools) pool?.setNpcTransformationId(NPC.POOL);
    }
  }

  onSubmerge() {
    // Captures: the jumping spot goes when Tempoross submerges, not when its timer runs out.
    if (this.special) {
      this.cove.removeNpc(this.special.npc);
      this.special = null;
    }
    this.nextSpecialAt = this.fight.ticks + Shared.randomInt(...F.specialSpotTicks);
    this.poolsOpenAt = this.fight.ticks + F.poolsActiveAfter;
  }

  onSurface() {
    this.poolsOpenAt = -1;
    for (const pool of this.pools) pool?.setNpcTransformationId(NPC.POOL_INACTIVE);
  }

  onOver() {
    this.onSurface();
  }

  poolsOpen() {
    return this.pools.some((pool) => pool?.getContentId() === NPC.POOL);
  }
}

// ------------------------------------------------------------------ harpooning

/** The best harpoon a player can use, carried or wielded; null if none. */
function harpoonOf(player) {
  const { ItemIdentifiers } = Shared.core();
  const level = player.getSkillManager().getCurrentLevel(Shared.core().Skill.FISHING);
  for (const harpoon of HARPOONS) {
    if (level < harpoon.level) continue;
    if (harpoon.ids.some((name) => Shared.hasItem(player, ItemIdentifiers[name]))) return harpoon;
  }
  return null;
}

/** OSRS skilling success, out of 256, interpolated between level 1 and 99. */
function catchChance(level, [low, high]) {
  const value = Math.floor((low * (99 - level)) / 98 + (high * (level - 1)) / 98 + 0.5);
  return Math.min(1, (1 + value) / 256);
}

function canHarpoon(player) {
  if (Shared.baseLevel(player, "FISHING") < DATA.fishingLevel) {
    player.sendMessage(`You need a Fishing level of ${DATA.fishingLevel} to fish here.`);
    return null;
  }
  const harpoon = harpoonOf(player);
  if (!harpoon) {
    player.sendMessage("You need a harpoon to fish here.");
    return null;
  }
  return harpoon;
}

/** Spot lines go on the spam channel (rsprox captures 552, 1858, 3275). */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(Shared.core().ChatType.SPAM, text);
}

/** rsprox capture 552: a full inventory is a message box, a reset animation and a sound. */
function inventoryFull(player) {
  Shared.animate(player, -1);
  player.getPacketSender().sendSoundEffect(SOUND.FULL_INVENTORY, 1, 0, 1);
  Shared.statement(player, "You can't carry any more fish.");
}

function catchFish(player, fight, harpoon, special) {
  const inventory = player.getInventory();
  const crystallised = harpoon.tier === "crystal" && Math.random() < DATA.catch.crystallisedChance;
  inventory.adds(crystallised ? ITEM.CRYSTALLISED : ITEM.RAW, 1);
  spam(player, "You catch a harpoonfish!");
  Shared.addXp(player, "FISHING", Shared.xpBase(player) / 100);
  fight.addPoints(player, DATA.points.fish);
  if (special && inventory.getFreeSlots() > 0 && Math.random() < DATA.catch.bonusChance) {
    inventory.adds(ITEM.RAW, 1);
    spam(player, "You manage to catch an extra harpoonfish as it jumps out of the water.");
    fight.addPoints(player, DATA.points.fish);
  }
  inventory.refreshItems();
  Shared.api().emitCustomEvent("fishing:success", { player, skill: Shared.core().Skill.FISHING, petBase: null, stop: false });
}

function harpoonSpot(event) {
  const { player, npc } = event;
  if (!Shared.SPOT_IDS.includes(event.npcId)) return false;
  const cove = coveOfNpc(npc);
  if (!cove || coveOf(player) !== cove || !cove.fight) return true;
  const harpoon = canHarpoon(player);
  if (!harpoon) return true;
  if (player.getInventory().getFreeSlots() <= 0) {
    inventoryFull(player);
    return true;
  }
  const fight = cove.fight;
  const tile = npc.getLocation();
  const level = Math.min(99, player.getSkillManager().getCurrentLevel(Shared.core().Skill.FISHING));
  player.setPositionToFace(tile);
  spam(player, "You start harpooning fish.");
  Shared.animate(player, ANIM.HARPOON);
  Shared.startAction(player, "harpoon", (ticks) => {
    if (!npc.isRegistered() || !npc.getLocation().equals(tile) || fight.result) return false;
    // The tick after the catch that fills the inventory, as in capture 552.
    if (player.getInventory().getFreeSlots() <= 0) {
      inventoryFull(player);
      return false;
    }
    if (ticks % DATA.ticks.harpoon !== 0) return true;
    Shared.animate(player, ANIM.HARPOON);
    if (Math.random() < catchChance(level, DATA.catch[harpoon.tier])) {
      catchFish(player, fight, harpoon, event.npcId === NPC.SPOT_SPECIAL);
    }
    return true;
  });
  return true;
}

// ------------------------------------------------------------------ the spirit pools

function harpoonPool(event) {
  const { player, npc } = event;
  if (event.npcId !== NPC.POOL) return false;
  const cove = coveOfNpc(npc);
  if (!cove || coveOf(player) !== cove || !cove.fight) return true;
  if (!canHarpoon(player)) return true;
  const fight = cove.fight;
  player.setPositionToFace(npc.getLocation());
  spam(player, "You start harpooning fish.");
  Shared.animate(player, ANIM.HARPOON);
  Shared.startAction(player, "pool", (ticks) => {
    if (fight.phase !== "submerged" || npc.getContentId() !== NPC.POOL) return false;
    if (ticks % DATA.ticks.pool !== 0) return true;
    Shared.animate(player, ANIM.HARPOON);
    scatter(player, fight, npc);
    return fight.phase === "submerged";
  });
  return true;
}

/** One scatter: up to 12 essence (Wiki: the most anyone can deal), points, XP and run energy. */
function scatter(player, fight, npc) {
  spam(player, "The glowing fish scatter, shedding their magical scales.");
  const here = npc.getLocation();
  player.getPacketSender().sendAreaSound(SOUND.POOL, here.getX(), here.getY(), here.getZ(), 1, 0, 11);
  Shared.addXp(player, "FISHING", (Shared.xpBase(player) * 11) / 100);
  fight.addPoints(player, DATA.points.scatter);
  player.setRunEnergy(player.getRunEnergy() + 3);
  player.getPacketSender().sendRunEnergy();
  fight.damageEssence(Shared.randomInt(1, DATA.damage.poolMax / 10) * 10);
}

function attachSpots(api) {
  api.onNpcInteraction("Fishing spot", { Harpoon: harpoonSpot });
  api.onNpcInteraction("<col=00ffff>Spirit pool</col>", { Harpoon: harpoonPool });
}

module.exports = { Spots, attachSpots, catchChance, harpoonOf };
