import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/**
 * RuneLite 1.13.5 TimestampConfig: group, keys, names and defaults as in RuneLite. The two
 * colours have no default, so a timestamp takes the line's own colour until one is picked. The
 * format's description is one paragraph, as the settings panel shows plain text.
 */
export const TimestampConfig = ConfigGroup("timestamp", {
    opaqueTimestamp: ConfigItem<number | undefined>({
        name: "Timestamps (opaque)",
        description: "Color of timestamps from the Timestamps plugin (opaque).",
        position: 1,
        color: true,
        default: undefined,
    }),
    transparentTimestamp: ConfigItem<number | undefined>({
        name: "Timestamps (transparent)",
        description: "Color of timestamps from the Timestamps plugin (transparent).",
        position: 2,
        color: true,
        default: undefined,
    }),
    timestampFormat: ConfigItem({
        keyName: "format",
        name: "Timestamp format",
        description: "Customize your timestamp format by using the following characters: "
            + "'yyyy' year, 'MM' month, 'dd' day, 'HH' hour in 24 hour format, 'hh' hour in 12 hour "
            + "format, 'mm' minute, 'ss' second, 'a' AM/PM.",
        position: 3,
        default: "[HH:mm]",
    }),
});
