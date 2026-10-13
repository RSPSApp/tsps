
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";
import { Task } from "../Task";
import { Mobile } from "../../entity/impl/Mobile";
import { Item } from "../../model/Item";
import { HitDamage } from "../../content/combat/hit/HitDamage";
import { HitMask } from "../../content/combat/hit/HitMask";

export class CombatPoisonEffect extends Task {
  private entity: Mobile;
  private ticksUntilHit: number;

  constructor(entity: Mobile) {
    super(1, entity, false);
    this.entity = entity;
    this.ticksUntilHit = 30;
  }

  public execute() {
    if (!this.entity.isRegistered()) {
      this.stop();
      return;
    }

    if (!this.entity.isPoisoned()) {
      this.stop();
      return;
    }

    if (!this.entity.getCombat().getPoisonImmunityTimer().finished()) {
      this.stop();
      return;
    }

    if (this.entity.isPlayer() && this.entity.getAsPlayer().getInterfaceId() > 0) {
      // Poison pauses while interfaces are open and should hit immediately
      // after the interface closes if it was already due.
      if (this.ticksUntilHit < 0) {
        this.ticksUntilHit = 0;
      }
      return;
    }

    if (this.ticksUntilHit > 0) {
      this.ticksUntilHit--;
      return;
    }

    const currentValue = this.entity.getPoisonDamage();
    if (currentValue <= 0) {
      this.stop();
      return;
    }

    if (this.entity.isVenomed()) {
      // OSRS venom: the stored value IS the damage dealt (no severity->damage
      // formula), escalates by 2 each hit up to a cap of 20, and does not
      // decay or expire on its own - only a cure ends it.
      this.entity
        .getCombat()
        .getHitQueue()
        .addPendingDamage([new HitDamage(currentValue, HitMask.GREEN)]);
      this.entity.setPoisonDamage(Math.min(20, currentValue + 2));
      this.ticksUntilHit = 30;
      return;
    }

    const poisonDamage = CombatPoisonEffect.damageFromSeverity(currentValue);
    this.entity
      .getCombat()
      .getHitQueue()
      .addPendingDamage([new HitDamage(poisonDamage, HitMask.GREEN)]);

    this.entity.setPoisonDamage(currentValue - 1);
    this.ticksUntilHit = 30;

    if (currentValue <= 1) {
      this.stop();
      return;
    }
  }

  public stop() {
    this.entity.setPoisonDamage(0);
    this.entity.setVenomed(false);

    super.stop();
  }

  /** varp `poison`: what the hitpoints orb and its "Cure" option read. */
  public static readonly ORB_VARP = 102;
  private static readonly ORB_VENOM_BASE = 1_000_000;
  /** Antipoison immunity counts down in steps of 30 ticks (18 seconds). */
  private static readonly ORB_IMMUNITY_STEP_SECONDS = 18;
  /** Shorter immunity is a serpentine helm's refresh, not a dose: the orb leaves it out. */
  private static readonly ORB_IMMUNITY_MIN_SECONDS = 2;

  /**
   * The orb's value, as rsprox captures show it: venom is 1,000,000 plus the hits it has
   * dealt (dark green), poison its severity, dropping a step each hit (green), and antipoison
   * immunity minus the 18-second steps left (-5 for 90 seconds, -20 for 6 minutes); 0 is none.
   */
  public static orbValue(entity: Mobile): number {
    if (entity.isVenomed()) {
      return CombatPoisonEffect.ORB_VENOM_BASE + Math.max(0, Math.round((entity.getPoisonDamage() - 6) / 2));
    }
    if (entity.isPoisoned()) {
      return entity.getPoisonDamage();
    }
    const immunity = entity.getCombat().getPoisonImmunityTimer().secondsRemaining();
    if (immunity > CombatPoisonEffect.ORB_IMMUNITY_MIN_SECONDS) {
      return -Math.ceil(immunity / CombatPoisonEffect.ORB_IMMUNITY_STEP_SECONDS);
    }
    return 0;
  }

  public static damageFromSeverity(severity: number): number {
    return Math.floor((severity + 4) / 5);
  }
}

export enum PoisonType {
  VERY_WEAK = 2,
  WEAK = 3,
  MILD = 4,
  EXTRA = 5,
  SUPER = 6,
  VENOM = 12,
}

export class CombatPoisonData {
  public static types = new Map<number, PoisonType>();

  static init() {
    CombatPoisonData.types.clear();
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_DART_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_DART_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_DART_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_DART_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_DART_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_DART_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_JAVELIN_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_JAVELIN_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_JAVELIN_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_JAVELIN_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_JAVELIN_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_JAVELIN_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_KNIFE_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_KNIFE_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_KNIFE_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_KNIFE_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_KNIFE_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_KNIFE_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_KNIFE_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_BOLTS_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_ARROW_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_ARROW_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_ARROW_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_ARROW_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_ARROW_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_ARROW_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.POISONED_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_SPEAR_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_SPEAR_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_SPEAR_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_SPEAR_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_SPEAR_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_SPEAR_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_SPEAR_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_DART_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_SPEAR_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_ARROW_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_ARROW_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_ARROW_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_ARROW_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_ARROW_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_ARROW_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_ARROW_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_ARROW_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_ARROW_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_ARROW_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_ARROW_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_ARROW_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_DART_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_DART_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_DART_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_DART_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_DART_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_DART_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_DART_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_DART_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_DART_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_DART_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_DART_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_DART_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_DART_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_DART_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_JAVELIN_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_JAVELIN_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_JAVELIN_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_JAVELIN_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_JAVELIN_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_JAVELIN_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_JAVELIN_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_JAVELIN_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_JAVELIN_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_JAVELIN_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_JAVELIN_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_JAVELIN_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_KNIFE_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_KNIFE_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_KNIFE_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_KNIFE_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_KNIFE_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_KNIFE_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_KNIFE_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_KNIFE_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_KNIFE_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_KNIFE_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_KNIFE_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_KNIFE_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_KNIFE_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_KNIFE_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.POISON_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.POISON_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_SPEAR_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_SPEAR_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_SPEAR_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_SPEAR_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_SPEAR_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_SPEAR_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_SPEAR_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_SPEAR_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_SPEAR_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_SPEAR_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_SPEAR_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_SPEAR_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_SPEAR_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_SPEAR_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_SPEAR_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.BLACK_SPEAR_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_BOLTS_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_BOLTS_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.WHITE_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.WHITE_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.WHITE_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.BONE_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BONE_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.BONE_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.BLURITE_BOLTS_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_BOLTS_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_BOLTS_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_BOLTS_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_BOLTS_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.RUNITE_BOLTS_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.SILVER_BOLTS_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BLURITE_BOLTS_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_BOLTS_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_BOLTS_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_BOLTS_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_BOLTS_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.RUNITE_BOLTS_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.SILVER_BOLTS_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.BLURITE_BOLTS_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_BOLTS_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_BOLTS_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_BOLTS_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_BOLTS_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.RUNITE_BOLTS_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.SILVER_BOLTS_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.KERIS_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.KERIS_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.KERIS_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_ARROW_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_ARROW_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_ARROW_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_DART_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_DART_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_DART_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_HASTA_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_HASTA_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.BRONZE_HASTA_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_HASTA_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_HASTA_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.IRON_HASTA_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_HASTA_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_HASTA_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.STEEL_HASTA_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_HASTA_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_HASTA_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.MITHRIL_HASTA_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_HASTA_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_HASTA_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.ADAMANT_HASTA_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_HASTA_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_HASTA_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.RUNE_HASTA_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.ABYSSAL_DAGGER_P_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.ABYSSAL_DAGGER_P_PLUS_, PoisonType.EXTRA);
    CombatPoisonData.types.set(ItemIdentifiers.ABYSSAL_DAGGER_P_PLUS_PLUS_, PoisonType.SUPER);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_JAVELIN_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_JAVELIN_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.DRAGON_JAVELIN_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.AMETHYST_JAVELIN_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.AMETHYST_JAVELIN_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.AMETHYST_JAVELIN_P_PLUS_PLUS_, PoisonType.MILD);
    CombatPoisonData.types.set(ItemIdentifiers.AMETHYST_ARROW_P_, PoisonType.VERY_WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.AMETHYST_ARROW_P_PLUS_, PoisonType.WEAK);
    CombatPoisonData.types.set(ItemIdentifiers.AMETHYST_ARROW_P_PLUS_PLUS_, PoisonType.MILD);

    CombatPoisonData.types.set(ItemIdentifiers.TOXIC_BLOWPIPE, PoisonType.VENOM);
    // Note: Abyssal tentacle has no poison/venom effect in OSRS - do not add it here.
  }

  public static getPoisonType(item?: Item): PoisonType | undefined {
    if (!item || item.getId() < 1 || item.getAmount() < 1) {
      return undefined;
    }

    return CombatPoisonData.types.get(item.getId());
  }

  public static getMeleeSeverity(poisonType: PoisonType): number {
    switch (poisonType) {
      case PoisonType.EXTRA:
        return 25;
      case PoisonType.SUPER:
        return 30;
      // Venom doesn't use the severity/decay model - this is its fixed
      // starting damage (see CombatPoisonEffect.execute and CombatFactory.poisonEntity).
      case PoisonType.VENOM:
        return 6;
      default:
        return 20;
    }
  }

  public static getRangedSeverity(poisonType: PoisonType): number {
    switch (poisonType) {
      case PoisonType.WEAK:
        return 11;
      case PoisonType.MILD:
        return 16;
      case PoisonType.VENOM:
        return 6;
      default:
        return 6;
    }
  }
}


