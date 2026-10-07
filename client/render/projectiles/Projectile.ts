import { RAD_TO_RS_UNITS } from "../../rs/utils/rotation";

export interface ProjectileConfig {
    projectileId: number;
    debugId?: number;
    sourceX: number;
    sourceY: number;
    sourceZ: number;
    targetX: number;
    targetY: number;
    targetGroundZ: number;
    startCycle: number;
    endCycle: number;
    endCycleExact?: number;
    startPos: number;
    sourceHeight: number;
    endHeight: number;
    slope: number;
    plane: number;
    frameLengths?: number[];
    frameCount?: number;
    impactSpotId?: number;
}

/**
 * Projectile runtime modeled after OSRS projectile semantics.
 */
export class Projectile {
    readonly projectileId: number;
    readonly debugId: number;
    readonly plane: number;

    private sourceX: number;
    private sourceY: number;
    private sourceZ: number;
    private targetX: number;
    private targetY: number;
    private targetZ: number;
    private targetGroundZ: number;

    readonly startCycle: number;
    readonly endCycle: number;
    readonly endCycleExact: number;

    readonly slope: number;
    readonly impactSpotId?: number;

    private readonly startPos: number;
    private readonly sourceHeightUnits: number;
    private destinationHeight: number;

    currentX: number;
    currentY: number;
    currentZ: number;

    private speedX: number = 0;
    private speedY: number = 0;
    private speedZ: number = 0;
    private speedScalar: number = 0;
    private accelerationZ: number = 0;

    animationFrame: number = 0;
    private frameCycle: number = 0;

    /** Cycles into the current animation frame (1..its length), for animation smoothing. */
    getFrameCycle(): number {
        return this.frameCycle;
    }
    private readonly frameLengths?: number[];
    private readonly frameCount: number;

    yaw: number = 0;
    pitch: number = 0;
    roll: number = 0;

    private moving: boolean = false;
    private initialized: boolean = false;
    private needsVelocityRefresh: boolean = false;
    private lastSolveTick: number = NaN;
    private velocitiesInitialized: boolean = false;

    constructor(config: ProjectileConfig) {
        this.projectileId = config.projectileId;
        this.debugId = config.debugId ?? 0;
        this.plane = config.plane;

        this.sourceX = config.sourceX;
        this.sourceY = config.sourceY;
        this.sourceZ = config.sourceZ;
        this.targetX = config.targetX;
        this.targetY = config.targetY;
        this.targetGroundZ = config.targetGroundZ;
        this.destinationHeight = config.endHeight;
        this.targetZ = this.targetGroundZ - this.destinationHeight;

        this.startCycle = config.startCycle;
        this.endCycle = Math.max(config.startCycle + 1, config.endCycle);
        this.endCycleExact = Math.max(this.endCycle + 1, config.endCycleExact ?? this.endCycle + 1);
        this.startPos = config.startPos;
        this.sourceHeightUnits = config.sourceHeight;
        this.slope = config.slope;
        this.impactSpotId = config.impactSpotId;

        this.frameLengths = config.frameLengths;
        this.frameCount = config.frameCount ?? 1;

        this.currentX = this.sourceX;
        this.currentY = this.sourceY;
        this.currentZ = this.sourceZ;
    }

    /**
     * Calculate horizontal speeds and vertical kinematics to land at endCycle.
     * Mirrors OSRS Projectile.setDestination(): solve once per integer cycle.
     */
    trackTarget(currentCycle: number): void {
        const nowFloat = currentCycle;
        const now = Math.floor(nowFloat);

        if (this.lastSolveTick === now && this.moving && !this.needsVelocityRefresh) {
            return;
        }

        if (!this.initialized) {
            const dx = this.targetX - this.sourceX;
            const dy = this.targetY - this.sourceY;
            const length = Math.hypot(dx, dy);
            if (length > 1e-9) {
                const unitX = dx / length;
                const unitY = dy / length;
                this.currentX = this.sourceX + this.startPos * unitX;
                this.currentY = this.sourceY + this.startPos * unitY;
            } else {
                this.currentX = this.sourceX;
                this.currentY = this.sourceY;
            }
            this.currentZ = this.sourceZ;
            this.initialized = true;
        }

        if (nowFloat >= this.endCycleExact) {
            this.snapToTarget();
            this.moving = true;
            this.lastSolveTick = now;
            return;
        }

        if ((this.needsVelocityRefresh || !this.velocitiesInitialized) && now >= this.startCycle) {
            const remaining = Math.max(1e-6, this.endCycle + 1 - nowFloat);

            this.speedX = (this.targetX - this.currentX) / remaining;
            this.speedY = (this.targetY - this.currentY) / remaining;
            this.speedScalar = Math.hypot(this.speedX, this.speedY);

            if (!this.moving || !this.velocitiesInitialized) {
                const slopeRadians = this.slope * 0.02454369260617026;
                this.speedZ = -this.speedScalar * Math.tan(slopeRadians);
            }

            this.accelerationZ =
                (2 * (this.targetZ - this.currentZ - this.speedZ * remaining)) /
                (remaining * remaining);

            this.velocitiesInitialized = true;
            this.needsVelocityRefresh = false;
        }

        this.lastSolveTick = now;
    }

    /**
     * Advance the projectile by the given number of client cycles.
     */
    advance(cycles: number): void {
        this.moving = true;

        this.currentX += this.speedX * cycles;
        this.currentY += this.speedY * cycles;
        this.currentZ += this.speedZ * cycles + 0.5 * this.accelerationZ * cycles * cycles;

        this.speedZ += this.accelerationZ * cycles;

        const totalDx = this.targetX - this.sourceX;
        const totalDy = this.targetY - this.sourceY;
        const totalLengthSquared = totalDx * totalDx + totalDy * totalDy;
        if (totalLengthSquared > 1e-6) {
            const currentDx = this.currentX - this.sourceX;
            const currentDy = this.currentY - this.sourceY;
            const progress = (currentDx * totalDx + currentDy * totalDy) / totalLengthSquared;
            if (progress >= 1) {
                this.snapToTarget();
                this.speedX = 0;
                this.speedY = 0;
                this.speedScalar = 0;
                this.speedZ = 0;
                this.accelerationZ = 0;
            }
        }

        this.yaw =
            (Math.trunc(Math.atan2(this.speedX, this.speedY) * RAD_TO_RS_UNITS) + 1024) & 2047;
        this.pitch = Math.trunc(Math.atan2(this.speedZ, this.speedScalar) * 325.949) & 2047;
        this.roll = (this.animationFrame * 32) & 2047;

        if (this.frameLengths && this.frameLengths.length > 0) {
            this.frameCycle += cycles;

            while (true) {
                const currentFrameLength = this.frameLengths[this.animationFrame] ?? 1;
                if (this.frameCycle <= currentFrameLength) {
                    break;
                }

                this.frameCycle -= currentFrameLength;
                this.animationFrame++;

                if (this.animationFrame >= this.frameLengths.length) {
                    this.animationFrame -= this.frameCount;
                }

                if (this.animationFrame < 0 || this.animationFrame >= this.frameLengths.length) {
                    this.animationFrame = 0;
                    break;
                }
            }
            return;
        }

        this.animationFrame += cycles;
        if (this.frameCount > 0 && this.animationFrame >= this.frameCount) {
            this.animationFrame %= this.frameCount;
        }
    }

    isExpired(currentCycle: number): boolean {
        return currentCycle > this.endCycle;
    }

    setTarget(x: number, y: number, groundZ: number, forceRefresh: boolean = false): void {
        if (
            !forceRefresh &&
            this.targetX === x &&
            this.targetY === y &&
            this.targetGroundZ === groundZ
        ) {
            return;
        }
        this.targetX = x;
        this.targetY = y;
        this.targetGroundZ = groundZ;
        this.targetZ = this.targetGroundZ - this.destinationHeight;
        this.needsVelocityRefresh = true;
        this.lastSolveTick = NaN;
    }

    setSource(x: number, y: number, z: number): void {
        if (this.moving && this.initialized) {
            return;
        }
        if (this.sourceX === x && this.sourceY === y && this.sourceZ === z) {
            return;
        }
        this.sourceX = x;
        this.sourceY = y;
        this.sourceZ = z;
        this.initialized = false;
        this.lastSolveTick = NaN;
    }

    hasStarted(): boolean {
        return this.moving;
    }

    getPosition(): { x: number; y: number; z: number } {
        return {
            x: this.currentX,
            y: this.currentY,
            z: this.currentZ,
        };
    }

    getRotation(): { yaw: number; pitch: number; roll: number } {
        return {
            yaw: this.yaw,
            pitch: this.pitch,
            roll: this.roll,
        };
    }

    getSource(): { x: number; y: number; z: number } {
        return {
            x: this.sourceX,
            y: this.sourceY,
            z: this.sourceZ,
        };
    }

    getTarget(): { x: number; y: number; z: number } {
        return {
            x: this.targetX,
            y: this.targetY,
            z: this.targetZ,
        };
    }

    getTiming(): { startCycle: number; endCycle: number } {
        return {
            startCycle: this.startCycle,
            endCycle: this.endCycle,
        };
    }

    get startHeight(): number {
        return this.sourceHeightUnits;
    }

    get endHeight(): number {
        return this.destinationHeight;
    }

    get horizontalOffset(): number {
        return this.startPos;
    }

    getSpeed(): { x: number; y: number; z: number; scalar: number } {
        return {
            x: this.speedX,
            y: this.speedY,
            z: this.speedZ,
            scalar: this.speedScalar,
        };
    }

    revalidateSourceHeight(groundHeight: number): void {
        const newSourceZ = groundHeight - this.sourceHeightUnits;
        const diff = newSourceZ - this.sourceZ;
        if (Math.abs(diff) <= 64) {
            return;
        }

        this.sourceZ = newSourceZ;
        this.currentZ += diff;
        this.needsVelocityRefresh = true;
    }

    snapToTarget(): void {
        this.currentX = this.targetX;
        this.currentY = this.targetY;
        this.currentZ = this.targetZ;
    }

    debugPredictTrajectory(): Array<{ t: number; x: number; y: number; z: number }> {
        const out: Array<{ t: number; x: number; y: number; z: number }> = [];
        const remaining = this.endCycle + 1 - this.startCycle;
        if (!(remaining > 0)) {
            return out;
        }

        const dx = this.targetX - this.sourceX;
        const dy = this.targetY - this.sourceY;
        const length = Math.hypot(dx, dy);
        let startX = this.sourceX;
        let startY = this.sourceY;
        if (length > 1e-9) {
            const unitX = dx / length;
            const unitY = dy / length;
            startX = this.sourceX + this.startPos * unitX;
            startY = this.sourceY + this.startPos * unitY;
        }
        const startZ = this.sourceZ;

        const speedX = (this.targetX - startX) / remaining;
        const speedY = (this.targetY - startY) / remaining;
        const speed = Math.hypot(speedX, speedY);
        const slopeRadians = this.slope * 0.02454369260617026;
        const speedZ = -speed * Math.tan(slopeRadians);
        const accelerationZ =
            (2 * (this.targetZ - startZ - speedZ * remaining)) / (remaining * remaining);

        const steps = Math.ceil(remaining);
        for (let t = 0; t <= steps; t++) {
            const x = startX + speedX * t;
            const y = startY + speedY * t;
            const z = startZ + speedZ * t + 0.5 * accelerationZ * t * t;
            out.push({ t, x, y, z });
        }
        return out;
    }
}
