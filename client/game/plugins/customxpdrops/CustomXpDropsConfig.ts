/*
 * Ported from l2-'s Customizable XP drops (upstream commit 3835071).
 * Copyright (c) 2021, l2-
 * SPDX-License-Identifier: BSD-2-Clause
 * See LICENSE in this directory.
 */
import { ConfigGroup, ConfigItem, ConfigSection } from "@runelite/client/config/ConfigItem";
import { FontType } from "@runelite/client/config/FontType";

export enum CenterOn {
    TEXT = "TEXT",
    ICON_AND_TEXT = "ICON_AND_TEXT",
}

export enum VerticalDirection {
    UP = "UP",
    DOWN = "DOWN",
}

export enum HorizontalDirection {
    LEFT = "LEFT",
    RIGHT = "RIGHT",
}

export enum PredictedHitIconStyle {
    NO_ICON = "NO_ICON",
    HITSPLAT = "HITSPLAT",
    HITSPLAT_SKILL = "HITSPLAT_SKILL",
    SKILL = "SKILL",
}

/** TextComponentWithAlpha.Background: what is drawn behind the text. */
export enum TextBackground {
    NONE = "NONE",
    SHADOW = "SHADOW",
    OUTLINE = "OUTLINE",
}

/** XpTrackerSkills: a fixed skill, the overall total, or whichever skill last gained XP. */
export enum XpTrackerSkill {
    OVERALL = "OVERALL",
    MOST_RECENT = "MOST_RECENT",
    ATTACK = "ATTACK",
    STRENGTH = "STRENGTH",
    DEFENCE = "DEFENCE",
    HITPOINTS = "HITPOINTS",
    RANGED = "RANGED",
    PRAYER = "PRAYER",
    MAGIC = "MAGIC",
    RUNECRAFT = "RUNECRAFT",
    CONSTRUCTION = "CONSTRUCTION",
    AGILITY = "AGILITY",
    HERBLORE = "HERBLORE",
    THIEVING = "THIEVING",
    CRAFTING = "CRAFTING",
    FLETCHING = "FLETCHING",
    SLAYER = "SLAYER",
    HUNTER = "HUNTER",
    MINING = "MINING",
    SMITHING = "SMITHING",
    FISHING = "FISHING",
    COOKING = "COOKING",
    FIREMAKING = "FIREMAKING",
    WOODCUTTING = "WOODCUTTING",
    FARMING = "FARMING",
    SAILING = "SAILING",
}

const WHITE = 0xffffffff;

const XP_DROP = "xp_drop_settings";
const FONT = "font_settings";
const PREDICTED_HIT = "predicted_hit";
const XP_TRACKER = "xp_tracker_settings";
const MISC = "xp_miscellaneous_settings";

/**
 * Customizable XP Drops (l2-, plugin hub commit 3835071) XpDropsConfig: group, keys, names and
 * defaults as there. Left out: the Party section (this client has no RuneLite party), the
 * overlay priorities (overlays here have none), "Allow icons override" (no resource packs) and
 * "Show fake icon" (no FakeXpDrop event).
 */
export const CustomXpDropsConfig = ConfigGroup(
    "CustomizableXPDrops",
    {
        useCustomizableXpDrops: ConfigItem({
            name: "Use Customizable XP drops",
            description: "Control if this plugin should show customizable xp drops or not. Useful when only the xp tracker is wanted.",
            position: -2,
            section: XP_DROP,
            default: true,
        }),
        isGrouped: ConfigItem({
            keyName: "grouped",
            name: "Group XP drops",
            description: "Group XP drops",
            position: 0,
            section: XP_DROP,
            default: true,
        }),
        groupedDelay: ConfigItem({
            name: "XP drop delay",
            description: "The amount of frames delay between 2 drops when not grouped",
            position: 0,
            section: XP_DROP,
            default: 20,
        }),
        yPixelsPerSecond: ConfigItem({
            name: "Vertical XP drop speed",
            description: "The amount of pixels per second the drop is moved in vertical direction",
            position: 1,
            section: XP_DROP,
            default: 44,
        }),
        yDirection: ConfigItem<VerticalDirection>({
            name: "Vertical direction",
            description: "The direction in which the XP drop moves",
            position: 1,
            section: XP_DROP,
            enum: VerticalDirection,
            default: VerticalDirection.UP,
        }),
        xPixelsPerSecond: ConfigItem({
            name: "Horizontal XP drop speed",
            description: "The amount of pixels per second the drop is moved in horizontal direction",
            position: 2,
            section: XP_DROP,
            default: 0,
        }),
        xDirection: ConfigItem<HorizontalDirection>({
            name: "Horizontal direction",
            description: "The direction in which the XP drop moves",
            position: 2,
            section: XP_DROP,
            enum: HorizontalDirection,
            default: HorizontalDirection.LEFT,
        }),
        framesPerDrop: ConfigItem({
            name: "Time until disappearance",
            description: "The amount of frames (50 per second) the XP drop will show for",
            position: 3,
            section: XP_DROP,
            default: 100,
        }),
        fadeOut: ConfigItem({
            name: "Fade out",
            description: "Should the XP drop fade out",
            position: 4,
            section: XP_DROP,
            default: true,
        }),
        showIcons: ConfigItem({
            name: "Show skill icons",
            description: "Show the skill icons next to the XP drop or predicted hit",
            position: 5,
            section: XP_DROP,
            default: true,
        }),
        xpDropColor: ConfigItem({
            name: "Xp drop color",
            description: "Color of the XP drop text",
            position: 7,
            section: XP_DROP,
            color: true,
            alpha: true,
            default: WHITE,
        }),
        xpDropColorMelee: ConfigItem({
            name: "Xp drop color melee",
            description: "Color of the XP drop text when praying melee offensively",
            position: 8,
            section: XP_DROP,
            color: true,
            alpha: true,
            default: WHITE,
        }),
        xpDropColorMage: ConfigItem({
            name: "Xp drop color mage",
            description: "Color of the XP drop text when praying mage offensively",
            position: 9,
            section: XP_DROP,
            color: true,
            alpha: true,
            default: WHITE,
        }),
        xpDropColorRange: ConfigItem({
            name: "Xp drop color range",
            description: "Color of the XP drop text when praying range offensively",
            position: 10,
            section: XP_DROP,
            color: true,
            alpha: true,
            default: WHITE,
        }),
        xpDropFontType: ConfigItem<FontType>({
            name: "Font style",
            description: "Style of the font to use for XP drops.",
            position: 12,
            section: FONT,
            fontType: true,
            default: FontType.REGULAR,
        }),
        xpDropBackground: ConfigItem<TextBackground>({
            name: "Background",
            description: "Background of the XP drop text",
            position: 13,
            section: FONT,
            enum: TextBackground,
            default: TextBackground.SHADOW,
        }),
        iconSizeOverride: ConfigItem({
            name: "Icon size override",
            description: "When non zero indicates the size of the skill icons in the xp drop.",
            position: 13,
            section: FONT,
            default: 0,
        }),
        attachToPlayer: ConfigItem({
            name: "Attach to player",
            description: "Attaches the XP drop location to the player",
            position: 14,
            section: XP_DROP,
            default: false,
        }),
        attachToTarget: ConfigItem({
            name: "Attach to target",
            description: "Attaches the XP drop location to the targeted Actor(NPC/Player)",
            position: 14,
            section: XP_DROP,
            default: false,
        }),
        attachToOffsetX: ConfigItem({
            name: "Attach to x offset",
            description: "Change the attach to overlay x position with relation to the target",
            position: 15,
            section: XP_DROP,
            range: { min: -100000 },
            default: 0,
        }),
        attachToOffsetY: ConfigItem({
            name: "Attach to y offset",
            description: "Change the attach to overlay y position with relation to the target",
            position: 15,
            section: XP_DROP,
            range: { min: -100000 },
            default: 0,
        }),
        skillsToFilter: ConfigItem({
            name: "Skills to filter",
            description: "Names of the skills for which a XP drop should not be shown, each name separated by a comma. Must be the full name of the skill as shown when hovered in the skills tab.",
            position: 17,
            section: XP_DROP,
            default: "",
        }),
        xpDropPrefix: ConfigItem({
            name: "Xp drop prefix",
            description: "Custom prefix to be placed in front of the xp drop after the icon",
            position: 18,
            section: XP_DROP,
            default: "",
        }),
        xpDropSuffix: ConfigItem({
            name: "Xp drop suffix",
            description: "Custom suffix to be placed after xp drop",
            position: 19,
            section: XP_DROP,
            default: "",
        }),
        showPredictedHit: ConfigItem({
            name: "Show predicted hit",
            description: "Show the amount that is predicted you will hit based on the current xp drop",
            position: 18,
            section: PREDICTED_HIT,
            default: false,
        }),
        neverGroupPredictedHit: ConfigItem({
            name: "Never group predicted hit",
            description: "Always show the predicted hit as a separate drop regardless of the xp grouped setting",
            position: 19,
            section: PREDICTED_HIT,
            default: false,
        }),
        predictedHitPrefix: ConfigItem({
            name: "Predicted hit prefix",
            description: "Custom prefix to be placed in front of the predicted hit after the icon",
            position: 20,
            section: PREDICTED_HIT,
            default: "",
        }),
        predictedHitSuffix: ConfigItem({
            name: "Predicted hit suffix",
            description: "Custom suffix to be placed after predicted hit",
            position: 21,
            section: PREDICTED_HIT,
            default: "",
        }),
        skillsToFilterForPredictedHits: ConfigItem({
            name: "Skills to filter for hits",
            description: "Names of the skills for which a predicted hit should not be shown, each name separated by a comma. Must be the full name of the skill as shown when hovered in the skills tab.",
            position: 22,
            section: PREDICTED_HIT,
            default: "",
        }),
        xpMultiplier: ConfigItem({
            name: "Xp multiplier",
            description: "A bonus xp multiplier to factor in when calculating the hit, on top of the world's rate (which the server tells the client).",
            position: 23,
            section: PREDICTED_HIT,
            step: 0.01,
            default: 1,
        }),
        predictedHitColor: ConfigItem({
            name: "Predicted hit color",
            description: "Color of predicted hit, only works with Predicted hit color override enabled",
            position: 24,
            section: PREDICTED_HIT,
            color: true,
            alpha: true,
            default: WHITE,
        }),
        predictedHitColorOverride: ConfigItem({
            name: "Predicted hit color override",
            description: "Override the predicted hit text color with custom color",
            position: 25,
            section: PREDICTED_HIT,
            default: false,
        }),
        predictedHitIcon: ConfigItem<PredictedHitIconStyle>({
            name: "Predicted hit icon",
            description: "The style of the predicted hit icon. Only applicable when `Never group predicted hit` is enabled.",
            position: 26,
            section: PREDICTED_HIT,
            enum: PredictedHitIconStyle,
            enumLabels: {
                NO_ICON: "No icon",
                HITSPLAT: "Hitsplat",
                HITSPLAT_SKILL: "Hitsplat and skill",
                SKILL: "Skill",
            },
            default: PredictedHitIconStyle.HITSPLAT,
        }),
        predictedHitModifiers: ConfigItem({
            name: "Predicted hit xp modifiers",
            description: "Advanced. Enter your own xp modifiers per NPC id here, one per line as npcId:modifier, "
                + "for NPCs that pay a different rate of combat XP (the Gemstone Crab pays 0.875).",
            position: 27,
            section: PREDICTED_HIT,
            textArea: true,
            default: "",
        }),
        useXpTracker: ConfigItem({
            name: "Use xp tracker",
            description: "Enable or disable custom xp tracker",
            position: 24,
            section: XP_TRACKER,
            default: false,
        }),
        showXpTrackerProgressBar: ConfigItem({
            name: "Show progress bar",
            description: "Show a progress bar in the tracker similar to the progress bar in the vanilla tracker. Configure the start and goal in game.",
            position: 25,
            section: XP_TRACKER,
            default: false,
        }),
        xpTrackerProgressBarHeight: ConfigItem({
            name: "Progress bar height",
            description: "The height in pixels of the xp tracker progress bar.",
            position: 26,
            section: XP_TRACKER,
            range: { min: 3 },
            default: 6,
        }),
        showIconsXpTracker: ConfigItem({
            name: "Show icons xp tracker",
            description: "Enable or disable skill icons for xp tracker",
            position: 27,
            section: XP_TRACKER,
            default: true,
        }),
        xpTrackerSkill: ConfigItem<XpTrackerSkill>({
            name: "Xp tracker skill",
            description: "Skill to display within the Xp Tracker",
            position: 28,
            section: XP_TRACKER,
            enum: XpTrackerSkill,
            default: XpTrackerSkill.MOST_RECENT,
        }),
        xpTrackerFontType: ConfigItem<FontType>({
            name: "Font",
            description: "Font to use for the xp tracker",
            position: 29,
            section: XP_TRACKER,
            fontType: true,
            default: FontType.REGULAR,
        }),
        xpTrackerBackground: ConfigItem<TextBackground>({
            name: "XP tracker text background",
            description: "Background of the XP tracker text",
            position: 30,
            section: XP_TRACKER,
            enum: TextBackground,
            default: TextBackground.SHADOW,
        }),
        xpTrackerIconSizeOverride: ConfigItem({
            name: "Icon size override",
            description: "When non zero indicates the size of the skill icons for the XP tracker.",
            position: 31,
            section: XP_TRACKER,
            default: 0,
        }),
        xpTrackerColor: ConfigItem({
            name: "XP tracker color",
            description: "Color for the Xp Tracker",
            position: 32,
            section: XP_TRACKER,
            color: true,
            alpha: true,
            default: WHITE,
        }),
        xpTrackerBorderColor: ConfigItem({
            name: "XP tracker border color",
            description: "Color for the Xp Tracker border",
            position: 33,
            section: XP_TRACKER,
            color: true,
            alpha: true,
            default: 0xff5a5245,
        }),
        xpTrackerClientTicksToLinger: ConfigItem({
            name: "Time until disappearance",
            description: "Never disappear when set to 0. The amount of frames (50 per second) the XP tracker will show for.",
            position: 34,
            section: XP_TRACKER,
            default: 0,
        }),
        xpTrackerFadeOut: ConfigItem({
            name: "Fade out",
            description: "Should the XP tracker fade out",
            position: 35,
            section: XP_TRACKER,
            default: true,
        }),
        xpDropsHideVanilla: ConfigItem({
            name: "Hide vanilla xp drops",
            description: "When enabled this plugin will hide the vanilla xp drops",
            position: 1,
            section: MISC,
            default: true,
        }),
        xpTrackerHideVanilla: ConfigItem({
            name: "Hide vanilla xp tracker",
            description: "When enabled and when 'Use xp tracker' is enabled this plugin will hide the vanilla xp tracker",
            position: 2,
            section: MISC,
            default: true,
        }),
        xpDropForceCentered: ConfigItem({
            name: "Force xp drops to be centered",
            description: "Center xp drops within their overlay box. Has no effect when the drops are attached to the player or target.",
            position: 3,
            section: MISC,
            default: false,
        }),
        xpDropCenterOn: ConfigItem<CenterOn>({
            name: "Center xp drop on",
            description: "Centers the xp drop on the xp drop text only or on the total width of the icon and text.",
            position: 4,
            section: MISC,
            enum: CenterOn,
            enumLabels: { TEXT: "Text", ICON_AND_TEXT: "Icon and text" },
            default: CenterOn.ICON_AND_TEXT,
        }),
    },
    {
        sections: {
            [XP_DROP]: ConfigSection({ name: "Xp drop settings", position: 1 }),
            [FONT]: ConfigSection({ name: "Font settings", position: 2, closedByDefault: true }),
            [PREDICTED_HIT]: ConfigSection({ name: "Predicted hit", position: 3, closedByDefault: true }),
            [XP_TRACKER]: ConfigSection({ name: "Xp tracker overlay", position: 4, closedByDefault: true }),
            [MISC]: ConfigSection({ name: "Miscellaneous", position: 5, closedByDefault: true }),
        },
    },
);
