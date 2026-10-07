import { Location } from "./Location";
import { World } from '../World';
import { Mobile } from "../entity/impl/Mobile";
import { PrivateArea } from "./areas/impl/PrivateArea";

export class Projectile {
    private start: Location;
    private end: Location;
    private speed: number;
    private projectileId: number;
    private startHeight: number;
    private endHeight: number;
    private lockon: Mobile;
    private lockonTargetIndex: number;
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
     * 10 per tile on top of the launch delay. Flat lifetimes make a projectile cross a
     * boss's whole range as fast as it crosses one tile, which reads as teleporting.
     */
    public static arrivalCycles(from: Mobile | Location, to: Mobile | Location, delay: number = 40): number {
        return delay + Projectile.locationOf(from).getDistance(Projectile.locationOf(to)) * 10;
    }

    /** The same arrival, in game ticks, for lining a hitsplat up with the projectile. */
    public static arrivalTicks(from: Mobile | Location, to: Mobile | Location, delay: number = 40): number {
        return Math.ceil(Projectile.arrivalCycles(from, to, delay) / 30);
    }

    private static locationOf(at: Mobile | Location): Location {
        return at instanceof Location ? at : Projectile.centreOf(at);
    }

        static createProjectile(source: Mobile, victim: Mobile, projectileId: number, delay: number, speed: number,
                            startHeight: number, endHeight: number) {
        return new Projectile(
            Projectile.centreOf(source),
            Projectile.centreOf(victim),
            victim,
            projectileId,
            delay,
            speed,
            startHeight,
            endHeight,
            source.getPrivateArea()
        );
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
            const distance = this.start.getDistance(this.end);
            resolvedDelay = 51;
            resolvedSpeed = resolvedDelay - 5 + distance * 10;
        }

        let recipients = 0;
        let scannedNetworkPlayers = 0;
        let skippedArea = 0;
        let skippedView = 0;
        let skippedTargetView = 0;
        World.forEachNetworkPlayer((player) => {
            scannedNetworkPlayers++;
            if (player.getPrivateArea() != this.privateArea) {
                skippedArea++;
                return;
            }
            // Seen as far as NPCs are: an area that widens that shows their projectiles too.
            const range = Math.max(15, player.getNpcViewDistance?.() ?? 15);
            if (!this.start.isViewableFromWithin(player.getLocation(), range)) {
                skippedView++;
                return;
            }
            if (
                this.lockon &&
                typeof this.lockon.getLocation === "function" &&
                !this.lockon.getLocation().isViewableFromWithin(player.getLocation(), range)
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
                    this.progress
                );
        });
        if (process.env.PROJECTILE_DEBUG === "1") {
            console.log(
                `[projectile.send] id=${this.projectileId} recipients=${recipients} scanned=${scannedNetworkPlayers} skippedArea=${skippedArea} skippedView=${skippedView} skippedTargetView=${skippedTargetView} start=(${this.start.getX()},${this.start.getY()},${this.start.getZ?.() ?? 0}) end=(${this.end.getX()},${this.end.getY()},${this.end.getZ?.() ?? 0})`
            );
        }
    }
}
