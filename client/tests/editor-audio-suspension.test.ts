// STAGED, UNEXECUTED: this notes path is NOT directly executable.
// Intended destination: client/tests/editor-audio-suspension.test.ts.
// The import below deliberately targets that destination, not a private overlay.
import assert from "node:assert/strict";
import { registerManagedAudioContext, unregisterManagedAudioContext, setAudioSuspended, resumeAudioContextIfNeeded } from "../game/audio/audioContext";

assert.equal(typeof document, "undefined", "this API fixture requires an isolated Node process without document");
assert.equal(typeof window, "undefined", "this API fixture requires an isolated Node process without window");

function context() {
    return {
        state: "running",
        suspend() { this.state = "suspended"; return Promise.resolve(); },
        resume() { this.state = "running"; return Promise.resolve(); },
    };
}
const existing = context();
const late = context();
try {
    registerManagedAudioContext(existing as AudioContext);
    setAudioSuspended(true);
    registerManagedAudioContext(late as AudioContext);
    for (const ctx of [existing, late]) {
        resumeAudioContextIfNeeded(ctx as AudioContext);
        assert.equal(ctx.state, "suspended", "editor gestures must not resume existing or newly created audio");
    }
    setAudioSuspended(false);
    for (const ctx of [existing, late]) {
        assert.equal(ctx.state, "running", "leaving the editor restores audio");
    }
} finally {
    unregisterManagedAudioContext(existing as AudioContext);
    unregisterManagedAudioContext(late as AudioContext);
    setAudioSuspended(false);
}

// A bounded Web Audio API model, not browser playback. State is the control-thread
// state; an allowed resume changes it synchronously, before promise settlement.
// Source start only records the spec-eligible queued rendering request:
// https://www.w3.org/TR/2021/REC-webaudio-20210617/#dom-audioscheduledsourcenode-start
type ControlState = "suspended" | "running" | "interrupted" | "closed";
class ContextModel {
    private controlState: ControlState = "suspended";
    private allowedToStart = false;
    private suspendedByUser = false;
    private pendingResume: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
    private controls: Array<{ kind: "resume" | "suspend"; resolve?: () => void }> = [];
    resumeCalls = 0;
    suspendCalls = 0;
    sourceStartRequests = 0;

    get state(): ControlState { return this.controlState; }
    get userSuspended(): boolean { return this.suspendedByUser; }
    get pendingResumeCount(): number { return this.pendingResume.length; }
    asAudioContext(): AudioContext { return this as unknown as AudioContext; }

    // Explicit policy precondition, not a simulated native activation event.
    allowStart(): void { this.allowedToStart = true; }

    resume(): Promise<void> {
        this.resumeCalls++;
        if (this.controlState === "closed") return Promise.reject(new Error("closed"));
        this.suspendedByUser = false;
        const promise = new Promise<void>((resolve, reject) => this.pendingResume.push({ resolve, reject }));
        if (!this.allowedToStart) return promise;
        this.controlState = "running";
        this.controls.push({ kind: "resume" });
        return promise;
    }

    suspend(): Promise<void> {
        this.suspendCalls++;
        if (this.controlState === "closed") return Promise.reject(new Error("closed"));
        this.suspendedByUser = true;
        this.controlState = "suspended";
        return new Promise<void>((resolve) => this.controls.push({ kind: "suspend", resolve }));
    }

    requestSourceStart(): void {
        assert.notEqual(this.controlState, "closed", "source-start model requires a live context");
        if (this.controlState === "suspended" && this.allowedToStart && !this.suspendedByUser) {
            this.sourceStartRequests++;
        }
        // No invented synchronous state change or audible-output assertion.
    }

    // Complete the API operations queued by resume/suspend; no timers or clocks.
    // Source-start requests are observations only and are not executed by this model.
    completeControls(): void {
        for (const control of this.controls.splice(0)) {
            if (control.kind === "suspend") control.resolve?.();
            else for (const pending of this.pendingResume.splice(0)) pending.resolve();
        }
    }

    interrupt(): void {
        assert.equal(this.controlState, "running", "interruption requires a previously running context");
        this.controlState = "interrupted";
    }

    close(): Promise<void> {
        this.controlState = "closed";
        for (const pending of this.pendingResume.splice(0)) pending.reject(new Error("closed"));
        for (const control of this.controls.splice(0)) control.resolve?.();
        return Promise.resolve();
    }
}

async function managed(run: (ctx: ContextModel) => Promise<void> | void): Promise<void> {
    const ctx = new ContextModel();
    registerManagedAudioContext(ctx.asAudioContext());
    try {
        await run(ctx);
    } finally {
        unregisterManagedAudioContext(ctx.asAudioContext());
        setAudioSuspended(false);
        await ctx.close();
    }
}

async function main(): Promise<void> {
    // Positive: the same lawful policy transition allows an unmuted initial context
    // to request rendering. A blocked resume does not authorize fake settlement.
    await managed((ctx) => {
        assert.equal(ctx.state, "suspended");
        assert.equal(ctx.userSuspended, false);
        resumeAudioContextIfNeeded(ctx.asAudioContext());
        assert.equal(ctx.pendingResumeCount, 1);
        assert.equal(ctx.state, "suspended", "disallowed resume remains suspended");
        ctx.allowStart();
        ctx.requestSourceStart();
        assert.equal(ctx.sourceStartRequests, 1, "unmuted positive has eligible source-start preconditions");
        assert.equal(ctx.state, "suspended", "recording a source request does not fabricate a public transition");
    });

    // A manually suspended existing context has no helper resume intent to restore.
    await managed(async (ctx) => {
        ctx.allowStart();
        const suspended = ctx.suspend();
        ctx.completeControls();
        await suspended;
        setAudioSuspended(true);
        setAudioSuspended(false);
        assert.equal(ctx.resumeCalls, 0, "unmute must not acquire manual suspension ownership");
        assert.equal(ctx.state, "suspended");
        assert.equal(ctx.userSuspended, true);
    });

    // Existing running/interrupted contexts remain the ordinary auto-resume owners.
    for (const interrupted of [false, true]) {
        await managed(async (ctx) => {
            ctx.allowStart();
            const running = ctx.resume();
            assert.equal(ctx.state, "running", "allowed resume updates public state synchronously");
            ctx.completeControls();
            await running;
            if (interrupted) ctx.interrupt();
            setAudioSuspended(true);
            assert.equal(ctx.userSuspended, true);
            ctx.completeControls();
            setAudioSuspended(false);
            assert.equal(ctx.state, "running");
            assert.equal(ctx.resumeCalls, 2);
            ctx.completeControls();
        });
    }

    // Registration during mute already requests browser suspension. Keep its
    // existing restoration rule; this is not the failing existing-context branch.
    setAudioSuspended(true);
    await managed((ctx) => {
        assert.equal(ctx.suspendCalls, 1);
        assert.equal(ctx.userSuspended, true);
        ctx.allowStart();
        ctx.requestSourceStart();
        assert.equal(ctx.sourceStartRequests, 0);
        ctx.completeControls();
        setAudioSuspended(false);
        assert.equal(ctx.state, "running");
        ctx.completeControls();
    });

    // Removal and closure independently prevent auto-resume, as does both together.
    for (const release of ["unregister", "close", "both"] as const) {
      await managed(async (ctx) => {
        ctx.allowStart();
        const running = ctx.resume();
        ctx.completeControls();
        await running;
        setAudioSuspended(true);
        ctx.completeControls();
        if (release !== "close") unregisterManagedAudioContext(ctx.asAudioContext());
        if (release !== "unregister") await ctx.close();
        const resumes = ctx.resumeCalls;
        setAudioSuspended(false);
        assert.equal(ctx.resumeCalls, resumes, `${release} must prevent automatic restoration`);
        if (release !== "unregister") {
            resumeAudioContextIfNeeded(ctx.asAudioContext());
            assert.equal(ctx.resumeCalls, resumes, "the resume helper must ignore a closed context");
        }
      });
    }

    // Intended first red on the baseline: an existing browser-blocked context is
    // globally muted before policy permits source start. Import the actual helper;
    // the model's source predicate knows nothing about the helper's global flag.
    await managed((ctx) => {
        assert.equal(ctx.state, "suspended");
        assert.equal(ctx.userSuspended, false);
        resumeAudioContextIfNeeded(ctx.asAudioContext());
        assert.equal(ctx.resumeCalls, 1);
        assert.equal(ctx.pendingResumeCount, 1);
        setAudioSuspended(true);
        assert.equal(ctx.state, "suspended");
        ctx.allowStart();
        ctx.requestSourceStart();
        assert.equal(ctx.sourceStartRequests, 0, "global suspension must prevent eligible source-start rendering requests");
        assert.equal(ctx.userSuspended, true, "global mute establishes browser suspension even for initial suspended state");
        ctx.completeControls();
        setAudioSuspended(false);
        assert.equal(ctx.resumeCalls, 2, "unmute restores preexisting helper resume intent despite its pending guard");
        assert.equal(ctx.state, "running");
        ctx.completeControls();
        assert.equal(ctx.pendingResumeCount, 0, "allowed resume completion settles the old blocked request too");
    });
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
