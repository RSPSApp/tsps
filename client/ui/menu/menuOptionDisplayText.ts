/**
 * The text a menu option is shown as. Menus, the menu swapper, click dispatch and the server all
 * work with the option as the game sent it; only the places that draw an option (the right-click
 * menu, its header and the mouseover text) pass it through here, so a plugin such as OSRS
 * Translate can show it in another language without changing what a click does.
 */
type OptionTransform = (option: string) => string | undefined;

let transform: OptionTransform | undefined;

/** Sets the transform, or clears it with undefined. One plugin owns it at a time. */
export function setMenuOptionDisplayText(fn: OptionTransform | undefined): void {
    transform = fn;
}

export function menuOptionDisplayText(option: string): string {
    if (!transform || !option) return option;
    return transform(option) ?? option;
}
