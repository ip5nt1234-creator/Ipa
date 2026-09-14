FROM node:18-bullseye-slim

RUN apt-get update && apt-get install -y curl tar ca-certificates && rm -rf /var/lib/apt/lists/*

RUN curl -sL https://github.com/zhlynn/zsign/releases/download/v1.1.2/zsign-linux-x86_64.tar.gz | tar -xz -C /usr/local/bin/ && chmod +x /usr/local/bin/zsign

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8000

CMD ["node", "server.js"]
