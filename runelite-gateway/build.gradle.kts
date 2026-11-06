plugins {
    alias(libs.plugins.kotlin.jvm)
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(platform(libs.netty.bom))
    implementation(libs.rsprot.api)
    implementation(libs.rsprot.desktop)
    implementation(libs.commons.compress)
    // rsprot logs through SLF4J; without a binding its errors (closed channels included) vanish.
    runtimeOnly(libs.slf4j.simple)
    testImplementation("net.rsprox:osrs-241")
    testImplementation("net.rsprox:protocol")
    testImplementation("net.rsprox:cache-api")
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.launcher)
}

kotlin {
    jvmToolchain(17)
}

application {
    mainClass = "gateway.MainKt"
    // Run from the repository root so `.env` and `server/` resolve the same way as `yarn start`.
    tasks.named<JavaExec>("run") { workingDir = rootDir.parentFile }
}

tasks.test {
    useJUnitPlatform()
    workingDir = rootDir.parentFile
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
