# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Python API
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y build-essential && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY src/ ./src/
COPY config/ ./config/
# data/ and reports/ are NOT baked in — mount them as volumes at runtime
# (docker-compose.yml does this automatically)

RUN pip install --no-cache-dir .

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

EXPOSE 8000
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
