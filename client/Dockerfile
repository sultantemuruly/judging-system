# ============================================================
# Lightweight nginx — serves pre-built dist/ only
# Run "npm run build" locally first, then docker build
# ============================================================
FROM nginx:1.27-alpine

# Remove default nginx page
RUN rm -rf /usr/share/nginx/html/*

# Copy the pre-built Vite output
COPY dist/ /usr/share/nginx/html/

# Custom nginx config: handle React Router (SPA fallback)
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    # SPA fallback — send all routes to index.html\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
\n\
    # Cache static assets aggressively\n\
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
\n\
    # Proxy API and WebSocket to the backend\n\
    location /ws {\n\
        proxy_pass http://server:8080;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Upgrade $http_upgrade;\n\
        proxy_set_header Connection "Upgrade";\n\
        proxy_set_header Host $host;\n\
    }\n\
\n\
    location /health {\n\
        proxy_pass http://server:8080;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
