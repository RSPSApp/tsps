import type { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import type { VarManager } from "../../rs/config/vartype/VarManager";
import type { AmbientSoundInstance, SoundEffectSystem } from "./SoundEffectSystem";

/** The loc data a map square of either renderer carries, which is all ambient sound needs. */
export interface AmbientSoundMap {
    mapX: number;
    mapY: number;
    tileLocOffsetsByLevel?: ArrayLike<number>[];
    tileLocIdsByLevel?: ArrayLike<number>[];
    tileLocTypeRotByLevel?: ArrayLike<number>[];
    locsAnimated?: Iterable<{ id: number; x: number; y: number; level: number; rotation: number }>;
}

type Emitter = { locId: number; x: number; y: number; level: number; rot: number };

/** Collect the visible maps' emitters every this many frames; between collects volumes still follow the listener. */
const THROTTLE_FRAMES = 3;

/**
 * The looping sounds of scenery (birds, water, machinery) around the listener. It belonged to the
 * WebGL frame; every renderer now hands it the maps it shows once per frame.
 */
export class AmbientSoundCollector {
    private readonly buffer: AmbientSoundInstance[] = [];
    private bufferIndex = 0;
    private frameCounter = 0;
    /** Memoized "does this loc (or any of its transforms) emit ambient sound". */
    private readonly soundPotential = new Map<number, boolean>();
    /** Keyed by a level's loc id array: a loc change brings a new array, so its list is rebuilt. */
    private readonly emittersByLocIds = new WeakMap<object, Emitter[]>();

    constructor(
        private readonly getSoundSystem: () => SoundEffectSystem | undefined,
        private readonly getLocTypeLoader: () => LocTypeLoader,
        private readonly getVarManager: () => VarManager,
    ) {}

    frame(maps: Iterable<AmbientSoundMap>): void {
        const soundSystem = this.getSoundSystem();
        if (!soundSystem) return;
        if (++this.frameCounter >= THROTTLE_FRAMES) {
            this.frameCounter = 0;
            this.bufferIndex = 0;
            for (const map of maps) this.collect(map);
            this.buffer.length = this.bufferIndex;
        }
        soundSystem.updateAmbientSounds(this.buffer);
    }

    private collect(map: AmbientSoundMap): void {
        // Animated locs (sparse, iterate all levels)
        for (const loc of map.locsAnimated ?? []) {
            if (!this.hasSoundPotential(loc.id)) continue;
            this.addEmitter(loc.id, loc.x, loc.y, loc.level, loc.rotation);
        }
        const idsByLevel = map.tileLocIdsByLevel;
        const offsetsByLevel = map.tileLocOffsetsByLevel;
        if (!idsByLevel || !offsetsByLevel) return;
        for (let level = 0; level < offsetsByLevel.length; level++) {
            for (const emitter of this.levelEmitters(map, level)) {
                this.addEmitter(emitter.locId, emitter.x, emitter.y, emitter.level, emitter.rot);
            }
        }
    }

    /** The static locs on one level that can make sound, built once per loc id array. */
    private levelEmitters(map: AmbientSoundMap, level: number): Emitter[] {
        const offsets = map.tileLocOffsetsByLevel![level];
        const ids = map.tileLocIdsByLevel![level];
        if (!offsets || !ids || offsets.length < 2) return [];
        const cached = this.emittersByLocIds.get(ids);
        if (cached) return cached;

        const emitters: Emitter[] = [];
        const mapBaseX = map.mapX * 64;
        const mapBaseY = map.mapY * 64;
        const typeRots = map.tileLocTypeRotByLevel?.[level];
        const span = Math.round(Math.sqrt(offsets.length - 1));
        for (let localY = 0; localY < span; localY++) {
            for (let localX = 0; localX < span; localX++) {
                const tileIdx = localY * span + localX;
                const end = offsets[tileIdx + 1] | 0;
                for (let i = offsets[tileIdx] | 0; i < end; i++) {
                    const locId = ids[i] | 0;
                    if (!this.hasSoundPotential(locId)) continue;
                    const packed = typeRots ? typeRots[i] | 0 : 0;
                    emitters.push({
                        locId,
                        x: (mapBaseX + localX) * 128 + 64,
                        y: (mapBaseY + localY) * 128 + 64,
                        level,
                        rot: (packed >> 6) & 3,
                    });
                }
            }
        }
        this.emittersByLocIds.set(ids, emitters);
        return emitters;
    }

    private hasSoundPotential(locId: number): boolean {
        const cached = this.soundPotential.get(locId);
        if (cached !== undefined) return cached;
        const loader = this.getLocTypeLoader();
        const locType = loader.load(locId);
        let result = hasSound(locType);
        if (!result && locType?.transforms) {
            result = locType.transforms.some((id: number) => id !== -1 && hasSound(loader.load(id)));
        }
        this.soundPotential.set(locId, result);
        return result;
    }

    private addEmitter(locId: number, x: number, y: number, level: number, rot: number): void {
        const loader = this.getLocTypeLoader();
        const baseType = loader.load(locId);
        if (!baseType) return;
        // Resolve varbit transforms for the active sound fields; the emitter persists with no
        // sound while the active transform is silent so it can fade between states without
        // losing loop phase or timers.
        let soundType: any = baseType.transforms ? baseType.transform(this.getVarManager(), loader) : baseType;
        if (soundType && !hasSound(soundType)) soundType = undefined;

        let inst = this.buffer[this.bufferIndex];
        if (!inst) {
            inst = {} as AmbientSoundInstance;
            this.buffer[this.bufferIndex] = inst;
        }
        this.bufferIndex++;
        inst.locId = locId;
        inst.soundId = soundType ? soundType.ambientSoundId : -1;
        inst.x = x;
        inst.y = y;
        inst.z = level * 128;
        inst.maxDistance = soundType ? soundType.soundMaxDistance : 0;
        inst.minDistance = soundType ? soundType.soundMinDistance : 0;
        inst.changeTicksMin = soundType ? soundType.ambientSoundChangeTicksMin : 0;
        inst.changeTicksMax = soundType ? soundType.ambientSoundChangeTicksMax : 0;
        inst.soundIds = soundType ? soundType.ambientSoundIds : undefined;
        inst.sizeX = baseType.sizeX || 1;
        inst.sizeY = baseType.sizeY || 1;
        inst.orientation = rot;
        inst.fadeInDurationMs = soundType?.soundFadeInDuration || undefined;
        inst.fadeOutDurationMs = soundType?.soundFadeOutDuration || undefined;
        inst.fadeInCurve = soundType?.soundFadeInCurve || undefined;
        inst.fadeOutCurve = soundType?.soundFadeOutCurve || undefined;
        inst.distanceFadeCurve = soundType?.soundDistanceFadeCurve || undefined;
        inst.distanceOverride = soundType ? (soundType.soundAreaRadiusOverride ?? undefined) : undefined;
        inst.loopSequentially = soundType ? soundType.loopMultiSoundSequentially : false;
        inst.deferSwap = soundType ? soundType.deferredAmbientSwap : false;
        inst.exactPosition = soundType ? soundType.useExactSoundPosition : false;
        inst.resetOnLoop = soundType ? soundType.resetAmbientOnLoopRestart : false;
    }
}

function hasSound(locType: any): boolean {
    return !!locType && (locType.ambientSoundId !== -1 || locType.ambientSoundIds?.length > 0);
}
