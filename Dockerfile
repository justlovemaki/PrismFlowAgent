# --- Build Stage ---
FROM node:20-slim AS builder

WORKDIR /app

# Install system dependencies for node-canvas, sharp, etc.
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy root package files and config
COPY package*.json tsconfig.json ./
RUN npm install

# Copy backend source and build
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Build Frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Production Stage ---
FROM node:20-slim

# Install ffmpeg for video processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy built backend
COPY --from=builder /app/dist ./dist

# Copy built frontend
# Note: In production, Fastify should serve the frontend dist directory
COPY --from=builder /app/frontend/dist ./frontend/dist

# Create data directory for SQLite
RUN mkdir -p /app/data && chmod 777 /app/data

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/database.sqlite

EXPOSE 3000

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]
