import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** RuneLite's HighlightSetting: off, on, or only in PvP areas (the Wilderness and PvP worlds). */
export const HighlightSetting = { DISABLED: "DISABLED", ENABLED: "ENABLED", PVP: "PVP" } as const;
export type HighlightSetting = (typeof HighlightSetting)[keyof typeof HighlightSetting];

/** RuneLite's PlayerNameLocation. */
export const PlayerNameLocation = {
    DISABLED: "DISABLED",
    ABOVE_HEAD: "ABOVE_HEAD",
    MODEL_CENTER: "MODEL_CENTER",
    MODEL_RIGHT: "MODEL_RIGHT",
} as const;
export type PlayerNameLocation = (typeof PlayerNameLocation)[keyof typeof PlayerNameLocation];

const highlight = (keyName: string, name: string, description: string, position: number, def: HighlightSetting) =>
    ConfigItem({
        keyName,
        name,
        description,
        section: "highlightSection",
        position,
        enum: HighlightSetting,
        default: def as HighlightSetting,
    });

const colour = (keyName: string, name: string, description: string, position: number, rgb: number) =>
    ConfigItem({ keyName, name, description, section: "highlightSection", position, color: true, default: (0xff000000 | rgb) >>> 0 });

/**
 * RuneLite's PlayerIndicatorsConfig: group, keys, defaults and order as in RuneLite. Party
 * members and the friends chat / clan rank icons are left out (see the README).
 */
export const PlayerIndicatorsConfig = ConfigGroup(
    "playerindicators",
    {
        highlightOwnPlayer: highlight("highlightSelf", "Highlight own player",
            "Configures whether your own player should be highlighted.", 0, "DISABLED"),
        ownPlayerColor: colour("ownNameColor", "Own player", "Color of your own player.", 1, 0x00b8d4),
        highlightFriends: highlight("highlightFriends", "Highlight friends",
            "Configures whether friends should be highlighted.", 4, "ENABLED"),
        friendColor: colour("friendNameColor", "Friend", "Color of friend names.", 5, 0x00c853),
        highlightFriendsChat: highlight("highlightFriendsChat", "Highlight friends chat members",
            "Configures whether friends chat members should be highlighted.", 6, "ENABLED"),
        friendsChatMemberColor: colour("clanMemberColor", "Friends chat", "Color of friends chat members.", 7, 0xaa00ff),
        highlightTeamMembers: highlight("highlightTeamMembers", "Highlight team members",
            "Configures whether team members should be highlighted.", 8, "ENABLED"),
        teamMemberColor: colour("teamMemberColor", "Team member", "Color of team members.", 9, 0x136ef7),
        highlightClanMembers: highlight("highlightClanMembers", "Highlight clan members",
            "Configures whether clan members should be highlighted.", 10, "ENABLED"),
        clanMemberColor: colour("clanChatMemberColor", "Clan member", "Color of clan members.", 11, 0x240fab),
        highlightOthers: highlight("highlightOthers", "Highlight others",
            "Configures whether other players should be highlighted.", 12, "DISABLED"),
        othersColor: colour("nonClanMemberColor", "Others", "Color of other players names.", 13, 0xff0000),
        drawTiles: ConfigItem({
            keyName: "drawPlayerTiles",
            name: "Draw tiles under players",
            description: "Configures whether or not tiles under highlighted players should be drawn.",
            position: 10,
            default: false,
        }),
        playerNamePosition: ConfigItem({
            name: "Name position",
            description: "Configures the position of drawn player names, or if they should be disabled.",
            position: 11,
            enum: PlayerNameLocation,
            enumLabels: {
                DISABLED: "Disabled",
                ABOVE_HEAD: "Above head",
                MODEL_CENTER: "Center of model",
                MODEL_RIGHT: "Right of model",
            },
            default: "ABOVE_HEAD" as PlayerNameLocation,
        }),
        drawMinimapNames: ConfigItem({
            name: "Draw names on minimap",
            description: "Configures whether or not minimap names for players with rendered names should be drawn.",
            position: 12,
            default: false,
        }),
        colorPlayerMenu: ConfigItem({
            name: "Colorize player menu",
            description: "Color right-click menu for players.",
            position: 13,
            default: true,
        }),
    },
    {
        sections: {
            highlightSection: { name: "Highlight options", position: 99 },
        },
    },
);
