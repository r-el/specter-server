# Build Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies needed for build
COPY package*.json ./
RUN npm ci

# Copy source code and config files
COPY . .

# Build the TypeScript code and resolve aliases
RUN npm run build

# Production Stage
FROM node:22-alpine

WORKDIR /app

# Only install production dependencies. Remove the prepare hook because husky is a dev dependency.
COPY package*.json ./
RUN npm pkg delete scripts.prepare \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist

# Run as non-root user
RUN chown -R node:node /app
USER node

ENV PORT=12113 \
    NODE_ENV=production

EXPOSE 12113

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:12113/api/health || exit 1

CMD ["node", "--async-stack-traces", "dist/index.js"]
