# OTIS - Omarchy Text Interface Studio
FROM node:24-alpine

LABEL org.opencontainers.image.title="OTIS" \
      org.opencontainers.image.description="Omarchy Text Interface Studio - a GUI designer for TUIs" \
      org.opencontainers.image.source="https://github.com/WolfBrandon/otis" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app
COPY package.json server.js mcp.js ./
COPY public/ ./public/

ENV PORT=6847 \
    DATA_DIR=/data \
    THEME_DIRS=/themes \
    NODE_ENV=production

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 6847
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:6847/api/health || exit 1

CMD ["node", "server.js"]
