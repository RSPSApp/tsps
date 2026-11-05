/** Browser counterpart of native OPENURL; popup policy remains browser-owned. */
export function openClientUrl(
    url: string,
    newWindow = true,
    open: (url: string, target: string, features: string) => unknown =
        (url, target, features) => window.open(url, target, features),
): boolean {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return false; }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    open(url, newWindow ? "_blank" : "_self", "noopener,noreferrer");
    return true;
}
