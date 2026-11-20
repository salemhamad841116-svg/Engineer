# Multi-stage Dockerfile for AI Deep Research Platform
# Optimized for caching, small footprint, and security

# ==========================================
# Stage 1: Build Frontend Assets
# ==========================================
FROM node:22-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies required for client compilation
RUN npm install --legacy-peer-deps

# Copy application source code and configuration
COPY . .

# Compile production client bundles into dist/
RUN npm run build

# ==========================================
# Stage 2: Production Server Runtime
# ==========================================
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies and globally install tsx to run server.ts
RUN npm pkg delete scripts.prepare && npm install --legacy-peer-deps --omit=dev && npm install -g tsx

# Copy compiled frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend files and application logic
COPY server.ts ./
COPY server ./server
COPY server_backend ./server_backend
COPY src ./src
COPY public ./public

# Ensure directory for SQLite databases and storage exists
RUN mkdir -p /app/.data /app/data

# Mount volumes for persistent SQLite databases and file uploads
VOLUME ["/app/.data", "/app/data"]

EXPOSE 3001

# Container health probe checking /api/health
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["tsx", "server.ts"]
