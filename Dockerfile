FROM python:3.11-slim

WORKDIR /app

# Set Python to run in unbuffered mode
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy only the necessary files
COPY pyproject.toml .
COPY README.md .
COPY LICENSE .
COPY Makefile .
COPY src/ src/

# Install dependencies and package
RUN pip install --no-cache-dir -e ".[dev]"

# Expose the port from environment variable
EXPOSE 9000

CMD ["aiaio", "app", "--host", "0.0.0.0", "--port", "9000"]
