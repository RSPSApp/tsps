import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const VoiceChatConfig = ConfigGroup("voicechat", {
    volume: ConfigItem({
        name: "Voice volume",
        description: "Volume of nearby players, independent of game sounds.",
        default: 100,
        range: { min: 0, max: 100 },
        units: "%",
    }),
});
