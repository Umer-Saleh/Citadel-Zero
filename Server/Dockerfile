# Alpine keeps the image small, but argon2 compiles native code, so
# the build stage needs a toolchain Alpine doesn't ship by default.
FROM node:24-alpine AS build

WORKDIR /app

# python3, make and g++ are needed to build argon2 from source.
# They're installed in the build stage ONLY — the final image doesn't
# carry a C compiler around, which is both smaller and less useful to
# anyone who gets a shell in it.
RUN apk add --no-cache python3 make g++

# Copy manifests first, on their own. Docker caches each layer, and
# this one only invalidates when a dependency changes — so editing
# source doesn't trigger a fresh npm install every build.
COPY package*.json ./

# `npm ci` not `npm install`: it installs exactly what the lockfile
# says and fails if the lockfile is out of date, so the image is
# reproducible. --omit=dev leaves test and lint tooling out.
RUN npm ci --omit=dev

# ---------------------------------------------------------------

FROM node:24-alpine

WORKDIR /app

# Don't run as root. If the process is ever compromised, the attacker
# lands as an unprivileged user rather than owning the container.
# node:alpine ships a `node` user for exactly this.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations

# Operational one-shots: the demo seed and the nightly wipe. They ride
# in the same image because they need the same crypto and the same
# native argon2 build — but neither is reachable from the running
# server, which only ever executes src/server.js.
COPY --chown=node:node scripts ./scripts

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "src/server.js"]