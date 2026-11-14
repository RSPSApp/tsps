package gateway.cache

/** Where the cache the official client gets differs from the one tsps runs on, and why. */
object ClientCachePatches {
    private const val GROUPING_WORLDS_ENUM = 850
    private const val NO_WORLD = -1

    /**
     * Enum 850: the world the Grouping tab (interface 76) suggests for each activity. Script 435
     * shows it as "Suggested world" and, unless it is -1, adds a "Switch <world>" button that
     * hops there. A tsps server is one world, so no activity suggests one: the tab shows "---"
     * and no button. Script 435 still suggests world 383 for Castle Wars to a non-member
     * (varc 103, which script 828 sets at login), so that one stays on free worlds.
     */
    private val groupingWorlds =
        FilePatch(EnumTypes.CONFIG_ARCHIVE, EnumTypes.ENUM_GROUP, GROUPING_WORLDS_ENUM) { EnumTypes.withIntValues(it, NO_WORLD) }

    val ALL: List<FilePatch> = listOf(groupingWorlds)
}
