import { COLOR_GRADE_INDEX, ColorGrade } from "./ShaderFxConfig";

/** Floats in the shader's uniform block: ten vec4s (see Fx in hd-shaderfx.wgsl). */
export const SHADER_FX_UNIFORM_FLOATS = 40;

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
} as const;

/** What the WebGPU post chain asks the plugin each frame. */
export interface ShaderFxRuntime {
    /** Fills the uniform block (all but the screen size); false when nothing would change. */
    fill(out: Float32Array): boolean;
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
} as const;

/** The strength of the ambient looks, before the intensity scales them. */
const GRAIN = 1;
const SCANLINES = 1;
const VIGNETTE = 1;
const FRINGE = 1;
const SHARPEN = 1;
const TILT_SHIFT = 1;
const PIXEL_SIZE = 3;
const POSTERIZE_LEVELS = 6;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** 1 at the start, falling to 0 at `duration`, easing out. */
export function fade(elapsedMs: number, duration: number): number {
    if (!(elapsedMs >= 0) || elapsedMs >= duration) return 0;
    const left = 1 - elapsedMs / duration;
    return left * left;
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
        let active = false;
        const mark = (value: number) => {
            if (value > 0) active = true;
            return value;
        };

        out[FxSlot.TIME] = (now / 1000) % 1000;

        // Taken: vignette, colour split, shake, shockwave progress (-1 when none)
        const damage = settings.damageVignette
            ? fade(now - this.damageAt, FxDuration.DAMAGE) * this.damageStrength * k : 0;
        const bigFade = fade(now - this.bigHitAt, FxDuration.BIG_HIT) * this.bigHitStrength * k;
        out[FxSlot.TAKEN] = mark(damage);
        out[FxSlot.TAKEN + 1] = mark(settings.hitChromatic ? bigFade : 0);
        out[FxSlot.TAKEN + 2] = mark(settings.hitShake ? bigFade : 0);
        const waveAge = now - this.bigHitAt;
        const waveOn = settings.hitShockwave && waveAge >= 0 && waveAge < FxDuration.SHOCKWAVE;
        out[FxSlot.TAKEN + 3] = -1;
        if (waveOn) {
            active = true;
            out[FxSlot.TAKEN + 3] = Math.min(0.9999, Math.max(0.0001, waveAge / FxDuration.SHOCKWAVE));
        }

        // Dealt: punch, low health, spec flash, level-up strength
        out[FxSlot.DEALT] = mark(
            settings.dealPunch ? fade(now - this.punchAt, FxDuration.PUNCH) * this.punchStrength * k : 0,
        );
        const lowAt = Math.max(0.05, Math.min(0.9, settings.lowHealthPercent / 100));
        const low = settings.lowHealth && this.healthFraction < lowAt
            ? clamp01(1 - this.healthFraction / lowAt) * 0.6 + 0.4 : 0;
        out[FxSlot.DEALT + 1] = mark(low * k);
        out[FxSlot.DEALT + 2] = mark(settings.specFlash ? fade(now - this.specAt, FxDuration.SPEC) * k : 0);
        const levelAge = now - this.levelUpAt;
        const levelOn = settings.levelUpBurst && levelAge >= 0 && levelAge < FxDuration.LEVEL_UP;
        out[FxSlot.DEALT + 3] = levelOn ? mark(1 - levelAge / FxDuration.LEVEL_UP) * k : 0;

        // Events: level-up ring progress (-1 none), poison, ranged focus, glitch
        out[FxSlot.EVENTS] = levelOn ? clamp01(levelAge / (FxDuration.LEVEL_UP * 0.7)) : -1;
        out[FxSlot.EVENTS + 1] = mark(settings.poisonTint && this.poisoned ? k : 0);
        out[FxSlot.EVENTS + 2] = mark(
            settings.rangedFocus ? fade(now - this.rangedAt, FxDuration.RANGED) * k : 0,
        );
        out[FxSlot.EVENTS + 3] = mark(settings.hitGlitch ? bigFade : 0);

        // Cast glow, with the colour in rgb and the strength in alpha
        const castFade = settings.castGlow ? fade(now - this.castAt, FxDuration.CAST) * k : 0;
        out.set(this.castColor, FxSlot.CAST);
        out[FxSlot.CAST + 3] = mark(castFade);
        out.set(unpackRgb(settings.damageColor), FxSlot.DAMAGE_COLOR);
        // The shockwave's strength rides in the damage colour's spare alpha.
        out[FxSlot.DAMAGE_COLOR + 3] = this.bigHitStrength * k;

        // Always-on looks
        out[FxSlot.LOOK_A] = mark(settings.filmGrain ? GRAIN * k : 0);
        out[FxSlot.LOOK_A + 1] = mark(settings.scanlines ? SCANLINES * Math.min(1, k) : 0);
        out[FxSlot.LOOK_A + 2] = mark(settings.staticVignette ? VIGNETTE * k : 0);
        out[FxSlot.LOOK_A + 3] = mark(settings.staticChromatic ? FRINGE * k : 0);
        out[FxSlot.LOOK_B] = mark(settings.sharpen ? SHARPEN * k : 0);
        out[FxSlot.LOOK_B + 1] = mark(settings.tiltShift ? TILT_SHIFT * k : 0);
        out[FxSlot.LOOK_B + 2] = mark(settings.pixelate ? PIXEL_SIZE : 0);
        out[FxSlot.LOOK_B + 3] = mark(settings.posterize ? POSTERIZE_LEVELS : 0);
        const grade = COLOR_GRADE_INDEX[settings.colorGrade] ?? 0;
        out[FxSlot.GRADE] = grade;
        out[FxSlot.GRADE + 1] = grade > 0 ? Math.min(1, k) : 0;
        if (grade > 0) active = true;

        return active;
    }
}
