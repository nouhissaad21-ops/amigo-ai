#!/bin/bash
echo "🔄 Setting up Redis..."

# Add to docker-compose.yml
cat >> docker-compose.yml << 'EOF'

  redis:
    image: redis:7-alpine
    container_name: amigo-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    restart: unless-stopped

volumes:
  redis-data:
EOF

echo "✅ Redis configuration added to docker-compose.yml"
echo "Run: docker compose up -d redis"
