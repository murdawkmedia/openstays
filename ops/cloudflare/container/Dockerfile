# syntax=docker/dockerfile:1.7

# Runtime digests are intentionally immutable. Update them only after checking
# the corresponding upstream release and rebuilding the full image.
FROM python:3.13.14-slim-bookworm@sha256:9d7f287598e1a5a978c015ee176d8216435aaf335ed69ac3c38dd1bbb10e8d64 AS ots-runtime
RUN python -m pip install --no-cache-dir "opentimestamps-client==0.7.2"

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS cli-build
WORKDIR /build/cli
COPY cli/package.json cli/package-lock.json ./
RUN npm ci
COPY cli/tsconfig.json ./
COPY cli/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

ARG WAVELENGTH_VERSION=v0.1.0
ARG WAVELENGTH_ARCHIVE_SHA256=78502f588c38281e646e0e6a302c1f23e1ee1589686dbebf186739b6d41796fe
ARG WAVELENGTH_DAEMON_SHA256=09cc6e77c2abadaebfd4fe9362440aad096851382d9aa3ee58e7a947bd37284a

COPY --from=ots-runtime /usr/local /usr/local
ADD --checksum=sha256:78502f588c38281e646e0e6a302c1f23e1ee1589686dbebf186739b6d41796fe \
  https://github.com/lightninglabs/wavelength/releases/download/v0.1.0/wavelength-linux-amd64-v0.1.0.tar.gz \
  /tmp/wavelength.tar.gz
RUN tar -xzf /tmp/wavelength.tar.gz -C /tmp --strip-components=1 \
  && printf '%s  %s\n' "$WAVELENGTH_DAEMON_SHA256" /tmp/waved | sha256sum -c - \
  && install -m 0755 /tmp/waved /usr/local/bin/waved \
  && rm -rf /tmp/wavelength.tar.gz /tmp/waved /tmp/wavecli \
  && test "$WAVELENGTH_VERSION" = "v0.1.0" \
  && test "$WAVELENGTH_ARCHIVE_SHA256" = "78502f588c38281e646e0e6a302c1f23e1ee1589686dbebf186739b6d41796fe" \
  && ots --version

WORKDIR /app
COPY --from=cli-build --chown=node:node /build/cli/package.json /app/cli/package.json
COPY --from=cli-build --chown=node:node /build/cli/node_modules /app/cli/node_modules
COPY --from=cli-build --chown=node:node /build/cli/dist /app/cli/dist
COPY --chown=node:node ops/cloudflare/container/control.mjs ops/cloudflare/container/backup.mjs /app/container/

RUN mkdir -p /var/lib/openstays /run/openstays \
  && chown -R node:node /var/lib/openstays /run/openstays /app

ENV NODE_ENV=production \
  CONTROL_PORT=8080 \
  WAVELENGTH_WALLET_DIRECTORY=/var/lib/openstays/wavelength \
  WAVELENGTH_DAEMON_URL=http://127.0.0.1:10031 \
  WAVELENGTH_EXPECTED_NETWORK=signet \
  OTS_COMMAND=/usr/local/bin/ots

USER node
EXPOSE 8080
ENTRYPOINT ["node", "/app/container/control.mjs"]
