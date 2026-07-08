FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app
COPY pom.xml .
COPY src src
RUN apk add --no-cache maven && mvn package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/target/healthcare-api-1.0.0.jar app.jar
EXPOSE 4003
ENTRYPOINT ["java", "-jar", "app.jar"]
