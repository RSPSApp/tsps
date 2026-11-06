plugins { java }

repositories {
    maven { url = uri("https://repo.runelite.net") }
    mavenCentral()
}

dependencies {
    compileOnly("net.runelite:client:1.13.4")
    implementation("org.ow2.asm:asm:9.7")
    implementation("org.ow2.asm:asm-tree:9.7")
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }
tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release = 11
}
tasks.test { useJUnitPlatform() }
tasks.jar {
    archiveFileName = "LoginUtilities.jar"
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from(configurations.runtimeClasspath.get().map { if (it.isDirectory) it else zipTree(it) })
    // RuneLite scans sideloaded JAR classes; Java module descriptors are not plugin classes.
    exclude("module-info.class", "META-INF/versions/**", "META-INF/*.SF", "META-INF/*.RSA", "META-INF/*.DSA")
}
