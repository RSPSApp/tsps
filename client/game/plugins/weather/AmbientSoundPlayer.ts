// Ported to TypeScript from ScreteMonge/3D-Weather (BSD-2-Clause).
// Upstream plays looping clips through two Crossfading SoundPlayers; this port
// keeps one looping HTMLAudioElement per weather manager with the same fades.
import { SOUND_EFFECT_URLS, type SoundEffect } from "./WeatherConditions";

function clampPercent(percent: number): number {
    return Math.max(0, Math.min(100, percent | 0));
}

export class AmbientSoundPlayer {
    timer = 0;

    private audio?: HTMLAudioElement;
    private fadeTimer?: number;
    private fadeTarget?: number;
    private volumeLevel = 0;
    private track?: SoundEffect;

    isPlaying(): boolean {
        return !!this.audio && !this.audio.paused;
    }

    getCurrentTrack(): SoundEffect | undefined {
        return this.track;
    }

    getCurrentVolume(): number {
        return this.volumeLevel;
    }

    playClip(effect: SoundEffect, volumePercent: number): void {
        if (typeof Audio === "undefined") return;
        const volume = clampPercent(volumePercent);
        const changedTrack = this.track !== effect;
        this.stopFade();
        if (changedTrack) {
            if (!this.audio) {
                this.audio = new Audio();
                this.audio.loop = true;
                this.audio.preload = "auto";
            }
            this.audio.src = SOUND_EFFECT_URLS[effect];
            this.track = effect;
            this.volumeLevel = 0;
        }
        if (!this.audio) return;
        this.audio.volume = volume / 100;
        this.volumeLevel = volume;
        if (this.audio.paused) {
            this.audio.play().catch(() => {});
        }
    }

    /** RuneLite's SoundPlayer.smoothVolumeChange: ramp over `durationMs`. */
    fadeTo(volumePercent: number, durationMs: number): void {
        if (typeof window === "undefined") return;
        const target = clampPercent(volumePercent);
        if (this.fadeTimer !== undefined && this.fadeTarget === target) return;
        this.stopFade();
        if (!this.audio) return;
        const start = this.volumeLevel;
        if (start === target) return;
        this.fadeTarget = target;
        const started = performance.now();
        this.fadeTimer = window.setInterval(() => {
            const progress = Math.min(1, (performance.now() - started) / Math.max(1, durationMs));
            const value = start + (target - start) * progress;
            this.volumeLevel = value;
            if (this.audio) this.audio.volume = value / 100;
            if (progress >= 1) {
                this.stopFade();
                if (target <= 0) this.stopClip();
            }
        }, 50);
    }

    stopClip(): void {
        this.stopFade();
        this.timer = 0;
        if (this.audio) {
            this.audio.pause();
            this.audio.removeAttribute("src");
            this.track = undefined;
        }
        this.volumeLevel = 0;
    }

    tick(): void {
        if (this.isPlaying()) this.timer++;
    }

    private stopFade(): void {
        if (this.fadeTimer !== undefined) {
            window.clearInterval(this.fadeTimer);
            this.fadeTimer = undefined;
        }
        this.fadeTarget = undefined;
    }
}
