/**
 * A few instructions end the whole client script on the spot, without an error: the script and
 * every script that called it stop, nothing is logged, and what the script had deferred (triggered
 * ops, an interface close, queued resizes) is still carried out. cc_callonresize / if_callonresize
 * on a component with no onResize listener is one.
 *
 * A handler signals it with `endScript()`; the VM catches the signal in its instruction loop.
 */
export class ScriptEndSignal extends Error {
    constructor() {
        super("script ended");
        this.name = "ScriptEndSignal";
    }
}

export function endScript(): never {
    throw new ScriptEndSignal();
}
