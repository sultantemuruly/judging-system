# ============================================================
# Lightweight nginx — serves pre-built dist/ only
# Run "npm run build" locally first, then docker build
# ============================================================
FROM nginx:1.27-alpine

# Remove default nginx page
RUN rm -rf /usr/share/nginx/html/*

# Copy the pre-built Vite output
COPY dist/ /usr/share/nginx/html/

# Copy nginx config (separate file for clarity and easy editing)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
