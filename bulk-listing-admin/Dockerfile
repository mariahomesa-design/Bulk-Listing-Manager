FROM node:22-alpine
RUN apk add --no-cache openssl libc6-compat

EXPOSE 3000

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm exec prisma generate && pnpm run build

ENV NODE_ENV=production

CMD ["sh", "-c", "pnpm run setup && pnpm run start"]
