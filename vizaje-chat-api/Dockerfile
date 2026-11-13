FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY drizzle.config.ts tsconfig.json ./

EXPOSE 3001
CMD ["bun", "run", "src/index.ts"]
