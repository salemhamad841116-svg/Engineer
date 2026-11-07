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
RUN npm install --legacy-peer-deps --omit=dev && npm install -g tsx

# Copy compiled frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend files and application logic
COPY server.ts ./
COPY server_backend ./server_backend
COPY src ./src
COPY public ./public

# Ensure directory for SQLite databases and storage exists
RUN mkdir -p /app/.data /app/data

EXPOSE 3001

CMD ["tsx", "server.ts"]
