FROM node:22-alpine AS frontend
WORKDIR /src/frontend
ARG VITE_API_URL=/api/v1
ARG VITE_PUBLIC_URL=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PUBLIC_URL=$VITE_PUBLIC_URL
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS backend
WORKDIR /src/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV WEB_DIR=/app/web
ENV UPLOAD_DIR=/app/uploads
RUN apk add --no-cache wget
COPY --from=backend /src/backend/package.json ./
COPY --from=backend /src/backend/node_modules ./node_modules
COPY --from=backend /src/backend/dist ./dist
COPY --from=frontend /src/frontend/dist ./web
RUN mkdir -p /app/uploads
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --retries=5 CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["node", "dist/server.js"]
