# ── Build stage ────────────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jdk AS build
WORKDIR /app

# Copy Gradle wrapper first (cached layer)
COPY gradle gradle
COPY gradlew .
RUN chmod +x gradlew

# Copy build scripts and resolve dependencies (cached layer)
COPY build.gradle settings.gradle ./
RUN ./gradlew dependencies --no-daemon -Dorg.gradle.java.installations.auto-download=false 2>/dev/null || true

# Copy source and build
COPY src src
RUN ./gradlew bootJar -x test --no-daemon -Dorg.gradle.java.installations.auto-download=false

# ── Runtime stage ───────────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /app/build/libs/healthcare-api-1.0.0.jar app.jar
EXPOSE 4003
ENTRYPOINT ["java", "-jar", "app.jar"]
