import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const IsometricConfig = ConfigGroup("isometriccamera", {
    pitch: ConfigItem({
        name: "Angle",
        description: "How steeply the camera looks down, in degrees. True isometric is 35; action RPGs sit nearer 50. Roofs between the camera and you hide below 54.",
        position: 0,
        units: "°",
        range: { min: 25, max: 80 },
        default: 35,
    }),
    rotateKeys: ConfigItem({
        name: "Quarter turns",
        description:
            "Left and right arrows, a sideways drag (middle mouse, or one finger on a touch screen) and a controller's bumpers or right stick turn the view 90°. Off locks the camera to one angle.",
        position: 1,
        default: true,
    }),
});
