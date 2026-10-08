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

ENV PORT=12113 \
    NODE_ENV=production

EXPOSE 12113

CMD ["node", "dist/index.js"]
