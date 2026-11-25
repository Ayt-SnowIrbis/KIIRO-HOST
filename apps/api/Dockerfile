FROM node:24-alpine AS build
WORKDIR /workspace
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm install
COPY . .
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
RUN npm run build -w @kiiro/api

FROM node:24-alpine AS runner
WORKDIR /workspace
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /workspace ./
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
