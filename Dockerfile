# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
# Copy package files
COPY frontend/package*.json ./
RUN npm install

# Copy source and build
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and serve
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy backend dependencies
# We use requirements.txt (if generated via uv/pip) or just pip install directly if we provide a pyproject.toml
# For simplicity with uv, we can install the package
COPY pyproject.toml README.md ./
COPY src/ ./src/
COPY data/ ./data/
COPY config/ ./config/
COPY reports/ ./reports/

RUN pip install --no-cache-dir .

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose API port
EXPOSE 8000

# Run the FastAPI server
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
