import { mat4, vec3 } from "gl-matrix";

import { DEGREES_TO_RADIANS, RS_TO_RADIANS } from "../rs/MathConstants";
import { clamp } from "../common/utils/MathUtil";
import { Frustum } from "./Frustum";

export interface CameraView {
    position: vec3;
    pitch: number;
    yaw: number;
    orthoZoom: number;
}

export enum ProjectionType {
    PERSPECTIVE,
    ORTHO,
}

type CameraEasing = "linear" | "ease_in_out_sine" | "ease_out_cubic" | "ease_out_sine" | "ease_in_sine";
interface CameraTween {
    cycles: number;
    elapsed: number;
    easing: CameraEasing;
    start: vec3;
    ignoreTerrain?: boolean;
    packetHeight?: number;
    startHeight?: number;
    trackTarget?: boolean;
    angles?: { pitch: number; yaw: number; targetPitch: number; targetYaw: number };
    /** cam_moveto_arc: the tile centre the move swings around. */
    arc?: { cx: number; cz: number };
}
interface ScriptedCameraShot {
    target: vec3;
    rate: number;
    rate2: number;
    snapPending: boolean;
    tween?: CameraTween;
    heightAt?: (x: number, z: number) => number | undefined;
}

export class Camera {
    static moveCameraRotOrigin: vec3 = vec3.create();
    static deltaTemp: vec3 = vec3.create();
    private static readonly FOV_SCRIPT_BASE = 7;
    private static readonly FOV_SCRIPT_SCALE = 256;

    pos: vec3;
    readonly focalPoint: vec3 = vec3.create();

    setFocalPoint(x: number, y: number, z: number): void {
        vec3.set(this.focalPoint, x, y, z);
    }

    moveFocalPoint(x: number, y: number, z: number): void {
        const dx = x - this.focalPoint[0], dy = y - this.focalPoint[1], dz = z - this.focalPoint[2];
        this.setFocalPoint(x, y, z);
        this.snapToPosition(this.pos[0] + dx, this.pos[1] + dy, this.pos[2] + dz);
    }

    pitch: number;
    yaw: number;
    /** Bumped each time the angle is forced (snapToPitch/snapToYaw): a script or the server turned it. */
    forcedAngleChanges = 0;

    private targetPos: vec3;
    private targetPitch: number;
    private targetYaw: number;
    private scenePitchOverride: number | undefined;
    private viewPitchOverride: number | undefined;
    private renderPitchOverride: number | undefined;
    private viewZoomScale: number = 1;
    private scriptedMove?: ScriptedCameraShot;
    private scriptedLook?: ScriptedCameraShot;
    private scriptedCycleMs = 0;
    private scriptedPitchUnlocked = false;
    private scriptedHeights = { move: 0, look: 0 };

    private readonly positionMaxSpeedPerSec = 12; // tiles per second toward target
    private readonly positionSpringPerSec = 6; // proportional easing factor
    private readonly positionMinSpeedPerSec = 0.25; // ensures drift settles
    private readonly yawMaxSpeedPerSec = 2048 / 4; // full rotation in ~4 seconds
    private readonly yawMinSpeedPerSec = 10;
    private readonly pitchMaxSpeedPerSec = 192; // matches RS camera responsiveness
    private readonly pitchMinSpeedPerSec = 16;
    private readonly positionEpsilon = 1e-4;
    private readonly angleEpsilon = 1e-3;

    projectionType: ProjectionType = ProjectionType.PERSPECTIVE;

    orthoZoom: number = 15;

    // OSRS viewport parameters (script op defaults)
    private viewportFovLow: number = 256;
    private viewportFovHigh: number = 205;
    private viewportFovClampMin: number = 1;
    private viewportFovClampMax: number = 32767;
    private viewportZoomClampMin: number = 1;
    private viewportZoomClampMax: number = 32767;
    private viewportZoomHeightMin: number = 256;
    private viewportZoomHeightMax: number = 320;

    viewportZoom: number = 0;
    viewportWidth: number = 0;
    viewportHeight: number = 0;
    viewportXOffset: number = 0;
    viewportYOffset: number = 0;
    /**
     * Device pixels per OSRS viewport unit. Fixed mode's viewport is 512x334 units however
     * large it is drawn, so OSRS's viewport-size rules (FOV, zoom clamps) see that size and
     * the result is scaled up; 1 means the viewport is measured in device pixels.
     */
    private viewportUnitScaleX: number = 1;
    private viewportUnitScaleY: number = 1;
    private viewportAspect: number = 1;
    screenWidth: number = 0;
    screenHeight: number = 0;

    projectionMatrix: mat4 = mat4.create();
    cameraMatrix: mat4 = mat4.create();
    viewMatrix: mat4 = mat4.create();
    viewProjMatrix: mat4 = mat4.create();
    private viewportTransformMatrix: mat4 = mat4.create();

    frustum = new Frustum();

    updated: boolean = false;
    updatedPosition: boolean = false;
    updatedLastFrame: boolean = false;
    constructor(x: number, y: number, z: number, pitch: number, yaw: number) {
        this.pos = vec3.fromValues(x, y, z);
        this.pitch = pitch;
        this.yaw = yaw;
        this.targetPos = vec3.clone(this.pos);
        this.targetPitch = clamp(pitch, 0, 512);
        this.targetYaw = this.wrapYawInternal(yaw);
    }

    static scriptFovToScale(scriptValue: number): number {
        return Math.trunc(
            Math.pow(2, scriptValue / Camera.FOV_SCRIPT_SCALE + Camera.FOV_SCRIPT_BASE),
        );
    }

    static fovScaleToScriptValue(fovScale: number): number {
        return Math.trunc(
            (Math.log(fovScale) / Math.LN2 - Camera.FOV_SCRIPT_BASE) * Camera.FOV_SCRIPT_SCALE,
        );
    }

    static rawPitchToScenePitchAngle(rawPitch: number): number {
        const normalizedPitch = clamp(Number(rawPitch) || 0, 0, 512);
        return 128 + (normalizedPitch * 255) / 512;
    }

    snapToPosition(x?: number, y?: number, z?: number): void {
        if (x !== undefined) {
            this.pos[0] = x;
            this.targetPos[0] = x;
        }
        if (y !== undefined) {
            this.pos[1] = y;
            this.targetPos[1] = y;
        }
        if (z !== undefined) {
            this.pos[2] = z;
            this.targetPos[2] = z;
        }
        this.updated = true;
        this.updatedPosition = true;
    }

    setTargetPosition(x: number, y: number, z: number): void {
        this.targetPos[0] = x;
        this.targetPos[1] = y;
        this.targetPos[2] = z;
        this.updated = true;
    }

    resolveScriptedHeight(mode: "move" | "look", height: number, relative: boolean): number {
        return this.scriptedHeights[mode] = relative ? this.scriptedHeights[mode] + height : height;
    }

    setScriptedPosition(x: number, y: number, z: number, rate: number, rate2: number,
        heightAt?: (x: number, z: number) => number | undefined): void {
        if (!this.scriptedMove && !this.scriptedLook) this.setViewPitchOverride(undefined);
        const shot = this.scriptedMove = { target: vec3.fromValues(x, y, z), rate, rate2, heightAt, snapPending: rate2 >= 100 };
        const heightReady = this.refreshScriptedHeight(shot);
        if (shot.snapPending) {
            // Centre streaming on a cold scene without inventing its missing ground elevation.
            this.snapToPosition(x, heightReady ? shot.target[1] : this.pos[1], z);
            shot.snapPending = !heightReady;
        }
    }

    setScriptedLook(x: number, y: number, z: number, rate: number, rate2: number,
        heightAt?: (x: number, z: number) => number | undefined): void {
        if (!this.scriptedMove && !this.scriptedLook) this.setViewPitchOverride(undefined);
        const shot = this.scriptedLook = { target: vec3.fromValues(x, y, z), rate, rate2, heightAt, snapPending: rate2 >= 100 };
        if (this.refreshScriptedHeight(shot) && this.refreshScriptedHeight(this.scriptedMove) && !this.scriptedMove?.snapPending && shot.snapPending) this.advanceScriptedLook();
    }

    setScriptedPositionCycles(x: number, z: number, cycles: number, easing: CameraEasing, ignoreTerrain: boolean,
        heightAt: (x: number, z: number) => number | undefined, packetHeight: number): void {
        this.setScriptedPosition(x, this.pos[1], z, 0, 0, heightAt);
        this.scriptedMove!.tween = { cycles, elapsed: 0, easing, start: vec3.clone(this.pos), ignoreTerrain, packetHeight };
    }

    /** cam_moveto_arc: a timed move along the circle about (cx, cz), radius and height eased with it. */
    setScriptedPositionArc(cx: number, cz: number, x: number, z: number, cycles: number, easing: CameraEasing,
                           heightAt: (x: number, z: number) => number | undefined, packetHeight: number, ignoreTerrain = true): void {
        this.setScriptedPositionCycles(x, z, cycles, easing, ignoreTerrain, heightAt, packetHeight);
        this.scriptedMove!.tween!.arc = { cx, cz };
    }

    setScriptedLookCycles(x: number, z: number, cycles: number, easing: CameraEasing, trackTarget: boolean,
        heightAt: (x: number, z: number) => number | undefined): void {
        this.setScriptedLook(x, this.pos[1], z, 0, 0, heightAt);
        const shot = this.scriptedLook!;
        shot.tween = { cycles, elapsed: 0, easing, start: vec3.clone(this.pos), trackTarget };
        if (this.refreshScriptedHeight(shot)) this.advanceScriptedLook();
    }

    /**
     * cam_rotateby: turns the view by a yaw delta (2048 units a turn) over client cycles. A
     * scripted look keeps its distance and turns its target about the camera.
     */
    // ponytail: yaw only; every captured cam_rotateby has pitch 0. Add pitch when one doesn't.
    rotateScriptedBy(_pitch: number, yaw: number, cycles: number, easing: CameraEasing): void {
        const look = this.scriptedLook;
        if (!look) {
            this.setTargetYaw(this.wrapYawInternal(this.yaw + yaw));
            return;
        }
        const dx = look.target[0] - this.pos[0], dz = look.target[2] - this.pos[2];
        const radius = Math.hypot(dx, dz), angle = Math.atan2(dx, dz) + (yaw * Math.PI) / 1024;
        look.target[0] = Math.round((this.pos[0] + radius * Math.sin(angle)) * 128) / 128;
        look.target[2] = Math.round((this.pos[2] + radius * Math.cos(angle)) * 128) / 128;
        look.snapPending = false;
        look.tween = { cycles: Math.max(1, cycles), elapsed: 0, easing, start: vec3.clone(this.pos) };
        if (this.refreshScriptedHeight(look)) this.advanceScriptedLook();
    }

    private tweenProgress(tween: CameraTween): number {
        const progress = Math.min(1, tween.elapsed / Math.max(1, tween.cycles));
        if (tween.easing === "ease_in_out_sine") return (1 - Math.cos(Math.PI * progress)) / 2;
        if (tween.easing === "ease_out_cubic") return 1 - Math.pow(1 - progress, 3);
        if (tween.easing === "ease_out_sine") return Math.sin((Math.PI * progress) / 2);
        if (tween.easing === "ease_in_sine") return 1 - Math.cos((Math.PI * progress) / 2);
        return progress;
    }

    private refreshScriptedHeight(shot: ScriptedCameraShot | undefined): boolean {
        if (!shot?.heightAt) return true;
        const height = shot.heightAt(shot.target[0], shot.target[2]);
        if (height === undefined || !Number.isFinite(height)) return false;
        shot.target[1] = height;
        return true;
    }

    setScriptedPitchUnlocked(unlock: boolean): void {
        this.scriptedPitchUnlocked = unlock;
    }

    translateScriptedCamera(dx: number, dz: number): void {
        this.snapToPosition(this.pos[0] + dx, this.pos[1], this.pos[2] + dz);
        for (const shot of [this.scriptedMove, this.scriptedLook]) {
            if (shot) {
                shot.target[0] += dx; shot.target[2] += dz;
                if (shot.tween) { shot.tween.start[0] += dx; shot.tween.start[2] += dz; }
            }
        }
    }

    clearScriptedCamera(): void {
        const wasScripted = this.scriptedMove || this.scriptedLook;
        this.scriptedMove = this.scriptedLook = undefined;
        this.scriptedCycleMs = 0;
        this.scriptedPitchUnlocked = false;
        this.scriptedHeights = { move: 0, look: 0 };
        if (wasScripted) {
            this.snapToPosition(this.pos[0], this.pos[1], this.pos[2]);
            this.snapToYaw(this.yaw);
        }
    }

    private scriptedStep(current: number, target: number, rate: number, rate2: number): number {
        const distance = Math.abs(target - current);
        return current + Math.sign(target - current) * Math.min(distance, Math.trunc(distance * rate2 / 1000) + rate);
    }

    private advanceScriptedLook(): void {
        const look = this.scriptedLook;
        if (!look) return;
        const dx = Math.trunc((look.target[0] - this.pos[0]) * 128);
        const dy = Math.trunc((look.target[1] - this.pos[1]) * 128);
        const dz = Math.trunc((look.target[2] - this.pos[2]) * 128);
        const horizontal = Math.trunc(Math.hypot(dx, dz));
        const angleScale = 325.9490051269531;
        let pitch = Math.trunc(Math.atan2(dy, horizontal) * angleScale) & 2047;
        if (this.scriptedPitchUnlocked) {
            if (pitch > 1024) pitch -= 2048;
        } else pitch = clamp(pitch, 128, 383);
        const yaw = Math.trunc(Math.atan2(dx, dz) * angleScale) & 2047;
        if (look.tween) {
            const tween = look.tween;
            const angles = tween.angles ??= { pitch: this.getScenePitchAngle(), yaw: this.yaw, targetPitch: pitch, targetYaw: yaw };
            if (tween.trackTarget) { angles.targetPitch = pitch; angles.targetYaw = yaw; }
            const progress = this.tweenProgress(tween);
            this.viewPitchOverride = Math.round(angles.pitch + (angles.targetPitch - angles.pitch) * progress);
            this.snapToYaw(Math.round(angles.yaw + this.normalizeYawDelta(angles.targetYaw - angles.yaw) * progress));
        } else if (look.snapPending) {
            this.viewPitchOverride = pitch;
            this.snapToYaw(yaw);
        } else {
            this.viewPitchOverride = this.scriptedStep(Math.trunc(this.getScenePitchAngle()), pitch, look.rate, look.rate2);
            const delta = this.normalizeYawDelta(yaw - Math.trunc(this.yaw));
            this.snapToYaw(this.scriptedStep(Math.trunc(this.yaw), Math.trunc(this.yaw) + delta, look.rate, look.rate2));
        }
        look.snapPending = false;
        this.updated = true;
    }

    private advanceScriptedCamera(deltaTimeMs: number): void {
        const move = this.scriptedMove, look = this.scriptedLook;
        const moveReady = this.refreshScriptedHeight(move), lookReady = this.refreshScriptedHeight(look);
        if (!moveReady || !lookReady) { this.scriptedCycleMs = 0; return; }
        if (move?.snapPending) {
            this.snapToPosition(move.target[0], move.target[1], move.target[2]);
            move.snapPending = false;
        }
        if (look?.snapPending) this.advanceScriptedLook();
        // OSRS applies the constant + proportional rates in integer fine units every 20ms.
        this.scriptedCycleMs += Math.max(0, deltaTimeMs);
        while (this.scriptedCycleMs >= 20) {
            this.scriptedCycleMs -= 20;
            if (move) {
                const tween = move.tween;
                if (tween) {
                    // Terrain-aware pans interpolate height above the ground at each tile.
                    if (!tween.ignoreTerrain && tween.startHeight === undefined) {
                        const startY = move.heightAt?.(tween.start[0], tween.start[2]);
                        if (startY === undefined) return;
                        tween.startHeight = (startY - tween.start[1]) * 128 + (tween.packetHeight ?? 0);
                    }
                    const nextElapsed = Math.min(tween.cycles, tween.elapsed + 1);
                    const previousElapsed = tween.elapsed;
                    tween.elapsed = nextElapsed;
                    const progress = this.tweenProgress(tween);
                    const position = vec3.clone(this.pos);
                    for (let axis = 0; axis < 3; axis++) position[axis] = Math.round((tween.start[axis] + (move.target[axis] - tween.start[axis]) * progress) * 128) / 128;
                    if (tween.arc) {
                        const { cx, cz } = tween.arc;
                        const startAngle = Math.atan2(tween.start[2] - cz, tween.start[0] - cx);
                        let turn = Math.atan2(move.target[2] - cz, move.target[0] - cx) - startAngle;
                        if (turn > Math.PI) turn -= 2 * Math.PI;
                        else if (turn < -Math.PI) turn += 2 * Math.PI;
                        const startRadius = Math.hypot(tween.start[0] - cx, tween.start[2] - cz);
                        const radius = startRadius + (Math.hypot(move.target[0] - cx, move.target[2] - cz) - startRadius) * progress;
                        const angle = startAngle + turn * progress;
                        position[0] = Math.round((cx + Math.cos(angle) * radius) * 128) / 128;
                        position[2] = Math.round((cz + Math.sin(angle) * radius) * 128) / 128;
                    }
                    if (!tween.ignoreTerrain) {
                        const ground = move.heightAt?.(position[0], position[2]);
                        if (ground === undefined) { tween.elapsed = previousElapsed; return; }
                        position[1] = ground + ((tween.packetHeight ?? 0) - (tween.startHeight! + ((tween.packetHeight ?? 0) - tween.startHeight!) * progress)) / 128;
                    }
                    vec3.copy(this.pos, position);
                } else for (let axis = 0; axis < 3; axis++) {
                    const current = Math.trunc(this.pos[axis] * 128), target = Math.trunc(move.target[axis] * 128);
                    this.pos[axis] = this.scriptedStep(current, target, move.rate, move.rate2) / 128;
                }
                vec3.copy(this.targetPos, this.pos);
                this.updatedPosition = this.updated = true;
            }
            if (look?.tween) look.tween.elapsed = Math.min(look.tween.cycles, look.tween.elapsed + 1);
            this.advanceScriptedLook();
        }
    }

    private wrapYawInternal(yaw: number): number {
        return ((yaw % 2048) + 2048) % 2048;
    }

    private normalizeYawDelta(delta: number): number {
        let normalized = delta % 2048;
        if (normalized > 1024) {
            normalized -= 2048;
        } else if (normalized < -1024) {
            normalized += 2048;
        }
        return normalized;
    }

    getControlPitchAngle(): number {
        return Camera.rawPitchToScenePitchAngle(this.pitch);
    }

    getScenePitchAngle(): number {
        return this.renderPitchOverride ?? this.viewPitchOverride ?? this.scenePitchOverride ?? this.getControlPitchAngle();
    }

    setRenderPitchOverride(pitch: number | undefined): void {
        this.renderPitchOverride = pitch;
        this.updated = true;
    }

    getScenePitchOverride(): number | undefined {
        return this.scenePitchOverride;
    }

    setScenePitchOverride(pitch: number | undefined): void {
        this.scenePitchOverride =
            pitch === undefined ? undefined : clamp(pitch, 0, 512);
        this.updated = true;
    }

    getViewPitchOverride(): number | undefined {
        return this.viewPitchOverride;
    }

    setViewPitchOverride(pitch: number | undefined): void {
        this.viewPitchOverride =
            pitch === undefined ? undefined : clamp(pitch, -480, 480);
        this.updated = true;
    }

    getViewZoomScale(): number {
        return this.viewZoomScale;
    }

    setViewportUnitScale(scaleX: number, scaleY: number): void {
        const x = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
        const y = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
        if (x === this.viewportUnitScaleX && y === this.viewportUnitScaleY) return;
        this.viewportUnitScaleX = x;
        this.viewportUnitScaleY = y;
        this.updated = true;
    }

    setViewZoomScale(scale: number): void {
        this.viewZoomScale = clamp(scale, 0.5, 2);
        this.updated = true;
    }

    getScenePitchRadians(): number {
        return -this.getScenePitchAngle() * RS_TO_RADIANS;
    }

    setTargetYaw(yaw: number): void {
        this.targetYaw = this.wrapYawInternal(yaw);
        this.updated = true;
    }

    setTargetPitch(pitch: number): void {
        this.targetPitch = clamp(pitch, 0, 512);
        this.updated = true;
    }

    snapToPitch(pitch: number): void {
        this.forcedAngleChanges++;
        this.targetPitch = clamp(pitch, 0, 512);
        this.pitch = this.targetPitch;
        this.updated = true;
    }

    snapToYaw(yaw: number): void {
        this.forcedAngleChanges++;
        const wrapped = this.wrapYawInternal(yaw);
        this.targetYaw = wrapped;
        this.yaw = this.targetYaw;
        this.updated = true;
    }

    setProjectionType(type: ProjectionType) {
        this.projectionType = type;
        this.updated = true;
    }

    applySmoothing(deltaTimeMs: number): void {
        if (!Number.isFinite(deltaTimeMs)) {
            return;
        }
        if (this.scriptedMove || this.scriptedLook) {
            this.advanceScriptedCamera(deltaTimeMs);
            return;
        }
        const dt = Math.max(0, deltaTimeMs) / 1000;
        if (dt === 0) {
            this.alignToTargetsIfClose();
            return;
        }

        let didUpdate = false;
        let movedPosition = false;

        for (let i = 0; i < 3; i++) {
            const diff = this.targetPos[i] - this.pos[i];
            const absDiff = Math.abs(diff);
            if (absDiff <= this.positionEpsilon) {
                this.pos[i] = this.targetPos[i];
                continue;
            }
            const spring = absDiff * this.positionSpringPerSec * dt;
            const speedCap = this.positionMaxSpeedPerSec * dt;
            const minStep = this.positionMinSpeedPerSec * dt;
            let step = spring + minStep;
            step = Math.min(step, speedCap > 0 ? speedCap : step);
            step = Math.min(step, absDiff);
            if (step <= this.positionEpsilon) {
                this.pos[i] = this.targetPos[i];
                continue;
            }
            const delta = Math.sign(diff) * step;
            this.pos[i] += delta;
            if (Math.abs(this.targetPos[i] - this.pos[i]) <= this.positionEpsilon) {
                this.pos[i] = this.targetPos[i];
            }
            movedPosition = true;
            didUpdate = true;
        }

        if (movedPosition) {
            this.updatedPosition = true;
        }

        const pitchDiff = this.targetPitch - this.pitch;
        const pitchAbs = Math.abs(pitchDiff);
        if (pitchAbs > this.angleEpsilon) {
            const speedCap = this.pitchMaxSpeedPerSec * dt;
            const minStep = this.pitchMinSpeedPerSec * dt;
            let step = Math.min(pitchAbs, speedCap > 0 ? speedCap : pitchAbs);
            if (step < minStep && pitchAbs > this.angleEpsilon) {
                step = Math.min(pitchAbs, minStep);
            }
            const delta = Math.sign(pitchDiff) * step;
            this.pitch = clamp(this.pitch + delta, 0, 512);
            if (Math.abs(this.targetPitch - this.pitch) <= this.angleEpsilon) {
                this.pitch = this.targetPitch;
            }
            didUpdate = true;
        } else {
            this.pitch = this.targetPitch;
        }

        const yawDiff = this.normalizeYawDelta(this.targetYaw - this.yaw);
        const yawAbs = Math.abs(yawDiff);
        if (yawAbs > this.angleEpsilon) {
            const speedCap = this.yawMaxSpeedPerSec * dt;
            const minStep = this.yawMinSpeedPerSec * dt;
            let step = Math.min(yawAbs, speedCap > 0 ? speedCap : yawAbs);
            if (step < minStep && yawAbs > this.angleEpsilon) {
                step = Math.min(yawAbs, minStep);
            }
            const delta = Math.sign(yawDiff) * step;
            this.yaw = this.wrapYawInternal(this.yaw + delta);
            if (Math.abs(this.normalizeYawDelta(this.targetYaw - this.yaw)) <= this.angleEpsilon) {
                this.yaw = this.wrapYawInternal(this.targetYaw);
            }
            didUpdate = true;
        } else {
            this.yaw = this.wrapYawInternal(this.targetYaw);
        }

        if (didUpdate) {
            this.updated = true;
        }
    }

    move(deltaX: number, deltaY: number, deltaZ: number, rotatePitch: boolean = false): void {
        Camera.deltaTemp[0] = deltaX;
        Camera.deltaTemp[1] = deltaY;
        Camera.deltaTemp[2] = deltaZ;

        if (rotatePitch) {
            vec3.rotateX(
                Camera.deltaTemp,
                Camera.deltaTemp,
                Camera.moveCameraRotOrigin,
                -this.getScenePitchRadians(),
            );
        }
        vec3.rotateY(
            Camera.deltaTemp,
            Camera.deltaTemp,
            Camera.moveCameraRotOrigin,
            (this.yaw - 1024) * RS_TO_RADIANS,
        );

        vec3.add(this.focalPoint, this.focalPoint, Camera.deltaTemp);
        vec3.add(this.pos, this.pos, Camera.deltaTemp);
        vec3.copy(this.targetPos, this.pos);
        this.updated = true;
        this.updatedPosition = true;
    }

    updatePitch(_pitch: number, deltaPitch: number): void {
        // Positive-down pitch in RS units: 0 (level) .. 512 (≈90° down)
        const next = clamp(this.targetPitch + deltaPitch, 0, 512);
        this.pitch = next;
        this.targetPitch = next;
        this.updated = true;
    }

    getYaw(): number {
        // Return normalized yaw in RS units [0, 2048) as integer for debug/UI
        return (((this.yaw % 2048) + 2048) % 2048) & 2047;
    }

    setYaw(yaw: number): void {
        // Keep yaw numerically stable by wrapping into [0, 2048)
        const wrapped = this.wrapYawInternal(yaw);
        this.yaw = wrapped;
        this.setTargetYaw(wrapped);
    }

    updateYaw(_yaw: number, deltaYaw: number): void {
        const next = this.wrapYawInternal(this.targetYaw + deltaYaw);
        this.yaw = next;
        this.targetYaw = next;
        this.updated = true;
    }

    update(
        screenWidth: number,
        screenHeight: number,
        viewportX: number = 0,
        viewportY: number = 0,
        viewportWidth: number = screenWidth,
        viewportHeight: number = screenHeight,
    ) {
        this.screenWidth = Math.max(1, screenWidth | 0);
        this.screenHeight = Math.max(1, screenHeight | 0);

        const viewportMetrics = this.computeOsrsViewportForSize(viewportWidth, viewportHeight);
        this.viewportZoom = viewportMetrics.viewportZoom;
        this.viewportWidth = viewportMetrics.viewportWidth;
        this.viewportHeight = viewportMetrics.viewportHeight;
        this.viewportXOffset = (viewportX | 0) + viewportMetrics.viewportXOffset;
        this.viewportYOffset = (viewportY | 0) + viewportMetrics.viewportYOffset;
        this.viewportAspect = viewportMetrics.aspect;

        // Projection
        mat4.identity(this.projectionMatrix);
        if (this.projectionType === ProjectionType.PERSPECTIVE) {
            const fovY =
                2 * Math.atan(this.viewportHeight / (2 * this.viewportZoom * this.viewZoomScale));
            const aspect = this.viewportAspect;
            mat4.perspective(this.projectionMatrix, fovY, aspect, 0.1, 1024.0 * 4);
        } else {
            mat4.ortho(
                this.projectionMatrix,
                -this.viewportWidth / this.orthoZoom,
                this.viewportWidth / this.orthoZoom,
                -this.viewportHeight / this.orthoZoom,
                this.viewportHeight / this.orthoZoom,
                -1024.0 * 4,
                1024.0 * 4,
            );
        }
        this.applyViewportTransform();

        // View
        const pitch = this.getScenePitchRadians();
        const yaw = (this.yaw - 1024) * RS_TO_RADIANS;

        mat4.identity(this.cameraMatrix);

        mat4.translate(this.cameraMatrix, this.cameraMatrix, this.pos);
        mat4.rotateY(this.cameraMatrix, this.cameraMatrix, yaw);
        mat4.rotateZ(this.cameraMatrix, this.cameraMatrix, 180 * DEGREES_TO_RADIANS); // Roll
        mat4.rotateX(this.cameraMatrix, this.cameraMatrix, pitch);

        mat4.invert(this.viewMatrix, this.cameraMatrix);

        // Calculate view projection matrix
        mat4.multiply(this.viewProjMatrix, this.projectionMatrix, this.viewMatrix);

        this.frustum.setPlanes(this.viewProjMatrix);
    }

    computeViewportZoomForSize(width: number, height: number): number {
        const { viewportZoom } = this.computeOsrsViewportForSize(width, height);
        return Math.max(1, viewportZoom | 0);
    }

    computeViewportMetricsForSize(
        width: number,
        height: number,
    ): {
        viewportZoom: number;
        viewportWidth: number;
        viewportHeight: number;
        /** The effective height in OSRS viewport units, for OSRS's own viewport-size rules. */
        unitViewportHeight: number;
    } {
        const { viewportZoom, viewportWidth, viewportHeight, unitViewportHeight } =
            this.computeOsrsViewportForSize(width, height);
        return {
            viewportZoom: Math.max(1, viewportZoom | 0),
            viewportWidth: Math.max(1, viewportWidth | 0),
            viewportHeight: Math.max(1, viewportHeight | 0),
            unitViewportHeight,
        };
    }

    getViewportFovValues(): { low: number; high: number } {
        return {
            low: Camera.fovScaleToScriptValue(this.viewportFovLow),
            high: Camera.fovScaleToScriptValue(this.viewportFovHigh),
        };
    }

    setViewportFovValues(low: number, high: number): void {
        const nextLow = Camera.scriptFovToScale(low | 0);
        const nextHigh = Camera.scriptFovToScale(high | 0);
        this.viewportFovLow = nextLow > 0 ? nextLow : 256;
        this.viewportFovHigh = nextHigh > 0 ? nextHigh : 256;
        this.updated = true;
    }

    getViewportZoomRange(): { min: number; max: number } {
        return {
            min: this.viewportZoomHeightMin | 0,
            max: this.viewportZoomHeightMax | 0,
        };
    }

    setViewportZoomRange(min: number, max: number): void {
        this.viewportZoomHeightMin = min > 0 ? min | 0 : 256;
        this.viewportZoomHeightMax = max > 0 ? max | 0 : 320;
        this.updated = true;
    }

    containsScreenPoint(x: number, y: number): boolean {
        const viewportWidth = this.viewportWidth | 0;
        const viewportHeight = this.viewportHeight | 0;
        if (viewportWidth <= 0 || viewportHeight <= 0) {
            return false;
        }

        const viewportX = this.viewportXOffset | 0;
        const viewportY = this.viewportYOffset | 0;
        return (
            x >= viewportX &&
            y >= viewportY &&
            x < viewportX + viewportWidth &&
            y < viewportY + viewportHeight
        );
    }

    private computeOsrsViewportForSize(width: number, height: number) {
        const unitX = this.viewportUnitScaleX;
        const unitY = this.viewportUnitScaleY;
        let viewportWidth = Math.max(1, Math.round(width / unitX));
        let viewportHeight = Math.max(1, Math.round(height / unitY));
        let viewportXOffset = 0;
        let viewportYOffset = 0;

        const diff = viewportHeight - 334;
        let fovScale: number;
        if (diff < 0) {
            fovScale = this.viewportFovLow;
        } else if (diff >= 100) {
            fovScale = this.viewportFovHigh;
        } else {
            fovScale =
                ((this.viewportFovHigh - this.viewportFovLow) * diff) / 100 + this.viewportFovLow;
        }

        const zoomRatio = (viewportHeight * fovScale * 512) / (viewportWidth * 334);

        if (zoomRatio < this.viewportZoomClampMin) {
            const clamp = this.viewportZoomClampMin;
            fovScale = (clamp * viewportWidth * 334) / (viewportHeight * 512);
            if (fovScale > this.viewportFovClampMax) {
                fovScale = this.viewportFovClampMax;
                const scaledWidth = (viewportHeight * fovScale * 512) / (clamp * 334);
                const gutter = Math.max(0, Math.trunc((viewportWidth - scaledWidth) / 2));
                viewportXOffset += gutter;
                viewportWidth -= gutter * 2;
            }
        } else if (zoomRatio > this.viewportZoomClampMax) {
            const clamp = this.viewportZoomClampMax;
            fovScale = (clamp * viewportWidth * 334) / (viewportHeight * 512);
            if (fovScale < this.viewportFovClampMin) {
                fovScale = this.viewportFovClampMin;
                const scaledHeight = (clamp * viewportWidth * 334) / (fovScale * 512);
                const gutter = Math.max(0, Math.trunc((viewportHeight - scaledHeight) / 2));
                viewportYOffset += gutter;
                viewportHeight -= gutter * 2;
            }
        }

        viewportWidth = Math.max(1, viewportWidth | 0);
        viewportHeight = Math.max(1, viewportHeight | 0);
        // Client.viewportZoom is an integer (var3 * var6 / 334).
        const viewportZoom = ((viewportHeight * fovScale) / 334) | 0;

        // Back to device pixels; the aspect stays the unit one, so a viewport stretched
        // unevenly shows the same scene stretched rather than more of it.
        return {
            viewportZoom: (viewportZoom * unitY) | 0,
            viewportWidth: Math.max(1, Math.round(viewportWidth * unitX)),
            viewportHeight: Math.max(1, Math.round(viewportHeight * unitY)),
            viewportXOffset: Math.round(viewportXOffset * unitX),
            viewportYOffset: Math.round(viewportYOffset * unitY),
            unitViewportHeight: viewportHeight,
            aspect: viewportWidth / viewportHeight,
        };
    }

    onFrameEnd() {
        this.updatedLastFrame = this.updated;
        this.updated = false;
        this.updatedPosition = false;
    }

    private alignToTargetsIfClose(): void {
        for (let i = 0; i < 3; i++) {
            if (Math.abs(this.targetPos[i] - this.pos[i]) <= this.positionEpsilon) {
                this.pos[i] = this.targetPos[i];
            }
        }
        if (Math.abs(this.targetPitch - this.pitch) <= this.angleEpsilon) {
            this.pitch = this.targetPitch;
        }
        if (Math.abs(this.normalizeYawDelta(this.targetYaw - this.yaw)) <= this.angleEpsilon) {
            this.yaw = this.wrapYawInternal(this.targetYaw);
        }
    }

    getPosX(): number {
        return this.pos[0];
    }

    getPosY(): number {
        return this.pos[1];
    }

    getPosZ(): number {
        return this.pos[2];
    }

    getMapX(): number {
        return this.getPosX() >> 6;
    }

    getMapY(): number {
        return this.getPosZ() >> 6;
    }

    getTargetYaw(): number { return this.targetYaw; }
    getTargetPitch(): number { return this.targetPitch; }

    getTargetPos(): vec3 {
        return this.targetPos;
    }

    /**
     * Set the FOV and zoom clamp values for viewport calculations.
     * Called by VIEWPORT_CLAMPFOV CS2 opcode.
     * Values of 0 indicate no clamping (use defaults).
     */
    setClampFov(
        fovClampMin: number,
        fovClampMax: number,
        zoomClampMin: number,
        zoomClampMax: number,
    ): void {
        // If all values are 0, reset to defaults (no clamping)
        if (fovClampMin === 0 && fovClampMax === 0 && zoomClampMin === 0 && zoomClampMax === 0) {
            this.viewportFovClampMin = 1;
            this.viewportFovClampMax = 32767;
            this.viewportZoomClampMin = 1;
            this.viewportZoomClampMax = 32767;
        } else {
            this.viewportFovClampMin = fovClampMin;
            this.viewportFovClampMax = fovClampMax;
            this.viewportZoomClampMin = zoomClampMin;
            this.viewportZoomClampMax = zoomClampMax;
        }
        this.updated = true;
    }

    private applyViewportTransform(): void {
        const screenWidth = Math.max(1, this.screenWidth | 0);
        const screenHeight = Math.max(1, this.screenHeight | 0);
        const viewportWidth = Math.max(1, this.viewportWidth | 0);
        const viewportHeight = Math.max(1, this.viewportHeight | 0);
        const viewportX = this.viewportXOffset | 0;
        const viewportY = this.viewportYOffset | 0;

        const scaleX = viewportWidth / screenWidth;
        const scaleY = viewportHeight / screenHeight;
        const translateX = (2 * viewportX + viewportWidth) / screenWidth - 1;
        const translateY = 1 - (2 * viewportY + viewportHeight) / screenHeight;

        mat4.set(
            this.viewportTransformMatrix,
            scaleX,
            0,
            0,
            0,
            0,
            scaleY,
            0,
            0,
            0,
            0,
            1,
            0,
            translateX,
            translateY,
            0,
            1,
        );
        mat4.multiply(this.projectionMatrix, this.viewportTransformMatrix, this.projectionMatrix);
    }
}
