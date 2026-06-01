# Base image for Node.js 20.17.0 
FROM node:20.17.0

# Set working directory
WORKDIR /app

# Install required system dependencies for building native modules
RUN apt-get update && apt-get install -y python3 build-essential

# Reinstall dependencies and handle optional dependencies
RUN corepack enable && corepack prepare yarn@4.0.0 --activate

# Copy application code (includes drizzle/ if it exists)
COPY . .

RUN yarn install

RUN yarn build

# Copy and set up entrypoint script
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

# Use entrypoint script for migration + startup
ENTRYPOINT ["/docker-entrypoint.sh"]
