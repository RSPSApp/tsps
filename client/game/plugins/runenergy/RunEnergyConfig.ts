import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** RuneLite 1.13.5 RunEnergyConfig: group, keys, names and defaults as in RuneLite. */
export const RunEnergyConfig = ConfigGroup("runenergy", {
    ringOfEnduranceChargeMessage: ConfigItem({
        name: "Ring of endurance charge message",
        description: "Sends a message asking you to charge your equipped ring of endurance when it has less than 500 charges.",
        default: true,
    }),
    replaceOrbText: ConfigItem({
        name: "Replace orb text with run time left",
        description: "Show the remaining run time (in seconds) next in the energy orb.",
        default: false,
    }),
});
