FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', r => r.statusCode < 500 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"
CMD ["node", "src/index.js"]
