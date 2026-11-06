/** RuneLite's net.runelite.client.util.Text, the parts ported plugins use. */
export const Text = {
    /** Strips `<col=…>`, `<br>` and every other tag (RuneLite's removeTags). */
    removeTags(text: string): string {
        return text.replace(/<[^>]*>/g, "");
    },

    /**
     * RuneLite's sanitizeMultilineText: a hyphenated line break joins its word, other `<br>` and
     * `<n>` breaks become spaces, runs of spaces collapse to one, then every tag goes. Not trimmed.
     */
    sanitizeMultilineText(text: string): string {
        return Text.removeTags(
            text.replace(/-<br>/g, "-").replace(/<br>/g, " ").replace(/-<n>/g, "-").replace(/<n>/g, " ").replace(/ +/g, " "),
        );
    },

    /** RuneLite's fromCSV: the comma-separated parts of a line, each trimmed, empty ones dropped. */
    fromCSV(csv: string): string[] {
        return csv.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
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
