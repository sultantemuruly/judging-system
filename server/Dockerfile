# ============================================================
# Stage 1: Build
# ============================================================
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Copy dependency files first (layer cache optimization)
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build a statically linked binary (no CGO, no external deps)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o judging-server .

# ============================================================
# Stage 2: Run
# ============================================================
FROM alpine:3.19

# Add CA certificates (needed for HTTPS outbound calls if ever)
RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy only the compiled binary from the builder stage
COPY --from=builder /app/judging-server .

# Expose the server port
EXPOSE 8080

# Run as non-root user for security
RUN adduser -D -g '' appuser
USER appuser

CMD ["./judging-server"]
