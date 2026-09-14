FROM node:18-bullseye-slim

# تثبيت الحزم الأساسية وأداة zsign الجاهزة
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    libssl1.1 \
    libzip4 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* || true

# تحميل نسخة zsign جاهزة ومباشرة بدون تجميع
RUN curl -L -o /usr/local/bin/zsign https://github.com/zhlynn/zsign/releases/download/v0.1/zsign \
    || (apt-get update && apt-get install -y git g++ make libssl-dev libzip-dev \
        && git clone --depth 1 https://github.com/zhlynn/zsign.git /tmp/zsign \
        && cd /tmp/zsign && g++ *.cpp -lcrypto -O3 -o /usr/local/bin/zsign \
        && rm -rf /tmp/zsign && apt-get purge -y git g++ make && apt-get autoremove -y)

RUN chmod +x /usr/local/bin/zsign

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 8000

CMD ["node", "server.js"]
