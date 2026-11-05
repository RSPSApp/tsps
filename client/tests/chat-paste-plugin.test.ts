import { strict as assert } from "node:assert";
import { ChatPastePlugin, MAX_PASTE_LENGTH, isPasteShortcut, pasteText } from "../game/plugins/chatpaste/ChatPastePlugin";

const key = (code: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) =>
    ({ code, key: code.replace("Key", "").toLowerCase(), ctrlKey: false, metaKey: false, altKey: false, ...mods }) as KeyboardEvent;

assert.ok(isPasteShortcut(key("KeyV", { ctrlKey: true })));
assert.ok(isPasteShortcut(key("KeyV", { metaKey: true })), "Cmd+V");
assert.ok(!isPasteShortcut(key("KeyV")), "a plain v is typed");
assert.ok(!isPasteShortcut(key("KeyC", { ctrlKey: true })));
assert.ok(!isPasteShortcut(key("KeyV", { ctrlKey: true, altKey: true })));

assert.equal(pasteText("::tele 3222\r\n3218\t0"), "::tele 3222 3218 0", "one line");
assert.equal(pasteText("café \u{1F600}!"), "café !", "Latin-1 stays, emoji go");
assert.equal(pasteText("x".repeat(200)).length, MAX_PASTE_LENGTH);

// The plugin: lets the shortcut through to the browser, then types the paste.
let filter: ((type: string, event: any) => boolean) | undefined;
const typed: number[] = [];
const input = {
    addInputFilter: (f: (type: string, event: any) => boolean) => ((filter = f), () => (filter = undefined)),
    enqueueTypedChar: (c: number) => void typed.push(c),
};
const listeners = new Map<string, (e: Event) => void>();
const target = {
    addEventListener: (type: string, fn: any) => void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
};
const plugin = new ChatPastePlugin(input as any, target as any);
void plugin.start();
assert.equal(filter?.("keyPressed", key("KeyV", { ctrlKey: true })), true, "the game skips Ctrl+V");
assert.equal(filter?.("keyPressed", key("KeyA")), false);
assert.equal(filter?.("mousePressed", {}), false);

let prevented = false;
const paste = (text: string, tagName = "CANVAS") =>
    listeners.get("paste")!({
        clipboardData: { getData: () => text },
        target: { tagName, isContentEditable: false },
        preventDefault: () => (prevented = true),
    } as unknown as Event);
paste("hi all");
assert.equal(String.fromCharCode(...typed), "hi all");
assert.ok(prevented);
typed.length = 0;
paste("into a panel field", "INPUT");
assert.deepEqual(typed, [], "pastes into the page's own inputs are theirs");

void plugin.stop();
assert.equal(filter, undefined);
assert.equal(listeners.size, 0);

console.log("chat-paste-plugin: ok");
