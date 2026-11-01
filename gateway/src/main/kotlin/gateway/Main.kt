package gateway

import gateway.config.GatewayConfig
import gateway.coverage.DropCounter
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private const val DROP_LOG_INTERVAL_MINUTES = 1L

fun main() {
    val gateway = Gateway.start(GatewayConfig.load())

    Executors.newSingleThreadScheduledExecutor { Thread(it, "gateway-drops").apply { isDaemon = true } }
        .scheduleAtFixedRate(
            { DropCounter.summary().takeIf { it.isNotEmpty() }?.let { println("dropped: $it") } },
            DROP_LOG_INTERVAL_MINUTES,
            DROP_LOG_INTERVAL_MINUTES,
            TimeUnit.MINUTES,
        )
    Runtime.getRuntime().addShutdownHook(Thread { println("dropped: ${DropCounter.summary()}") })

    val config = gateway.config
    println("tsps gateway (revision ${gateway.revision}) on port ${config.gatewayPort}, tsps at ${config.tspsUrl}")
    println(
        "RSProx target: jav_config_url http://${config.publicHost}:${config.websocketPort}/gateway/jav_config.ws, " +
            "game_server_port ${config.gatewayPort}, revision ${gateway.revision}, modulus ${gateway.rsa.modulus.toString(16)}",
    )
}
