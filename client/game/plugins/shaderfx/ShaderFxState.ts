import { COLOR_GRADE_INDEX, ColorGrade } from "./ShaderFxConfig";

/** Floats in the shader's uniform block: fourteen vec4s (see Fx in shaderfx.wgsl). */
export const SHADER_FX_UNIFORM_FLOATS = 56;

/** Offsets of each vec4 in the block. The pass fills SCREEN; the state fills the rest. */
export const FxSlot = {
    SCREEN: 0,
    TIME: 4,
    TAKEN: 8,
    DEALT: 12,
    EVENTS: 16,
    CAST: 20,
    DAMAGE_COLOR: 24,
    LOOK_A: 28,
    LOOK_B: 32,
    GRADE: 36,
    /** Ice freeze, entangle thorns, teleport warp, ink outlines. */
    STATUS: 40,
    /** Prayer aura colour rgb, strength. */
    AURA: 44,
    /** Loot flash colour rgb (already scaled by its strength), sweep progress (<0 off). */
    LOOT: 48,
    /** Player on screen (u, v from the top left, radius as a share of the height). */
    FOCUS: 52,
} as const;

/** What the WebGPU post chain asks the plugin each frame. */
export interface ShaderFxRuntime {
    /** Fills the uniform block (all but the screen size); false when nothing would change. */
    fill(out: Float32Array): boolean;
    /** Whether the frame wants the player's model drawn as a mask (the prayer aura follows it). */
    wantsPlayerMask?(): boolean;
}

/** The toggles as the state reads them. */
export interface ShaderFxSettings {
    /** 0 to 2; every effect is scaled by it. */
    intensity: number;
    damageVignette: boolean;
    damageColor: number;
    hitChromatic: boolean;
    hitShake: boolean;
    hitShockwave: boolean;
    hitGlitch: boolean;
    bigHitDamage: number;
    lowHealth: boolean;
    lowHealthPercent: number;
    dealPunch: boolean;
    dealMinDamage: number;
    specFlash: boolean;
    castGlow: boolean;
    castColor: number;
    castHueFromGraphic: boolean;
    rangedFocus: boolean;
    levelUpBurst: boolean;
    poisonTint: boolean;
    colorGrade: ColorGrade;
    filmGrain: boolean;
    scanlines: boolean;
    staticVignette: boolean;
    staticChromatic: boolean;
    sharpen: boolean;
    tiltShift: boolean;
    pixelate: boolean;
    posterize: boolean;
    inkOutlines: boolean;
    prayerAura: boolean;
    freezeEffect: boolean;
    thornsEffect: boolean;
    teleportWarp: boolean;
    lootFlash: boolean;
    /** The drop value (price times quantity) that starts the loot flash. */
    lootFlashValue: number;
}

/** How long each impulse lasts, in milliseconds. */
export const FxDuration = {
    DAMAGE: 650,
    BIG_HIT: 520,
    SHOCKWAVE: 700,
    PUNCH: 240,
    SPEC: 520,
    CAST: 900,
    RANGED: 650,
    LEVEL_UP: 1400,
    FREEZE: 3200,
    THORNS: 3200,
    /** The teleport wind-up builds over this long, and gives up if no landing comes within the timeout. */
    TELEPORT_WINDUP: 1500,
    TELEPORT_TIMEOUT: 3600,
    /** The picture settles back over this long after the landing. */
    TELEPORT_LAND: 1100,
    LOOT: 1500,
} as const;

/** How quickly a freeze or thorns effect comes in, in milliseconds, and the share of it held at full. */
const STATUS_RAMP_MS = 160;
const STATUS_HOLD = 0.35;

/** The strength of the ambient looks, before the intensity scales them. */
const GRAIN = 1;
const SCANLINES = 1;
const VIGNETTE = 1;
const FRINGE = 1;
const SHARPEN = 1;
const TILT_SHIFT = 1;
const PIXEL_SIZE = 3;
const POSTERIZE_LEVELS = 6;

const INK = 1;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** 1 at the start, falling to 0 at `duration`, easing out. */
export function fade(elapsedMs: number, duration: number): number {
    if (!(elapsedMs >= 0) || elapsedMs >= duration) return 0;
    const left = 1 - elapsedMs / duration;
    return left * left;
}

/**
 * Rises over `ramp` milliseconds, holds full strength for the first `hold` share of the
 * duration, then drains away to 0 at `duration`.
 */
export function rampFade(elapsedMs: number, duration: number, ramp: number, hold = 0): number {
    if (!(elapsedMs >= 0) || elapsedMs >= duration) return 0;
    const drain = Math.min(1, (1 - elapsedMs / duration) / Math.max(0.01, 1 - hold));
    return Math.min(1, elapsedMs / ramp) * drain;
}

/** Where the local player is on screen, for the prayer haze. */
export interface PlayerScreen {
    /** Horizontal position, 0 at the left edge to 1 at the right. */
    u: number;
    /** Vertical position, 0 at the top edge to 1 at the bottom. */
    v: number;
    /** Half the player's height on screen, as a share of the canvas height. */
    radius: number;
}

/**
 * How far the teleport bends the picture at `now`, 0 to 1. It builds while the teleport plays,
 * holds until the landing, then settles back.
 */
export function teleportWarp(now: number, startAt: number, landAt: number): number {
    if (startAt > landAt) {
        const age = now - startAt;
        if (!(age >= 0) || age >= FxDuration.TELEPORT_TIMEOUT) return 0;
        const p = clamp01(age / FxDuration.TELEPORT_WINDUP);
        return p * p;
    }
    const age = now - landAt;
    if (!(age >= 0) || age >= FxDuration.TELEPORT_LAND) return 0;
    const left = 1 - age / FxDuration.TELEPORT_LAND;
    return left * left;
}

/** Where the prayer haze sits when the player's spot is unknown: the middle of the screen. */
const SCREEN_CENTRE: PlayerScreen = { u: 0.5, v: 0.5, radius: 0.12 };

/** The aura colour for each prayer that has one, as [varbit, r, g, b]. */
export const PRAYER_AURA_COLORS: ReadonlyArray<readonly [number, number, number, number]> = [
    [4118, 1.0, 0.3, 0.22], // Protect from Melee
    [4117, 0.3, 1.0, 0.4], // Protect from Missiles
    [4116, 0.3, 0.6, 1.0], // Protect from Magic
    [4129, 1.0, 0.8, 0.25], // Piety
    [5464, 0.7, 0.3, 1.0], // Rigour
    [5465, 0.3, 0.95, 0.95], // Augury
];

/** The loot flash colour: gold from the threshold, purple from ten times it. */
export function lootColor(value: number, threshold: number): [number, number, number] | undefined {
    if (!(value >= Math.max(1, threshold))) return undefined;
    return value >= threshold * 10 ? [0.8, 0.35, 1] : [1, 0.8, 0.28];
}

/** A colour for a graphic id: a stable hue per id, so each spell glows its own colour. */
export function graphicColor(graphicId: number): [number, number, number] {
    // Golden-ratio spacing keeps neighbouring ids visibly apart.
    const hue = ((graphicId * 0.61803398875) % 1 + 1) % 1;
    const h = hue * 6;
    const f = h - Math.floor(h);
    const q = 1 - 0.75 * f;
    const t = 1 - 0.75 * (1 - f);
    const table: [number, number, number][] = [
        [1, t, 0.25], [q, 1, 0.25], [0.25, 1, t], [0.25, q, 1], [t, 0.25, 1], [1, 0.25, q],
    ];
    return table[Math.floor(h) % 6];
}

const unpackRgb = (rgb: number): [number, number, number] => [
    ((rgb >>> 16) & 0xff) / 255,
    ((rgb >>> 8) & 0xff) / 255,
    (rgb & 0xff) / 255,
];

/**
 * What the shaders react to, kept as a few decaying impulses: a hit starts one, the frame reads
 * how much is left. Pure, with the clock passed in, so it is testable without a GPU.
 */
export class ShaderFxState {
    private damageAt = -1e9;
    private damageStrength = 0;
    private bigHitAt = -1e9;
    private bigHitStrength = 0;
    private punchAt = -1e9;
    private punchStrength = 0;
    private specAt = -1e9;
    private castAt = -1e9;
    private castColor: [number, number, number] = [0.42, 0.36, 1];
    private rangedAt = -1e9;
    private levelUpAt = -1e9;
    private freezeAt = -1e9;
    private thornsAt = -1e9;
    private teleportStartAt = -1e9;
    private teleportLandAt = -1e9;
    private playerScreen: PlayerScreen | undefined;
    private lootAt = -1e9;
    private lootRgb: [number, number, number] = [1, 0.8, 0.28];
    private auraRgb: [number, number, number] | undefined;
    /** Whether anything in the frame being filled would change the picture. */
    private active = false;
    /** Notes a strength for fill(): kept as a field so no closure is made per frame. */
    private readonly mark = (value: number): number => {
        if (value > 0) this.active = true;
        return value;
    };
    /** Hitpoints over maximum, 1 when unknown. */
    private healthFraction = 1;
    private poisoned = false;

    /** A hit on the local player. */
    hitTaken(damage: number, bigHitDamage: number, now: number): void {
        if (!(damage > 0)) return;
        const big = Math.max(1, bigHitDamage);
        this.damageAt = now;
        this.damageStrength = clamp01(0.35 + 0.65 * (damage / big));
        if (damage >= big) {
            this.bigHitAt = now;
            this.bigHitStrength = clamp01(0.55 + 0.45 * (damage / (big * 2)));
        }
    }

    /** A hit on something else. */
    hitDealt(damage: number, minDamage: number, now: number): void {
        if (!(damage >= Math.max(1, minDamage))) return;
        this.punchAt = now;
        this.punchStrength = clamp01(0.4 + damage / 40);
    }

    specUsed(now: number): void {
        this.specAt = now;
    }

    /** A graphic played on the local player (a spell cast, a teleport, a prayer). */
    cast(graphicId: number, now: number, settings: Pick<ShaderFxSettings, "castHueFromGraphic" | "castColor">): void {
        this.castAt = now;
        this.castColor = settings.castHueFromGraphic ? graphicColor(graphicId) : unpackRgb(settings.castColor);
    }

    /** Drops a spell glow that turned out to be a ranged weapon's draw-back. */
    cancelCast(): void {
        this.castAt = -1e9;
    }

    rangedFired(now: number): void {
        this.rangedAt = now;
    }

    levelUp(now: number): void {
        this.levelUpAt = now;
    }

    /** An Ice spell's graphic landed on the local player. */
    frozen(now: number): void {
        this.freezeAt = now;
    }

    /** Bind, Snare or Entangle rooted the local player. */
    entangled(now: number): void {
        this.thornsAt = now;
    }

    /** A teleport graphic started on the local player: the wind-up builds until the landing. */
    teleportStarted(now: number): void {
        if (this.teleportStartAt > this.teleportLandAt && now - this.teleportStartAt < FxDuration.TELEPORT_TIMEOUT) return;
        this.teleportStartAt = now;
    }

    /** The local player jumped a long way in one tick: the landing. */
    teleported(now: number): void {
        this.teleportLandAt = now;
    }

    /** A valuable drop arrived; `value` is its price times quantity. */
    lootDropped(value: number, threshold: number, now: number): void {
        const color = lootColor(value, threshold);
        if (!color) return;
        this.lootAt = now;
        this.lootRgb = color;
    }

    /** Whether a prayer aura is showing, so the plugin only looks up the player's screen spot when needed. */
    hasPrayerAura(): boolean {
        return this.auraRgb !== undefined;
    }

    /** Where the local player is on screen; undefined puts the haze in the middle. */
    setPlayerScreen(screen: PlayerScreen | undefined): void {
        this.playerScreen = screen;
    }

    /** The prayer aura colour, or undefined when no prayer with an aura is on. */
    setPrayerAura(rgb: [number, number, number] | undefined): void {
        this.auraRgb = rgb;
    }

    setHealth(current: number, max: number): void {
        this.healthFraction = max > 0 ? clamp01(current / max) : 1;
    }

    setPoisoned(poisoned: boolean): void {
        this.poisoned = poisoned;
    }

    /** Drops everything in flight, for a logout or world hop. */
    reset(): void {
        this.damageAt = this.bigHitAt = this.punchAt = this.specAt = -1e9;
        this.castAt = this.rangedAt = this.levelUpAt = -1e9;
        this.freezeAt = this.thornsAt = this.teleportStartAt = this.teleportLandAt = this.lootAt = -1e9;
        this.playerScreen = undefined;
        this.auraRgb = undefined;
        this.healthFraction = 1;
        this.poisoned = false;
    }

    /**
     * Writes everything but the screen size into `out` (SHADER_FX_UNIFORM_FLOATS floats).
     * Returns whether any effect would change the picture, so an idle frame costs nothing.
     */
    fill(out: Float32Array, settings: ShaderFxSettings, now: number): boolean {
        out.fill(0);
        const k = Math.max(0, Math.min(2, settings.intensity));
        if (k <= 0) return false;
        this.active = false;

        out[FxSlot.TIME] = (now / 1000) % 1000;

        // Taken: vignette, colour split, shake, shockwave progress (-1 when none)
        const damage = settings.damageVignette
            ? fade(now - this.damageAt, FxDuration.DAMAGE) * this.damageStrength * k : 0;
        const bigFade = fade(now - this.bigHitAt, FxDuration.BIG_HIT) * this.bigHitStrength * k;
        out[FxSlot.TAKEN] = this.mark(damage);
        out[FxSlot.TAKEN + 1] = this.mark(settings.hitChromatic ? bigFade : 0);
        out[FxSlot.TAKEN + 2] = this.mark(settings.hitShake ? bigFade : 0);
        const waveAge = now - this.bigHitAt;
        const waveOn = settings.hitShockwave && waveAge >= 0 && waveAge < FxDuration.SHOCKWAVE;
        out[FxSlot.TAKEN + 3] = -1;
        if (waveOn) {
            this.active = true;
            out[FxSlot.TAKEN + 3] = Math.min(0.9999, Math.max(0.0001, waveAge / FxDuration.SHOCKWAVE));
        }

        // Dealt: punch, low health, spec flash, level-up strength
        out[FxSlot.DEALT] = this.mark(
            settings.dealPunch ? fade(now - this.punchAt, FxDuration.PUNCH) * this.punchStrength * k : 0,
        );
        const lowAt = Math.max(0.05, Math.min(0.9, settings.lowHealthPercent / 100));
        const low = settings.lowHealth && this.healthFraction < lowAt
            ? clamp01(1 - this.healthFraction / lowAt) * 0.6 + 0.4 : 0;
        out[FxSlot.DEALT + 1] = this.mark(low * k);
        out[FxSlot.DEALT + 2] = this.mark(settings.specFlash ? fade(now - this.specAt, FxDuration.SPEC) * k : 0);
        const levelAge = now - this.levelUpAt;
        const levelOn = settings.levelUpBurst && levelAge >= 0 && levelAge < FxDuration.LEVEL_UP;
        out[FxSlot.DEALT + 3] = levelOn ? this.mark(1 - levelAge / FxDuration.LEVEL_UP) * k : 0;

        // Events: level-up ring progress (-1 none), poison, ranged focus, glitch
        out[FxSlot.EVENTS] = levelOn ? clamp01(levelAge / (FxDuration.LEVEL_UP * 0.7)) : -1;
        out[FxSlot.EVENTS + 1] = this.mark(settings.poisonTint && this.poisoned ? k : 0);
        out[FxSlot.EVENTS + 2] = this.mark(
            settings.rangedFocus ? fade(now - this.rangedAt, FxDuration.RANGED) * k : 0,
        );
        out[FxSlot.EVENTS + 3] = this.mark(settings.hitGlitch ? bigFade : 0);

        // Cast glow, with the colour in rgb and the strength in alpha
        const castFade = settings.castGlow ? fade(now - this.castAt, FxDuration.CAST) * k : 0;
        out.set(this.castColor, FxSlot.CAST);
        out[FxSlot.CAST + 3] = this.mark(castFade);
        const damageColor = settings.damageColor;
        out[FxSlot.DAMAGE_COLOR] = ((damageColor >>> 16) & 0xff) / 255;
        out[FxSlot.DAMAGE_COLOR + 1] = ((damageColor >>> 8) & 0xff) / 255;
        out[FxSlot.DAMAGE_COLOR + 2] = (damageColor & 0xff) / 255;
        // The shockwave's strength rides in the damage colour's spare alpha.
        out[FxSlot.DAMAGE_COLOR + 3] = this.bigHitStrength * k;

        // Always-on looks
        out[FxSlot.LOOK_A] = this.mark(settings.filmGrain ? GRAIN * k : 0);
        out[FxSlot.LOOK_A + 1] = this.mark(settings.scanlines ? SCANLINES * Math.min(1, k) : 0);
        out[FxSlot.LOOK_A + 2] = this.mark(settings.staticVignette ? VIGNETTE * k : 0);
        out[FxSlot.LOOK_A + 3] = this.mark(settings.staticChromatic ? FRINGE * k : 0);
        out[FxSlot.LOOK_B] = this.mark(settings.sharpen ? SHARPEN * k : 0);
        out[FxSlot.LOOK_B + 1] = this.mark(settings.tiltShift ? TILT_SHIFT * k : 0);
        out[FxSlot.LOOK_B + 2] = this.mark(settings.pixelate ? PIXEL_SIZE : 0);
        out[FxSlot.LOOK_B + 3] = this.mark(settings.posterize ? POSTERIZE_LEVELS : 0);
        const grade = COLOR_GRADE_INDEX[settings.colorGrade] ?? 0;
        out[FxSlot.GRADE] = grade;
        out[FxSlot.GRADE + 1] = grade > 0 ? Math.min(1, k) : 0;
        if (grade > 0) this.active = true;

        // Status: ice freeze, thorns, teleport warp, ink outlines
        out[FxSlot.STATUS] = this.mark(
            settings.freezeEffect ? rampFade(now - this.freezeAt, FxDuration.FREEZE, STATUS_RAMP_MS, STATUS_HOLD) * k : 0,
        );
        out[FxSlot.STATUS + 1] = this.mark(
            settings.thornsEffect ? rampFade(now - this.thornsAt, FxDuration.THORNS, STATUS_RAMP_MS, STATUS_HOLD) * k : 0,
        );
        out[FxSlot.STATUS + 2] = this.mark(
            settings.teleportWarp ? teleportWarp(now, this.teleportStartAt, this.teleportLandAt) * k : 0,
        );
        out[FxSlot.STATUS + 3] = this.mark(settings.inkOutlines ? INK * Math.min(1, k) : 0);

        // Prayer aura, with the colour in rgb and the strength in alpha; the focus slot says where
        const focus = this.playerScreen ?? SCREEN_CENTRE;
        out[FxSlot.FOCUS] = focus.u;
        out[FxSlot.FOCUS + 1] = focus.v;
        out[FxSlot.FOCUS + 2] = focus.radius;
        if (settings.prayerAura && this.auraRgb) {
            out.set(this.auraRgb, FxSlot.AURA);
            out[FxSlot.AURA + 3] = this.mark(k);
        }

        // Loot flash: the sweep's progress (-1 none), with the colour scaled by the intensity
        const lootAge = now - this.lootAt;
        out[FxSlot.LOOT + 3] = -1;
        if (settings.lootFlash && lootAge >= 0 && lootAge < FxDuration.LOOT) {
            this.active = true;
            out[FxSlot.LOOT] = this.lootRgb[0] * k;
            out[FxSlot.LOOT + 1] = this.lootRgb[1] * k;
            out[FxSlot.LOOT + 2] = this.lootRgb[2] * k;
            out[FxSlot.LOOT + 3] = lootAge / FxDuration.LOOT;
        }

        return this.active;
    }
}
