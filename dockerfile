# Base image for Node.js 20.17.0 
FROM node:20.17.0

# Set working directory
WORKDIR /app

# Install required system dependencies for building native modules
RUN apt-get update && apt-get install -y python3 build-essential

# Prepare the repository-pinned Yarn in a runtime-readable, immutable cache.
ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p "$COREPACK_HOME" \
    && corepack enable \
    && corepack prepare yarn@1.22.19 --activate \
    && chmod -R a+rX "$COREPACK_HOME"
ENV COREPACK_ENABLE_NETWORK=0

# Copy dependency metadata first so the install layer remains cacheable.
COPY --chown=1000:1000 package.json yarn.lock ./
RUN --mount=type=cache,id=checkmate-yarn-v1,target=/usr/local/share/.cache/yarn/v6,sharing=locked \
    yarn install --frozen-lockfile --network-timeout 100000

# Copy application code with the base image's numeric non-root ownership.
COPY --chown=1000:1000 . .
RUN yarn build

ENV HOME=/home/node
USER 1000:1000

EXPOSE 3000
CMD ["yarn", "start"]
