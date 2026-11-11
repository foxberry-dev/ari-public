FROM node:24.15.0-trixie-slim@sha256:291be77873bc04731968cacf82f0fcef17cee8cf200c6b6951e2bcab41560eb7
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY target/release/ari /usr/local/bin/ari
ENV ARI_HOME=/data/library
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/ari"]
