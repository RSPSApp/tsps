import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { RUNELITE_DEFAULT_RESIZABLE_SCALING_PERCENT } from "../../../ui/UiScale";

export const StretchedModeConfig = ConfigGroup("stretchedmode", {
    keepAspectRatio: ConfigItem({
        name: "Keep aspect ratio",
        description: "Fixed mode: keeps the gameframe's aspect ratio, leaving bars at the sides or top and bottom.",
        position: 1,
        default: true,
    }),
    integerScaling: ConfigItem({
        name: "Integer scaling",
        description: "Fixed mode: scales the gameframe by whole numbers only, so every game pixel is the same size.",
        position: 2,
        default: false,
    }),
    resizableScaling: ConfigItem({
        name: "Resizable scaling",
        description: "Resizable mode: how much larger the game is drawn, on top of the in-game Interface scaling.",
        position: 3,
        units: "%",
        range: { min: 0, max: 400 },
        default: RUNELITE_DEFAULT_RESIZABLE_SCALING_PERCENT,
    }),
    sceneResolution: ConfigItem({
        name: "Scene resolution",
        description: "Draws the 3D scene at a lower resolution for better performance. Interfaces stay sharp.",
        position: 4,
        units: "%",
        range: { min: 50, max: 100 },
        default: 100,
    }),
});
