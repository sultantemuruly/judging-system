# ============================================================
# Stage 1: build the server
# ============================================================
FROM golang:1.25-alpine AS builder

WORKDIR /src

# Dependencies first, so source changes don't refetch them
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# Static binary for the platform Docker builds for (amd64 or arm64)
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o /out/judging-server ./cmd/server

# ============================================================
# Stage 2: run
# ============================================================
FROM alpine:3.20

RUN apk --no-cache add ca-certificates \
 && adduser -D -g '' appuser \
 && mkdir -p /app/data \
 && chown appuser /app/data

WORKDIR /app
COPY --from=builder /out/judging-server .

# Fight logs, current fight, heartbeat and tournament.json live here.
# Mount a volume on it; a new named volume takes this directory's owner.
ENV DATA_DIR=/app/data PORT=8080
VOLUME /app/data

USER appuser
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1

CMD ["./judging-server"]
