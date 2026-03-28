# Judging System

A real-time tournament judging and bracket management system.

**Stack:** Go (WebSocket server) · React + TypeScript · Vite · Tailwind CSS

---

## Prerequisites

Make sure you have the following installed before running the project:

| Tool | Version | Download |
|------|---------|----------|
| [Go](https://go.dev/dl/) | 1.21+ | https://go.dev/dl/ |
| [Node.js](https://nodejs.org/) | 18+ | https://nodejs.org/ |
| npm | comes with Node.js | — |

---

## Project Structure

```
judging-system/
├── server/          # Go backend (WebSocket + REST API, port 8080)
│   ├── main.go
│   ├── store.go
│   ├── tournament_store.go
│   └── ...
└── client/          # React + Vite frontend (port 5173)
    ├── src/
    ├── index.html
    └── ...
```

---

## Running the Server (Go)

```bash
cd server

# Install dependencies (first time only)
go mod download

# Run the server
go run .
```

The server will start at **http://localhost:8080**

To verify it's running, open: http://localhost:8080/health — it should return `OK`.

> **Build a binary (optional):**
> ```bash
> go build -o judging-server.exe .
> ./judging-server.exe
> ```

---

## Running the Client (React + Vite)

Open a **new terminal window** (keep the server running):

```bash
cd client

# Install dependencies (first time only)
npm install

# Start the dev server
npm run dev
```

The app will open at **http://localhost:5173**

---

## Running Both at the Same Time

You need **two terminal windows** running simultaneously:

**Terminal 1 — Server:**
```bash
cd server
go run .
```

**Terminal 2 — Client:**
```bash
cd client
npm run dev
```

Then open **http://localhost:5173** in your browser.

---

## Build for Production

```bash
# Build the frontend
cd client
npm run build
# Output will be in client/dist/

# Build the backend binary
cd server
go build -o judging-server.exe .
```

---

## Troubleshooting

**WebSocket connection errors** — Make sure the Go server is running on port `8080` before opening the client.

**`go: command not found`** — Install Go from https://go.dev/dl/ and restart your terminal.

**`npm: command not found`** — Install Node.js from https://nodejs.org/ and restart your terminal.

**Port already in use** — Kill the process using the port:
```bash
# Windows
netstat -ano | findstr :8080
taskkill /PID <PID> /F
```
# 1. Сначала собери клиент локально
cd client
npm run build

# 2. Запусти всё через docker-compose
cd ..
docker-compose up --build
