import { Location } from "./Location";
import { CrossFloor } from "../CrossFloor";
import { World } from '../World';
import { Mobile } from "../entity/impl/Mobile";
import { PrivateArea } from "./areas/impl/PrivateArea";
import { BoatManager } from "../content/sailing/BoatManager";
import { CombatPosition } from "../content/combat/CombatPosition";

export class Projectile {
    private start: Location;
    private end: Location;
    private speed: number;
    private projectileId: number;
    private startHeight: number;
    private endHeight: number;
    private lockon: Mobile;
    private lockonTargetIndex: number;
    /** The mobile firing it, when known: the client starts it from where that mobile is drawn. */
    private sourceIndex = 0;
    private delay: number;
    private privateArea: PrivateArea;
    /** The arc's slope at launch (the packet's angle); 16 unless set. */
    private angle = 16;

    constructor(start: Location, end: Location, lockon: Mobile, projectileId: number, delay: number, speed: number,
        startHeight: number, endHeight: number, privateArea: PrivateArea) {
        // Freeze packet coordinates at fire time so later movement/retargets do not
        // mutate the projectile trajectory unexpectedly for observers.
        this.start = start?.clone?.() ?? start;
        this.lockon = lockon;
        this.end = end?.clone?.() ?? end;
        this.projectileId = projectileId;
        this.delay = delay;
        this.speed = speed;
        this.startHeight = startHeight;
        this.endHeight = endHeight;
        this.privateArea = privateArea;
        this.lockonTargetIndex = Projectile.resolveLockonTargetIndex(lockon);
        }

        private static resolveLockonTargetIndex(lockon: Mobile): number {
        if (!lockon) {
            return 0;
        }
        if (typeof (lockon as any).getIndex !== "function" || typeof (lockon as any).isPlayer !== "function") {
            return 0;
        }
        const index = (lockon as any).getIndex();
        if (!Number.isInteger(index) || index < 0) {
            return 0;
        }
        return (lockon as any).isPlayer() ? -(index + 1) : index + 1;
    }

    /**
     * A mobile's Location is the south-west tile of its footprint, so anything bigger
     * than 1x1 (KBD, Jad, Vet'ion...) would fire from - and be shot at - a corner of
     * its body instead of the middle of it.
     */
    public static centreOf(mobile: Mobile): Location {
        const location = mobile.getLocation();
        const offset = (Math.max(1, mobile.getSize()) - 1) >> 1;
        return offset > 0 ? location.transform(offset, offset) : location;
    }

    /**
     * Cycles (20ms) between a projectile being sent and it landing, at the engine's usual
     * 10 per tile (or `perTile`) on top of the launch delay. Flat lifetimes make a projectile
     * cross a boss's whole range as fast as it crosses one tile, which reads as teleporting.
     */
    public static arrivalCycles(from: Mobile | Location, to: Mobile | Location, delay: number = 40, perTile: number = 10): number {
        return delay + Projectile.flightDistance(
            Projectile.locationOf(from),
            Projectile.locationOf(to),
            typeof (to as Mobile)?.getLocation === "function" ? to as Mobile : undefined,
        ) * perTile;
    }

    /**
     * The same arrival, in game ticks, for lining a hitsplat up with the projectile: a hit
     * queued this many ticks out shows its splat on the first tick after the projectile lands.
     */
    public static arrivalTicks(from: Mobile | Location, to: Mobile | Location, delay: number = 40, perTile: number = 10): number {
        return Math.ceil(Projectile.arrivalCycles(from, to, delay, perTile) / 30);
    }

    /**
     * Ticks to queue a hit on a player so its splat shows when a projectile ending at `endCycle`
     * lands: a hit N ticks out shows 30 * N cycles after the projectile was sent, and the
     * projectile reaches its target at the end cycle (#1862).
     */
    public static ticksToLand(endCycle: number): number {
        return Math.max(1, Math.ceil(endCycle / 30));
    }

    /**
     * The end the legacy magic shape (delay 0, speed 20, heights 43/31) is normalised to in
     * sendProjectile: launched at 51 and landing at 46 + 10 per tile.
     */
    public static readonly LEGACY_MAGIC_END_BASE = 46;

    /**
     * Horizontal tiles a projectile flies to the nearest tile of the target, ignoring floor delta.
     * The end point is the target's centre tile (rsprox: magic projectiles land against a large target's
     * nearest tile, not its south-west corner).
     */
    public static flightDistance(start: Location, end: Location, victim?: Mobile | null): number {
        const size = Math.max(1, victim?.getSize?.() ?? 1);
        const offset = (size - 1) >> 1;
        const west = end.getX() - offset;
        const south = end.getY() - offset;
        const dx = Math.max(0, west - start.getX(), start.getX() - (west + size - 1));
        const dy = Math.max(0, south - start.getY(), start.getY() - (south + size - 1));
        return Math.max(dx, dy);
    }

    private static locationOf(at: Mobile | Location): Location {
        return at instanceof Location ? at : Projectile.centreOf(at);
    }

        static createProjectile(source: Mobile, victim: Mobile, projectileId: number, delay: number, speed: number,
                            startHeight: number, endHeight: number) {
        // Across a boat's deck (a player aboard shooting a sea creature) the shot flies in the
        // main world, from the tile under the shooter.
        const across = CombatPosition.acrossDeck(source, victim);
        return new Projectile(
            across ? Projectile.rootCentreOf(source) : Projectile.centreOf(source),
            across ? Projectile.rootCentreOf(victim) : Projectile.centreOf(victim),
            victim,
            projectileId,
            delay,
            speed,
            startHeight,
            endHeight,
            across ? null : source.getPrivateArea()
        ).withSource(source);
    }

    /** `centreOf`, from the main-world tile under a mobile aboard a boat. */
    private static rootCentreOf(mobile: Mobile): Location {
        const location = BoatManager.rootLocation(mobile);
        const offset = (Math.max(1, mobile.getSize()) - 1) >> 1;
        return offset > 0 ? location.transform(offset, offset) : location;
    }

    /**
     * Names the mobile firing it. Its tile is still the packet's source, but the client starts
     * the projectile from where the mobile is drawn: a caster that attacks on the tick it steps
     * into range is still walking there on screen.
     */
    public withSource(source: Mobile): Projectile {
        this.sourceIndex = Projectile.resolveLockonTargetIndex(source);
        return this;
    }


    /** Sets the arc's slope at launch: higher is steeper (Zebak's falling fragments use 127). */
    public withAngle(angle: number): Projectile {
        this.angle = Math.max(0, Math.min(255, Math.trunc(angle)));
        return this;
    }

    /** Where along the source tile it starts, in 1/128ths of a tile (the packet's progress); 64 unless set. */
    private progress = 64;

    public withProgress(progress: number): Projectile {
        this.progress = Math.max(0, Math.min(255, Math.trunc(progress)));
        return this;
    }

    public sendProjectile(): void {
        let resolvedDelay = this.delay;
        let resolvedSpeed = this.speed;

        // Most combat spells use Java ProjectileBuilder defaults:
        // start=43, end=31, delay=51, duration=-5, span=10.
        // Older TS spell ports still pass (delay=0, speed=20), which makes
        // spell travel/desync look off versus Java. Normalize only this legacy
        // magic shape and keep all custom/ranged projectiles untouched.
        if (
            this.delay === 0 &&
            this.speed === 20 &&
            this.startHeight === 43 &&
            this.endHeight === 31
        ) {
            const distance = Projectile.flightDistance(this.start, this.end, this.lockon);
            resolvedDelay = 51;
            resolvedSpeed = Projectile.LEGACY_MAGIC_END_BASE + distance * 10;
        }

        let recipients = 0;
        let scannedNetworkPlayers = 0;
        let skippedArea = 0;
        let skippedView = 0;
        let skippedTargetView = 0;
        World.forEachNetworkPlayer((player) => {
            scannedNetworkPlayers++;
            // A deck counts as the main world: people aboard see the shots around them at sea,
            // measured from the tile under them (as sync does).
            const sameArea = player.getPrivateArea() == this.privateArea;
            if (!sameArea && BoatManager.syncArea(player) != this.privateArea) {
                skippedArea++;
                return;
            }
            const viewer = sameArea ? player.getLocation() : BoatManager.rootLocation(player);
            // Seen as far as NPCs are: an area that widens that shows their projectiles too.
            const range = Math.max(15, player.getNpcViewDistance?.() ?? 15);
            if (!CrossFloor.projectileVisible(viewer, this.start, range)) {
                skippedView++;
                return;
            }
            if (
                this.lockon &&
                typeof this.lockon.getLocation === "function" &&
                !CrossFloor.projectileVisible(viewer, sameArea ? this.lockon.getLocation() : BoatManager.rootLocation(this.lockon), range)
            ) {
                skippedTargetView++;
                return;
            }
            recipients++;
            player
                .getPacketSender()
                .sendProjectile(
                    this.start,
                    this.end,
                    0,
                    resolvedSpeed,
                    this.projectileId,
                    this.startHeight,
                    this.endHeight,
                    this.lockonTargetIndex,
                    resolvedDelay,
                    this.angle,
                    this.progress,
                    this.sourceIndex || null
                );
        });
        if (process.env.PROJECTILE_DEBUG === "1") {
            console.log(
                `[projectile.send] id=${this.projectileId} recipients=${recipients} scanned=${scannedNetworkPlayers} skippedArea=${skippedArea} skippedView=${skippedView} skippedTargetView=${skippedTargetView} start=(${this.start.getX()},${this.start.getY()},${this.start.getZ?.() ?? 0}) end=(${this.end.getX()},${this.end.getY()},${this.end.getZ?.() ?? 0})`
            );
        }
    }
}
