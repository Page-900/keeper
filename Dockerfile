FROM node:22.23.1-slim AS build
ENV HUSKY=0
WORKDIR /app

# The Solidity test helpers are a git dependency, so the install needs git and the runtime does not.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run compile && npm run build

FROM node:22.23.1-slim
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/artifacts ./artifacts
COPY public ./public
COPY material ./material
COPY scripts/demo.js ./scripts/demo.js

# The page appends what strangers send it, so this is the one directory it may write to.
COPY --chown=node:node evidence ./evidence

USER node
EXPOSE 8080
CMD ["node", "scripts/demo.js"]
