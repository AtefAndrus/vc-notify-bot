FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# 依存関係インストール
FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

# ビルド（必要な場合）
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# TypeScriptコンパイル等

# 実行環境
FROM base AS runner
ENV NODE_ENV=production

# 依存関係コピー
COPY --from=deps /app/node_modules ./node_modules

# アプリケーションコピー
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

# データディレクトリ作成
RUN mkdir -p /app/data && chown -R bun:bun /app/data

# 非rootユーザーで実行
USER bun

# Volume
VOLUME ["/app/data"]

# 起動
CMD ["bun", "run", "src/index.ts"]
