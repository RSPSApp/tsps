type AudioContextConstructor = {
    new (contextOptions?: AudioContextOptions): AudioContext;
};

/**
 * Events that can unlock/resume an AudioContext. On iOS WebKit only "activation-triggering"
 * events grant the user activation required by autoplay policy: keydown, mousedown,
 * pointerup (non-mouse) and touchend. Notably `touchstart` does NOT qualify, and `click`
 * never fires when a canvas handler calls preventDefault() on the touch events (as the
 * mobile login screen does). `touchstart`/`click` are kept for browsers where they work.
 */
const AUDIO_CONTEXT_RESUME_EVENTS: (keyof DocumentEventMap)[] = [
    "click",
    "keydown",
    "mousedown",
    "pointerup",
    "touchend",
    "touchstart",
];

/**
 * iOS WebKit reports a non-standard "interrupted" state when the system takes the audio
 * session away (app switch, phone call, Siri, screen lock). Such contexts must be resumed
 * exactly like suspended ones, and doing so requires a fresh user gesture.
 */
export function isAudioContextResumable(ctx: AudioContext): boolean {
    if (audioSuspended) return false;
    const state = ctx.state as string;
    return state === "suspended" || state === "interrupted";
}

/**
 * Contexts with a resume() still in flight. Until the page has user activation, resume() stays
 * pending, so callers that run every frame (ambient sounds) would pile up a promise per call.
 */
const pendingResumes = new WeakSet<AudioContext>();

/** Resume a context if it is suspended or (iOS) interrupted. Errors are ignored. */
export function resumeAudioContextIfNeeded(ctx: AudioContext): void {
    if (!isAudioContextResumable(ctx) || pendingResumes.has(ctx)) return;
    pendingResumes.add(ctx);
    ctx.resume()
        .catch(() => {})
        .finally(() => pendingResumes.delete(ctx));
}

/** One shared music graph — avoids N AudioContexts + forced 44.1→48 kHz resampling. */
let sharedMusicContext: AudioContext | null = null;
let sharedMusicResumeCleanup: (() => void) | null = null;
let sharedMusicWorkletPromise: Promise<void> | null = null;

/**
 * Page-lifecycle audio management.
 *
 * Web Audio contexts (especially AudioWorklet-driven ones) keep rendering audio while the
 * page is hidden or has been backgrounded/closed on mobile. On iOS WebKit the page is frozen
 * into the back/forward cache rather than torn down, so `dispose()`/`close()` never runs and
 * music keeps playing after the tab is closed. To prevent that we suspend every managed
 * context when the page becomes hidden (or is frozen/hidden via pagehide) and resume the ones
 * we auto-suspended when the page becomes visible again.
 */
const managedAudioContexts = new Set<AudioContext>();
let audioSuspended = false;

/** Temporarily silence every client audio context, including ones created later. */
export function setAudioSuspended(suspended: boolean): void {
    if (audioSuspended === suspended) return;
    audioSuspended = suspended;
    if (suspended) suspendManagedAudioContexts();
    else resumeAutoSuspendedAudioContexts();
}
const autoSuspendedAudioContexts = new Set<AudioContext>();
let audioLifecycleListenersInstalled = false;

function suspendManagedAudioContexts(): void {
    for (const ctx of managedAudioContexts) {
        const state = ctx.state as string;
        // suspend() on an iOS "interrupted" context transitions it to "suspended",
        // which keeps our bookkeeping consistent with what WebKit reports.
        if (state === "running" || state === "interrupted" || state === "suspended") {
            // A browser-blocked context also needs explicit suspension to prevent source
            // nodes from starting it. Restore only prior activity or helper resume intent,
            // without taking ownership of an existing manual suspension.
            if (state !== "suspended" || pendingResumes.has(ctx)) {
                autoSuspendedAudioContexts.add(ctx);
            }
            ctx.suspend().catch(() => {});
        }
    }
}

function resumeAutoSuspendedAudioContexts(): void {
    if (audioSuspended) return;
    for (const ctx of Array.from(autoSuspendedAudioContexts)) {
        autoSuspendedAudioContexts.delete(ctx);
        if (managedAudioContexts.has(ctx) && isAudioContextResumable(ctx)) {
            // Best effort: some browsers (iOS WebKit in particular) require a fresh user
            // gesture to resume. When resume is rejected, the persistent interaction
            // listeners added via addAudioContextResumeListeners recover on the next tap.
            ctx.resume().catch(() => {});
        }
    }
}

function installAudioLifecycleListenersOnce(): void {
    if (audioLifecycleListenersInstalled) return;
    if (typeof document === "undefined" || typeof window === "undefined") return;
    audioLifecycleListenersInstalled = true;

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            suspendManagedAudioContexts();
        } else if (document.visibilityState === "visible") {
            resumeAutoSuspendedAudioContexts();
        }
    });
    // `pagehide` covers tab close, navigation, and mobile backgrounding (incl. bfcache).
    window.addEventListener("pagehide", () => suspendManagedAudioContexts());
    // Page Lifecycle API (Chromium): fired when a backgrounded page is frozen / thawed.
    document.addEventListener("freeze", () => suspendManagedAudioContexts());
    document.addEventListener("resume", () => resumeAutoSuspendedAudioContexts());
}

/**
 * Register an AudioContext so it is automatically suspended when the page is hidden/closed and
 * resumed when the page becomes visible again. Safe to call multiple times with the same context.
 */
export function registerManagedAudioContext(ctx: AudioContext | null | undefined): void {
    if (!ctx) return;
    managedAudioContexts.add(ctx);
    installAudioLifecycleListenersOnce();
    if (audioSuspended) {
        autoSuspendedAudioContexts.add(ctx);
        ctx.suspend().catch(() => {});
    }
}

/** Stop managing a context (call when the context is being closed/disposed). */
export function unregisterManagedAudioContext(ctx: AudioContext | null | undefined): void {
    if (!ctx) return;
    managedAudioContexts.delete(ctx);
    autoSuspendedAudioContexts.delete(ctx);
}

export function getAudioContextConstructor(): AudioContextConstructor | undefined {
    if (typeof window === "undefined") {
        return undefined;
    }

    return window.AudioContext ?? window.webkitAudioContext;
}

/**
 * Install persistent user-gesture listeners that resume the given context.
 *
 * The listeners intentionally stay armed after the first successful resume: iOS WebKit
 * re-locks contexts (state "interrupted"/"suspended") whenever the user switches apps,
 * takes a call, or locks the screen, and each recovery needs a fresh gesture. They are
 * registered in the capture phase because game canvas handlers (e.g. the mobile login
 * screen) call preventDefault()/stopImmediatePropagation() on touch events, which would
 * otherwise starve bubble-phase document listeners and suppress synthetic clicks.
 *
 * `onRunning` is invoked once, the first time the context reaches "running".
 * The returned cleanup removes the listeners; call it when the context is disposed.
 */
export function addAudioContextResumeListeners(
    ctx: AudioContext,
    onRunning?: () => void,
): () => void {
    if (typeof document === "undefined") {
        return () => {};
    }

    let active = true;
    let notifiedRunning = false;

    function cleanup(): void {
        if (!active) {
            return;
        }
        active = false;
        for (const eventType of AUDIO_CONTEXT_RESUME_EVENTS) {
            document.removeEventListener(eventType, listener, true);
        }
    }

    function notifyRunningOnce(): void {
        if (!active || notifiedRunning) {
            return;
        }
        if ((ctx.state as string) !== "running") {
            return;
        }
        notifiedRunning = true;
        onRunning?.();
    }

    function listener(): void {
        if (!active) {
            return;
        }
        if ((ctx.state as string) === "closed") {
            cleanup();
            return;
        }
        if (isAudioContextResumable(ctx)) {
            // resume() must be called synchronously within the gesture handler for the
            // user activation to count (iOS WebKit rejects it from deferred callbacks).
            ctx.resume().then(notifyRunningOnce, () => {});
        }
        notifyRunningOnce();
    }

    for (const eventType of AUDIO_CONTEXT_RESUME_EVENTS) {
        document.addEventListener(eventType, listener, true);
    }

    return cleanup;
}

/**
 * Shared Web Audio context for all RealtimeMidiSynth instances.
 * Uses the device's native sample rate (usually 48000 on Windows) — do not force 44100.
 */
export function getSharedMusicAudioContext(): AudioContext | null {
    const AudioCtx = getAudioContextConstructor();
    if (!AudioCtx) {
        return null;
    }

    if (!sharedMusicContext || sharedMusicContext.state === "closed") {
        sharedMusicContext = new AudioCtx();
        sharedMusicWorkletPromise = null;
        if (sharedMusicResumeCleanup) {
            sharedMusicResumeCleanup();
            sharedMusicResumeCleanup = null;
        }
        sharedMusicResumeCleanup = addAudioContextResumeListeners(sharedMusicContext);
        registerManagedAudioContext(sharedMusicContext);
    }

    resumeAudioContextIfNeeded(sharedMusicContext);

    return sharedMusicContext;
}

/**
 * Why music cannot play here, or null when it can. AudioWorklet only exists in a secure
 * context (HTTPS or localhost), so a client opened over plain HTTP on a LAN or tailnet
 * hostname has Web Audio but no music worklet.
 */
export function getMusicWorkletUnsupportedReason(): string | null {
    if (!getAudioContextConstructor()) {
        return "Web Audio is not supported";
    }
    if (typeof AudioWorkletNode === "undefined") {
        return window.isSecureContext === false
            ? `music needs HTTPS or localhost (page is ${window.location.origin})`
            : "AudioWorklet is not supported";
    }
    return null;
}

/**
 * Register the music worklet module once on the shared context.
 */
export async function ensureSharedMusicWorklet(
    getWorkletCode: () => Promise<string>,
): Promise<AudioContext> {
    const ctx = getSharedMusicAudioContext();
    if (!ctx) {
        throw new Error("Web Audio not supported");
    }

    if (!sharedMusicWorkletPromise) {
        sharedMusicWorkletPromise = (async () => {
            const code = await getWorkletCode();
            const blob = new Blob([code], { type: "application/javascript" });
            const url = URL.createObjectURL(blob);
            try {
                await ctx.audioWorklet.addModule(url);
            } finally {
                URL.revokeObjectURL(url);
            }
        })().catch((err) => {
            sharedMusicWorkletPromise = null;
            throw err;
        });
    }

    await sharedMusicWorkletPromise;
    return ctx;
}
