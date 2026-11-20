FROM node:24-alpine AS build
WORKDIR /workspace
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm install
COPY . .
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
RUN npm run build -w @kiiro/worker

FROM node:24-alpine AS runner
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace ./
CMD ["node", "apps/worker/dist/main.js"]
