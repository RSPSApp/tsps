/** RuneLite's net.runelite.client.util.Text, the parts ported plugins use. */
export const Text = {
    /** Strips `<col=…>`, `<br>` and every other tag (RuneLite's removeTags). */
    removeTags(text: string): string {
        return text.replace(/<[^>]*>/g, "");
    },

    /** RuneLite's sanitizeMultilineText: `<br>` runs become one space, other tags go, whitespace is trimmed. */
    sanitizeMultilineText(text: string): string {
        return Text.removeTags(text.replace(/-<br>/g, "-").replace(/(<br>)+/g, " ")).trim();
    },

    /** RuneLite's standardize: lower case, no tags, collapsed whitespace, for comparing names. */
    standardize(text: string): string {
        return Text.removeTags(text).replace(/ /g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    },

    /** RuneLite's toJagexName: non-breaking spaces to spaces, underscores and hyphens to spaces. */
    toJagexName(text: string): string {
        return text.replace(/[ _-]/g, " ");
    },
};
