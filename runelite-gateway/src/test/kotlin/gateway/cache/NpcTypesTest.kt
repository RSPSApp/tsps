package gateway.cache

import gateway.headless.TestCache
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class NpcTypesTest {
    private val types = NpcTypes(TestCache.cache)

    @Test
    fun `an npc's body models come from its config`() {
        val rat = types.models(GIANT_RAT)
        assertTrue(rat.isNotEmpty() && rat.all { it in 0..0xFFFF }, "giant rat models $rat")
        assertEquals(emptyList<Int>(), types.models(Int.MAX_VALUE), "no such npc")
    }

    @Test
    fun `every npc config decodes to its last byte`() {
        val failed = types.ids.mapNotNull { id -> runCatching { types.decodeStrict(id) }.exceptionOrNull()?.let { "$id: ${it.message}" } }
        assertEquals(emptyList<String>(), failed.take(10), "${failed.size} of ${types.ids.size} failed")
    }

    private companion object {
        const val GIANT_RAT = 2854
    }
}
