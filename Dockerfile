# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:20-alpine3.18 as BUILDER
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY ["./*.json", "./yarn.lock", "./"]
RUN set -x && yarn install --frozen-lockfile
COPY ["./src", "./src"]
RUN set -x && yarn test
RUN set -x && yarn build

FROM node:20-alpine3.18
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    SECUTILS_WEB_SCRAPER_BROWSER_EXECUTABLE_PATH="/usr/bin/chromium-browser"
WORKDIR /app
RUN set -x && apk update --no-cache && \
    apk upgrade --no-cache && \
    apk add --no-cache dumb-init nss freetype harfbuzz ca-certificates ttf-freefont chromium
COPY --from=BUILDER ["/app/dist", "/app/package.json", "/app/yarn.lock", "./"]
RUN set -x && yarn install --production --frozen-lockfile && yarn cache clean
CMD [ "node", "src/index.js" ]
