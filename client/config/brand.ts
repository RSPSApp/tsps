/**
 * The product's name, wherever a screen prints it.
 *
 * Upstream's build is RSPS.app, which is right for upstream and wrong for a fork. A fork sets
 * `REACT_APP_BRAND_NAME` at build time and every screen that greets the player reads it here, so
 * renaming is one variable rather than a hunt through the login renderers. Left unset, the name
 * is upstream's, so this changes nothing for anyone who does not ask for it.
 */
const DEFAULT_BRAND_NAME = "RSPS.app";

/** Strip the BOM Windows and PowerShell like to write into env files, then the whitespace. */
function clean(value: string | undefined): string | undefined {
    const trimmed = value?.replace(/^﻿/, "").trim();
    return trimmed ? trimmed : undefined;
}

export const BRAND_NAME = clean(process.env.REACT_APP_BRAND_NAME) ?? DEFAULT_BRAND_NAME;

/** "<page> - <brand>", or just the brand when there is no page to name. */
export function brandedTitle(page?: string): string {
    const name = page?.trim();
    return name ? `${name} - ${BRAND_NAME}` : BRAND_NAME;
}

/**
 * The shared world directory's own name. This is not the brand: the directory is rsps.app
 * whatever a fork calls itself, so renaming the game must not rename it.
 */
export const DEFAULT_DIRECTORY_NAME = "RSPS.app";
