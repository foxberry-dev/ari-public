FROM node:24.15.0-trixie-slim@sha256:291be77873bc04731968cacf82f0fcef17cee8cf200c6b6951e2bcab41560eb7
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY frontend/package-lock.json /tmp/ari-package-lock.json
ENV ARI_RENDERER_HOME=/opt/ari-renderer PLAYWRIGHT_BROWSERS_PATH=/opt/ari-renderer/browsers
RUN version=$(node -p "require('/tmp/ari-package-lock.json').packages['node_modules/playwright'].version") && \
    npm install --prefix /opt/ari-renderer --ignore-scripts --no-audit --no-fund "playwright@$version" && \
    cd /opt/ari-renderer && npx playwright install --with-deps chromium && \
    chmod -R a+rX /opt/ari-renderer && rm /tmp/ari-package-lock.json
COPY target/release/ari /usr/local/bin/ari
ENV ARI_HOME=/data/library
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/ari"]
