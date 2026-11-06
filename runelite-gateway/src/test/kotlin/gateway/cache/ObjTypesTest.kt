package gateway.cache

import gateway.config.GatewayConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.util.logging.Handler
import java.util.logging.LogRecord
import java.util.logging.Logger

class ObjTypesTest {
    private val cache = Cache.open(GatewayConfig.load().cacheDirectory)

    @Test
    fun `every obj type decodes`() {
        val failures = ArrayList<String>()
        val handler =
            object : Handler() {
                override fun publish(record: LogRecord) {
                    failures += record.message
                }

                override fun flush() = Unit

                override fun close() = Unit
            }
        Logger.getLogger(ObjTypes::class.java.name).addHandler(handler)
        val types = ObjTypes(cache)
        cache.files(CONFIG_ARCHIVE, OBJ_GROUP).keys.forEach { types[it] }
        assertEquals(emptyList<String>(), failures.take(10))
    }

    @Test
    fun `a platebody is worn on the torso and hides the arms`() {
        val platebody = ObjTypes(cache)[RUNE_PLATEBODY]
        assertEquals(TORSO to ARMS, platebody.wearpos to platebody.wearpos2)
    }

    private companion object {
        const val CONFIG_ARCHIVE = 2
        const val OBJ_GROUP = 10
        const val RUNE_PLATEBODY = 1127
        const val TORSO = 4
        const val ARMS = 6
    }
}
