# Birthday ranker — tiny single-process Node app.
FROM node:20-alpine

WORKDIR /app

# Install only production deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source
COPY server.js config.json ./
COPY public ./public

# Votes + admin key live here — mount a volume at /data to persist them
ENV DATA_DIR=/data
ENV PORT=3000
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server.js"]
