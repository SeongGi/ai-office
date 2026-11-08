# AI Office 서버 이미지. 웹앱은 이미지 안에서 따로 빌드한다.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# typescript와 vite의 네이티브 바이너리는 optional 의존성이라 제외하면 안 된다. electron 바이너리만 건너뛴다.
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    AI_OFFICE_HOST=0.0.0.0 \
    AI_OFFICE_SEED=0 \
    AI_OFFICE_AUTOLAUNCH=0 \
    AI_OFFICE_DEVICE=서버
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY adapters ./adapters
COPY bin ./bin
COPY package.json ./
# 감사 기록 폴더. 이름 붙은 볼륨이 이 소유권을 이어받는다.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4317/health || exit 1
CMD ["node", "server/index.mjs"]
