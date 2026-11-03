import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** RuneLite 1.13.5 MouseHighlightConfig: group, keys, names and defaults as in RuneLite. */
export const MouseHighlightConfig = ConfigGroup("mousehighlight", {
    uiTooltip: ConfigItem({
        name: "Interface tooltips",
        description: "Whether or not tooltips are shown on interfaces.",
        position: 0,
        default: true,
    }),
    chatboxTooltip: ConfigItem({
        name: "Chatbox tooltips",
        description: "Whether or not tooltips are shown over the chatbox.",
        position: 1,
        default: true,
    }),
    disableSpellbooktooltip: ConfigItem({
        name: "Disable spellbook tooltips",
        description: "Disable spellbook tooltips so they don't cover descriptions.",
        position: 2,
        default: false,
    }),
});
