# ============================================================
# Stage 1: build the client
# ============================================================
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ============================================================
# Stage 2: nginx serves the build and proxies /ws to the server
# ============================================================
FROM nginx:1.27-alpine

RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
