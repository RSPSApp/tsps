import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const PingGrapherConfig = ConfigGroup("pinggraph", {
    graphTicks: ConfigItem({ name: "Graph Game Ticks", default: false }),
    toggleLineOnly: ConfigItem({ name: "Hide Labels", default: false }),
    hideGraph: ConfigItem({ name: "Hide Graph", default: false }),
    toggleRange: ConfigItem({ keyName: "toggleMaxMin", name: "Scale Between Max and Min", default: false }),
    enablePingSpikes: ConfigItem({ name: "Graph Ping Time Outs", default: false }),
    noResponseLimit: ConfigItem({ name: "Time Out Limit", default: 3, range: { min: 1, max: 100 } }),
    noResponseMsg: ConfigItem({ name: "Timed Out Label", default: "-" }),
    warnPingVal: ConfigItem({ name: "Ping Threshold (ms)", default: 100, range: { min: 1, max: 10000 } }),
    warnTickVal: ConfigItem({ name: "Tick Threshold (ms)", default: 800, range: { min: 1, max: 10000 } }),
    warnMaxToggle: ConfigItem({ name: "Persisting Warning", default: false }),
    warningHideOverlay: ConfigItem({ keyName: "warningOverlayToggle", name: "Hide Overlay Unless Warning", default: false }),
    width: ConfigItem({ name: "Width", default: 200, range: { min: 120, max: 600 } }),
    height: ConfigItem({ name: "Height", default: 100, range: { min: 50, max: 300 } }),
});
