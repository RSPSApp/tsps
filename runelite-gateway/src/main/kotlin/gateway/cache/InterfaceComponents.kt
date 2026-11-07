package gateway.cache

/**
 * Which interface components exist: each interface is a group of the interfaces archive, one
 * file per component. tsps still sends some 317-style flat widget ids (5857, 52029 ...), which
 * read as interface 0 with a component it doesn't have, and the official client throws on those.
 */
class InterfaceComponents(cache: Cache) {
    private val groups = cache.table(INTERFACES_ARCHIVE).groups

    fun exists(interfaceId: Int, componentId: Int): Boolean = groups[interfaceId]?.files?.let { componentId in it } ?: false

    fun exists(uid: Int): Boolean = exists(uid ushr 16, uid and 0xFFFF)

    private companion object {
        const val INTERFACES_ARCHIVE = 3
    }
}
