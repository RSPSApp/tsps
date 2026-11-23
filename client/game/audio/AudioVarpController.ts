import {
    VARP_AREA_SOUNDS_VOLUME,
    VARP_MASTER_VOLUME,
    VARP_MUSIC_VOLUME,
    VARP_SOUND_EFFECTS_VOLUME,
} from "../../common/vars";
import { getOsrsInterfaceScalingPercent, setOsrsInterfaceScalingPercent } from "../../ui/UiScale";
import type { GameRenderer } from "../GameRenderer";
import type { MusicSystem } from "../audio/MusicSystem";
import type { SoundEffectSystem } from "../audio/SoundEffectSystem";
import { clamp } from "../../common/utils/MathUtil";

export type AudioVarpControllerDeps = {
    getMusicSystem: () => MusicSystem | undefined;
    getSoundEffectSystem: () => SoundEffectSystem | undefined;
    getRenderer: () => GameRenderer | undefined;
    getMasterVolume: () => number;
    setMasterVolume: (value: number) => void;
    getMusicVolume: () => number;
    setMusicVolume: (value: number) => void;
    getSfxVolume: () => number;
    setSfxVolume: (value: number) => void;
    getAmbientVolume: () => number;
    setAmbientVolume: (value: number) => void;
};

/**
 * Applies audio varp/device-option changes and UI scaling refresh.
 */
export class AudioVarpController {
    private refreshingUiScaling = false;

    constructor(private readonly deps: AudioVarpControllerDeps) {}

    applyMasterVolume(): void {
        const master = this.deps.getMasterVolume();
        const musicSystem = this.deps.getMusicSystem();
        const soundEffectSystem = this.deps.getSoundEffectSystem();
        if (musicSystem) {
            musicSystem.setVolume(this.deps.getMusicVolume() * master);
        }
        if (soundEffectSystem) {
            soundEffectSystem.setVolume(this.deps.getSfxVolume() * master);
            soundEffectSystem.setAmbientVolume(this.deps.getAmbientVolume() * master);
        }
    }

    refreshUiScalingLayout(): void {
        // A cache Settings script runs this inside its own CS2 execution. Resizing the
        // renderer there can run resize scripts that set the option again; never re-enter.
        if (this.refreshingUiScaling) return;
        this.refreshingUiScaling = true;
        try {
            const renderer = this.deps.getRenderer();
            const canvas = renderer?.canvas;
            if (!renderer || !canvas) return;
            const width = canvas.width | 0;
            const height = canvas.height | 0;
            if (width <= 0 || height <= 0) return;
            renderer.onResize(width, height);
        } catch (error) {
            console.log("[OsrsClient] Failed to refresh UI scaling layout", { error });
        } finally {
            this.refreshingUiScaling = false;
        }
    }

    applyInterfaceScalingPercentDeviceOption(value: number, mobile = false): void {
        const previous = getOsrsInterfaceScalingPercent(mobile);
        setOsrsInterfaceScalingPercent(value | 0, mobile);
        // Settings lists re-apply their selected entry on layout passes. Only a real
        // change needs a renderer resize; repeating it churns WidgetManager layout and
        // GPU framebuffers for nothing.
        if (getOsrsInterfaceScalingPercent(mobile) !== previous) {
            this.refreshUiScalingLayout();
        }
    }

    applyAudioVarpChange(varpId: number, value: number): void {
        const percent = clamp(value | 0, 0, 100);
        const curved = Math.round((percent * percent) / 100);

        if (varpId === VARP_MUSIC_VOLUME) {
            const scaled = Math.round((curved * 255) / 100);
            this.deps.setMusicVolume(Math.max(0, Math.min(1, scaled / 255)));
            const musicSystem = this.deps.getMusicSystem();
            if (musicSystem) {
                musicSystem.setVolume(this.deps.getMusicVolume() * this.deps.getMasterVolume());
            }
            return;
        }

        if (varpId === VARP_SOUND_EFFECTS_VOLUME) {
            const scaled = Math.round((curved * 127) / 100);
            this.deps.setSfxVolume(Math.max(0, Math.min(1, scaled / 127)));
            const soundEffectSystem = this.deps.getSoundEffectSystem();
            if (soundEffectSystem) {
                soundEffectSystem.setVolume(this.deps.getSfxVolume() * this.deps.getMasterVolume());
            }
            return;
        }

        if (varpId === VARP_AREA_SOUNDS_VOLUME) {
            const scaled = Math.round((curved * 127) / 100);
            this.deps.setAmbientVolume(Math.max(0, Math.min(1, scaled / 127)));
            const soundEffectSystem = this.deps.getSoundEffectSystem();
            if (soundEffectSystem) {
                soundEffectSystem.setAmbientVolume(
                    this.deps.getAmbientVolume() * this.deps.getMasterVolume(),
                );
            }
            return;
        }

        if (varpId === VARP_MASTER_VOLUME) {
            this.deps.setMasterVolume(Math.max(0, Math.min(1, curved / 100)));
            this.applyMasterVolume();
        }
    }
}
