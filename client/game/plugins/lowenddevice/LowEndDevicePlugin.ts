import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { isMobileMode } from "../../../common/utils/DeviceUtil";
import type { GpuSettings } from "../gpu/GpuPlugin";
import { setLowEndDeviceModeEnabled } from "./LowEndDeviceMode";

export class LowEndDevicePlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Low-end Device",
        description: "Reduce view distance and scenery detail, disable HD and anti-aliasing, and cap at 30 FPS. WebGL also renders the scene at half resolution.",
        tags: ["graphics", "performance", "mobile", "low detail"],
        enabledByDefault: isMobileMode,
        configKey: "lowenddeviceplugin",
    };

    private readonly settings: GpuSettings = {
        msaaSamples: 0,
        fxaa: false,
        drawDistance: 12,
        fpsLimit: 30,
        colorBanding: 255,
        autoFogDepth: true,
        autoFogDepthFactor: 0.7,
        fogDepth: 0,
    };

    override setEnabledState(enabled: boolean): void {
        super.setEnabledState(enabled);
        setLowEndDeviceModeEnabled(enabled);
    }

    gpuSettings(): GpuSettings | undefined {
        return this.isEnabled() ? this.settings : undefined;
    }

    sceneResolutionScale(): number {
        return this.isEnabled() ? 0.5 : 1;
    }
}
