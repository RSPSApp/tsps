"use strict";

/**
 * The three battle mages (https://oldschool.runescape.wiki/w/Battle_mage), NPCs 1610 Zamorak,
 * 1611 Saradomin and 1612 Guthix (cache examine text). Each casts its own god spell (max hit
 * 20, already the spell's and the monster dump's maximumHit) on a 4-tick cycle via a custom
 * magic combat method, so no generic NPC projectile is used. They are aggressive to any player
 * not wearing their god's cape - the cape check runs on each NPC instance's `isAggressiveTo`,
 * repatched on the tick a player sees a (re)spawned mage, because respawn clones lose instance
 * overrides. Their aggression definition is set on server startup, after NpcDefinitionLoader
 * has read monsters-complete.json (which says aggressive: false).
 */

const ATTACK_SPEED_TICKS = 4;
const BATTLE_MAGE_AGGRESSION = Object.freeze({ aggressive: true, aggressiveTolerance: false });
const ARENA = Object.freeze({ minX: 3089, maxX: 3117, minY: 3921, maxY: 3946, z: 0 });

let core;
let gods = null;
const patched = new WeakSet();

function inArena(player) {
  const at = player?.getLocation?.();
  return at != null && at.getZ() === ARENA.z
    && at.getX() >= ARENA.minX && at.getX() <= ARENA.maxX
    && at.getY() >= ARENA.minY && at.getY() <= ARENA.maxY;
}

/** Zamorak/Saradomin/Guthix capes, worn or imbued; the same sets core's god-spell charge uses. */
function createGods(apiCore) {
  const Items = apiCore.ItemIdentifiers;
  const Spells = apiCore.CombatSpells;
  const Npcs = apiCore.NpcIdentifiers;
  return {
    [Npcs.BATTLE_MAGE]: {
      name: "Zamorak",
      capeIds: [
        Items.ZAMORAK_CAPE, Items.ZAMORAK_CAPE_2,
        Items.IMBUED_ZAMORAK_CAPE, Items.IMBUED_ZAMORAK_CAPE_2,
        Items.IMBUED_ZAMORAK_CAPE_3, Items.IMBUED_ZAMORAK_CAPE_4,
      ],
      spell: Spells.FLAMES_OF_ZAMORAK,
    },
    [Npcs.BATTLE_MAGE_2]: {
      name: "Saradomin",
      capeIds: [
        Items.SARADOMIN_CAPE, Items.SARADOMIN_CAPE_2,
        Items.IMBUED_SARADOMIN_CAPE, Items.IMBUED_SARADOMIN_CAPE_2,
        Items.IMBUED_SARADOMIN_CAPE_3, Items.IMBUED_SARADOMIN_CAPE_4,
      ],
      spell: Spells.SARADOMIN_STRIKE,
    },
    [Npcs.BATTLE_MAGE_3]: {
      name: "Guthix",
      capeIds: [
        Items.GUTHIX_CAPE, Items.GUTHIX_CAPE_2,
        Items.IMBUED_GUTHIX_CAPE, Items.IMBUED_GUTHIX_CAPE_2,
        Items.IMBUED_GUTHIX_CAPE_3, Items.IMBUED_GUTHIX_CAPE_4,
      ],
      spell: Spells.CLAWS_OF_GUTHIX,
    },
  };
}

function godForMage(npcId) {
  return gods?.[npcId] ?? null;
}

function wearsCape(player, god) {
  const capeId = player?.getEquipment?.()?.get?.(core.Equipment.CAPE_SLOT)?.getId?.();
  return capeId != null && god.capeIds.includes(capeId);
}

/** The god-spell method for one battle mage: cast its spell, land at the spell's own speed. */
function battleMageCombatMethod(spell) {
  return class BattleMageCombat extends core.MagicCombatMethod {
    start(npc, target) {
      npc.getCombat().setCastSpell(spell);
      super.start(npc, target);
    }

    attackSpeed() {
      return ATTACK_SPEED_TICKS;
    }

    finished(npc) {
      npc.getCombat().setPreviousCast(spell);
      npc.getCombat().setCastSpell(null);
    }
  };
}

/** Keep this instance aggressive only to players not wearing its god's cape. */
function patchBattleMage(npc) {
  const god = godForMage(npc.getId?.());
  if (!god || patched.has(npc)) return;
  patched.add(npc);
  const baseAggressive = core.NPC.prototype.isAggressiveTo;
  npc.isAggressiveTo = (player) => !wearsCape(player, god) && baseAggressive.call(npc, player) === true;
}

function processPlayer({ player }) {
  if (!inArena(player)) return;
  for (const npc of player.getLocalNpcs()) {
    if (npc != null) patchBattleMage(npc);
  }
}

function configureAggression() {
  for (const id of Object.keys(gods)) {
    Object.assign(core.NpcDefinition.forId(Number(id)), BATTLE_MAGE_AGGRESSION);
  }
}

module.exports = function registerBattleMages(api) {
  core = api.core;
  gods = createGods(core);
  const Npcs = core.NpcIdentifiers;
  api.onServerStartup(configureAggression);
  api.onPlayerProcess(processPlayer);
  api.registerNpcCombatMethodProvider(Npcs.BATTLE_MAGE, battleMageCombatMethod(gods[Npcs.BATTLE_MAGE].spell));
  api.registerNpcCombatMethodProvider(Npcs.BATTLE_MAGE_2, battleMageCombatMethod(gods[Npcs.BATTLE_MAGE_2].spell));
  api.registerNpcCombatMethodProvider(Npcs.BATTLE_MAGE_3, battleMageCombatMethod(gods[Npcs.BATTLE_MAGE_3].spell));
};

Object.assign(module.exports, {
  _test: {
    ARENA,
    ATTACK_SPEED_TICKS,
    BATTLE_MAGE_AGGRESSION,
    inArena,
    createGods,
    godForMage,
    wearsCape,
    battleMageCombatMethod,
    configureAggression,
    processPlayer,
    setCore(value) {
      core = value;
      if (value?.NpcIdentifiers && value?.ItemIdentifiers && value?.CombatSpells) gods = createGods(value);
    },
  },
});
