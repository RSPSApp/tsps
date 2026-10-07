
import { CombatEquipment } from '../CombatEquipment';
import { CombatFactory } from '../CombatFactory';
import { Mobile } from '../../../entity/impl/Mobile';
import type { Player } from '../../../entity/impl/player/Player';
import { Graphic } from '../../../model/Graphic';
import { GraphicHeight } from '../../../model/GraphicHeight';
import { Skill } from '../../../model/Skill';
import { Equipment } from '../../../model/container/impl/Equipment';
import { ItemIdentifiers } from '../../../../util/ItemIdentifiers';
import { Misc } from '../../../../util/Misc';
import { BOW_OF_FAERDHINEN_ARROWS, CRYSTAL_BOW_ALL_WEAPON_IDS, CRYSTAL_BOW_PROJECTILE_ID, isCrystalBow } from './CrystalBow';
import { PluginManager } from '../../../../plugins/PluginManager';
import { HitDamage } from '../hit/HitDamage';
import { HitMask } from '../hit/HitMask';

const getFightType = () => require("../FightType").FightType as typeof import("../FightType").FightType;



export class RangedData {
    /**
  * A map of items and their respective interfaces.
  */
    // TODO - Populate rangedAmmunition maps
    private static rangedWeapons: Map<number, RangedWeapon> = new Map<number, RangedWeapon>();
    private static rangedAmmunition: Map<number, Ammunition> = new Map<number, Ammunition>();

    public static getSpecialEffectsMultiplier(p: Player, target: Mobile, damage: number): number {
        let multiplier = 1.0;

        // Enchanted dragon bolts have their gem's effect.
        switch (Ammunition.effectOf(p.getCombat().getAmmunition())) {
            case Ammunition.ENCHANTED_DIAMOND_BOLT:
                target.performGraphic(new Graphic(758, 0, GraphicHeight.MIDDLE));
                multiplier = 1.15;
                break;

            case Ammunition.ENCHANTED_DRAGONSTONE_DRAGON_BOLT:
            case Ammunition.ENCHANTED_DRAGON_BOLT:
                let multiply = true;
                if (target.isPlayer()) {
                    const t = target.getAsPlayer();
                    multiply = !(!t.getCombat().getFireImmunityTimer().finished() || CombatEquipment.hasDragonProtectionGear(t));
                }

                if (multiply) {
                    target.performGraphic(new Graphic(756));
                    multiplier = 1.31;
                }
                break;

            case Ammunition.ENCHANTED_EMERALD_BOLT:
                target.performGraphic(new Graphic(752));
                CombatFactory.poisonEntity(
                    target,
                    p.getEquipment().get(Equipment.WEAPON_SLOT).getId() === ItemIdentifiers.ZARYTE_CROSSBOW ? 27 : 25
                );
                break;

            case Ammunition.ENCHANTED_JADE_BOLT:
                target.performGraphic(new Graphic(755));
                multiplier = 1.05;
                break;

            case Ammunition.ENCHANTED_ONYX_BOLT:
                target.performGraphic(new Graphic(753));
                multiplier = 1.26;
                const heal = Math.floor(damage * 0.25) + 10;
                p.getSkillManager().setCurrentLevels(Skill.HITPOINTS, p.getSkillManager().getCurrentLevel(Skill.HITPOINTS) + heal);
                if (p.getSkillManager().getCurrentLevel(Skill.HITPOINTS) >= 1120) {
                    p.getSkillManager().setCurrentLevels(Skill.HITPOINTS, 1120);
                }
                p.getSkillManager().updateSkill(Skill.HITPOINTS);
                if (damage < 250 && Misc.getRandom(3) <= 1) {
                    damage += 150 + Misc.getRandom(80);
                }
                break;

            case Ammunition.ENCHANTED_PEARL_BOLT:
                target.performGraphic(new Graphic(750));
                multiplier = 1.1;
                break;

            case Ammunition.ENCHANTED_RUBY_BOLT: {
                // Blood Forfeit (Wiki): 20% of the target's current hitpoints, at most 100, for
                // 10% of the player's own; not when the player can't spare them.
                const cost = Math.floor(p.getHitpoints() * 0.1);
                const forfeit = Math.min(100, Math.floor(target.getHitpoints() * 0.2));
                if (cost < 1 || forfeit < 1 || damage <= 0) break;
                target.performGraphic(new Graphic(754));
                p.getCombat().getHitQueue().addPendingDamage([new HitDamage(cost, HitMask.RED)]);
                multiplier = forfeit / damage;
                break;
            }

            case Ammunition.ENCHANTED_SAPPHIRE_BOLT:
                target.performGraphic(new Graphic(751));
                if (target.isPlayer()) {
                    const t = target.getAsPlayer();
                    t.getSkillManager().setCurrentLevels(Skill.PRAYER, t.getSkillManager().getCurrentLevel(Skill.PRAYER) - 20);
                    if (t.getSkillManager().getCurrentLevel(Skill.PRAYER) < 0) {
                        t.getSkillManager().setCurrentLevels(Skill.PRAYER, 0);
                    }
                    t.sendMessage("Your Prayer level has been leeched.");

                    p.getSkillManager().setCurrentLevels(Skill.PRAYER, t.getSkillManager().getCurrentLevel(Skill.PRAYER) + 20);
                    if (p.getSkillManager().getCurrentLevel(Skill.PRAYER) > p.getSkillManager().getMaxLevel(Skill.PRAYER)) {
                        p.getSkillManager().setCurrentLevels(Skill.PRAYER, p.getSkillManager().getMaxLevel(Skill.PRAYER));
                    } else {
                        p.sendMessage("Your enchanced bolts leech some Prayer points from your opponent..");
                    }
                }
                break;
            case Ammunition.ENCHANTED_TOPAZ_BOLT:


                target.performGraphic(new Graphic(757));
                if (target.isPlayer()) {
                    const t = target.getAsPlayer();
                    t.getSkillManager().setCurrentLevels(Skill.MAGIC, t.getSkillManager().getCurrentLevel(Skill.MAGIC) - 3);
                    t.sendMessage("Your Magic level has been reduced.");
                }

                break;
            case Ammunition.ENCHANTED_OPAL_BOLT:


                target.performGraphic(new Graphic(749));
                multiplier = 1.3;

                break;
        }

        return multiplier;
    }

}

export class Ammunition {
    private static rangedAmmunition: Map<number, Ammunition> = new Map<number, Ammunition>();

    public static readonly BRONZE_ARROW = new Ammunition(882, new Graphic(19, 0, GraphicHeight.HIGH), 10, 7)
    public static readonly IRON_ARROW = new Ammunition(884, new Graphic(18, 0, GraphicHeight.HIGH), 9, 10)
    public static readonly STEEL_ARROW = new Ammunition(886, new Graphic(20, 0, GraphicHeight.HIGH), 11, 16)
    public static readonly MITHRIL_ARROW = new Ammunition(888, new Graphic(21, 0, GraphicHeight.HIGH), 12, 22)
    public static readonly ADAMANT_ARROW = new Ammunition(890, new Graphic(22, 0, GraphicHeight.HIGH), 13, 31)
    public static readonly RUNE_ARROW = new Ammunition(892, new Graphic(24, 0, GraphicHeight.HIGH), 15, 50)
    public static readonly ICE_ARROW = new Ammunition(78, new Graphic(25, 0, GraphicHeight.HIGH), 16, 58)
    public static readonly BROAD_ARROW = new Ammunition(4160, new Graphic(20, 0, GraphicHeight.HIGH), 11, 58)
    // RuneLite names these AIDE_ARROW_LAUNCH/TRAVEL; their recolours match the training
    // arrow item's palette [61,57,5012,926] -> [127,111,41366,41282].
    public static readonly TRAINING_ARROWS = new Ammunition(ItemIdentifiers.TRAINING_ARROWS, new Graphic(806, 0, GraphicHeight.HIGH), 805, 7)
    public static readonly DRAGON_ARROW = new Ammunition(11212, new Graphic(1111, 0, GraphicHeight.HIGH), 1120, 65)

    public static readonly BRONZE_BOLT = new Ammunition(877, new Graphic(955, 0, GraphicHeight.HIGH), 27, 13)
    public static readonly OPAL_BOLT = new Ammunition(879, new Graphic(955, 0, GraphicHeight.HIGH), 27, 20)
    public static readonly ENCHANTED_OPAL_BOLT = new Ammunition(9236, new Graphic(955, 0, GraphicHeight.HIGH), 27, 20)
    public static readonly IRON_BOLT = new Ammunition(9140, new Graphic(955, 0, GraphicHeight.HIGH), 27, 28)
    public static readonly JADE_BOLT = new Ammunition(9335, new Graphic(955, 0, GraphicHeight.HIGH), 27, 31)
    public static readonly ENCHANTED_JADE_BOLT = new Ammunition(9237, new Graphic(955, 0, GraphicHeight.HIGH), 27, 31)
    public static readonly STEEL_BOLT = new Ammunition(9141, new Graphic(955, 0, GraphicHeight.HIGH), 27, 35)
    public static readonly PEARL_BOLT = new Ammunition(880, new Graphic(955, 0, GraphicHeight.HIGH), 27, 38)
    public static readonly ENCHANTED_PEARL_BOLT = new Ammunition(9238, new Graphic(955, 0, GraphicHeight.HIGH), 27, 38)
    public static readonly MITHRIL_BOLT = new Ammunition(9142, new Graphic(955, 0, GraphicHeight.HIGH), 27, 40)
    public static readonly TOPAZ_BOLT = new Ammunition(9336, new Graphic(955, 0, GraphicHeight.HIGH), 27, 50)
    public static readonly ENCHANTED_TOPAZ_BOLT = new Ammunition(9239, new Graphic(955, 0, GraphicHeight.HIGH), 27, 50)
    public static readonly ADAMANT_BOLT = new Ammunition(9143, new Graphic(955, 0, GraphicHeight.HIGH), 27, 60)
    public static readonly SAPPHIRE_BOLT = new Ammunition(9337, new Graphic(955, 0, GraphicHeight.HIGH), 27, 65)
    public static readonly ENCHANTED_SAPPHIRE_BOLT = new Ammunition(9240, new Graphic(955, 0, GraphicHeight.HIGH), 27, 65)
    public static readonly EMERALD_BOLT = new Ammunition(9338, new Graphic(955, 0, GraphicHeight.HIGH), 27, 70)
    public static readonly ENCHANTED_EMERALD_BOLT = new Ammunition(9241, new Graphic(955, 0, GraphicHeight.HIGH), 27, 70)
    public static readonly RUBY_BOLT = new Ammunition(9339, new Graphic(955, 0, GraphicHeight.HIGH), 27, 75)
    public static readonly ENCHANTED_RUBY_BOLT = new Ammunition(9242, new Graphic(955, 0, GraphicHeight.HIGH), 27, 75)
    public static readonly BROAD_BOLT = new Ammunition(13280, new Graphic(955, 0, GraphicHeight.HIGH), 27, 100)
    public static readonly RUNITE_BOLT = new Ammunition(9144, new Graphic(955, 0, GraphicHeight.HIGH), 27, 115)
    public static readonly DIAMOND_BOLT = new Ammunition(9340, new Graphic(955, 0, GraphicHeight.HIGH), 27, 105)
    public static readonly ENCHANTED_DIAMOND_BOLT = new Ammunition(9243, new Graphic(955, 0, GraphicHeight.HIGH), 27, 105)
    public static readonly DRAGON_BOLT = new Ammunition(9341, new Graphic(955, 0, GraphicHeight.HIGH), 27, 117)
    public static readonly ENCHANTED_DRAGON_BOLT = new Ammunition(9244, new Graphic(955, 0, GraphicHeight.HIGH), 27, 117)
    public static readonly ONYX_BOLT = new Ammunition(9342, new Graphic(955, 0, GraphicHeight.HIGH), 27, 120)
    public static readonly ENCHANTED_ONYX_BOLT = new Ammunition(9245, new Graphic(955, 0, GraphicHeight.HIGH), 27, 120)
    public static readonly ENCHANTED_DRAGONSTONE_DRAGON_BOLT = new Ammunition(ItemIdentifiers.DRAGONSTONE_DRAGON_BOLTS_E_, new Graphic(955, 0, GraphicHeight.HIGH), 27, 122)

    // Dragon bolts, plain and gem-tipped: +122 ranged strength (Wiki), for a dragon crossbow or better.
    public static readonly DRAGON_BOLTS = Ammunition.dragonBolt(ItemIdentifiers.DRAGON_BOLTS_2)
    public static readonly OPAL_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.OPAL_DRAGON_BOLTS)
    public static readonly ENCHANTED_OPAL_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.OPAL_DRAGON_BOLTS_E_)
    public static readonly JADE_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.JADE_DRAGON_BOLTS)
    public static readonly ENCHANTED_JADE_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.JADE_DRAGON_BOLTS_E_)
    public static readonly PEARL_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.PEARL_DRAGON_BOLTS)
    public static readonly ENCHANTED_PEARL_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.PEARL_DRAGON_BOLTS_E_)
    public static readonly TOPAZ_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.TOPAZ_DRAGON_BOLTS)
    public static readonly ENCHANTED_TOPAZ_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.TOPAZ_DRAGON_BOLTS_E_)
    public static readonly SAPPHIRE_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.SAPPHIRE_DRAGON_BOLTS)
    public static readonly ENCHANTED_SAPPHIRE_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.SAPPHIRE_DRAGON_BOLTS_E_)
    public static readonly EMERALD_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.EMERALD_DRAGON_BOLTS)
    public static readonly ENCHANTED_EMERALD_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.EMERALD_DRAGON_BOLTS_E_)
    public static readonly RUBY_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.RUBY_DRAGON_BOLTS)
    public static readonly ENCHANTED_RUBY_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.RUBY_DRAGON_BOLTS_E_)
    public static readonly DIAMOND_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.DIAMOND_DRAGON_BOLTS)
    public static readonly ENCHANTED_DIAMOND_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.DIAMOND_DRAGON_BOLTS_E_)
    public static readonly DRAGONSTONE_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.DRAGONSTONE_DRAGON_BOLTS)
    public static readonly ONYX_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.ONYX_DRAGON_BOLTS)
    public static readonly ENCHANTED_ONYX_DRAGON_BOLT = Ammunition.dragonBolt(ItemIdentifiers.ONYX_DRAGON_BOLTS_E_)
    /** Every dragon bolt, for the crossbows that fire them. */
    public static readonly ALL_DRAGON_BOLTS: Ammunition[] = [
        Ammunition.DRAGON_BOLTS,
        Ammunition.OPAL_DRAGON_BOLT, Ammunition.ENCHANTED_OPAL_DRAGON_BOLT,
        Ammunition.JADE_DRAGON_BOLT, Ammunition.ENCHANTED_JADE_DRAGON_BOLT,
        Ammunition.PEARL_DRAGON_BOLT, Ammunition.ENCHANTED_PEARL_DRAGON_BOLT,
        Ammunition.TOPAZ_DRAGON_BOLT, Ammunition.ENCHANTED_TOPAZ_DRAGON_BOLT,
        Ammunition.SAPPHIRE_DRAGON_BOLT, Ammunition.ENCHANTED_SAPPHIRE_DRAGON_BOLT,
        Ammunition.EMERALD_DRAGON_BOLT, Ammunition.ENCHANTED_EMERALD_DRAGON_BOLT,
        Ammunition.RUBY_DRAGON_BOLT, Ammunition.ENCHANTED_RUBY_DRAGON_BOLT,
        Ammunition.DIAMOND_DRAGON_BOLT, Ammunition.ENCHANTED_DIAMOND_DRAGON_BOLT,
        Ammunition.DRAGONSTONE_DRAGON_BOLT, Ammunition.ENCHANTED_DRAGONSTONE_DRAGON_BOLT,
        Ammunition.ONYX_DRAGON_BOLT, Ammunition.ENCHANTED_ONYX_DRAGON_BOLT,
    ]
    /** An enchanted dragon bolt -> the enchanted gem bolt whose effect it has. */
    private static readonly DRAGON_BOLT_EFFECTS = new Map<Ammunition, Ammunition>([
        [Ammunition.ENCHANTED_OPAL_DRAGON_BOLT, Ammunition.ENCHANTED_OPAL_BOLT],
        [Ammunition.ENCHANTED_JADE_DRAGON_BOLT, Ammunition.ENCHANTED_JADE_BOLT],
        [Ammunition.ENCHANTED_PEARL_DRAGON_BOLT, Ammunition.ENCHANTED_PEARL_BOLT],
        [Ammunition.ENCHANTED_TOPAZ_DRAGON_BOLT, Ammunition.ENCHANTED_TOPAZ_BOLT],
        [Ammunition.ENCHANTED_SAPPHIRE_DRAGON_BOLT, Ammunition.ENCHANTED_SAPPHIRE_BOLT],
        [Ammunition.ENCHANTED_EMERALD_DRAGON_BOLT, Ammunition.ENCHANTED_EMERALD_BOLT],
        [Ammunition.ENCHANTED_RUBY_DRAGON_BOLT, Ammunition.ENCHANTED_RUBY_BOLT],
        [Ammunition.ENCHANTED_DIAMOND_DRAGON_BOLT, Ammunition.ENCHANTED_DIAMOND_BOLT],
        [Ammunition.ENCHANTED_ONYX_DRAGON_BOLT, Ammunition.ENCHANTED_ONYX_BOLT],
    ])

    private static dragonBolt(itemId: number): Ammunition {
        return new Ammunition(itemId, new Graphic(955, 0, GraphicHeight.HIGH), 27, 122)
    }

    /** The bolt whose special effect this ammunition has (itself, unless an enchanted dragon bolt). */
    public static effectOf(ammunition: Ammunition | null | undefined): Ammunition | null | undefined {
        return (ammunition && Ammunition.DRAGON_BOLT_EFFECTS.get(ammunition)) ?? ammunition
    }

    public static readonly BRONZE_DART = new Ammunition(806, new Graphic(232, 0, GraphicHeight.HIGH), 226, 1)
    public static readonly IRON_DART = new Ammunition(807, new Graphic(233, 0, GraphicHeight.HIGH), 227, 4)
    public static readonly STEEL_DART = new Ammunition(808, new Graphic(234, 0, GraphicHeight.HIGH), 228, 6)
    public static readonly MITHRIL_DART = new Ammunition(809, new Graphic(235, 0, GraphicHeight.HIGH), 229, 8)
    public static readonly ADAMANT_DART = new Ammunition(810, new Graphic(236, 0, GraphicHeight.HIGH), 230, 13)
    public static readonly RUNE_DART = new Ammunition(811, new Graphic(237, 0, GraphicHeight.HIGH), 231, 17)
    public static readonly BLACK_DART = new Ammunition(ItemIdentifiers.BLACK_DART, new Graphic(237, 0, GraphicHeight.HIGH), 231, 6)
    public static readonly AMETHYST_DART = new Ammunition(ItemIdentifiers.AMETHYST_DART, new Graphic(1123, 0, GraphicHeight.HIGH), 226, 28)
    public static readonly DRAGON_DART = new Ammunition(11230, new Graphic(1123, 0, GraphicHeight.HIGH), 226, 24)

    public static readonly BRONZE_KNIFE = new Ammunition(864, new Graphic(219, 0, GraphicHeight.HIGH), 212, 3)
    public static readonly BRONZE_KNIFE_P1 = new Ammunition(870, new Graphic(219, 0, GraphicHeight.HIGH), 212, 3)
    public static readonly BRONZE_KNIFE_P2 = new Ammunition(5654, new Graphic(219, 0, GraphicHeight.HIGH), 212, 3)
    public static readonly BRONZE_KNIFE_P3 = new Ammunition(5661, new Graphic(219, 0, GraphicHeight.HIGH), 212, 3)

    public static readonly IRON_KNIFE = new Ammunition(863, new Graphic(220, 0, GraphicHeight.HIGH), 213, 4)
    public static readonly IRON_KNIFE_P1 = new Ammunition(871, new Graphic(220, 0, GraphicHeight.HIGH), 213, 4)
    public static readonly IRON_KNIFE_P2 = new Ammunition(5655, new Graphic(220, 0, GraphicHeight.HIGH), 213, 4)
    public static readonly IRON_KNIFE_P3 = new Ammunition(5662, new Graphic(220, 0, GraphicHeight.HIGH), 213, 4)

    public static readonly STEEL_KNIFE = new Ammunition(865, new Graphic(221, 0, GraphicHeight.HIGH), 214, 7)
    public static readonly STEEL_KNIFE_P1 = new Ammunition(872, new Graphic(221, 0, GraphicHeight.HIGH), 214, 7)
    public static readonly STEEL_KNIFE_P2 = new Ammunition(5656, new Graphic(221, 0, GraphicHeight.HIGH), 214, 7)
    public static readonly STEEL_KNIFE_P3 = new Ammunition(5663, new Graphic(221, 0, GraphicHeight.HIGH), 214, 7)

    public static readonly BLACK_KNIFE = new Ammunition(869, new Graphic(222, 0, GraphicHeight.HIGH), 215, 8)
    public static readonly BLACK_KNIFE_P1 = new Ammunition(874, new Graphic(222, 0, GraphicHeight.HIGH), 215, 8)
    public static readonly BLACK_KNIFE_P2 = new Ammunition(5658, new Graphic(222, 0, GraphicHeight.HIGH), 215, 8)
    public static readonly BLACK_KNIFE_P3 = new Ammunition(5665, new Graphic(222, 0, GraphicHeight.HIGH), 215, 8)

    public static readonly MITHRIL_KNIFE = new Ammunition(866, new Graphic(223, 0, GraphicHeight.HIGH), 215, 10)
    public static readonly MITHRIL_KNIFE_P1 = new Ammunition(873, new Graphic(223, 0, GraphicHeight.HIGH), 215, 10)
    public static readonly MITHRIL_KNIFE_P2 = new Ammunition(5657, new Graphic(223, 0, GraphicHeight.HIGH), 215, 10)
    public static readonly MITHRIL_KNIFE_P3 = new Ammunition(5664, new Graphic(223, 0, GraphicHeight.HIGH), 215, 10)

    public static readonly ADAMANT_KNIFE = new Ammunition(867, new Graphic(224, 0, GraphicHeight.HIGH), 217, 14)
    public static readonly ADAMANT_KNIFE_P1 = new Ammunition(875, new Graphic(224, 0, GraphicHeight.HIGH), 217, 14)
    public static readonly ADAMANT_KNIFE_P2 = new Ammunition(5659, new Graphic(224, 0, GraphicHeight.HIGH), 217, 14)
    public static readonly ADAMANT_KNIFE_P3 = new Ammunition(5666, new Graphic(224, 0, GraphicHeight.HIGH), 217, 14)

    public static readonly RUNE_KNIFE = new Ammunition(868, new Graphic(225, 0, GraphicHeight.HIGH), 218, 24)
    public static readonly RUNE_KNIFE_P1 = new Ammunition(876, new Graphic(225, 0, GraphicHeight.HIGH), 218, 24)
    public static readonly RUNE_KNIFE_P2 = new Ammunition(5660, new Graphic(225, 0, GraphicHeight.HIGH), 218, 24)
    public static readonly RUNE_KNIFE_P3 = new Ammunition(5667, new Graphic(225, 0, GraphicHeight.HIGH), 218, 24)
    public static readonly DRAGON_KNIFE = new Ammunition(ItemIdentifiers.DRAGON_KNIFE, null, 28, 30)
    public static readonly DRAGON_KNIFE_P1 = new Ammunition(ItemIdentifiers.DRAGON_KNIFE_P_, null, 697, 30)
    public static readonly DRAGON_KNIFE_P2 = new Ammunition(ItemIdentifiers.DRAGON_KNIFE_P_PLUS_, null, 697, 30)
    public static readonly DRAGON_KNIFE_P3 = new Ammunition(ItemIdentifiers.DRAGON_KNIFE_P_PLUS_PLUS_, null, 697, 30)

    public static readonly BRONZE_JAVELIN = new Ammunition(825, null, 200, 25)
    public static readonly IRON_JAVELIN = new Ammunition(826, null, 201, 42)
    public static readonly STEEL_JAVELIN = new Ammunition(827, null, 202, 64)
    public static readonly MITHRIL_JAVELIN = new Ammunition(828, null, 203, 85)
    public static readonly ADAMANT_JAVELIN = new Ammunition(829, null, 204, 107)
    public static readonly RUNE_JAVELIN = new Ammunition(830, null, 205, 124)
    public static readonly DRAGON_JAVELIN = new Ammunition(19484, null, 1301, 150)
    public static readonly MORRIGANS_JAVELIN = new Ammunition(ItemIdentifiers.MORRIGANS_JAVELIN, null, 200, 145)

    public static readonly TOKTZ_XIL_UL = new Ammunition(6522, null, 442, 58)

    public static readonly BOLT_RACK = new Ammunition(4740, null, 27, 55)
    public static readonly CRYSTAL_BOW = new Ammunition(ItemIdentifiers.CRYSTAL_BOW_FULL, null, CRYSTAL_BOW_PROJECTILE_ID, 0)
    // The Gauntlet's crystal and corrupted bows: no ammunition, the strength is on the bow.
    public static readonly GAUNTLET_BOW = new Ammunition(ItemIdentifiers.CRYSTAL_BOW_BASIC_, null, CRYSTAL_BOW_PROJECTILE_ID, 0)
    // Self-ammo weapons: the item generates its own projectile and is not loaded
    // from the ammo slot. Projectile ids are travel spotanims (RuneLite SpotanimID).
    // Craw's/Webweaver shots are the yellow-orange aura arrow (crystal-bow-style glow).
    public static readonly WEBWEAVER_BOW = new Ammunition(ItemIdentifiers.WEBWEAVER_BOW, new Graphic(1692, 0, GraphicHeight.HIGH), 1693, 0) // arrow_glow_orange launch/travel
    public static readonly CRAWS_BOW = new Ammunition(ItemIdentifiers.CRAWS_BOW, new Graphic(1692, 0, GraphicHeight.HIGH), 1693, 0) // arrow_glow_orange launch/travel
    // Thrownaxes (Wiki): ranged strength +5/+7/+11/+16/+23/+36/+47; launch/travel spotanims from the cache.
    public static readonly BRONZE_THROWNAXE = new Ammunition(ItemIdentifiers.BRONZE_THROWNAXE, new Graphic(43, 0, GraphicHeight.HIGH), 36, 5)
    public static readonly IRON_THROWNAXE = new Ammunition(ItemIdentifiers.IRON_THROWNAXE, new Graphic(42, 0, GraphicHeight.HIGH), 35, 7)
    public static readonly STEEL_THROWNAXE = new Ammunition(ItemIdentifiers.STEEL_THROWNAXE, new Graphic(44, 0, GraphicHeight.HIGH), 37, 11)
    public static readonly MITHRIL_THROWNAXE = new Ammunition(ItemIdentifiers.MITHRIL_THROWNAXE, new Graphic(45, 0, GraphicHeight.HIGH), 38, 16)
    public static readonly ADAMANT_THROWNAXE = new Ammunition(ItemIdentifiers.ADAMANT_THROWNAXE, new Graphic(46, 0, GraphicHeight.HIGH), 39, 23)
    public static readonly RUNE_THROWNAXE = new Ammunition(ItemIdentifiers.RUNE_THROWNAXE, new Graphic(48, 0, GraphicHeight.HIGH), 41, 36) // RUNE_TAXE_LAUNCH/TRAVEL
    public static readonly DRAGON_THROWNAXE = new Ammunition(ItemIdentifiers.DRAGON_THROWNAXE, new Graphic(1320, 0, GraphicHeight.HIGH), 1319, 47) // DRAGON_TAXE_LAUNCH/TRAVEL
    public static readonly MORRIGANS_THROWING_AXE = new Ammunition(ItemIdentifiers.MORRIGANS_THROWING_AXE_BH_, new Graphic(1624, 0, GraphicHeight.HIGH), 1623, 0) // MORRIGANS_TAXE_LAUNCH/TRAVEL
    public static readonly BOW_OF_FAERDHINEN: Ammunition[] = BOW_OF_FAERDHINEN_ARROWS.map(
        ({ bow, travel, launch }) => new Ammunition(bow, new Graphic(launch, 0, GraphicHeight.HIGH), travel, 0)
    );
    // Chinchompas: the wielded creature is its own ammunition (RuneLite grenade spotanims).
    public static readonly CHINCHOMPA = new Ammunition(ItemIdentifiers.CHINCHOMPA_2, null, 908, 0) // CHINCHOMPA_GRENADE
    public static readonly RED_CHINCHOMPA = new Ammunition(ItemIdentifiers.RED_CHINCHOMPA_2, null, 909, 0) // BIG_CHINCHOMPA_GRENADE
    public static readonly BLACK_CHINCHOMPA = new Ammunition(ItemIdentifiers.BLACK_CHINCHOMPA, null, 1272, 0) // BLACK_CHINCHOMPA_GRENADE
    // Salamander fuel (Wiki): the tar's ranged strength is the ranged-mode max-hit basis.
    public static readonly GUAM_TAR = new Ammunition(ItemIdentifiers.GUAM_TAR, null, 33, 16)
    public static readonly MARRENTILL_TAR = new Ammunition(ItemIdentifiers.MARRENTILL_TAR, null, 33, 20)
    public static readonly TARROMIN_TAR = new Ammunition(ItemIdentifiers.TARROMIN_TAR, null, 33, 26)
    public static readonly HARRALANDER_TAR = new Ammunition(ItemIdentifiers.HARRALANDER_TAR, null, 33, 31)
    public static readonly IRIT_TAR = new Ammunition(ItemIdentifiers.IRIT_TAR, null, 33, 36)
    public static readonly TONALZTICS_OF_RALOS = new Ammunition(ItemIdentifiers.TONALZTICS_OF_RALOS, null, 2729, 0) // PROJANIM_GLAIVE_01_REGULAR

    private readonly startGfx: Graphic;
    private readonly itemId: number;
    private readonly projectileId: number;
    private readonly strength: number;


    constructor(itemId: number, startGfx: Graphic, projectileId: number, strength: number) {
        this.itemId = itemId;
        this.startGfx = startGfx;
        this.projectileId = projectileId;
        this.strength = strength;
        Ammunition.rangedAmmunition.set(itemId, this);
    }

    /**
     * Whether the wielded weapon fires what is in the ammo slot (bows, crossbows). Thrown
     * weapons, self-ammo bows and plugin-loaded weapons (the blowpipe) don't, so the ammo
     * slot's ranged strength doesn't count for them. Mirrors getFor.
     */
    public static firesFromAmmoSlot(p: Player): boolean {
        const weapon = Number(p.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.() ?? -1);
        if (isCrystalBow(weapon) || RangedWeapon.getSelfAmmo(weapon)) return false;
        if (PluginManager.resolveRangedAmmunition(p) != null) return false;
        return !Ammunition.rangedAmmunition.has(weapon);
    }

    public static getFor(p: Player): Ammunition {
        // First try to get a throw weapon as ammo
        const weapon = Number(p.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId());
        if (isCrystalBow(weapon)) {
            return Ammunition.CRYSTAL_BOW;
        }
        // Self-ammo weapons (self-charging bows, thrown weapons) resolve their own ammo.
        const selfAmmo = RangedWeapon.getSelfAmmo(weapon);
        if (selfAmmo) {
            return selfAmmo;
        }
        const pluginResolvedAmmo = PluginManager.resolveRangedAmmunition(p);
        if (pluginResolvedAmmo != null) {
            return pluginResolvedAmmo;
        }
        const throwWeapon = Ammunition.rangedAmmunition.get(weapon);

        // Didn't find one. Try arrows
        if (throwWeapon == null) {
            const ammoId = Number(p.getEquipment().getItems()[Equipment.AMMUNITION_SLOT].getId());
            return Ammunition.rangedAmmunition.get(ammoId);
        }

        return throwWeapon;
    }

    public static getForItem(item: number): Ammunition {
        item = Number(item);
        // First try to get a throw weapon as ammo
        const throwWeapon = Ammunition.rangedAmmunition.get(item);

        // Didn't find one. Try arrows
        if (throwWeapon == null) {
            return Ammunition.rangedAmmunition.get(item);
        }

        return throwWeapon;
    }

    public getItemId(): number {
        return this.itemId;
    }

    public getStartGraphic(): Graphic {
        return this.startGfx;
    }

    public getProjectileId(): number {
        return this.projectileId;
    }

    public getStrength(): number {
        return this.strength;
    }
}

export class RangedWeaponType {
    private readonly defaultDistance: number;
    private readonly longRangeDistance: number;
    private readonly longRangeFightType: any;

    constructor(defaultDistance: number, longRangeDistance: number, longRangeFightType: any) {
        this.defaultDistance = defaultDistance;
        this.longRangeDistance = longRangeDistance;
        this.longRangeFightType = longRangeFightType;
    }

    static get KNIFE() { const FT: any = getFightType(); return new RangedWeaponType(4, 6, FT?.KNIFE_LONGRANGE ?? null); }
    static get THROWNAXE() { const FT: any = getFightType(); return new RangedWeaponType(4, 6, FT?.THROWNAXE_LONGRANGE ?? null); }
    static get GLAIVE() { return new RangedWeaponType(5, 6, null); }
    static get DART() { const FT: any = getFightType(); return new RangedWeaponType(3, 5, FT?.DART_LONGRANGE ?? null); }
    static get TOKTZ_XIL_UL() { const FT: any = getFightType(); return new RangedWeaponType(5, 6, FT?.OBBY_RING_LONGRANGE ?? null); }
    static get MORRIGANS_JAVELIN() { const FT: any = getFightType(); return new RangedWeaponType(5, 6, FT?.JAVELIN_LONGRANGE ?? null); }
    static get CHINCHOMPA() { const FT: any = getFightType(); return new RangedWeaponType(9, 9, FT?.CHINCHOMPA_LONG_FUSE ?? null); }
    static get SALAMANDER() { return new RangedWeaponType(1, 1, null); }
    static get LONGBOW() { const FT: any = getFightType(); return new RangedWeaponType(9, 10, FT?.LONGBOW_LONGRANGE ?? null); }
    static get TWISTED_BOW() { const FT: any = getFightType(); return new RangedWeaponType(10, 10, FT?.LONGBOW_LONGRANGE ?? null); }
    /** Wiki: attack range 10, longbow styles. */
    static get SCORCHING_BOW() { const FT: any = getFightType(); return new RangedWeaponType(10, 10, FT?.LONGBOW_LONGRANGE ?? null); }
    static get BLOWPIPE() { const FT: any = getFightType(); return new RangedWeaponType(5, 7, FT?.BLOWPIPE_LONGRANGE ?? null); }
    static get SHORTBOW() { const FT: any = getFightType(); return new RangedWeaponType(7, 9, FT?.SHORTBOW_LONGRANGE ?? null); }
    static get CRYSTAL_BOW() { const FT: any = getFightType(); return new RangedWeaponType(10, 10, FT?.SHORTBOW_LONGRANGE ?? null); }
    static get GAUNTLET_BOW() { const FT: any = getFightType(); return new RangedWeaponType(10, 10, FT?.LONGBOW_LONGRANGE ?? null); }
    static get CROSSBOW() { const FT: any = getFightType(); return new RangedWeaponType(7, 9, FT?.CROSSBOW_LONGRANGE ?? null); }
    static get BALLISTA() { const FT: any = getFightType(); return new RangedWeaponType(7, 9, FT?.BALLISTA_LONGRANGE ?? null); }

    public getDefaultDistance(): number {
        return this.defaultDistance;
    }

    public getLongRangeDistance(): number {
        return this.longRangeDistance;
    }

    public getLongRangeFightType(): any {
        return this.longRangeFightType;
    }

}

export class RangedWeapon {
    private static rangedWeapons: Map<number, RangedWeapon> = new Map<number, RangedWeapon>();
    /** Weapons with exactly one ammo entry are self-ammo (thrown / charge bows). */
    private static selfAmmoByWeapon: Map<number, Ammunition> = new Map<number, Ammunition>();

    public static readonly LONGBOW = new RangedWeapon([839], [Ammunition.BRONZE_ARROW], RangedWeaponType.LONGBOW)
    public static readonly SHORTBOW = new RangedWeapon([841], [Ammunition.BRONZE_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly TRAINING_BOW = new RangedWeapon([ItemIdentifiers.TRAINING_BOW], [Ammunition.TRAINING_ARROWS], RangedWeaponType.SHORTBOW)
    public static readonly OAK_LONGBOW = new RangedWeapon([845], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW], RangedWeaponType.LONGBOW)
    public static readonly OAK_SHORTBOW = new RangedWeapon([843], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly WILLOW_LONGBOW = new RangedWeapon([847], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW], RangedWeaponType.LONGBOW)
    public static readonly WILLOW_SHORTBOW = new RangedWeapon([849], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly MAPLE_LONGBOW = new RangedWeapon([851], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW], RangedWeaponType.LONGBOW)
    public static readonly MAPLE_SHORTBOW = new RangedWeapon([853], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly YEW_LONGBOW = new RangedWeapon([855], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.ICE_ARROW], RangedWeaponType.LONGBOW)
    public static readonly YEW_SHORTBOW = new RangedWeapon([857], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.ICE_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly MAGIC_LONGBOW = new RangedWeapon([859], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.ICE_ARROW, Ammunition.BROAD_ARROW], RangedWeaponType.LONGBOW)
    public static readonly MAGIC_SHORTBOW = new RangedWeapon([861, ItemIdentifiers.MAGIC_SHORTBOW_I_, ItemIdentifiers.MAGIC_SHORTBOW_3], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.ICE_ARROW, Ammunition.BROAD_ARROW], RangedWeaponType.SHORTBOW)
    // Wiki: 3rd Age bow shoots at shortbow speed with a 9-tile range and can fire dragon arrows.
    public static readonly THIRD_AGE_BOW = new RangedWeapon([ItemIdentifiers._3RD_AGE_BOW], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.ICE_ARROW, Ammunition.BROAD_ARROW, Ammunition.DRAGON_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly CRYSTAL_BOW = new RangedWeapon(CRYSTAL_BOW_ALL_WEAPON_IDS, [Ammunition.CRYSTAL_BOW], RangedWeaponType.CRYSTAL_BOW)
    public static readonly GAUNTLET_BOW = new RangedWeapon([
        ItemIdentifiers.CRYSTAL_BOW_BASIC_, ItemIdentifiers.CRYSTAL_BOW_ATTUNED_, ItemIdentifiers.CRYSTAL_BOW_PERFECTED_,
        ItemIdentifiers.CORRUPTED_BOW_BASIC_, ItemIdentifiers.CORRUPTED_BOW_ATTUNED_, ItemIdentifiers.CORRUPTED_BOW_PERFECTED_,
    ], [Ammunition.GAUNTLET_BOW], RangedWeaponType.GAUNTLET_BOW)
    public static readonly GODBOW = new RangedWeapon([19143, 19149, 19146], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.BROAD_ARROW, Ammunition.DRAGON_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly ZARYTE_BOW = new RangedWeapon([20171], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.BROAD_ARROW, Ammunition.DRAGON_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly WEBWEAVER_BOW = new RangedWeapon([ItemIdentifiers.WEBWEAVER_BOW, ItemIdentifiers.WEBWEAVER_BOW_2], [Ammunition.WEBWEAVER_BOW], RangedWeaponType.SHORTBOW)
    public static readonly BOW_OF_FAERDHINEN: RangedWeapon[] = Ammunition.BOW_OF_FAERDHINEN.map(
        (arrows) => new RangedWeapon([arrows.getItemId()], [arrows], RangedWeaponType.CRYSTAL_BOW)
    );
    public static readonly CRAWS_BOW = new RangedWeapon([ItemIdentifiers.CRAWS_BOW, ItemIdentifiers.CRAWS_BOW_2], [Ammunition.CRAWS_BOW], RangedWeaponType.SHORTBOW)
    public static readonly SEERCULL = new RangedWeapon([ItemIdentifiers.SEERCULL], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.ICE_ARROW, Ammunition.BROAD_ARROW, Ammunition.DRAGON_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly TWISTED_BOW = new RangedWeapon([ItemIdentifiers.TWISTED_BOW], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.ICE_ARROW, Ammunition.BROAD_ARROW, Ammunition.DRAGON_ARROW], RangedWeaponType.TWISTED_BOW)

    /** Wiki: fires arrows up to dragon arrows. */
    public static readonly SCORCHING_BOW = new RangedWeapon([ItemIdentifiers.SCORCHING_BOW], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.ICE_ARROW, Ammunition.BROAD_ARROW, Ammunition.DRAGON_ARROW], RangedWeaponType.SCORCHING_BOW)
    public static readonly DARK_BOW = new RangedWeapon([11235, 13405, 15701, 15702, 15703, 15704], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.DRAGON_ARROW], RangedWeaponType.LONGBOW)

    public static readonly BRONZE_CROSSBOW = new RangedWeapon([9174], [Ammunition.BRONZE_BOLT], RangedWeaponType.CROSSBOW)
    public static readonly IRON_CROSSBOW = new RangedWeapon([9177], [Ammunition.BRONZE_BOLT, Ammunition.OPAL_BOLT, Ammunition.ENCHANTED_OPAL_BOLT, Ammunition.IRON_BOLT], RangedWeaponType.CROSSBOW)
    public static readonly STEEL_CROSSBOW = new RangedWeapon([9179], [Ammunition.BRONZE_BOLT, Ammunition.OPAL_BOLT, Ammunition.ENCHANTED_OPAL_BOLT, Ammunition.IRON_BOLT, Ammunition.JADE_BOLT, Ammunition.ENCHANTED_JADE_BOLT, Ammunition.STEEL_BOLT, Ammunition.PEARL_BOLT, Ammunition.ENCHANTED_PEARL_BOLT], RangedWeaponType.CROSSBOW)
    public static readonly MITHRIL_CROSSBOW = new RangedWeapon([9181], [Ammunition.BRONZE_BOLT, Ammunition.OPAL_BOLT, Ammunition.ENCHANTED_OPAL_BOLT, Ammunition.IRON_BOLT, Ammunition.JADE_BOLT, Ammunition.ENCHANTED_JADE_BOLT, Ammunition.STEEL_BOLT, Ammunition.PEARL_BOLT, Ammunition.ENCHANTED_PEARL_BOLT, Ammunition.MITHRIL_BOLT, Ammunition.TOPAZ_BOLT, Ammunition.ENCHANTED_TOPAZ_BOLT], RangedWeaponType.CROSSBOW)
    public static readonly ADAMANT_CROSSBOW = new RangedWeapon([9183], [Ammunition.BRONZE_BOLT, Ammunition.OPAL_BOLT, Ammunition.ENCHANTED_OPAL_BOLT, Ammunition.IRON_BOLT, Ammunition.JADE_BOLT, Ammunition.ENCHANTED_JADE_BOLT, Ammunition.STEEL_BOLT, Ammunition.PEARL_BOLT, Ammunition.ENCHANTED_PEARL_BOLT, Ammunition.MITHRIL_BOLT, Ammunition.TOPAZ_BOLT, Ammunition.ENCHANTED_TOPAZ_BOLT, Ammunition.ADAMANT_BOLT, Ammunition.SAPPHIRE_BOLT, Ammunition.ENCHANTED_SAPPHIRE_BOLT, Ammunition.EMERALD_BOLT, Ammunition.ENCHANTED_EMERALD_BOLT, Ammunition.RUBY_BOLT, Ammunition.ENCHANTED_RUBY_BOLT], RangedWeaponType.CROSSBOW)
    public static readonly RUNE_CROSSBOW = new RangedWeapon([9185], [Ammunition.BRONZE_BOLT, Ammunition.OPAL_BOLT, Ammunition.ENCHANTED_OPAL_BOLT, Ammunition.IRON_BOLT, Ammunition.JADE_BOLT, Ammunition.ENCHANTED_JADE_BOLT, Ammunition.STEEL_BOLT, Ammunition.PEARL_BOLT, Ammunition.ENCHANTED_PEARL_BOLT, Ammunition.MITHRIL_BOLT, Ammunition.TOPAZ_BOLT, Ammunition.ENCHANTED_TOPAZ_BOLT, Ammunition.ADAMANT_BOLT, Ammunition.SAPPHIRE_BOLT, Ammunition.ENCHANTED_SAPPHIRE_BOLT, Ammunition.EMERALD_BOLT, Ammunition.ENCHANTED_EMERALD_BOLT, Ammunition.RUBY_BOLT, Ammunition.ENCHANTED_RUBY_BOLT, Ammunition.RUNITE_BOLT, Ammunition.BROAD_BOLT, Ammunition.DIAMOND_BOLT, Ammunition.ENCHANTED_DIAMOND_BOLT, Ammunition.ONYX_BOLT, Ammunition.ENCHANTED_ONYX_BOLT, Ammunition.DRAGON_BOLT, Ammunition.ENCHANTED_DRAGON_BOLT], RangedWeaponType.CROSSBOW)
    public static readonly DRAGON_CROSSBOW = new RangedWeapon([ItemIdentifiers.DRAGON_CROSSBOW, ItemIdentifiers.DRAGON_CROSSBOW_2, ItemIdentifiers.DRAGON_CROSSBOW_3], [Ammunition.BRONZE_BOLT, Ammunition.OPAL_BOLT, Ammunition.ENCHANTED_OPAL_BOLT, Ammunition.IRON_BOLT, Ammunition.JADE_BOLT, Ammunition.ENCHANTED_JADE_BOLT, Ammunition.STEEL_BOLT, Ammunition.PEARL_BOLT, Ammunition.ENCHANTED_PEARL_BOLT, Ammunition.MITHRIL_BOLT, Ammunition.TOPAZ_BOLT, Ammunition.ENCHANTED_TOPAZ_BOLT, Ammunition.ADAMANT_BOLT, Ammunition.SAPPHIRE_BOLT, Ammunition.ENCHANTED_SAPPHIRE_BOLT, Ammunition.EMERALD_BOLT, Ammunition.ENCHANTED_EMERALD_BOLT, Ammunition.RUBY_BOLT, Ammunition.ENCHANTED_RUBY_BOLT, Ammunition.RUNITE_BOLT, Ammunition.BROAD_BOLT, Ammunition.DIAMOND_BOLT, Ammunition.ENCHANTED_DIAMOND_BOLT, Ammunition.ONYX_BOLT, Ammunition.ENCHANTED_ONYX_BOLT, Ammunition.DRAGON_BOLT, Ammunition.ENCHANTED_DRAGON_BOLT, Ammunition.ENCHANTED_DRAGONSTONE_DRAGON_BOLT, ...Ammunition.ALL_DRAGON_BOLTS], RangedWeaponType.CROSSBOW)
    public static readonly DORGESHUUN_CROSSBOW = new RangedWeapon([ItemIdentifiers.DORGESHUUN_CROSSBOW], [Ammunition.BRONZE_BOLT, Ammunition.IRON_BOLT, Ammunition.STEEL_BOLT, Ammunition.MITHRIL_BOLT, Ammunition.ADAMANT_BOLT, Ammunition.RUNITE_BOLT, Ammunition.BROAD_BOLT, Ammunition.DRAGON_BOLT], RangedWeaponType.CROSSBOW)
    public static readonly ARMADYL_CROSSBOW = new RangedWeapon([ItemIdentifiers.ARMADYL_CROSSBOW], [Ammunition.BRONZE_BOLT, Ammunition.OPAL_BOLT, Ammunition.ENCHANTED_OPAL_BOLT, Ammunition.IRON_BOLT, Ammunition.JADE_BOLT, Ammunition.ENCHANTED_JADE_BOLT, Ammunition.STEEL_BOLT, Ammunition.PEARL_BOLT, Ammunition.ENCHANTED_PEARL_BOLT, Ammunition.MITHRIL_BOLT, Ammunition.TOPAZ_BOLT, Ammunition.ENCHANTED_TOPAZ_BOLT, Ammunition.ADAMANT_BOLT, Ammunition.SAPPHIRE_BOLT, Ammunition.ENCHANTED_SAPPHIRE_BOLT, Ammunition.EMERALD_BOLT, Ammunition.ENCHANTED_EMERALD_BOLT, Ammunition.RUBY_BOLT, Ammunition.ENCHANTED_RUBY_BOLT, Ammunition.RUNITE_BOLT, Ammunition.BROAD_BOLT, Ammunition.DIAMOND_BOLT, Ammunition.ENCHANTED_DIAMOND_BOLT, Ammunition.ONYX_BOLT, Ammunition.ENCHANTED_ONYX_BOLT, Ammunition.DRAGON_BOLT, Ammunition.ENCHANTED_DRAGON_BOLT, Ammunition.ENCHANTED_DRAGONSTONE_DRAGON_BOLT, ...Ammunition.ALL_DRAGON_BOLTS], RangedWeaponType.CROSSBOW)
    public static readonly ZARYTE_CROSSBOW = new RangedWeapon([ItemIdentifiers.ZARYTE_CROSSBOW], [Ammunition.BRONZE_BOLT, Ammunition.OPAL_BOLT, Ammunition.ENCHANTED_OPAL_BOLT, Ammunition.IRON_BOLT, Ammunition.JADE_BOLT, Ammunition.ENCHANTED_JADE_BOLT, Ammunition.STEEL_BOLT, Ammunition.PEARL_BOLT, Ammunition.ENCHANTED_PEARL_BOLT, Ammunition.MITHRIL_BOLT, Ammunition.TOPAZ_BOLT, Ammunition.ENCHANTED_TOPAZ_BOLT, Ammunition.ADAMANT_BOLT, Ammunition.SAPPHIRE_BOLT, Ammunition.ENCHANTED_SAPPHIRE_BOLT, Ammunition.EMERALD_BOLT, Ammunition.ENCHANTED_EMERALD_BOLT, Ammunition.RUBY_BOLT, Ammunition.ENCHANTED_RUBY_BOLT, Ammunition.RUNITE_BOLT, Ammunition.BROAD_BOLT, Ammunition.DIAMOND_BOLT, Ammunition.ENCHANTED_DIAMOND_BOLT, Ammunition.ONYX_BOLT, Ammunition.ENCHANTED_ONYX_BOLT, Ammunition.DRAGON_BOLT, Ammunition.ENCHANTED_DRAGON_BOLT, Ammunition.ENCHANTED_DRAGONSTONE_DRAGON_BOLT, ...Ammunition.ALL_DRAGON_BOLTS], RangedWeaponType.CROSSBOW)

    public static readonly BRONZE_DART = new RangedWeapon([806], [Ammunition.BRONZE_DART], RangedWeaponType.DART)
    public static readonly IRON_DART = new RangedWeapon([807], [Ammunition.IRON_DART], RangedWeaponType.DART)
    public static readonly STEEL_DART = new RangedWeapon([808], [Ammunition.STEEL_DART], RangedWeaponType.DART)
    public static readonly MITHRIL_DART = new RangedWeapon([809], [Ammunition.MITHRIL_DART], RangedWeaponType.DART)
    public static readonly ADAMANT_DART = new RangedWeapon([810], [Ammunition.ADAMANT_DART], RangedWeaponType.DART)
    public static readonly RUNE_DART = new RangedWeapon([811], [Ammunition.RUNE_DART], RangedWeaponType.DART)
    public static readonly DRAGON_DART = new RangedWeapon([11230], [(Ammunition.DRAGON_DART)], RangedWeaponType.DART)


    public static readonly BRONZE_KNIFE = new RangedWeapon([864, ItemIdentifiers.BRONZE_KNIFE_P_, ItemIdentifiers.BRONZE_KNIFE_P_PLUS_, ItemIdentifiers.BRONZE_KNIFE_P_PLUS_PLUS_], [Ammunition.BRONZE_KNIFE], RangedWeaponType.KNIFE)
    public static readonly IRON_KNIFE = new RangedWeapon([863, ItemIdentifiers.IRON_KNIFE_P_, ItemIdentifiers.IRON_KNIFE_P_PLUS_, ItemIdentifiers.IRON_KNIFE_P_PLUS_PLUS_], [Ammunition.IRON_KNIFE], RangedWeaponType.KNIFE)
    public static readonly STEEL_KNIFE = new RangedWeapon([865, ItemIdentifiers.STEEL_KNIFE_P_, ItemIdentifiers.STEEL_KNIFE_P_PLUS_, ItemIdentifiers.STEEL_KNIFE_P_PLUS_PLUS_], [Ammunition.STEEL_KNIFE], RangedWeaponType.KNIFE)
    public static readonly BLACK_KNIFE = new RangedWeapon([869, ItemIdentifiers.BLACK_KNIFE_P_, ItemIdentifiers.BLACK_KNIFE_P_PLUS_, ItemIdentifiers.BLACK_KNIFE_P_PLUS_PLUS_], [Ammunition.BLACK_KNIFE], RangedWeaponType.KNIFE)
    public static readonly MITHRIL_KNIFE = new RangedWeapon([866, ItemIdentifiers.MITHRIL_KNIFE_P_, ItemIdentifiers.MITHRIL_KNIFE_P_PLUS_, ItemIdentifiers.MITHRIL_KNIFE_P_PLUS_PLUS_], [Ammunition.MITHRIL_KNIFE], RangedWeaponType.KNIFE)
    public static readonly ADAMANT_KNIFE = new RangedWeapon([867, ItemIdentifiers.ADAMANT_KNIFE_P_, ItemIdentifiers.ADAMANT_KNIFE_P_PLUS_, ItemIdentifiers.ADAMANT_KNIFE_P_PLUS_PLUS_], [Ammunition.ADAMANT_KNIFE], RangedWeaponType.KNIFE)
    public static readonly RUNE_KNIFE = new RangedWeapon([868, ItemIdentifiers.RUNE_KNIFE_P_, ItemIdentifiers.RUNE_KNIFE_P_PLUS_, ItemIdentifiers.RUNE_KNIFE_P_PLUS_PLUS_], [Ammunition.RUNE_KNIFE], RangedWeaponType.KNIFE)
    public static readonly DRAGON_KNIFE = new RangedWeapon([ItemIdentifiers.DRAGON_KNIFE, ItemIdentifiers.DRAGON_KNIFE_P_, ItemIdentifiers.DRAGON_KNIFE_P_PLUS_, ItemIdentifiers.DRAGON_KNIFE_P_PLUS_PLUS_], [Ammunition.DRAGON_KNIFE], RangedWeaponType.KNIFE)

    public static readonly TOKTZ_XIL_UL = new RangedWeapon([6522], [Ammunition.TOKTZ_XIL_UL], RangedWeaponType.TOKTZ_XIL_UL)

    public static readonly KARILS_CROSSBOW = new RangedWeapon([4734], [Ammunition.BOLT_RACK], RangedWeaponType.CROSSBOW)

    public static readonly BALLISTA = new RangedWeapon([19478, 19481], [Ammunition.BRONZE_JAVELIN, Ammunition.IRON_JAVELIN, Ammunition.STEEL_JAVELIN, Ammunition.MITHRIL_JAVELIN, Ammunition.ADAMANT_JAVELIN, Ammunition.RUNE_JAVELIN, Ammunition.DRAGON_JAVELIN], RangedWeaponType.BALLISTA)

    public static readonly TOXIC_BLOWPIPE = new RangedWeapon([12926], [Ammunition.BRONZE_DART, Ammunition.IRON_DART, Ammunition.STEEL_DART, Ammunition.BLACK_DART, Ammunition.MITHRIL_DART, Ammunition.ADAMANT_DART, Ammunition.RUNE_DART, Ammunition.AMETHYST_DART, Ammunition.DRAGON_DART], RangedWeaponType.BLOWPIPE)
    public static readonly ROSEWOOD_BLOWPIPE = new RangedWeapon([ItemIdentifiers.ROSEWOOD_BLOWPIPE, ItemIdentifiers.ROSEWOOD_BLOWPIPE_2], [Ammunition.BRONZE_DART, Ammunition.IRON_DART, Ammunition.STEEL_DART, Ammunition.BLACK_DART, Ammunition.MITHRIL_DART, Ammunition.ADAMANT_DART, Ammunition.RUNE_DART, Ammunition.AMETHYST_DART, Ammunition.DRAGON_DART], RangedWeaponType.BLOWPIPE)
    public static readonly RUNE_THROWNAXE = new RangedWeapon([ItemIdentifiers.RUNE_THROWNAXE, ItemIdentifiers.RUNE_THROWNAXE_2], [Ammunition.RUNE_THROWNAXE], RangedWeaponType.THROWNAXE)
    public static readonly BRONZE_THROWNAXE = new RangedWeapon([ItemIdentifiers.BRONZE_THROWNAXE], [Ammunition.BRONZE_THROWNAXE], RangedWeaponType.THROWNAXE)
    public static readonly IRON_THROWNAXE = new RangedWeapon([ItemIdentifiers.IRON_THROWNAXE], [Ammunition.IRON_THROWNAXE], RangedWeaponType.THROWNAXE)
    public static readonly STEEL_THROWNAXE = new RangedWeapon([ItemIdentifiers.STEEL_THROWNAXE], [Ammunition.STEEL_THROWNAXE], RangedWeaponType.THROWNAXE)
    public static readonly MITHRIL_THROWNAXE = new RangedWeapon([ItemIdentifiers.MITHRIL_THROWNAXE], [Ammunition.MITHRIL_THROWNAXE], RangedWeaponType.THROWNAXE)
    public static readonly ADAMANT_THROWNAXE = new RangedWeapon([ItemIdentifiers.ADAMANT_THROWNAXE], [Ammunition.ADAMANT_THROWNAXE], RangedWeaponType.THROWNAXE)
    // Composite bows: their ammunition tiers match the same-tier shortbow (Wiki).
    public static readonly WILLOW_COMP_BOW = new RangedWeapon([10280], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly YEW_COMP_BOW = new RangedWeapon([10282], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.ICE_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly MAGIC_COMP_BOW = new RangedWeapon([10284], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW, Ammunition.ICE_ARROW, Ammunition.BROAD_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly COMP_OGRE_BOW = new RangedWeapon([4827], [Ammunition.BRONZE_ARROW, Ammunition.IRON_ARROW, Ammunition.STEEL_ARROW, Ammunition.MITHRIL_ARROW, Ammunition.ADAMANT_ARROW, Ammunition.RUNE_ARROW], RangedWeaponType.SHORTBOW)
    public static readonly CHINCHOMPA = new RangedWeapon([ItemIdentifiers.CHINCHOMPA_2], [Ammunition.CHINCHOMPA], RangedWeaponType.CHINCHOMPA)
    public static readonly RED_CHINCHOMPA = new RangedWeapon([ItemIdentifiers.RED_CHINCHOMPA_2], [Ammunition.RED_CHINCHOMPA], RangedWeaponType.CHINCHOMPA)
    public static readonly BLACK_CHINCHOMPA = new RangedWeapon([ItemIdentifiers.BLACK_CHINCHOMPA], [Ammunition.BLACK_CHINCHOMPA], RangedWeaponType.CHINCHOMPA)
    public static readonly SWAMP_LIZARD = new RangedWeapon([10149], [Ammunition.GUAM_TAR], RangedWeaponType.SALAMANDER)
    public static readonly ORANGE_SALAMANDER = new RangedWeapon([10146], [Ammunition.MARRENTILL_TAR], RangedWeaponType.SALAMANDER)
    public static readonly RED_SALAMANDER = new RangedWeapon([10147], [Ammunition.TARROMIN_TAR], RangedWeaponType.SALAMANDER)
    public static readonly BLACK_SALAMANDER = new RangedWeapon([10148], [Ammunition.HARRALANDER_TAR], RangedWeaponType.SALAMANDER)
    public static readonly DRAGON_THROWNAXE = new RangedWeapon([ItemIdentifiers.DRAGON_THROWNAXE, ItemIdentifiers.DRAGON_THROWNAXE_2, ItemIdentifiers.DRAGON_THROWNAXE_3], [Ammunition.DRAGON_THROWNAXE], RangedWeaponType.THROWNAXE)
    public static readonly MORRIGANS_THROWING_AXE = new RangedWeapon([ItemIdentifiers.MORRIGANS_THROWING_AXE, ItemIdentifiers.MORRIGANS_THROWING_AXE_2, ItemIdentifiers.MORRIGANS_THROWING_AXE_BH_, ItemIdentifiers.MORRIGANS_THROWING_AXE_BH__2], [Ammunition.MORRIGANS_THROWING_AXE], RangedWeaponType.THROWNAXE)
    public static readonly TONALZTICS_OF_RALOS = new RangedWeapon([ItemIdentifiers.TONALZTICS_OF_RALOS, ItemIdentifiers.TONALZTICS_OF_RALOS_2], [Ammunition.TONALZTICS_OF_RALOS], RangedWeaponType.GLAIVE)
    public static readonly MORRIGANS_JAVELIN = new RangedWeapon([
        ItemIdentifiers.MORRIGANS_JAVELIN, ItemIdentifiers.MORRIGANS_JAVELIN_2, ItemIdentifiers.MORRIGANS_JAVELIN_3,
        ItemIdentifiers.MORRIGANS_JAVELIN_BH_, ItemIdentifiers.MORRIGANS_JAVELIN_BH__2,
    ], [Ammunition.MORRIGANS_JAVELIN], RangedWeaponType.MORRIGANS_JAVELIN)




    private weaponIds: number[];
    private ammunitionData: Ammunition[];
    private type: RangedWeaponType;


    constructor(weaponIds: number[], ammunitionData: Ammunition[], type: RangedWeaponType) {
        this.weaponIds = weaponIds;
        this.ammunitionData = ammunitionData;
        this.type = type;
        for (const weaponId of weaponIds) {
            RangedWeapon.rangedWeapons.set(weaponId, this);
            // Self-ammo only when the weapon is its own ammo (darts, knives, Craw's bow); a
            // bow limited to one arrow type (shortbow, training bow) still draws from the quiver.
            if (Array.isArray(ammunitionData) && ammunitionData.length === 1 && weaponIds.includes(ammunitionData[0].getItemId())) {
                RangedWeapon.selfAmmoByWeapon.set(weaponId, ammunitionData[0]);
            }
        }
    }

    public static getFor(p: Player): RangedWeapon {
        const weapon = Number(p.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId());
        return RangedWeapon.rangedWeapons.get(weapon);
    }

    public static getSelfAmmo(itemId: number): Ammunition | undefined {
        return RangedWeapon.selfAmmoByWeapon.get(Number(itemId));
    }

    public getWeaponIds(): number[] {
        return this.weaponIds;
    }

    public getAmmunitionData(): Ammunition[] {
        return this.ammunitionData;
    }

    public getType(): RangedWeaponType {
        return this.type;
    }
}
