import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** Colour grades the Colour grade option offers. */
export enum ColorGrade {
    NONE = "none",
    WARM = "warm",
    COOL = "cool",
    NOIR = "noir",
    SEPIA = "sepia",
    TEAL_ORANGE = "tealOrange",
    VIVID = "vivid",
    DREAMY = "dreamy",
    VAPORWAVE = "vaporwave",
}

/** The shader's index for each grade (grade() in hd-shaderfx.wgsl). */
export const COLOR_GRADE_INDEX: Readonly<Record<ColorGrade, number>> = {
    [ColorGrade.NONE]: 0,
    [ColorGrade.WARM]: 1,
    [ColorGrade.COOL]: 2,
    [ColorGrade.NOIR]: 3,
    [ColorGrade.SEPIA]: 4,
    [ColorGrade.TEAL_ORANGE]: 5,
    [ColorGrade.VIVID]: 6,
    [ColorGrade.DREAMY]: 7,
    [ColorGrade.VAPORWAVE]: 8,
};

/**
 * Shader Effects: optional screen shaders reacting to combat, magic, ranged and more. They are
 * drawn by 117 HD's WebGPU post chain, so they need the 117 HD plugin on the WebGPU renderer.
 */
export const ShaderFxConfig = ConfigGroup(
    "shaderfx",
    {
        intensity: ConfigItem({
            name: "Effect intensity",
            description: "Scales every effect. 100 is the designed strength; 0 turns them all off.",
            position: 1,
            section: "general",
            units: "%",
            range: { min: 0, max: 200 },
            default: 100,
        }),

        // Taking damage
        damageVignette: ConfigItem({
            name: "Damage vignette",
            description: "The screen edges flash red when you take a hit.",
            position: 10,
            section: "taking",
            default: true,
        }),
        damageColor: ConfigItem({
            name: "Damage colour",
            description: "The colour of the damage flash.",
            position: 11,
            section: "taking",
            color: true,
            default: 0xd01818,
        }),
        hitChromatic: ConfigItem({
            name: "Hit colour split",
            description: "Red and blue fringes split apart for a moment on a big hit.",
            position: 12,
            section: "taking",
            default: true,
        }),
        hitShake: ConfigItem({
            name: "Hit shake",
            description: "The picture shudders on a big hit.",
            position: 13,
            section: "taking",
            default: true,
        }),
        hitShockwave: ConfigItem({
            name: "Hit shockwave",
            description: "A ring ripples out from the middle of the screen on a big hit.",
            position: 14,
            section: "taking",
            default: true,
        }),
        hitGlitch: ConfigItem({
            name: "Hit glitch",
            description: "Horizontal slices of the picture tear sideways on a big hit.",
            position: 15,
            section: "taking",
            default: false,
        }),
        bigHitDamage: ConfigItem({
            name: "Big hit",
            description: "The damage that counts as a big hit for the options above.",
            position: 16,
            section: "taking",
            units: " dmg",
            range: { min: 1, max: 100 },
            default: 15,
        }),
        lowHealth: ConfigItem({
            name: "Low health warning",
            description: "A pulsing red edge and fading colour while your hitpoints are low.",
            position: 17,
            section: "taking",
            default: true,
        }),
        lowHealthPercent: ConfigItem({
            name: "Low health at",
            description: "The share of your hitpoints at or under which the warning shows.",
            position: 18,
            section: "taking",
            units: "%",
            range: { min: 5, max: 60 },
            default: 25,
        }),

        // Dealing damage
        dealPunch: ConfigItem({
            name: "Hit punch",
            description: "A quick zoom and radial blur when a hit lands on something other than you.",
            position: 20,
            section: "dealing",
            default: true,
        }),
        dealMinDamage: ConfigItem({
            name: "Punch from",
            description: "The smallest hit that punches the screen.",
            position: 21,
            section: "dealing",
            units: " dmg",
            range: { min: 1, max: 100 },
            default: 8,
        }),
        specFlash: ConfigItem({
            name: "Special attack flash",
            description: "A golden flash when you use special attack energy.",
            position: 22,
            section: "dealing",
            default: true,
        }),

        // Magic and ranged
        castGlow: ConfigItem({
            name: "Spell glow",
            description: "A glow washes over the screen when a graphic plays on you, such as a spell cast.",
            position: 30,
            section: "magic",
            default: true,
        }),
        castColor: ConfigItem({
            name: "Spell colour",
            description: "The colour of the spell glow.",
            position: 31,
            section: "magic",
            color: true,
            default: 0x6a5cff,
        }),
        castHueFromGraphic: ConfigItem({
            name: "Colour by spell",
            description: "Picks a different glow colour for each graphic instead of the Spell colour.",
            position: 32,
            section: "magic",
            default: true,
        }),
        rangedFocus: ConfigItem({
            name: "Ranged focus",
            description: "Speed lines streak in from the edges when you fire a ranged attack.",
            position: 33,
            section: "magic",
            default: true,
        }),

        // World events
        levelUpBurst: ConfigItem({
            name: "Level-up burst",
            description: "A golden ring bursts out when one of your skills levels up.",
            position: 40,
            section: "events",
            default: true,
        }),
        poisonTint: ConfigItem({
            name: "Poison haze",
            description: "A sickly green wobble while you are poisoned or envenomed.",
            position: 41,
            section: "events",
            default: true,
        }),

        // Always-on looks
        colorGrade: ConfigItem({
            name: "Colour grade",
            description: "Tints the whole picture.",
            position: 50,
            section: "look",
            enum: {
                None: ColorGrade.NONE,
                Warm: ColorGrade.WARM,
                Cool: ColorGrade.COOL,
                Noir: ColorGrade.NOIR,
                Sepia: ColorGrade.SEPIA,
                "Teal and orange": ColorGrade.TEAL_ORANGE,
                Vivid: ColorGrade.VIVID,
                Dreamy: ColorGrade.DREAMY,
                Vaporwave: ColorGrade.VAPORWAVE,
            },
            default: ColorGrade.NONE,
        }),
        filmGrain: ConfigItem({
            name: "Film grain",
            description: "Fine moving noise over the picture.",
            position: 51,
            section: "look",
            default: false,
        }),
        scanlines: ConfigItem({
            name: "Scanlines",
            description: "Dark horizontal lines, like an old monitor.",
            position: 52,
            section: "look",
            default: false,
        }),
        staticVignette: ConfigItem({
            name: "Vignette",
            description: "Darkens the corners all the time.",
            position: 53,
            section: "look",
            default: false,
        }),
        staticChromatic: ConfigItem({
            name: "Lens fringe",
            description: "A little colour split towards the edges, like a cheap lens.",
            position: 54,
            section: "look",
            default: false,
        }),
        sharpen: ConfigItem({
            name: "Sharpen",
            description: "Crisper edges and textures.",
            position: 55,
            section: "look",
            default: false,
        }),
        tiltShift: ConfigItem({
            name: "Tilt shift",
            description: "Blurs the top and bottom of the screen for a miniature look.",
            position: 56,
            section: "look",
            default: false,
        }),
        pixelate: ConfigItem({
            name: "Pixelate",
            description: "Chunky pixels.",
            position: 57,
            section: "look",
            default: false,
        }),
        posterize: ConfigItem({
            name: "Posterize",
            description: "Rounds colours into a few flat bands, like a comic.",
            position: 58,
            section: "look",
            default: false,
        }),
    },
    {
        sections: {
            general: { name: "General", position: 0 },
            taking: { name: "Taking damage", position: 9 },
            dealing: { name: "Dealing damage", position: 19 },
            magic: { name: "Magic and ranged", position: 29 },
            events: { name: "World events", position: 39 },
            look: { name: "Always-on looks", position: 49, closedByDefault: true },
        },
    },
);
