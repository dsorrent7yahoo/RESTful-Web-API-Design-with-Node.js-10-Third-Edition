FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY dynamodb-uploader /app/dynamodb-uploader
COPY dynamo-db-backend/package.json /app/dynamo-db-backend/package.json
COPY dynamo-db-backend/package-lock.json /app/dynamo-db-backend/package-lock.json

WORKDIR /app/dynamo-db-backend
RUN npm ci --omit=dev && npm cache clean --force

FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runtime

WORKDIR /app

COPY --from=deps /app/dynamo-db-backend/node_modules /app/dynamo-db-backend/node_modules
COPY dynamo-db-backend /app/dynamo-db-backend
COPY coherent-11-07-2022 /app/coherent-11-07-2022

WORKDIR /app/dynamo-db-backend

ENV NODE_ENV=production
ENV PORT=4001
ENV AWS_REGION=us-east-1
ENV DYNAMODB_TABLE=medications
ENV SCARF_ANALYTICS=false

EXPOSE 4001

CMD ["app.js"]
