import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import * as AnimationID from "@runelite/api/gameval/AnimationID";
import { inject, CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import type { OsrsClient } from "../../OsrsClient";
import type { MenuActionData } from "../../../ui/menu/menuEvents";

export type DoorKickAnimation = "KICK" | "PUNCH" | "QUICK_KICK" | "QUICK_PUNCH" | "CHEST_KICK";

export const DoorKickerConfig = ConfigGroup("doorkicker", {
    animation: ConfigItem<DoorKickAnimation>({
        name: "Opening animation",
        description: "Local animation to play when opening a door, gate, or trapdoor.",
        enum: {
            KICK: "KICK",
            PUNCH: "PUNCH",
            QUICK_KICK: "QUICK_KICK",
            QUICK_PUNCH: "QUICK_PUNCH",
            CHEST_KICK: "CHEST_KICK",
        },
        enumLabels: {
            KICK: "Unarmed kick",
            PUNCH: "Unarmed punch",
            QUICK_KICK: "Quick unarmed kick",
            QUICK_PUNCH: "Quick unarmed punch",
            CHEST_KICK: "Kick open chest",
        },
        default: "KICK",
    }),
});

const ANIMATION_SEQUENCE: Record<DoorKickAnimation, number> = {
    KICK: AnimationID.HUMAN_UNARMEDKICK,
    PUNCH: AnimationID.HUMAN_UNARMEDPUNCH,
    QUICK_KICK: AnimationID.HUMAN_UNARMEDKICK_QUICK,
    QUICK_PUNCH: AnimationID.HUMAN_UNARMEDPUNCH_QUICK,
    CHEST_KICK: AnimationID.HUMAN_KICKS_CHEST_OPEN,
};

/** Plays a selected local animation when the player chooses to open a door-like object. */
export class DoorKickerPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Door Kicker",
        description: "Play a configurable animation when opening doors and gates",
        tags: ["door", "gate", "animation", "kick", "fun"],
        enabledByDefault: false,
        configKey: "doorkickerplugin",
    };

    static config = DoorKickerConfig;

    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private readonly config = inject(ConfigManager).getConfig(DoorKickerConfig);

    onMenuOptionClicked(action: MenuActionData): boolean {
        if (!this.isStarted()) return false;
        if (!isDoorOpenAction(action)) return false;
        const playerId = this.client.controlledPlayerServerId | 0;
        if (playerId < 0 || !this.client.playerAnimController) return false;
        const animation = String(this.config.animation()) as DoorKickAnimation;
        const sequence = Object.prototype.hasOwnProperty.call(ANIMATION_SEQUENCE, animation)
            ? ANIMATION_SEQUENCE[animation]
            : ANIMATION_SEQUENCE.KICK;
        this.client.playerAnimController.setAnimation(playerId, sequence);
        return false;
    }
}

function isDoorOpenAction(action: MenuActionData): boolean {
    const option = stripTags(action.option).trim().toLowerCase();
    if (!/^open(?:\b|$)/.test(option)) return false;
    const target = stripTags(action.target).toLowerCase();
    return /\b(?:door|gate|trap\s*door|portcullis)\b/.test(target);
}

function stripTags(value: string): string {
    return String(value ?? "").replace(/<[^>]*>/g, "").trim();
}
