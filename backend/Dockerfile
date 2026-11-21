# Multi-stage build (RM M1.6; hardened further at M35.1).
#
# Node 20 is the version the roadmap fixes, and the frontend's `engines`
# field agrees. Alpine keeps the runtime image small; the build stage
# needs the full toolchain, the runtime stage does not.

# ── Stage 1: dependencies ──────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copied separately so a source-only change reuses the cached install.
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ─────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Drop dev dependencies from the tree that gets copied forward.
RUN npm prune --omit=dev

# ── Stage 3: runtime ───────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# The image ships a `node` user; running as root in a container that
# handles PHI is an avoidable privilege (MG §14).
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

EXPOSE 3000

# Uses the readiness probe, so an unhealthy dependency takes the
# container out of rotation rather than leaving it serving errors.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
