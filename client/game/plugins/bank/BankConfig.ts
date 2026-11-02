import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** RuneLite 1.13.3 BankConfig's value options: group, keys and defaults as in RuneLite. */
export const BankConfig = ConfigGroup("bank", {
    showGE: ConfigItem({
        name: "Show Grand Exchange price",
        description: "Show Grand Exchange price total (GE)",
        position: 1,
        default: true,
    }),
    showHA: ConfigItem({
        name: "Show high alchemy price",
        description: "Show high alchemy price total (HA)",
        position: 2,
        default: false,
    }),
    showExact: ConfigItem({
        name: "Show exact bank value",
        description: "Show exact bank value",
        position: 3,
        default: false,
    }),
});
