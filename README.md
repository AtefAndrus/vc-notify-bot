# Discord VC 参加通知 Bot

Discord サーバーにおいて、特定のボイスチャンネル（VC）にユーザーが参加した際、指定されたテキストチャンネルに自動で通知を行う Bot です。

## 概要

- VC 参加をリアルタイムで検知し、柔軟なルールベースで通知を送信
- Slash Commands による直感的な管理インターフェース
- Bun 1.3 ランタイム + discord.js v14 を使用
- SQLite データベースによる軽量なデータ管理
- Coolify Self-hosted デプロイメントに対応

## 主な機能

- **VC 参加検知**: Discord Gateway Events を監視し、リアルタイム検知
- **ルールベース通知システム**: 監視対象 VC、対象ユーザー、通知先チャンネルを柔軟に設定
- **Slash Commands 管理**: `/vc-notify` コマンドによる直感的なルール管理
- **複数ルール対応**: 1 サーバーあたり最大 50 ルールを設定可能

## 必要な権限

Bot には以下の権限が必要です:

- `VIEW_CHANNEL` - チャンネル閲覧
- `SEND_MESSAGES` - メッセージ送信
- `USE_SLASH_COMMANDS` - スラッシュコマンド使用

Intent:

- `Guilds`
- `GuildVoiceStates`

## セットアップ

### 0. 事前準備

- [mise](https://mise.jdx.dev/) をインストールしてください。

### 1. ツールと依存関係のインストール

```bash
mise install
mise run setup
```

### 2. 環境変数の設定

`.env` が未作成の場合は「1. ツールと依存関係のインストール」で自動生成されます。必要に応じて `.env` を編集し、Discord Bot Token を設定してください:

```env
DISCORD_TOKEN=your_bot_token_here
```

### 3. Bot の起動

```bash
mise run start
```

### 4. Discord での初期設定

Bot を Discord サーバーに招待後、以下のコマンドを実行:

```text
/vc-notify setup
```

## コマンド一覧

- `/vc-notify setup` - 初回セットアップ
- `/vc-notify rule add` - 通知ルール追加
- `/vc-notify rule list` - ルール一覧表示
- `/vc-notify rule edit` - ルール編集
- `/vc-notify rule toggle` - ルール有効/無効切り替え
- `/vc-notify rule delete` - ルール削除

## 技術スタック

- **Runtime**: Bun 1.3
- **Discord Library**: discord.js v14
- **Database**: SQLite 3 (bun:sqlite)
- **Language**: TypeScript
- **Testing**: Bun Test
- **Deployment**: Coolify (Docker)

## プロジェクト構造

```text
vc-notify-bot/
├── README.md
├── mise.toml               # mise 設定 & タスク定義
├── package.json            # 依存関係とスクリプト
├── bun.lock                # Bun ロックファイル
├── tsconfig.json
├── .env.example            # 環境変数ファイル
├── docs/
│   └── SPECIFICATION.md    # 詳細仕様
├── src/                    # 実装
├── tests/                  # テスト
└── Dockerfile
```

## 開発

### テスト実行

```bash
# 全テスト
mise run test

# Watch モード
mise run test:watch

# カバレッジ
mise run test:coverage
```

### データベース

SQLite データベースは `data/bot.db` に保存されます。

## デプロイ

Coolify を使用した Docker デプロイメントに対応しています。

詳細は [docs/SPECIFICATION.md](docs/SPECIFICATION.md) を参照してください。

## ドキュメント

- [仕様書](docs/SPECIFICATION.md) - 詳細な機能要件とアーキテクチャ設計

## ライセンス

MIT License
