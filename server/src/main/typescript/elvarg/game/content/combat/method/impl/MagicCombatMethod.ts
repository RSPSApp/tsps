import { CombatMethod } from "../CombatMethod";
import { Animation } from "../../../../model/Animation";
import { Graphic } from "../../../../model/Graphic";
import { Projectile } from "../../../../model/Projectile";
import { Sounds } from "../../../../Sounds";
import { Sound } from "../../../../Sound";
import { World } from "../../../../World";
import { CombatFactory } from "../../CombatFactory";
import { CombatType } from "../../CombatType";
import { PendingHit } from "../../hit/PendingHit";
import { Mobile } from "../../../../entity/impl/Mobile";
import { Player } from "../../../../entity/impl/player/Player";
import { GraphicHeight } from "../../../../model/GraphicHeight";
import { MagicSpellbook } from "../../../../model/MagicSpellbook";


export class MagicCombatMethod extends CombatMethod {

    public static SPLASH_GRAPHIC = new Graphic(85, GraphicHeight.MIDDLE);
    /** Wind strike; used when an npc has no projectile configured. */
    private static readonly DEFAULT_NPC_PROJECTILE = 91;
    private static readonly MAGIC_CAST_DEBUG =
        process.env.MAGIC_CAST_DEBUG === "1" ||
        process.env.MAGIC_CAST_DEBUG === "true";
    private static readonly CAST_SOUNDS: Readonly<Record<number, number>> = {
        1: 2540,
        1152: 220, 1153: 119, 1154: 211, 1156: 132, 1157: 3011, 1158: 160,
        1160: 218, 1161: 127, 1163: 209, 1166: 130, 1169: 157, 1171: 122,
        1172: 216, 1175: 207, 1177: 128, 1181: 155, 1183: 222, 1185: 213,
        1188: 134, 1189: 162, 1542: 3009, 1543: 148, 1562: 3004, 1572: 101,
        1582: 3003, 1592: 151, 12037: 1718,
        12861: 6589, 12871: 6589, 12881: 6589, 12891: 171,
        12901: 6589, 12911: 6589, 12919: 6589, 12929: 6589, 12939: 6589,
        12951: 6589, 12963: 6589, 12975: 6589, 12987: 6589, 12999: 6589,
        13011: 6589, 13023: 6589,
        // Capture: Undead Grasp.
        21832: 5030,
    };
    private static readonly IMPACT_SOUNDS: Readonly<Record<number, number>> = {
        1: 1460,
        1152: 221, 1153: 121, 1154: 212, 1156: 133, 1157: 3010, 1158: 161,
        1160: 219, 1161: 126, 1163: 210, 1166: 131, 1169: 158, 1171: 124,
        1172: 217, 1175: 208, 1177: 129, 1181: 156, 1183: 223, 1185: 214,
        1188: 135, 1189: 163, 1542: 3008, 1543: 150, 1562: 3005, 1572: 99,
        1582: 3002, 1592: 153, 12037: 174,
        12861: 173, 12871: 169, 12881: 170, 12891: 168,
        12901: 110, 12911: 104, 12919: 105, 12929: 102, 12939: 185,
        12951: 181, 12963: 182, 12975: 180, 12987: 179, 12999: 176,
        13011: 177, 13023: 175,
        // Capture: Undead Grasp (an area sound at the target).
        21832: 5055,
    };

    public type(): CombatType {
        return CombatType.MAGIC;
    }

    /** NPC casters keep their old fixed delay; their attacks are tuned around it. */
    private static readonly NPC_HIT_DELAY = 3;

    /**
     * Wiki (Hit delay): a player's magic lands 1 + (1 + distance) / 3 ticks after the cast, the
     * distance measured edge to edge (to the target's nearest tile); barrage spells measure to
     * its south-west tile. A spell with a fixed delay of its own keeps it.
     */
    public static hitDelay(attacker: Mobile, target: Mobile, spell?: any): number {
        const own = spell?.hitDelay?.();
        if (typeof own === "number") return own;
        if (!attacker.isPlayer()) return MagicCombatMethod.NPC_HIT_DELAY;
        const distance = MagicCombatMethod.isBarrage(spell)
            ? attacker.getLocation().getDistance(target.getLocation())
            : MagicCombatMethod.edgeDistance(attacker, target);
        return 1 + Math.floor((1 + distance) / 3);
    }

    /** Chebyshev distance from the attacker's tile to the nearest tile of the target. */
    private static edgeDistance(attacker: Mobile, target: Mobile): number {
        const from = attacker.getLocation();
        const to = target.getLocation();
        const size = Math.max(1, target.getSize?.() ?? 1);
        const dx = Math.max(0, to.getX() - from.getX(), from.getX() - (to.getX() + size - 1));
        const dy = Math.max(0, to.getY() - from.getY(), from.getY() - (to.getY() + size - 1));
        return Math.max(dx, dy);
    }

    /** Barrages are the only area spells from level 86 (bursts go up to 70). */
    private static isBarrage(spell: any): boolean {
        return typeof spell?.spellRadius === "function" && spell.spellRadius() > 0 &&
            (spell.levelRequired?.() ?? 0) >= 86;
    }

    public hits(character: Mobile, target: Mobile): PendingHit[] {
        let spell = character.getCombat().getSelectedSpell();
        let hits: PendingHit[] = [new PendingHit(character, target, this, MagicCombatMethod.hitDelay(character, target, spell))];


        if (!spell) {
            return hits;
        }

        let multiCombatHits: PendingHit[] = [];

        for (let hit of hits) {
            spell.onHitCalc(hit);

            const spellRadius =
                spell.getSpellbook() === MagicSpellbook.ANCIENT && typeof (spell as any).spellRadius === "function"
                    ? (spell as any).spellRadius()
                    : 0;
            const isAncientSpell = spell.getSpellbook() === MagicSpellbook.ANCIENT;
            if (!hit.isAccurate() || !isAncientSpell || spellRadius <= 0) {
                continue;
            }

            let it: IterableIterator<Mobile> = null;
            if (character.isPlayer() && target.isPlayer()) {
                it = (character as Player).getLocalPlayers().values();
            } else if (character.isPlayer() && target.isNpc()) {
                it = (character as Player).getLocalNpcs().values();
            } else if (character.isNpc() && target.isNpc()) {
                let npcs = Object.values(World.getNpcs());
            } else if (character.isNpc() && target.isPlayer()) {
                let npcsValues = Object.values(World.getNpcs());
            }

            for (let next of it) {
                if (!CombatFactory.canAttackSecondaryTarget(character, target, next, spellRadius)) {
                    continue;
                }
                let pendingHit: PendingHit = new PendingHit(character, next, this, MagicCombatMethod.hitDelay(character, next, spell), false);
                multiCombatHits.push(pendingHit);
                spell.onHitCalc(pendingHit);
            }
        }
        if (multiCombatHits.length > 0) {
            return hits.concat(multiCombatHits);
        }
        return hits;
    }

    public canAttack(character: Mobile, target: Mobile): boolean {
        if (character.isNpc()) {
            return true;
        }

        // Set the current spell to the autocast spell if it's null.
        if (character.getCombat().getCastSpell() == null) {
            character.getCombat().setCastSpell(character.getCombat().getAutocastSpell());
        }

        // Character didn't have autocast spell either.
        if (character.getCombat().getCastSpell() == null) {
            return false;
        }

        return character.getCombat().getCastSpell().canCast(character.getAsPlayer(), true);
    }

    public canPursue(character: Mobile, target: Mobile): boolean {
        if (character.isNpc()) return true;
        // Read-only: canAttack() owns promoting the autocast spell into the cast slot.
        const combat = character.getCombat();
        const spell = combat.getCastSpell() ?? combat.getAutocastSpell();
        return spell != null && spell.canCast(character.getAsPlayer(), false);
    }

    public start(character: Mobile, target: Mobile): void {
        const spell = character.getCombat().getSelectedSpell();

        if (spell == null && character.isNpc()) {
            // NPCs cast without a Spell object. Use the projectile configured in
            // npc-combat-defs.json, falling back to a generic one so the cast is at
            // least visible.
            const animation = character.getAttackAnim();
            if (animation !== -1) {
                character.performAnimation(new Animation(animation));
            }
            const configured = character.getAsNpc().getCurrentDefinition().getProjectileId();
            const projectileId = configured >= 0 ? configured : MagicCombatMethod.DEFAULT_NPC_PROJECTILE;
            Projectile.createProjectile(character, target, projectileId, 0, 20, 43, 31).sendProjectile();
            return;
        }

        if (spell != null) {
            const castSound = MagicCombatMethod.resolveCastSound(spell.spellId());
            if (castSound != null) {
                Sounds.sendSound(character, castSound);
            }
            if (MagicCombatMethod.MAGIC_CAST_DEBUG) {
                const casterName = character.isPlayer()
                    ? character.getAsPlayer()?.getUsername?.() ?? "unknown-player"
                    : `npc-${character.getAsNpc?.()?.getId?.() ?? "unknown"}`;
                const targetName = target?.isPlayer?.()
                    ? target.getAsPlayer()?.getUsername?.() ?? "unknown-player"
                    : `npc-${target?.getAsNpc?.()?.getId?.() ?? "unknown"}`;
                const spellId = spell?.spellId?.() ?? -1;
                console.info(
                    `[magic.cast] caster=${casterName} target=${targetName} spellId=${spellId}`
                );
            }
            spell.startCast(character, target);
        }
    }

    private static resolveCastSound(spellId: number): Sound | null {
        const soundId = MagicCombatMethod.CAST_SOUNDS[spellId];
        return soundId === undefined ? null : new Sound(soundId, 1, 0, 0);
    }

    public attackSpeed(character: Mobile): number {

        if (character.getCombat().getPreviousCast() != null) {
            return character.getCombat().getPreviousCast().getAttackSpeed();
        }

        return super.attackSpeed(character);
    }

    public attackDistance(character: Mobile): number {
        return 10;
    }

    finished(character: Mobile, target: Mobile) {
        // NPCs cast without a Spell object, so none of the player cast teardown
        // applies. Running it anyway reset their combat after every swing, which
        // made a magic NPC attack once and then stand there.
        if (character.isNpc()) {
            return;
        }
        // Reset the castSpell to autocastSpell
        // Update previousCastSpell so effects can be handled.
        const current = character.getCombat().getCastSpell();
        character.getCombat().setCastSpell(null);
        if (character.getCombat().getAutocastSpell() === null) {
            // The same tick as the cast: keep its animation, which the reset would replace.
            character.getCombat().reset(false);
            // reset() clears the interaction; a resolved manual cast still faces its target.
            character.setMobileInteraction(target);
        }
        character.getCombat().setPreviousCast(current);
    }

    handleAfterHitEffects(hit: PendingHit) {
        const attacker = hit.getAttacker();
        const target = hit.getTarget();
        const accurate = hit.isAccurate();
        const damage = hit.getTotalDamage();

        if (attacker.getHitpoints() <= 0 || target.getHitpoints() <= 0) {
            return;
        }

        const previousSpell = attacker.getCombat().getPreviousCast();

        if (previousSpell) {
            if (accurate) {
                const endGraphic = previousSpell.endGraphic();
                // A spell with no impact graphic (a grasp shows its own at the cast) sends none.
                if (endGraphic) target.performGraphic(endGraphic);
                const impactSound = previousSpell.impactSound()
                    ?? MagicCombatMethod.resolveImpactSound(previousSpell.spellId());
                Sounds.sendSound(target, impactSound);
              } else {
                // Send splash graphics for the spell because it wasn't accurate
                target.performGraphic(MagicCombatMethod.SPLASH_GRAPHIC);
                Sounds.sendSound(attacker, Sound.SPELL_FAIL_SPLASH);
            }
            previousSpell.finishCast(attacker, target, accurate, damage);
        }
    }

    private static resolveImpactSound(spellId: number): Sound | null {
        const soundId = MagicCombatMethod.IMPACT_SOUNDS[spellId];
        return soundId === undefined ? null : new Sound(soundId, 1, 0, 0);
    }
}
