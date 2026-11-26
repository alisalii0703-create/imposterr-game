# IMposter — production image. Any Node host (Render, Railway, Fly, a VPS).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install only what production needs, from the lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public

# Purchases are written here — mount a volume so redeploys don't wipe them.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
