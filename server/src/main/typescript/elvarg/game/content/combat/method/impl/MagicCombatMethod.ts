import { CombatPosition } from "../../CombatPosition";
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
import { Skill } from "../../../../model/Skill";
import type { CombatSpell } from "../../magic/CombatSpell";
import { Spell } from "../../magic/Spell";
import { Autocasting } from "../../magic/Autocasting";
import { CrossFloor } from "../../../../CrossFloor";
import { ChatType } from "../../../../../net/protocol/ClientProtocol";


export class MagicCombatMethod extends CombatMethod {

    public static SPLASH_GRAPHIC = new Graphic(85, GraphicHeight.SPELL_IMPACT);
    /** Casters whose current cast has not paid its base XP yet: set by start(), paid by hits(). */
    private static readonly baseExperienceOwed = new WeakSet<Mobile>();
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
        // OSRS Wiki List of sound IDs, Surge casts.
        21876: 4028, 21877: 4030, 21878: 4025, 21879: 4032,
    };
    /** Live plays a spell's cast sound for everyone but the caster as an area sound this far round the caster. */
    public static readonly CAST_SOUND_RADIUS = 10;
    /** Live plays a spell's impact and its splash as an area sound this far round the target's tile. */
    public static readonly IMPACT_SOUND_RADIUS = 10;
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
        // OSRS Wiki List of sound IDs, Surge impacts.
        21876: 4027, 21877: 4029, 21878: 4026, 21879: 4031,
    };

    public type(): CombatType {
        return CombatType.MAGIC;
    }

    /**
     * Wiki (Hit delay): a player's magic lands 1 + (1 + distance) / 3 ticks after the cast, the
     * distance measured edge to edge (to the target's nearest tile); barrage spells measure to
     * its south-west tile. A spell with a fixed delay of its own keeps it.
     *
     * An NPC's cast lands when its projectile does (the legacy magic shape, 46 + 10 cycles a
     * tile). A fixed 3 ticks hit a player a tick before a spell from 10 tiles arrived, and a
     * tick after one from the next tile had landed (#1862).
     */
    public static hitDelay(attacker: Mobile, target: Mobile, spell?: any): number {
        const own = spell?.hitDelay?.();
        if (typeof own === "number") return own;
        if (!attacker.isPlayer()) return Projectile.arrivalTicks(attacker, target, Projectile.LEGACY_MAGIC_END_BASE);
        const from = CombatPosition.location(attacker, target);
        const to = CombatPosition.location(target, attacker);
        const crossFloor = CrossFloor.canCross(from, to) && from.getZ() !== to.getZ();
        const distance = MagicCombatMethod.isBarrage(spell)
            ? crossFloor ? CombatPosition.projectileDistance(attacker, target) : CombatPosition.distance(attacker, target)
            : MagicCombatMethod.edgeDistance(attacker, target);
        if (crossFloor) {
            return Projectile.ticksToLand(Projectile.LEGACY_MAGIC_END_BASE + distance * 10);
        }
        return 1 + Math.floor((1 + distance) / 3);
    }

    /** Flight distance in tile units from the attacker to the nearest tile of the target. */
    private static edgeDistance(attacker: Mobile, target: Mobile): number {
        return CombatPosition.edgeDistance(attacker, target);
    }

    /**
     * A blood spell that hits sends one spam line per cast: "opponent's" for one target and
     * "opponents'" for two or more (rsprox_transcripts/226/01702.txt and 234/00821.txt: every
     * singular line follows exactly one blood impact; 238/01224.txt tick 3066 for Blood Blitz). An accurate impact
     * counts even for 0 damage: 234/00821.txt tick 4446, a Barrage on a just-killed nechryael spawn (base Magic XP
     * only, no Hitpoints XP), still sent the singular line.
     */
    private static sendBloodDrainLine(character: Mobile, spell: CombatSpell, hits: PendingHit[]): void {
        if (!character.isPlayer()) return;
        const { CombatSpells } = require("../../magic/CombatSpells");
        if (![CombatSpells.BLOOD_RUSH, CombatSpells.BLOOD_BURST, CombatSpells.BLOOD_BLITZ, CombatSpells.BLOOD_BARRAGE].includes(spell)) return;
        const drained = hits.filter((hit) => hit.isAccurate()).length;
        if (drained === 0) return;
        character.getAsPlayer().getPacketSender().sendTypedMessage(ChatType.SPAM,
            drained === 1 ? "You drain some of your opponent's health." : "You drain some of your opponents' health.");
    }

    /** Barrages are the only area spells from level 86 (bursts go up to 70). */
    private static isBarrage(spell: any): boolean {
        return typeof spell?.spellRadius === "function" && spell.spellRadius() > 0 &&
            (spell.levelRequired?.() ?? 0) >= 86;
    }

    public hits(character: Mobile, target: Mobile): PendingHit[] {
        let spell = character.getCombat().getSelectedSpell();
        const context = Spell.getCastContext(character, spell);
        // A spell cast is never a special attack: a special armed meanwhile (Soul Rend, Condemn)
        // keeps its energy and must not lend the spell its accuracy or damage (ordinary).
        let hits: PendingHit[] = [new PendingHit(character, target, this,
            { delay: MagicCombatMethod.hitDelay(character, target, spell), handleAfterHitEffects: true, ordinary: true }, undefined, context).setSpell(spell)];


        if (!spell) {
            return hits;
        }

        let multiCombatHits: PendingHit[] = [];

        for (let hit of hits) {
            spell.onHitCalc(hit);
            MagicCombatMethod.queueProjectileGraphic(hit);

            const spellRadius =
                spell.getSpellbook() === MagicSpellbook.ANCIENT && typeof (spell as any).spellRadius === "function"
                    ? (spell as any).spellRadius()
                    : 0;
            const isAncientSpell = spell.getSpellbook() === MagicSpellbook.ANCIENT;
            if (!hit.isAccurate() || !isAncientSpell || spellRadius <= 0) {
                continue;
            }
            // Wiki (Ancient Magicks; Multicombat area): the area spells hit more than one target only in multicombat, and
            // the target's zone decides (CombatFactory.areaAttackSpreads).
            if (!CombatFactory.areaAttackSpreads(character, target)) {
                continue;
            }

            // The splash picks victims of the primary target's kind; an NPC caster has no local lists,
            // so it draws from the world (canAttackSecondaryTarget applies the radius and multi rules).
            let it: Iterable<Mobile>;
            if (character.isPlayer()) {
                it = target.isPlayer() ? (character as Player).getLocalPlayers().values() : (character as Player).getLocalNpcs().values();
            } else {
                it = target.isPlayer()
                    ? World.getPlayers()
                    : World.getNpcsNear(target.getLocation(), spellRadius, target.getPrivateArea());
            }

            for (let next of it) {
                if (!CombatFactory.canAttackSecondaryTarget(character, target, next, spellRadius)) {
                    continue;
                }
                let pendingHit: PendingHit = new PendingHit(character, next, this,
                    { delay: MagicCombatMethod.hitDelay(character, next, spell), handleAfterHitEffects: false, ordinary: true }, undefined, context).setSpell(spell);
                multiCombatHits.push(pendingHit);
                spell.onHitCalc(pendingHit);
            }
        }
        MagicCombatMethod.payBaseExperience(character, spell, hits[0].isAccurate());
        MagicCombatMethod.sendBloodDrainLine(character, spell, hits.concat(multiCombatHits));
        if (multiCombatHits.length > 0) {
            return hits.concat(multiCombatHits);
        }
        return hits;
    }

    private static queueProjectileGraphic(hit: PendingHit): void {
        const spell = hit.getSpell();
        const target = hit.getTarget();
        const visual = spell?.getProjectileVisual?.(hit.getSpellContext(), target);
        if (!visual || visual.queued) return;
        // Live sends the impact (or splash) area sound at the cast, delayed to the projectile's end cycle
        // (RSProx 227/00102 tick 232: sound_area 161 delay=106 for a projectile ending at 106), beside the graphic.
        if (!visual.soundQueued) {
            const sound = hit.isAccurate() ? MagicCombatMethod.impactSoundFor(spell) : Sound.SPELL_FAIL_SPLASH;
            const at = target.getLocation?.();
            if (sound && at) {
                Sounds.playAreaSound({
                    soundId: sound.getId(), source: target, x: at.getX(), y: at.getY(), level: at.getZ(),
                    loops: sound.getLoopType(), delay: visual.endCycleOffset + sound.getDelay(),
                    radius: MagicCombatMethod.IMPACT_SOUND_RADIUS,
                });
                visual.soundQueued = true;
            }
        }
        const graphic = hit.isAccurate() ? spell.endGraphic() : MagicCombatMethod.SPLASH_GRAPHIC;
        if (!graphic || typeof graphic.withDelay !== "function") return;
        const delayed = graphic.withDelay(visual.endCycleOffset + graphic.getDelay());
        target.performGraphic(delayed);
        visual.queued = target.getGraphic() === delayed;
    }

    /**
     * OSRS pays a spell's base XP once per cast, however many targets it hits: the hit value, or
     * the splash value when the main target splashes (lower for the binding spells and Tele Block).
     * rewardExp adds the per-damage XP. Powered staves' built-in spells have none.
     */
    private static payBaseExperience(character: Mobile, spell: CombatSpell, accurate: boolean): void {
        if (!MagicCombatMethod.baseExperienceOwed.delete(character)) return;
        const experience = accurate ? spell.baseExperience() : spell.splashExperience();
        if (experience > 0) {
            character.getAsPlayer().getSkillManager().addExperience(Skill.MAGIC, experience, true);
        }
    }

    public canAttack(character: Mobile, target: Mobile): boolean {
        if (character.isNpc()) {
            return true;
        }

        // Set the current spell to the autocast spell if it's null.
        if (character.getCombat().getCastSpell() == null && Autocasting.isActive(character.getAsPlayer())) {
            character.getCombat().setCastSpell(character.getCombat().getAutocastSpell());
        }

        // Character didn't have autocast spell either.
        if (character.getCombat().getCastSpell() == null) {
            return false;
        }

        // An autocast keeps the spell's own target rule (Wiki: Crumble Undead, the demonbanes); the
        // spell-on-target packets check it before combat, so only the autocast is new here.
        if (!character.getCombat().getCastSpell().canCastOnTarget(character, target)) {
            character.getCombat().setCastSpell(null);
            character.getCombat().reset();
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
            const castSound = MagicCombatMethod.castSoundFor(spell);
            if (castSound != null) {
                MagicCombatMethod.sendCastSound(character, castSound);
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
            // The cast's base XP waits for hits(), where the main target's hit or splash is rolled.
            if ((spell.baseExperience() > 0 || spell.splashExperience() > 0) && !character.isNpc()) {
                MagicCombatMethod.baseExperienceOwed.add(character);
            }
        }
    }

    /**
     * A player caster hears the cast as a private synth (rsprox_transcripts/238/01224.txt: synth_sound 171 for
     * the recording's own casts, no area copy); everyone else nearby hears a range-10 area sound at the caster's
     * tile (234/03277.txt tick 5209: another player's Ice Barrage, sound_area 171 range=10; 234/03275.txt tick
     * 681: an NPC's Weaken, sound_area 3011 range=10).
     */
    private static sendCastSound(character: Mobile, sound: Sound): void {
        const caster = character.isPlayer() ? character.getAsPlayer() : undefined;
        if (caster) Sounds.sendSound(caster, sound);
        const at = character.getLocation?.();
        if (!at) return;
        Sounds.playAreaSound({
            soundId: sound.getId(), source: character, x: at.getX(), y: at.getY(), level: at.getZ(),
            loops: sound.getLoopType(), delay: sound.getDelay(), radius: MagicCombatMethod.CAST_SOUND_RADIUS,
            exclude: caster,
        });
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
        // A default spell kept without a staff isn't autocast: a hand cast still stops here,
        // rather than falling back to melee and walking around a safespot to reach the target.
        if (!Autocasting.isActive(character.getAsPlayer())) {
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

        const previousSpell = hit.getSpell();

        if (previousSpell) {
            const visual = previousSpell.getProjectileVisual?.(hit.getSpellContext(), target);
            const queuedGraphic = visual?.queued === true;
            const queuedSound = visual?.soundQueued === true;
            if (accurate) {
                const endGraphic = previousSpell.endGraphic();
                // A spell with no impact graphic (a grasp shows its own at the cast) sends none.
                if (endGraphic && !queuedGraphic) target.performGraphic(endGraphic);
                // Live (RSProx 102 tick 232, 3275): an area sound at the target's tile with range 10,
                // for an NPC or a player. A private synth never reached the caster, and an area sound
                // of range 0 (what Sounds.sendSound gives an NPC) is dropped by the client.
                const impactSound = MagicCombatMethod.impactSoundFor(previousSpell);
                if (impactSound && !queuedSound) Sounds.playAreaSoundAt(target, impactSound, MagicCombatMethod.IMPACT_SOUND_RADIUS);
              } else {
                // Send splash graphics for the spell because it wasn't accurate
                if (!queuedGraphic) target.performGraphic(MagicCombatMethod.SPLASH_GRAPHIC);
                // Also an area sound at the target (3275: 492 `sound_area id=227 range=10`).
                if (!queuedSound) Sounds.playAreaSoundAt(target, Sound.SPELL_FAIL_SPLASH, MagicCombatMethod.IMPACT_SOUND_RADIUS);
            }
            previousSpell.finishCast(attacker, target, accurate, damage, hit.getSpellContext());
        }
    }

    /** A spell's own impact sound, else the table by its spell id (null: none captured). */
    /** The sound `spell` is cast with (its own, else the spell id's). */
    public static castSoundFor(spell: { castSound?(): Sound | null; spellId(): number }): Sound | null {
        return spell.castSound?.() ?? MagicCombatMethod.resolveCastSound(spell.spellId());
    }

    public static impactSoundFor(spell: { impactSound(): Sound | null; spellId(): number }): Sound | null {
        return spell.impactSound() ?? MagicCombatMethod.resolveImpactSound(spell.spellId());
    }

    private static resolveImpactSound(spellId: number): Sound | null {
        const soundId = MagicCombatMethod.IMPACT_SOUNDS[spellId];
        return soundId === undefined ? null : new Sound(soundId, 1, 0, 0);
    }
}
