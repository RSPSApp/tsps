import { Player } from '../game/entity/impl/player/Player'
import { Sound } from '../game/Sound'
import { World } from './World'
export class Sounds {
    private static readonly knownSoundsByName = Sounds.buildKnownSoundsByName();
    private static readonly knownSoundsById = Sounds.buildKnownSoundsById();

    private static buildKnownSoundsByName(): ReadonlyMap<string, Sound> {
        const entries = Object.entries(Sound)
            .filter(([, value]) => value instanceof Sound)
            .map(([name, value]) => [name, value as Sound] as const);
        return new Map(entries);
    }

    private static buildKnownSoundsById(): ReadonlyMap<number, Sound> {
        const byId = new Map<number, Sound>();
        for (const sound of Sounds.knownSoundsByName.values()) {
            if (!byId.has(sound.getId())) {
                byId.set(sound.getId(), sound);
            }
        }
        return byId;
    }

    private static resolvePlayer(entity: unknown): Player | null {
        const candidate = entity as any;
        if (!candidate) {
            return null;
        }

        // Mobile-like source.
        if (typeof candidate.isPlayer === "function" && candidate.isPlayer()) {
            return typeof candidate.getAsPlayer === "function" ? (candidate.getAsPlayer() as Player) : null;
        }

        // Player-like source.
        if (typeof candidate.getPacketSender === "function" && typeof candidate.getUsername === "function") {
            return candidate as Player;
        }

        return null;
    }

    public static sendSound(entity: unknown, sound: Sound) {
        if (!sound) {
            return;
        }
        const player = Sounds.resolvePlayer(entity);
        if (player) {
            if (!player.isPlayerBot()) {
                player
                    .getPacketSender()
                    .sendSoundEffect(sound.getId(), sound.getLoopType(), sound.getDelay(), sound.getClientVolume());
            }
            return;
        }

        const location = (entity as any)?.getLocation?.();
        if (location) {
            Sounds.playAreaSound({
                soundId: sound.getId(),
                x: location.getX(),
                y: location.getY(),
                level: location.getZ(),
                loops: sound.getLoopType(),
                delay: sound.getDelay(),
            });
        }
    }

    public static sendSoundEffect(player: Player, soundId: number, loopType: number, delay: number, volume: number) {
        player.getPacketSender().sendSoundEffect(soundId, loopType, delay, volume);
    }

    public static playAreaSound(options: {
        soundId: number;
        x: number;
        y: number;
        level?: number;
        loops?: number;
        delay?: number;
        radius?: number;
        attenuation?: number;
    }): void {
        if (!(options.soundId > 0)) return;
        const level = options.level ?? 0;
        const radius = Math.max(0, Math.min(31, options.radius ?? 0));
        const broadcastRadius = Math.max(15, radius + 1);
        for (const player of World.getPlayers()) {
            if (player.isPlayerBot()) continue;
            const location = player.getLocation();
            if (location.getZ() !== level || Math.max(
                Math.abs(location.getX() - options.x),
                Math.abs(location.getY() - options.y),
            ) > broadcastRadius) continue;
            player.getPacketSender().sendAreaSound(
                options.soundId,
                options.x,
                options.y,
                level,
                options.loops,
                options.delay,
                radius,
                options.attenuation,
            );
        }
    }

    public static resolveKnownSound(token: string | number): Sound | null {
        if (typeof token === "number" && Number.isInteger(token)) {
            return Sounds.knownSoundsById.get(token) ?? null;
        }

        if (typeof token !== "string") {
            return null;
        }

        const normalized = token.trim().toUpperCase().replace(/^SOUND\./, '');
        if (normalized.length === 0) {
            return null;
        }

        if (/^\d+$/.test(normalized)) {
            return Sounds.knownSoundsById.get(Number.parseInt(normalized, 10)) ?? null;
        }

        return Sounds.knownSoundsByName.get(normalized) ?? null;
    }

    public static knownSoundNames(): ReadonlyArray<string> {
        return [...Sounds.knownSoundsByName.keys()].sort();
    }
}
