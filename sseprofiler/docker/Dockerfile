# Zero runtime dependencies, so there is nothing to install and no build step —
# the image is the base plus ~100KB of source. Kept deliberately: an
# observability tool should not be able to break the thing it observes, and an
# empty dependency tree is the cheapest way to guarantee that.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY src ./src
COPY tools ./tools

# Run unprivileged. The node image ships a `node` user; use it rather than root.
USER node

EXPOSE 9099

# '::' is dual-stack — see the bind comment in src/main.js. Clients that resolve
# "localhost" to ::1 (Node 18+ fetch does) would otherwise fail silently.
ENV OBSERVER_HOST=:: \
    OBSERVER_PORT=9099

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.OBSERVER_PORT||9099)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/main.js"]
