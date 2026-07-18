# ── Stage 1: install dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Copy installed modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY app.js        ./
COPY openapi.json  ./
COPY model/        ./model/
COPY modules/      ./modules/
COPY routes/       ./routes/

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "app.js"]
