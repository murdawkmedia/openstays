# syntax=docker/dockerfile:1.7

# Runtime digests are intentionally immutable. Update them only after checking
# the corresponding upstream release and rebuilding the full image.
FROM python:3.13.14-slim-bookworm@sha256:9d7f287598e1a5a978c015ee176d8216435aaf335ed69ac3c38dd1bbb10e8d64 AS ots-runtime
RUN python -m pip install --no-cache-dir "opentimestamps-client==0.7.2"

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS node-runtime

FROM node-runtime AS cli-build
WORKDIR /build/cli
COPY cli/package.json cli/package-lock.json ./
RUN npm ci
COPY cli/tsconfig.json ./
COPY cli/src ./src
RUN npm run build && npm prune --omit=dev

FROM golang:1.26.0-bookworm@sha256:2a0ba12e116687098780d3ce700f9ce3cb340783779646aafbabed748fa6677c AS wavelength-build
ARG WAVELENGTH_VERSION=v0.1.0
ARG WAVELENGTH_SOURCE_SHA256=93bc52ec22ffbad94147f3796ded5bffc3e5b9a384626b412aed920c5bd820b3
ARG WAVELENGTH_VENDOR_SHA256=6d242ae327b47b53bf8af63c90fa60a8bb95d326b9b733c9c1c3fa96abbaeed2
ADD --checksum=sha256:93bc52ec22ffbad94147f3796ded5bffc3e5b9a384626b412aed920c5bd820b3 \
  https://github.com/lightninglabs/wavelength/releases/download/v0.1.0/wavelength-source-v0.1.0.tar.gz \
  /tmp/wavelength-source.tar.gz
ADD --checksum=sha256:6d242ae327b47b53bf8af63c90fa60a8bb95d326b9b733c9c1c3fa96abbaeed2 \
  https://github.com/lightninglabs/wavelength/releases/download/v0.1.0/vendor.tar.gz \
  /tmp/wavelength-vendor.tar.gz
RUN mkdir -p /src /out \
  && tar -xzf /tmp/wavelength-source.tar.gz -C /src --strip-components=1 \
  && tar -xzf /tmp/wavelength-vendor.tar.gz -C /src \
  && test "$WAVELENGTH_VERSION" = "v0.1.0" \
  && test "$WAVELENGTH_SOURCE_SHA256" = "93bc52ec22ffbad94147f3796ded5bffc3e5b9a384626b412aed920c5bd820b3" \
  && test "$WAVELENGTH_VENDOR_SHA256" = "6d242ae327b47b53bf8af63c90fa60a8bb95d326b9b733c9c1c3fa96abbaeed2"
WORKDIR /src
RUN CGO_ENABLED=0 GOWORK=off go build \
  -mod=vendor \
  -trimpath \
  -tags="wavewalletrpc swapruntime" \
  -ldflags="-s -w -buildid= -X github.com/lightninglabs/wavelength/build.Commit=v0.1.0-wallet-rpc" \
  -o /out/waved \
  ./cmd/waved

FROM ots-runtime

ARG WAVELENGTH_VERSION=v0.1.0

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=wavelength-build /out/waved /usr/local/bin/waved
RUN test "$WAVELENGTH_VERSION" = "v0.1.0" \
  && ots --version

RUN groupadd --gid 1000 node \
  && useradd --uid 1000 --gid 1000 --shell /usr/sbin/nologin --create-home node

WORKDIR /app
COPY --from=cli-build --chown=node:node /build/cli/package.json /app/cli/package.json
COPY --from=cli-build --chown=node:node /build/cli/node_modules /app/cli/node_modules
COPY --from=cli-build --chown=node:node /build/cli/dist /app/cli/dist
COPY --chown=node:node ops/cloudflare/container/control.mjs ops/cloudflare/container/backup.mjs /app/container/
COPY --chown=node:node ops/cloudflare/container/control.mjs ops/cloudflare/container/backup.mjs /app/cloudflare/container/
COPY --chown=node:node ops/synology/*.mjs /app/synology/

RUN mkdir -p /var/lib/openstays /run/openstays \
  && chown -R node:node /var/lib/openstays /run/openstays /app

ENV NODE_ENV=production \
  CONTROL_PORT=8080 \
  WALLET_BACKUP_OUTPUT_PATH=/var/lib/openstays/runtime/wallet.tar.gz.enc \
  WAVELENGTH_WALLET_DIRECTORY=/var/lib/openstays/wavelength \
  WAVELENGTH_DAEMON_URL=http://127.0.0.1:10031 \
  WAVELENGTH_EXPECTED_NETWORK=signet \
  OTS_COMMAND=/usr/local/bin/ots

USER node
ENTRYPOINT ["node", "/app/container/control.mjs"]
