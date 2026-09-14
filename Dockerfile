FROM node:18-bullseye

RUN apt-get update && apt-get install -y \
    git \
    g++ \
    clang \
    make \
    libssl-dev \
    libzip-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/zhlynn/zsign.git /tmp/zsign \
    && cd /tmp/zsign \
    && g++ *.cpp -lcrypto -I/usr/include -L/usr/lib -O3 -o /usr/local/bin/zsign \
    && rm -rf /tmp/zsign

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8000

CMD ["node", "server.js"]
