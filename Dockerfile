FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
# yt-dlp is intentionally NOT installed: /api/dub is a stub in this build
# (no source-video download yet). Add a pinned yt-dlp only when dub is
# implemented, with a fixed version + checksum verification.
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
