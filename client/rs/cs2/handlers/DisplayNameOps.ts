/**
 * The display name changer (displayname_menu, interface 980): its scripts ask through
 * displaynames_status/check/claim/cancel and poll the matching *_result op every tick
 * (script10213, script10202). Requests go to the server on the "display-names" plugin channel;
 * each reply replaces that request's latest result, which the result ops return until the next.
 */
import { send } from "../../../network/ServerConnection";
import { subscribePluginMessages } from "../../../network/serverConnection/domain/pluginMessages";
import type { HandlerMap } from "./HandlerTypes";

export const DISPLAY_NAMES_CHANNEL = "display-names";

type Request = "status" | "check" | "claim" | "cancel";

/** Each result op's values, in the order the op returns them (strings and booleans in place). */
const SHAPES: Record<Request, Array<"int" | "string" | "boolean">> = {
    status: ["int", "int", "string", "boolean", "int", "int"],
    check: ["int", "int", "string", "int", "boolean", "int", "int"],
    claim: ["int", "int", "string", "int"],
    cancel: ["int", "int", "string"],
};

const latest = new Map<Request, unknown[]>();
let listening = false;

function neutral(request: Request): unknown[] {
    return SHAPES[request].map((type) => (type === "string" ? "" : 0));
}

/** A server reply: `{ op, result }`, `result` in the op's order. */
export function acceptDisplayNameReply(data: unknown): void {
    const reply = data as { op?: unknown; result?: unknown } | null;
    const request = reply?.op as Request;
    if (!request || !(request in SHAPES) || !Array.isArray(reply?.result)) return;
    const values = neutral(request);
    reply.result.slice(0, values.length).forEach((value, index) => { values[index] = value; });
    latest.set(request, values);
}

/** Forget every reply (a new login starts with no session). */
export function resetDisplayNames(): void {
    latest.clear();
}

function listen(): void {
    if (listening) return;
    listening = true;
    subscribePluginMessages((message) => {
        if (message?.channel === DISPLAY_NAMES_CHANNEL) acceptDisplayNameReply(message.data);
    });
}

function request(op: Request, name?: string): void {
    listen();
    // Pending until the server answers: the scripts show "Checking..." / "Requesting..." / disconnecting.
    if (op !== "status") {
        const pending = neutral(op);
        pending[0] = 1;
        latest.set(op, pending);
    }
    send({ type: "plugin_message", payload: { channel: DISPLAY_NAMES_CHANNEL, data: name === undefined ? { op } : { op, name } } } as any);
}

function pushResult(ctx: any, op: Request): void {
    const values = latest.get(op) ?? neutral(op);
    SHAPES[op].forEach((type, index) => {
        const value = values[index];
        if (type === "string") ctx.pushString(String(value ?? ""));
        else if (type === "boolean") ctx.pushInt(value ? 1 : 0);
        else ctx.pushInt(Number(value) | 0);
    });
}

export function registerDisplayNameOps(handlers: HandlerMap): void {
    listen();
    handlers.set(5100, () => request("status")); // displaynames_status
    handlers.set(5101, (ctx) => pushResult(ctx, "status")); // displaynames_status_result
    handlers.set(5102, (ctx) => request("check", String(ctx.popString() ?? ""))); // displaynames_check
    handlers.set(5103, (ctx) => pushResult(ctx, "check")); // displaynames_check_result
    handlers.set(5104, (ctx) => request("claim", String(ctx.popString() ?? ""))); // displaynames_claim
    handlers.set(5105, (ctx) => pushResult(ctx, "claim")); // displaynames_claim_result
    handlers.set(5106, () => request("cancel")); // displaynames_cancel
    handlers.set(5107, (ctx) => pushResult(ctx, "cancel")); // displaynames_cancel_result
    handlers.set(5108, () => {}); // displaynames_openurl: no account website to open
}
