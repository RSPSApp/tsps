import { SoundEffectLoader } from "../../rs/audio/SoundEffectLoader";
import type { RawSoundData } from "../../rs/audio/legacy/SoundEffect";
import type { SeqSoundEffect } from "../../rs/config/seqtype/SeqType";
import {
    addAudioContextResumeListeners,
    getAudioContextConstructor,
    registerManagedAudioContext,
    resumeAudioContextIfNeeded,
    unregisterManagedAudioContext,
} from "./audioContext";
import { resampleToSampleRate, smoothLowPass } from "./resample";

type DecodedSound = {
    sampleRate: number;
    channelData: Float32Array;
    duration: number;
    /** Loop start in seconds (from RawSound.start). 0 if no loop markers. */
    loopStartSec: number;
    /** Loop end in seconds (from RawSound.end). 0 if no loop markers. */
    loopEndSec: number;
    /** Synth onset trimmed at decode, in seconds; re-added when one-shots are scheduled. */
    onsetSec: number;
};

type PendingSoundRetry = {
    options: PlaySoundOptions;
    queuedAtMs: number;
};

const enum EasingCurveId {
    LINEAR = 0,
    EASE_IN_SINE = 1,
    EASE_OUT_SINE = 2,
    EASE_IN_OUT_SINE = 3,
    EASE_IN_QUAD = 4,
    EASE_OUT_QUAD = 5,
    EASE_IN_OUT_QUAD = 6,
    EASE_IN_CUBIC = 7,
    EASE_OUT_CUBIC = 8,
    EASE_IN_OUT_CUBIC = 9,
    EASE_IN_QUART = 10,
    EASE_OUT_QUART = 11,
    EASE_IN_OUT_QUART = 12,
    EASE_IN_QUINT = 13,
    EASE_OUT_QUINT = 14,
    EASE_IN_OUT_QUINT = 15,
    EASE_IN_EXPO = 16,
    EASE_OUT_EXPO = 17,
    EASE_IN_OUT_EXPO = 18,
    EASE_IN_CIRC = 19,
    EASE_OUT_CIRC = 20,
    EASE_IN_OUT_CIRC = 21,
    EASE_IN_BACK = 22,
    EASE_OUT_BACK = 23,
    EASE_IN_OUT_BACK = 24,
    EASE_IN_ELASTIC = 25,
    EASE_OUT_ELASTIC = 26,
    EASE_IN_OUT_ELASTIC = 27,
}

export interface PlaySoundOptions {
    loops?: number;
    delayMs?: number;
    position?: { x: number; y: number; z?: number };
    /** Silence distance in scene units (128 per tile). */
    radius?: number;
    distanceFadeCurve?: number;
    isLocalPlayer?: boolean;
    /** Full volume up to (attenuation & 31) - 1 tiles, then fades linearly to radius. */
    attenuation?: number;
}

export interface SequenceSoundContext {
    position?: { x: number; y: number; z?: number };
    isLocalPlayer?: boolean;
    distanceFadeCurve?: number;
    // Debug-only metadata for one-line logging
    debugSeqId?: number;
    debugFrame?: number;
}

export interface AmbientSoundInstance {
    locId: number;
    soundId: number;
    x: number;
    y: number;
    z: number;
    maxDistance: number;
    minDistance: number;
    sizeX: number;
    sizeY: number;
    orientation: number;
    changeTicksMin: number;
    changeTicksMax: number;
    soundIds?: number[];
    fadeInDurationMs?: number;
    fadeOutDurationMs?: number;
    fadeInCurve?: number;
    fadeOutCurve?: number;
    distanceFadeCurve?: number;
    distanceOverride?: number;
    loopSequentially?: boolean;
    deferSwap?: boolean;
    exactPosition?: boolean;
    resetOnLoop?: boolean;
}

type ActiveAmbientSound = {
    instance: AmbientSoundInstance;
    gainNode: GainNode;
    /** Identity of the resolved sound set this emitter is currently tuned to. */
    soundKey: string;
    loopSource?: AudioBufferSourceNode;
    loopSoundId?: number;
    overlaySource?: AudioBufferSourceNode;
    /** Absolute ctx time when the next overlay may trigger; Infinity while one plays or none pending. */
    nextChangeTime: number;
    /** Delay (seconds) applied after the current overlay finishes playing. */
    pendingOverlayDelaySec?: number;
    currentSoundIndex: number;
    stopAt?: number;
    fadeOutActive?: boolean;
    /** Fading to silence before switching to a different resolved sound set. */
    swapPending?: boolean;
    fadeInDurationSec: number;
    fadeOutDurationSec: number;
};

// Game cycle = 20ms (client runs at ~50fps). soundEffectMinDelay/MaxDelay are in game cycles.
const CYCLE_LENGTH_SECONDS = 0.02;

export type PendingSoundEffect = { soundId: number; options: PlaySoundOptions; consumed: boolean };
export class SoundEffectSystem {
    readonly beforePlayListeners = new Set<(sound: PendingSoundEffect) => void>();
    readonly volumeChangedListeners = new Set<(type: "effects" | "area") => void>();

    private readonly decodedCache = new Map<string, DecodedSound>();
    private readonly loader: SoundEffectLoader;
    private context: AudioContext | undefined;
    private gainNode: GainNode | undefined;
    private ambientGainNode: GainNode | undefined;
    private masterVolume = 1.0;
    private ambientVolume = 1.0; // Separate volume for area/ambient sounds
    private readonly activeSources: AudioBufferSourceNode[] = [];
    private readonly maxSimultaneous = 32;
    private readonly ambientSounds = new Map<string, ActiveAmbientSound>();
    private listenerX = 0;
    private listenerY = 0;
    private listenerZ = 0;
    private lastAmbientUpdateTime = -1;
    private readonly warnedSounds = new Set<number>();
    private readonly pendingRetries = new Map<number, PendingSoundRetry[]>();
    private disposed = false;
    // Memory leak fix: track context resume listener cleanup
    private contextResumeCleanup: (() => void) | null = null;
    private readonly MAX_CACHE_SIZE = 100;

    constructor(loader: SoundEffectLoader) {
        this.loader = loader;
    }

    updateListenerPosition(x: number, y: number, z: number): void {
        this.listenerX = x;
        this.listenerY = y;
        this.listenerZ = z;
    }

    setVolume(volume: number): void {
        const previous = this.masterVolume;
        this.masterVolume = Math.max(0, Math.min(1, volume));
        if (previous !== this.masterVolume) for (const listener of this.volumeChangedListeners) listener("effects");
        if (this.gainNode) {
            this.gainNode.gain.value = this.masterVolume;
        }
    }

    /**
     * Set the volume multiplier for ambient/area sounds.
     * This is separate from the master sound effect volume.
     * @param volume Volume level from 0.0 to 1.0
     */
    setAmbientVolume(volume: number): void {
        const previous = this.ambientVolume;
        this.ambientVolume = Math.max(0, Math.min(1, volume));
        if (previous !== this.ambientVolume) for (const listener of this.volumeChangedListeners) listener("area");
        if (this.ambientGainNode) {
            this.ambientGainNode.gain.value = this.ambientVolume;
        }
    }

    private ensureContext(): AudioContext | undefined {
        if (typeof window === "undefined") return undefined;
        if (this.context) {
            // Resume suspended/interrupted context on subsequent calls (after user gesture)
            resumeAudioContextIfNeeded(this.context);
            return this.context;
        }
        const AudioCtx = getAudioContextConstructor();
        if (!AudioCtx) return undefined;
        const ctx = new AudioCtx();
        // Master gain node for regular sound effects
        const gain = ctx.createGain();
        gain.gain.value = this.masterVolume;
        gain.connect(ctx.destination);
        this.context = ctx;
        this.gainNode = gain;
        // Suspend/resume this context with page visibility so sound effects don't keep
        // playing after the tab is hidden or closed (notably on iOS WebKit).
        registerManagedAudioContext(ctx);
        // Separate gain node for ambient/area sounds
        const ambientGain = ctx.createGain();
        ambientGain.gain.value = this.ambientVolume;
        ambientGain.connect(ctx.destination);
        this.ambientGainNode = ambientGain;

        // Auto-resume on user interaction (required by browser autoplay policy).
        // Listeners stay armed for the lifetime of the context because iOS re-locks
        // audio after app switches; they are removed in dispose().
        if (!this.contextResumeCleanup) {
            this.contextResumeCleanup = addAudioContextResumeListeners(ctx);
        }

        return ctx;
    }

    private removeContextListeners(): void {
        if (this.contextResumeCleanup) {
            const cleanup = this.contextResumeCleanup;
            this.contextResumeCleanup = null;
            cleanup();
        }
    }

    private cacheKey(soundId: number, sampleRate: number, trimOnset: boolean): string {
        return `${soundId}@${sampleRate}@${trimOnset ? "trimmed" : "full"}`;
    }

    private decode(
        soundId: number,
        targetSampleRate?: number,
        forceResample = false,
        loadedRaw?: RawSoundData,
        trimOnset = true,
    ): DecodedSound | undefined {
        const ctx = this.context;
        const effectiveRate =
            forceResample && ctx
                ? ctx.sampleRate
                : typeof targetSampleRate === "number"
                  ? targetSampleRate
                  : 0;
        const cacheKey = this.cacheKey(soundId, effectiveRate, trimOnset);
        const cached = this.decodedCache.get(cacheKey);
        if (cached) return cached;

        const t0 = performance.now();
        const raw = loadedRaw ?? this.loader.load(soundId, trimOnset);
        if (!raw) return undefined;
        const t1 = performance.now();

        const decoded = this.toFloatData(raw, effectiveRate);
        const t2 = performance.now();

        // Only log issues once per sound ID to avoid spam
        if (decoded.channelData.length === 0) {
            if (!this.warnedSounds.has(soundId)) {
                this.warnedSounds.add(soundId);
                console.warn(`[SoundEffectSystem] Sound ${soundId} produced empty output`);
            }
        }

        this.decodedCache.set(cacheKey, decoded);

        // Memory leak fix: evict oldest entries if cache too large
        if (this.decodedCache.size > this.MAX_CACHE_SIZE) {
            const keysToDelete = Array.from(this.decodedCache.keys()).slice(
                0,
                this.decodedCache.size - this.MAX_CACHE_SIZE,
            );
            for (const key of keysToDelete) {
                this.decodedCache.delete(key);
            }
        }

        return decoded;
    }

    private retryMissingSound(soundId: number, options: PlaySoundOptions): void {
        const queuedCount = [...this.pendingRetries.values()].reduce(
            (count, requests) => count + requests.length,
            0,
        );
        if (queuedCount >= 50) return;

        const request = { options, queuedAtMs: performance.now() };
        const pending = this.pendingRetries.get(soundId);
        if (pending) {
            pending.push(request);
            return;
        }
        this.pendingRetries.set(soundId, [request]);
        this.loader
            .loadWithRetry(soundId)
            .then((raw) => {
                const requests = this.pendingRetries.get(soundId);
                this.pendingRetries.delete(soundId);
                if (raw && requests && !this.disposed) {
                    const now = performance.now();
                    for (const queued of requests) {
                        this.playSoundEffectInternal(
                            soundId,
                            queued.options,
                            Math.max(0, now - queued.queuedAtMs),
                            raw,
                        );
                    }
                }
            })
            .catch(() => this.pendingRetries.delete(soundId));
    }

    private toFloatData(raw: RawSoundData, targetSampleRate: number): DecodedSound {
        const total = raw.samples.length | 0;

        const onsetSec = (raw.delayCycles ?? 0) * CYCLE_LENGTH_SECONDS;

        if (total <= 0) {
            return {
                sampleRate: raw.sampleRate || targetSampleRate || 22050,
                channelData: new Float32Array(0),
                duration: 0,
                loopStartSec: 0,
                loopEndSec: 0,
                onsetSec,
            };
        }

        // Keep the full buffer — loop boundaries are applied at playback, not decode.
        let channel: Float32Array = new Float32Array(total);
        for (let i = 0; i < total; i++) {
            channel[i] = raw.samples[i] / 128.0;
        }

        // Compute loop boundaries in source samples
        const srcLoopStart = Math.max(0, Math.min(total, Math.floor(raw.start)));
        const srcLoopEnd = raw.end > 0 ? Math.max(0, Math.min(total, Math.floor(raw.end))) : 0;

        let output: Float32Array = channel;
        let outputRate = raw.sampleRate;

        if (targetSampleRate > 0 && targetSampleRate !== raw.sampleRate) {
            if (targetSampleRate > raw.sampleRate) {
                const nyquist = raw.sampleRate / 2;
                smoothLowPass(channel, raw.sampleRate, nyquist * 0.9);
            }

            output = resampleToSampleRate(channel, raw.sampleRate, targetSampleRate);
            outputRate = targetSampleRate;
            smoothLowPass(output, outputRate);
        } else {
            smoothLowPass(output, outputRate);
        }

        // Convert loop boundaries from source-sample indices to seconds
        const loopStartSec = srcLoopStart > 0 ? srcLoopStart / raw.sampleRate : 0;
        const loopEndSec = srcLoopEnd > srcLoopStart ? srcLoopEnd / raw.sampleRate : 0;

        return {
            sampleRate: outputRate,
            channelData: output,
            duration: output.length / outputRate,
            loopStartSec,
            loopEndSec,
            onsetSec,
        };
    }

    private prepareBuffer(
        sound: DecodedSound,
        ctx: AudioContext,
        applyLoopCrossfade = false,
    ): AudioBuffer {
        const length = sound.channelData.length;
        const buffer = ctx.createBuffer(1, length, sound.sampleRate);
        const data = new Float32Array(sound.channelData); // Clone to avoid modifying cache
        buffer.copyToChannel(data, 0);
        return buffer;
    }

    private registerSource(source: AudioBufferSourceNode, extraNodes: AudioNode[] = []): void {
        this.activeSources.push(source);
        source.addEventListener("ended", () => {
            const idx = this.activeSources.indexOf(source);
            if (idx >= 0) this.activeSources.splice(idx, 1);
            this.disconnectNodes(extraNodes);
        });
        if (this.activeSources.length > this.maxSimultaneous) {
            const oldest = this.activeSources.shift();
            try {
                oldest?.stop();
            } catch {}
        }
    }

    private disconnectNodes(nodes: AudioNode[] = []) {
        for (const node of nodes) {
            try {
                node.disconnect();
            } catch {}
        }
    }

    playSoundEffect(soundId: number, options: PlaySoundOptions = {}): void {
        if (this.disposed) return;
        const pending = { soundId, options: { ...options }, consumed: false };
        for (const listener of this.beforePlayListeners) listener(pending);
        if (!pending.consumed) this.playSoundEffectInternal(pending.soundId, pending.options, 0);
    }

    private playSoundEffectInternal(
        soundId: number,
        options: PlaySoundOptions,
        elapsedMs: number,
        loadedRaw?: RawSoundData,
    ): void {
        if (this.disposed) return;
        const ctx = this.ensureContext();
        if (!ctx || !this.loader.available()) return;

        resumeAudioContextIfNeeded(ctx);

        const decoded = this.decode(soundId, undefined, false, loadedRaw);
        if (!decoded) {
            // Cache group may still be streaming in (sparse cache); retry once
            // it lands instead of silently dropping the sound.
            this.retryMissingSound(soundId, options);
            return;
        }
        const delayMs = SoundEffectSystem.remainingDelayMs(options, decoded.onsetSec, elapsedMs);
        if (!decoded.channelData || decoded.channelData.length === 0 || decoded.sampleRate <= 0) {
            // As a last-resort safety net, synthesize a tiny click to avoid errors and keep timing consistent
            const contextSampleRate =
                this.context && typeof this.context.sampleRate === "number"
                    ? this.context.sampleRate
                    : 22050;
            const sr = Math.max(22050, contextSampleRate);
            const tmp: DecodedSound = {
                sampleRate: sr,
                channelData: new Float32Array(Math.max(64, Math.floor(sr * 0.02))).fill(0),
                duration: 0.02,
                loopStartSec: 0,
                loopEndSec: 0,
                onsetSec: 0,
            };
            // tiny DC-pop-safe blip
            for (let i = 0; i < tmp.channelData.length; i++)
                tmp.channelData[i] = Math.sin((i / tmp.channelData.length) * Math.PI) * 0.001;
            const buffer = this.prepareBuffer(tmp, ctx);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            if (!this.gainNode) {
                this.gainNode = ctx.createGain();
                this.gainNode.gain.value = this.masterVolume;
                this.gainNode.connect(ctx.destination);
            }
            source.connect(this.gainNode);
            source.start(ctx.currentTime + delayMs / 1000);
            this.registerSource(source);
            return;
        }

        const radius = options.radius;
        const position = options.position;
        if (radius !== undefined && radius > 0) {
            if (!position) {
                return;
            }
            // Positional sound: distance and volume are evaluated when the
            // delay expires, from the listener's position at that moment.
            const startPositional = () => {
                const gain = this.computePositionalGain(
                    position,
                    radius,
                    options.attenuation,
                    options.distanceFadeCurve,
                );
                if (gain === undefined) return;
                this.startOneShot(decoded, ctx, gain, 0, options.loops, true);
            };
            if (delayMs > 0) {
                setTimeout(startPositional, delayMs);
            } else {
                startPositional();
            }
            return;
        }

        if (radius !== undefined && radius <= 0 && !options.isLocalPlayer) {
            return;
        }

        this.startOneShot(decoded, ctx, 1, delayMs, options.loops, false);
    }

    private static remainingDelayMs(
        options: PlaySoundOptions,
        onsetSec: number,
        elapsedMs: number,
    ): number {
        return Math.max(0, (options.delayMs ?? 0) + onsetSec * 1000 - elapsedMs);
    }

    private static expandFiniteLoop(
        samples: Float32Array,
        loopStart: number,
        loopEnd: number,
        repeats: number,
    ): Float32Array {
        if (loopStart < 0 || loopEnd <= loopStart || loopEnd > samples.length) return samples;

        const loopLength = loopEnd - loopStart;
        const expanded = new Float32Array(samples.length + loopLength * repeats);
        expanded.set(samples.subarray(0, loopEnd));
        let offset = loopEnd;
        for (let i = 0; i < repeats; i++) {
            expanded.set(samples.subarray(loopStart, loopEnd), offset);
            offset += loopLength;
        }
        expanded.set(samples.subarray(loopEnd), offset);
        return expanded;
    }

    /**
     * Compute distance falloff for a positional one-shot sound, or undefined
     * if the listener is out of range and the sound should not play.
     */
    private computePositionalGain(
        position: { x: number; y: number; z?: number },
        radius: number,
        attenuation?: number,
        distanceFadeCurve?: number,
    ): number | undefined {
        const dx = Math.abs(position.x - this.listenerX);
        const dy = Math.abs(position.y - this.listenerY);
        // Manhattan distance between tile centers, minus one tile (128 fine units)
        const dist = Math.max(0, dx + dy - 128);
        if (dist >= radius) {
            return undefined;
        }
        // Full volume out to (attenuation & 31) - 1 tiles, then fade to silence at radius
        const attenFine = Math.max(((((attenuation ?? 0) | 0) & 31) - 1) * 128, 0);
        if (attenFine >= radius) {
            return 1;
        }
        const progress = Math.max(0, Math.min(1, (radius - dist) / (radius - attenFine)));
        return SoundEffectSystem.ease(progress, distanceFadeCurve ?? EasingCurveId.LINEAR);
    }

    private ensureSfxBus(ctx: AudioContext): GainNode {
        if (!this.gainNode) {
            this.gainNode = ctx.createGain();
            this.gainNode.gain.value = this.masterVolume;
            this.gainNode.connect(ctx.destination);
        }
        return this.gainNode;
    }

    private ensureAmbientBus(ctx: AudioContext): GainNode {
        if (!this.ambientGainNode) {
            this.ambientGainNode = ctx.createGain();
            this.ambientGainNode.gain.value = this.ambientVolume;
            this.ambientGainNode.connect(ctx.destination);
        }
        return this.ambientGainNode;
    }

    private startOneShot(
        decoded: DecodedSound,
        ctx: AudioContext,
        gainValue: number,
        delayMs: number,
        loops: number | undefined,
        useAmbientBus: boolean,
    ): void {
        const buffer = this.prepareBuffer(decoded, ctx);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        // Positional sounds follow the area-sounds volume; the rest follow sound effects
        const bus = useAmbientBus ? this.ensureAmbientBus(ctx) : this.ensureSfxBus(ctx);

        let gainNode: GainNode | undefined;
        if (gainValue < 1) {
            gainNode = ctx.createGain();
            gainNode.gain.value = gainValue;
            gainNode.connect(bus);
            source.connect(gainNode);
        } else {
            source.connect(bus);
        }

        const startTime = ctx.currentTime + (delayMs > 0 ? delayMs / 1000 : 0);

        // Reference semantics: numLoops < 0 = infinite, 0 = play once, n > 0 = loop n additional times
        const requestedLoops = typeof loops === "number" ? loops : 0;

        if (requestedLoops < 0 && decoded.loopEndSec > decoded.loopStartSec) {
            // Infinite loop (matches RawPcmStream.setNumLoopsInternal(-1))
            source.loop = true;
            source.loopStart = decoded.loopStartSec;
            source.loopEnd = decoded.loopEndSec;
            source.start(startTime);
        } else if (requestedLoops <= 0) {
            // Play once (matches RawPcmStream.setNumLoopsInternal(0))
            source.start(startTime);
        } else {
            // Repeat only the cache-defined loop segment, then play the remaining tail.
            const expanded = SoundEffectSystem.expandFiniteLoop(
                decoded.channelData,
                Math.round(decoded.loopStartSec * decoded.sampleRate),
                Math.round(decoded.loopEndSec * decoded.sampleRate),
                requestedLoops,
            );
            if (expanded !== decoded.channelData) {
                const expandedBuffer = ctx.createBuffer(1, expanded.length, decoded.sampleRate);
                expandedBuffer.getChannelData(0).set(expanded);
                source.buffer = expandedBuffer;
            }
            source.start(startTime);
        }

        this.registerSource(source, gainNode ? [gainNode] : []);
    }

    handleSeqFrameSounds(effects: SeqSoundEffect[], context?: SequenceSoundContext): void {
        let effect: SeqSoundEffect | undefined = effects[0];
        if (effects.length > 1) {
            const roll = 1 + Math.floor(Math.random() * 100);
            let weightCursor = 0;
            effect = undefined;
            for (const candidate of effects) {
                const rangeStart = weightCursor;
                weightCursor += candidate.weight ?? 1;
                if (rangeStart <= roll && roll < weightCursor) {
                    effect = candidate;
                    break;
                }
            }
        }
        if (!effect) return;

        const radiusTiles = typeof effect.location === "number" ? effect.location : 0;
        if (radiusTiles === 0 && !context?.isLocalPlayer) return;

        // animation frame sound loops field uses 1-indexed semantics.
        const loops = (typeof effect.loops === "number" ? effect.loops : 1) - 1;
        this.playSoundEffect(effect.id, {
            loops,
            position: context?.position,
            radius: radiusTiles > 0 ? radiusTiles * 128 : undefined,
            distanceFadeCurve: context?.distanceFadeCurve,
            isLocalPlayer: context?.isLocalPlayer,
            attenuation: effect.attenuation,
        });
    }

    updateAmbientSounds(instances: AmbientSoundInstance[]): void {
        const ctx = this.ensureContext();
        if (!ctx || !this.loader.available()) return;

        resumeAudioContextIfNeeded(ctx);

        const now = ctx.currentTime;
        const dt =
            this.lastAmbientUpdateTime >= 0
                ? Math.min(Math.max(now - this.lastAmbientUpdateTime, 0), 1)
                : 0;
        this.lastAmbientUpdateTime = now;
        const activeKeys = new Set<string>();

        for (const instance of instances) {
            const key = this.ambientKey(instance);
            activeKeys.add(key);

            let active = this.ambientSounds.get(key);
            if (!active) {
                active = this.startAmbientSound(key, instance, ctx);
            }

            active.instance = instance;
            active.fadeInDurationSec = Math.max(
                0,
                (typeof instance.fadeInDurationMs === "number" ? instance.fadeInDurationMs : 300) /
                    1000,
            );
            active.fadeOutDurationSec = Math.max(
                0,
                (typeof instance.fadeOutDurationMs === "number"
                    ? instance.fadeOutDurationMs
                    : 300) / 1000,
            );
            active.fadeOutActive = false;
            active.stopAt = undefined;

            // A different resolved sound set (e.g. transformed loc): fade to
            // silence with the fade-out curve, then retune.
            const soundKey = SoundEffectSystem.soundKeyOf(instance);
            if (soundKey !== active.soundKey) {
                active.swapPending = true;
            }
            if (active.swapPending) {
                this.adjustAmbientGain(active, 0, ctx, now);
                if (active.gainNode.gain.value <= 0.001) {
                    this.stopActiveSources(active);
                    active.soundKey = soundKey;
                    active.currentSoundIndex = -1;
                    active.nextChangeTime = Infinity;
                    active.pendingOverlayDelaySec = undefined;
                    active.swapPending = false;
                }
                continue;
            }

            const planeMatch = instance.z === this.listenerZ;
            if (!planeMatch) {
                // Quick 150ms linear fade on plane mismatch; sources keep
                // running silently and the overlay countdown is frozen.
                this.adjustAmbientGain(active, 0, ctx, now, 0.15, EasingCurveId.LINEAR);
                if (active.nextChangeTime !== Infinity) {
                    active.nextChangeTime += dt;
                }
                continue;
            }

            const volume = this.computeAmbientVolume(instance);
            this.adjustAmbientGain(active, volume, ctx, now);

            // The loop stream starts once the sound first becomes audible and
            // then persists (running silently when out of range).
            const desiredLoopId = instance.soundId >= 0 ? instance.soundId : undefined;
            if (
                !active.loopSource &&
                desiredLoopId !== undefined &&
                active.loopSoundId !== desiredLoopId &&
                volume > 0
            ) {
                this.startLoopSource(active, desiredLoopId, ctx, now);
            }

            const hasAlternates =
                instance.soundIds !== undefined &&
                instance.soundIds.length > 0 &&
                instance.soundIds.some((id) => id !== undefined && id >= 0);

            if (!hasAlternates) {
                active.nextChangeTime = Infinity;
                if (active.overlaySource) {
                    try {
                        active.overlaySource.stop();
                    } catch {}
                    try {
                        active.overlaySource.disconnect();
                    } catch {}
                    active.overlaySource = undefined;
                }
            } else if (!active.overlaySource) {
                if (active.nextChangeTime === Infinity) {
                    active.nextChangeTime = now + this.computeOverlayDelaySec(instance);
                }
                // The countdown keeps running while inaudible, but the overlay
                // only triggers once the sound is audible.
                if (now >= active.nextChangeTime && volume > 0) {
                    this.playOverlaySound(key, active, instance, ctx, now);
                }
            }
        }

        // Fade out sounds whose emitters no longer exist (map unload, loc removed)
        for (const [key, active] of this.ambientSounds.entries()) {
            if (!activeKeys.has(key)) {
                this.beginAmbientFadeOut(key, active, ctx, now);
            }
            if (active.fadeOutActive && active.stopAt !== undefined && now >= active.stopAt) {
                this.stopAmbientSound(key, ctx);
            }
        }
    }

    private static soundKeyOf(instance: AmbientSoundInstance): string {
        return `${instance.soundId}|${instance.soundIds ? instance.soundIds.join(",") : ""}`;
    }

    private stopActiveSources(active: ActiveAmbientSound): void {
        try {
            active.loopSource?.stop();
        } catch {}
        try {
            active.loopSource?.disconnect();
        } catch {}
        try {
            active.overlaySource?.stop();
        } catch {}
        try {
            active.overlaySource?.disconnect();
        } catch {}
        active.loopSource = undefined;
        active.loopSoundId = undefined;
        active.overlaySource = undefined;
    }

    private startLoopSource(
        active: ActiveAmbientSound,
        soundId: number,
        ctx: AudioContext,
        now: number,
    ): void {
        const decoded = this.decode(soundId, undefined, true, undefined, false);
        if (!decoded) {
            return;
        }
        const loopBuffer = this.prepareBuffer(decoded, ctx, true);
        const loopSource = ctx.createBufferSource();
        loopSource.buffer = loopBuffer;
        loopSource.loop = true;
        loopSource.loopStart = decoded.loopStartSec;
        loopSource.loopEnd =
            decoded.loopEndSec > decoded.loopStartSec ? decoded.loopEndSec : loopBuffer.duration;
        loopSource.connect(active.gainNode);
        this.registerSource(loopSource);
        loopSource.start(now);
        active.loopSource = loopSource;
        active.loopSoundId = soundId;
    }

    private ambientKey(instance: AmbientSoundInstance): string {
        const quant = (value: number | undefined): number => {
            if (value === undefined || Number.isNaN(value)) return 0;
            return Math.round(value);
        };
        return `${instance.locId}_${quant(instance.x)}_${quant(instance.y)}_${quant(instance.z)}`;
    }

    private computeOverlayDelaySec(instance: AmbientSoundInstance): number {
        if (instance.deferSwap) {
            return Infinity;
        }

        const minDelay = Math.max(
            typeof instance.changeTicksMin === "number" ? instance.changeTicksMin : 0,
            0,
        );
        const maxDelay = Math.max(
            typeof instance.changeTicksMax === "number" ? instance.changeTicksMax : 0,
            minDelay,
        );

        if (minDelay === 0 && maxDelay === 0) {
            return Infinity;
        }

        // soundEffectMinDelay/MaxDelay are in game cycles (20ms each)
        const range = maxDelay - minDelay;
        const cycles = minDelay + (range > 0 ? Math.random() * range : 0);
        return cycles * CYCLE_LENGTH_SECONDS;
    }

    /**
     * Compute the easing value for a given progress (0..1) using EasingFunction curve types.
     */
    private static ease(progress: number, curveId: number = 0): number {
        if (progress <= 0) return 0;
        if (progress >= 1) return 1;
        switch (curveId) {
            case EasingCurveId.EASE_IN_SINE:
                return 1 - Math.cos((progress * Math.PI) / 2);
            case EasingCurveId.EASE_OUT_SINE:
                return Math.sin((Math.PI * progress) / 2);
            case EasingCurveId.EASE_IN_OUT_SINE:
                return -(Math.cos(progress * Math.PI) - 1) / 2;
            case EasingCurveId.EASE_IN_QUAD:
                return progress * progress;
            case EasingCurveId.EASE_OUT_QUAD:
                return 1 - (1 - progress) * (1 - progress);
            case EasingCurveId.EASE_IN_OUT_QUAD:
                return progress < 0.5
                    ? progress * 2 * progress
                    : 1 - Math.pow(progress * -2 + 2, 2) / 2;
            case EasingCurveId.EASE_IN_CUBIC:
                return progress * progress * progress;
            case EasingCurveId.EASE_OUT_CUBIC:
                return 1 - Math.pow(1 - progress, 3);
            case EasingCurveId.EASE_IN_OUT_CUBIC:
                return progress < 0.5
                    ? progress * (4 * progress) * progress
                    : 1 - Math.pow(2 + progress * -2, 3) / 2;
            case EasingCurveId.EASE_IN_QUART:
                return progress * progress * progress * progress;
            case EasingCurveId.EASE_OUT_QUART:
                return 1 - Math.pow(1 - progress, 4);
            case EasingCurveId.EASE_IN_OUT_QUART:
                return progress < 0.5
                    ? progress * (progress * 8 * progress) * progress
                    : 1 - Math.pow(2 + -2 * progress, 4) / 2;
            case EasingCurveId.EASE_IN_QUINT:
                return progress * progress * progress * progress * progress;
            case EasingCurveId.EASE_OUT_QUINT:
                return 1 - Math.pow(1 - progress, 5);
            case EasingCurveId.EASE_IN_OUT_QUINT:
                return progress < 0.5
                    ? progress * (progress * 8 * progress * progress * progress)
                    : 1 - Math.pow(2 + progress * -2, 5) / 2;
            case EasingCurveId.EASE_IN_EXPO:
                return Math.pow(2, 10 * progress - 10);
            case EasingCurveId.EASE_OUT_EXPO:
                return 1 - Math.pow(2, -10 * progress);
            case EasingCurveId.EASE_IN_OUT_EXPO:
                return progress < 0.5
                    ? Math.pow(2, 20 * progress - 10) / 2
                    : (2 - Math.pow(2, -20 * progress + 10)) / 2;
            case EasingCurveId.EASE_IN_CIRC:
                return 1 - Math.sqrt(1 - progress * progress);
            case EasingCurveId.EASE_OUT_CIRC:
                return Math.sqrt(1 - (progress - 1) * (progress - 1));
            case EasingCurveId.EASE_IN_OUT_CIRC:
                return progress < 0.5
                    ? (1 - Math.sqrt(1 - Math.pow(2 * progress, 2))) / 2
                    : (Math.sqrt(1 - Math.pow(-2 * progress + 2, 2)) + 1) / 2;
            case EasingCurveId.EASE_IN_BACK: {
                const c1 = 1.70158;
                return (c1 + 1) * progress * progress * progress - c1 * progress * progress;
            }
            case EasingCurveId.EASE_OUT_BACK: {
                const c1 = 1.70158;
                const p1 = progress - 1;
                return 1 + (c1 + 1) * p1 * p1 * p1 + c1 * p1 * p1;
            }
            case EasingCurveId.EASE_IN_OUT_BACK: {
                const c2 = 1.70158 * 1.525;
                return progress < 0.5
                    ? (Math.pow(2 * progress, 2) * ((c2 + 1) * 2 * progress - c2)) / 2
                    : (Math.pow(2 * progress - 2, 2) * ((c2 + 1) * (progress * 2 - 2) + c2) + 2) /
                          2;
            }
            case EasingCurveId.EASE_IN_ELASTIC: {
                const c4 = (2 * Math.PI) / 3;
                return -Math.pow(2, 10 * progress - 10) * Math.sin((progress * 10 - 10.75) * c4);
            }
            case EasingCurveId.EASE_OUT_ELASTIC: {
                const c4 = (2 * Math.PI) / 3;
                return Math.pow(2, -10 * progress) * Math.sin((progress * 10 - 0.75) * c4) + 1;
            }
            case EasingCurveId.EASE_IN_OUT_ELASTIC: {
                const c5 = (2 * Math.PI) / 4.5;
                return progress < 0.5
                    ? -(Math.pow(2, 20 * progress - 10) * Math.sin((20 * progress - 11.125) * c5)) /
                          2
                    : (Math.pow(2, -20 * progress + 10) * Math.sin((20 * progress - 11.125) * c5)) /
                          2 +
                          1;
            }
            case EasingCurveId.LINEAR:
            default:
                return progress;
        }
    }

    /**
     * Compute manhattan distance from a point to a rectangle, minus half a tile (64 fine units).
     * Computes manhattan distance from a point to a rectangle, minus half a tile (64 fine units).
     */
    private static distanceToRect(
        px: number,
        py: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
    ): number {
        let dist = 0;
        if (px < minX) dist += minX - px;
        else if (px > maxX) dist += px - maxX;
        if (py < minY) dist += minY - py;
        else if (py > maxY) dist += py - maxY;
        return Math.max(dist - 64, 0);
    }

    /**
     * Compute distance-based volume for an ambient sound instance.
     * Uses minDistance/maxDistance with easing curve for distance-based attenuation.
     */
    private computeAmbientVolume(instance: AmbientSoundInstance): number {
        // Compute effective size considering orientation
        let sx = instance.sizeX || 1;
        let sy = instance.sizeY || 1;
        if (instance.orientation === 1 || instance.orientation === 3) {
            const tmp = sx;
            sx = sy;
            sy = tmp;
        }

        // Compute object rectangle bounds in scene fine coordinates
        // x,y are tile center (origin + 64), so subtract 64 to get tile origin
        const minX = instance.x - 64;
        const minY = instance.y - 64;
        const maxX = minX + sx * 128;
        const maxY = minY + sy * 128;

        const dist = SoundEffectSystem.distanceToRect(
            this.listenerX,
            this.listenerY,
            minX,
            minY,
            maxX,
            maxY,
        );

        const maxDistTiles =
            instance.distanceOverride !== undefined && instance.distanceOverride >= 0
                ? instance.distanceOverride
                : instance.maxDistance;
        const maxDist = maxDistTiles * 128;
        const minDist = Math.max(((instance.minDistance || 0) - 1) * 128, 0);

        if (minDist < maxDist) {
            // Distance attenuation zone: full volume inside minDist, fades to 0 at maxDist.
            // ease() clamps progress to [0,1] so dist > maxDist naturally gives 0.
            const curveId = instance.distanceFadeCurve ?? 0;
            const progress = (maxDist - dist) / (maxDist - minDist);
            return SoundEffectSystem.ease(Math.max(0, Math.min(1, progress)), curveId);
        }
        // minDistance >= maxDistance: no distance attenuation, full volume everywhere
        return 1;
    }

    private scheduleGainRamp(
        gain: AudioParam,
        startTime: number,
        from: number,
        to: number,
        duration: number,
        curveId?: number,
    ): void {
        const fn = this.getFadeCurve(curveId);
        const steps = Math.max(2, Math.ceil(duration / 0.05));
        gain.setValueAtTime(from, startTime);
        for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            const shaped = fn(progress);
            const value = from + (to - from) * shaped;
            gain.linearRampToValueAtTime(value, startTime + progress * duration);
        }
    }

    private getFadeCurve(curveId?: number): (t: number) => number {
        const id = curveId ?? 0;
        return (t) => SoundEffectSystem.ease(t, id);
    }

    private adjustAmbientGain(
        active: ActiveAmbientSound,
        targetGain: number,
        ctx: AudioContext,
        now: number,
        overrideDurationSec?: number,
        overrideCurve?: number,
    ): void {
        const gain = active.gainNode.gain;
        gain.cancelScheduledValues(now);
        const current = gain.value;
        if (Math.abs(current - targetGain) < 0.001) return;
        gain.setValueAtTime(current, now);

        // Use fadeIn curve/duration when volume is increasing, fadeOut when decreasing
        const increasing = targetGain > current;
        let baseDuration: number;
        let curveId: number | undefined;
        if (overrideDurationSec !== undefined) {
            baseDuration = overrideDurationSec;
            curveId = overrideCurve;
        } else {
            baseDuration = increasing
                ? active.fadeInDurationSec > 0
                    ? active.fadeInDurationSec
                    : 0.05
                : active.fadeOutDurationSec > 0
                  ? active.fadeOutDurationSec
                  : 0.05;
            curveId = increasing ? active.instance.fadeInCurve : active.instance.fadeOutCurve;
        }

        // Scale fade duration proportionally to the volume delta.
        // Matches reference scaleIntByRatio: smaller volume changes → shorter fades.
        const delta = Math.abs(current - targetGain);
        const ramp = delta >= 1 ? baseDuration : baseDuration * delta;

        if (ramp > 0.001) {
            this.scheduleGainRamp(gain, now, current, targetGain, ramp, curveId);
        } else {
            gain.setValueAtTime(targetGain, now);
        }
    }

    private beginAmbientFadeOut(
        key: string,
        active: ActiveAmbientSound,
        ctx: AudioContext,
        now: number,
    ): void {
        if (active.fadeOutActive) {
            return;
        }
        // Quick 150ms linear fade when sound leaves range entirely,
        // matching the reference's hardcoded 150ms linear fallback.
        const duration = 0.15;
        const gain = active.gainNode.gain;
        gain.cancelScheduledValues(now);
        const current = gain.value;
        gain.setValueAtTime(current, now);
        this.scheduleGainRamp(gain, now, current, 0, duration, EasingCurveId.LINEAR);
        active.fadeOutActive = true;
        active.stopAt = now + duration;
    }

    private startAmbientSound(
        key: string,
        instance: AmbientSoundInstance,
        ctx: AudioContext,
    ): ActiveAmbientSound {
        // Sources are created lazily by the update loop once the sound first
        // becomes audible; the gain starts silent and fades in from there.
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0;
        gainNode.connect(this.ensureAmbientBus(ctx));

        const active: ActiveAmbientSound = {
            instance,
            gainNode,
            soundKey: SoundEffectSystem.soundKeyOf(instance),
            loopSource: undefined,
            loopSoundId: undefined,
            overlaySource: undefined,
            nextChangeTime: Infinity,
            currentSoundIndex: -1,
            fadeInDurationSec: 0.3,
            fadeOutDurationSec: 0.3,
            fadeOutActive: false,
        };
        this.ambientSounds.set(key, active);
        return active;
    }

    private playOverlaySound(
        key: string,
        active: ActiveAmbientSound,
        instance: AmbientSoundInstance,
        ctx: AudioContext,
        now: number,
    ): void {
        if (!instance.soundIds || instance.soundIds.length === 0) {
            active.nextChangeTime = Infinity;
            return;
        }

        // Filter out undefined/invalid sound IDs
        const validSoundIds = instance.soundIds.filter((id) => id !== undefined && id >= 0);
        if (validSoundIds.length === 0) {
            active.nextChangeTime = Infinity;
            return;
        }

        // Uniform random pick (the same sound may repeat back-to-back)
        let nextIndex: number;
        if (instance.loopSequentially) {
            nextIndex = (active.currentSoundIndex + 1) % validSoundIds.length;
        } else {
            nextIndex = Math.floor(Math.random() * validSoundIds.length);
        }
        const nextSoundId = validSoundIds[nextIndex];

        const decoded = this.decode(nextSoundId, undefined, false, undefined, false);
        if (!decoded) {
            return;
        }

        const buffer = this.prepareBuffer(decoded, ctx);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = false;
        source.connect(active.gainNode);

        // The next delay is drawn when the overlay starts, but only begins
        // counting down once the overlay has finished playing.
        const delaySec = this.computeOverlayDelaySec(instance);
        active.pendingOverlayDelaySec = delaySec;
        active.nextChangeTime = Infinity;

        source.addEventListener("ended", () => {
            try {
                source.disconnect();
            } catch {}
            if (active.overlaySource === source) {
                active.overlaySource = undefined;
                const pending = active.pendingOverlayDelaySec;
                active.pendingOverlayDelaySec = undefined;
                if (pending !== undefined && pending !== Infinity) {
                    const endNow = this.context ? this.context.currentTime : now;
                    active.nextChangeTime = endNow + pending;
                }
            }
        });
        this.registerSource(source);
        source.start(now);

        active.overlaySource = source;
        active.currentSoundIndex = nextIndex;
    }

    private stopAmbientSound(key: string, ctx?: AudioContext): void {
        const active = this.ambientSounds.get(key);
        if (!active) return;

        try {
            active.loopSource?.stop();
        } catch {}
        try {
            active.overlaySource?.stop();
        } catch {}
        try {
            active.loopSource?.disconnect();
        } catch {}
        try {
            active.overlaySource?.disconnect();
        } catch {}
        try {
            active.gainNode.disconnect();
        } catch {}
        this.disconnectNodes([active.gainNode]);

        this.ambientSounds.delete(key);
    }

    stopAllAmbientSounds(): void {
        const ctx = this.context;
        for (const key of this.ambientSounds.keys()) {
            this.stopAmbientSound(key, ctx);
        }
    }

    dispose(): void {
        this.disposed = true;
        this.pendingRetries.clear();

        // Stop all active sources
        for (const source of this.activeSources) {
            try {
                source.stop();
                source.disconnect();
            } catch {}
        }
        this.activeSources.length = 0;

        // Stop all ambient sounds
        this.stopAllAmbientSounds();

        // Remove event listeners
        this.removeContextListeners();

        // Disconnect and close audio context
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = undefined;
        }
        if (this.ambientGainNode) {
            this.ambientGainNode.disconnect();
            this.ambientGainNode = undefined;
        }
        if (this.context) {
            unregisterManagedAudioContext(this.context);
            this.context.close().catch(() => {});
            this.context = undefined;
        }

        // Clear caches
        this.decodedCache.clear();
        this.warnedSounds.clear();
    }
}
