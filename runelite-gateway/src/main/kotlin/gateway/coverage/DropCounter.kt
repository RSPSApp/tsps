package gateway.coverage

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Counts every message the gateway doesn't pass on, in either direction, so COVERAGE.md's
 * `dropped` and `todo` rows show up in a running session's log.
 */
object DropCounter {
    private val counts = ConcurrentHashMap<String, AtomicLong>()

    /** A tsps message with no 241 form (`down:<opcode>`). */
    fun down(opcode: Int) = count("down:$opcode")

    /** A tsps interface message aimed at a component the client doesn't have (`missing:<group>:<component>`). */
    fun missingComponent(uid: Int) = count("missing:${uid ushr 16}:${uid and 0xFFFF}")

    /** A client packet tsps has no use for (`up:<class>`). */
    fun up(message: Any) = count("up:${message.javaClass.simpleName}")

    fun snapshot(): Map<String, Long> = counts.mapValues { it.value.get() }.toSortedMap()

    fun summary(): String = snapshot().entries.joinToString(", ") { "${it.key}=${it.value}" }

    private fun count(key: String) {
        counts.computeIfAbsent(key) { AtomicLong() }.incrementAndGet()
    }
}
