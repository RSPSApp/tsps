import { sendChat } from "../../network/ServerConnection";

/** Ctrl+; and Ctrl+/ avoid the browser's new-tab and copy shortcuts. */
export function handleCommandShortcut(event: KeyboardEvent, loggedIn: boolean): boolean {
    if (!loggedIn || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.isComposing) return false;
    const command = event.key === ";" ? "teleports" : event.key === "/" ? "commands" : undefined;
    if (!command) return false;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) sendChat(`::${command}`);
    return true;
}
