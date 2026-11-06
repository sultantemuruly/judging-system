# One container with both the client and the server, for hosts that run a
# single image (Fly.io, see fly.toml). The Go server serves the built client
# itself (STATIC_DIR), so there is no nginx. For a laptop at the venue use
# docker-compose.yml instead.

FROM node:22-alpine AS client
WORKDIR /app
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM golang:1.25-alpine AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o /out/judging-server ./cmd/server

FROM alpine:3.20
# su-exec: the volume is mounted owned by root, so start as root, hand the
# data directory to appuser, then run the server as appuser.
RUN apk --no-cache add ca-certificates su-exec \
 && adduser -D -g '' appuser \
 && mkdir -p /app/data
WORKDIR /app
COPY --from=server /out/judging-server .
COPY --from=client /app/dist ./public
ENV DATA_DIR=/app/data STATIC_DIR=/app/public PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "chown appuser /app/data && exec su-exec appuser ./judging-server"]
