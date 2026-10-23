import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const OUTER_LIMIT_MIN = -400;
export const OUTER_LIMIT_MAX = 400;
/** The largest (most zoomed in) value that can be used. */
export const INNER_ZOOM_LIMIT = 1400;
/** The cache's zoom step per wheel notch (script 39). */
export const DEFAULT_ZOOM_INCREMENT = 25;

export const ControlFunction = {
    NONE: "NONE",
    CONTROL_TO_ZOOM: "CONTROL_TO_ZOOM",
    CONTROL_TO_RESET: "CONTROL_TO_RESET",
} as const;
export type ControlFunctionValue = (typeof ControlFunction)[keyof typeof ControlFunction];

export const EaseFrom = {
    BOTH: "BOTH",
    MOUSE: "MOUSE",
    KEYS: "KEYS",
} as const;
export type EaseFromValue = (typeof EaseFrom)[keyof typeof EaseFrom];

// "zoom": the group name of RuneLite's old zoom plugin, which its Camera plugin kept.
export const CameraConfig = ConfigGroup(
    "zoom",
    {
        controlsExpanded: ConfigItem({
            name: "Expand controls guide",
            description: "Show the keyboard and camera directions in the Controls overlay.",
            position: 0,
            default: false,
        }),
        innerLimit: ConfigItem({
            keyName: "inner",
            name: "Expand inner zoom limit",
            description: "Configures whether or not the inner zoom limit is reduced.",
            position: 1,
            default: false,
        }),
        outerLimit: ConfigItem({
            name: "Expand outer zoom limit",
            description: "Configures how much the outer zoom limit is adjusted.",
            position: 2,
            range: { min: OUTER_LIMIT_MIN, max: OUTER_LIMIT_MAX },
            default: 0,
        }),
        controlFunction: ConfigItem<ControlFunctionValue>({
            name: "Control function",
            description: "Configures the zoom function when control is pressed.",
            position: 4,
            enum: {
                None: ControlFunction.NONE,
                "Hold to zoom": ControlFunction.CONTROL_TO_ZOOM,
                "Reset zoom": ControlFunction.CONTROL_TO_RESET,
            },
            default: ControlFunction.NONE,
        }),
        ctrlZoomValue: ConfigItem({
            name: "Reset zoom position",
            description: "Position of zoom when it is reset.",
            position: 5,
            range: { min: OUTER_LIMIT_MIN, max: INNER_ZOOM_LIMIT },
            default: 512,
        }),
        zoomIncrement: ConfigItem({
            name: "Zoom speed",
            description: "Speed of zoom.",
            position: 6,
            default: DEFAULT_ZOOM_INCREMENT,
        }),
        cameraSpeed: ConfigItem({
            name: "Camera speed",
            description: "Speed which the camera moves from input.",
            position: 7,
            step: 0.1,
            default: 1,
        }),
        disableCameraShake: ConfigItem({
            name: "Disable camera shake",
            description: "Disables camera shake.",
            position: 8,
            default: false,
        }),
        invertYaw: ConfigItem({
            name: "Invert yaw",
            description: "Makes moving the camera horizontally with the mouse backwards.",
            position: 12,
            section: "mouseSettings",
            default: false,
        }),
        invertPitch: ConfigItem({
            name: "Invert pitch",
            description: "Makes moving the camera vertically with the mouse backwards.",
            position: 13,
            section: "mouseSettings",
            default: false,
        }),
        easing: ConfigItem({
            name: "Camera easing",
            description: "Eases the camera into and out of turns instead of starting and stopping at once.",
            position: 20,
            section: "easingSettings",
            default: true,
        }),
        easeIn: ConfigItem({
            name: "Ease in",
            description: "How long a turn takes to reach full speed. 0 starts at once.",
            position: 21,
            section: "easingSettings",
            units: "ms",
            range: { min: 0, max: 1000 },
            default: 30,
        }),
        easeOut: ConfigItem({
            name: "Ease out",
            description: "How long the camera takes to slow to a stop after you let go. 0 stops at once.",
            position: 22,
            section: "easingSettings",
            units: "ms",
            range: { min: 0, max: 1000 },
            default: 30,
        }),
        easeFrom: ConfigItem<EaseFromValue>({
            name: "Ease",
            description: "Which input is eased: the middle-mouse drag, the arrow keys, or both.",
            position: 23,
            section: "easingSettings",
            enum: { Both: EaseFrom.BOTH, Mouse: EaseFrom.MOUSE, "Arrow keys": EaseFrom.KEYS },
            default: EaseFrom.BOTH,
        }),
        easePitch: ConfigItem({
            name: "Ease pitch",
            description: "Eases up and down rotation too, not only left and right.",
            position: 24,
            section: "easingSettings",
            default: true,
        }),
    },
    {
        sections: {
            mouseSettings: { name: "Mouse settings", position: 10 },
            easingSettings: { name: "Camera easing", position: 19 },
        },
    },
);
