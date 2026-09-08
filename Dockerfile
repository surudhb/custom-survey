# custom-survey — tiny single-process Node app (the self-hosted path;
# for Cloudflare Workers use `npm run deploy` instead).
FROM node:20-alpine

WORKDIR /app

# Install only production deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source
COPY server.js config.json ./
COPY src ./src
COPY public ./public

# Votes + admin key live here — mount a volume at /data to persist them
ENV DATA_DIR=/data
ENV PORT=3000
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server.js"]
