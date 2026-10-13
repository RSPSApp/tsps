import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** 117 HD's extras. Rendering quality and post effects are WebGPU only. */
export const HdConfig = ConfigGroup("hd", {
    grass: ConfigItem({
        name: "Grass",
        description: "Swaying grass blades on grassy ground near the player (WebGPU)",
        position: 1,
        default: true,
    }),
    surfaceFog: ConfigItem({
        name: "Surface fog",
        description: "Low-lying mist that pools in valleys and drifts with the wind",
        position: 2,
        default: true,
    }),
    hdr: ConfigItem({
        name: "HDR",
        description: "Filmic tone mapping of the HDR scene; off clips highlights instead (WebGPU)",
        position: 3,
        default: true,
    }),
    bloom: ConfigItem({
        name: "Bloom",
        description: "Glow around bright lights and highlights (WebGPU)",
        position: 4,
        default: true,
    }),
    ambientOcclusion: ConfigItem({
        name: "Ambient occlusion",
        description: "Soft shadowing in corners and where objects meet the ground (WebGPU)",
        position: 5,
        default: true,
    }),
    textureFiltering: ConfigItem({
        name: "Texture filtering",
        description: "Mipmaps, 8x anisotropic filtering and higher-detail textures reduce shimmer (WebGPU)",
        position: 7,
        default: true,
    }),
    antiAliasing: ConfigItem({
        name: "Anti-aliasing",
        description: "Smooths jagged scene edges with FXAA while keeping the interface sharp (WebGPU)",
        position: 8,
        default: true,
    }),
    depthAwareAo: ConfigItem({
        name: "Depth-aware AO",
        description: "Keeps ambient occlusion from blurring across object edges; requires ambient occlusion (WebGPU)",
        position: 9,
        default: true,
    }),
    depthOfField: ConfigItem({
        name: "Depth of field",
        description: "Blurs the distance when the camera is zoomed in close (WebGPU)",
        position: 6,
        default: true,
    }),
});

/** The toggles as read each frame. */
export interface HdOptions {
    grass: boolean;
    surfaceFog: boolean;
    hdr: boolean;
    bloom: boolean;
    ambientOcclusion: boolean;
    depthOfField: boolean;
    textureFiltering: boolean;
    antiAliasing: boolean;
    depthAwareAo: boolean;
}
