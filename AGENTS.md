# Discord VC 参加通知 Bot - 開発ガイド

このファイルは、Claude Codeを使用してこのプロジェクトを開発する際のガイドラインとコンテキストを提供します。

## プロジェクト概要

Discord サーバーにおいて、特定のボイスチャンネル（VC）にユーザーが参加した際、指定されたテキストチャンネルに自動で通知を行う Bot です。

**技術スタック**
- Runtime: Bun 1.3
- Discord Library: discord.js v14
- Database: SQLite 3 (bun:sqlite)
- Language: TypeScript
- Testing: Bun Test (TDD)
- Deployment: Coolify (Docker)

## アーキテクチャ

### レイヤー構造

```
Handler Layer (Discord イベント処理)
  ↓
Command Layer (Slash Command 処理)
  ↓
Service Layer (ビジネスロジック)
  ↓
Repository Layer (データアクセス)
  ↓
SQLite Database
```

### ディレクトリ構造

```
src/
├── index.ts                 # エントリーポイント
├── handlers/                # Discord イベントハンドラー
│   └── voiceState.ts       # VoiceStateUpdate ハンドラー
├── commands/                # Slash Commands
│   ├── setup.ts            # セットアップコマンド
│   └── rule.ts             # ルール管理コマンド
├── services/                # ビジネスロジック
│   ├── ruleService.ts      # ルール管理サービス
│   └── notifyService.ts    # 通知送信サービス
├── database/                # データベース
│   ├── repository.ts       # リポジトリ
│   ├── migrations.ts       # マイグレーション
│   └── schema.sql          # スキーマ定義
└── types/                   # 型定義
    └── index.ts

tests/
├── unit/                    # ユニットテスト
│   ├── handlers/
│   ├── services/
│   └── database/
└── integration/             # 統合テスト
    └── database/
```

## 開発ガイドライン

### コーディング規約

1. **TypeScript Strict モード**を使用
2. **ESM (ES Modules)**を使用
3. **依存性注入 (DI)**パターンを使用してクラス間の結合を緩和
4. **Repository パターン**を使用してデータアクセスを抽象化

### テスト戦略

- **テストカバレッジ目標: 80%以上**
- TDD (Test-Driven Development) を推奨
- ユニットテスト: 各関数・メソッド単体
- 統合テスト: DB + Service 層の統合

テスト実行:
```bash
bun test              # 全テスト実行
bun test --watch      # Watch mode
bun test --coverage   # カバレッジ
```

### データベース

**SQLite スキーマ**

```sql
CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  watched_voice_channel_ids TEXT NOT NULL, -- JSON配列
  target_user_ids TEXT NOT NULL,           -- JSON配列
  notification_channel_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_guild_id ON notification_rules(guild_id);
CREATE INDEX idx_enabled ON notification_rules(enabled);
```

**データモデル**

```typescript
interface NotificationRule {
  id: string; // UUID v4
  guildId: string;
  name: string;
  watchedVoiceChannelIds: string[];
  targetUserIds: string[];
  notificationChannelId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

## コア機能

### F-001: VC 参加検知

- Discord Gateway Events (`VoiceStateUpdate`) を監視
- 参加判定: `oldState.channel === null && newState.channel !== null`
- 検知目標: 100ms 以内

### F-002: ルールベース通知システム

**ルール評価ロジック**
1. 参加した VC チャンネルが watchedVoiceChannelIds に含まれるか
2. targetUserIds が空配列の場合は全ユーザー対象
3. targetUserIds に値がある場合は該当ユーザーのみ対象
4. enabled が true の場合のみ実行

**制約**
- 1 サーバーあたり最大 50 ルール
- 1 回の参加で複数ルール適用可能
- 同じ通知先への重複送信は抑制

### F-003: Slash Command インターフェース

**コマンド一覧**
- `/vc-notify setup` - 初回セットアップ
- `/vc-notify rule add` - ルール追加
- `/vc-notify rule list` - ルール一覧
- `/vc-notify rule edit` - ルール編集
- `/vc-notify rule toggle` - ルール有効/無効切り替え
- `/vc-notify rule delete` - ルール削除

**権限**
- 管理系コマンド: `MANAGE_GUILD` 権限が必要
- 参照系コマンド: 権限不要

## 環境変数

```env
DISCORD_TOKEN=        # Discord Bot Token (必須)
LOG_LEVEL=info        # ログレベル (debug, info, warn, error)
DB_PATH=./data/bot.db # データベースファイルパス
NODE_ENV=production   # 実行環境 (development, production)
```

## デプロイメント

### Coolify デプロイ

1. Coolify で GitHub リポジトリを接続
2. Dockerfile を使用してビルド
3. 環境変数 `DISCORD_TOKEN` を設定
4. Volume `/app/data` をマウント（SQLite データベース永続化）

### Docker ローカル実行

```bash
docker build -t vc-notify-bot .
docker run -d \
  -e DISCORD_TOKEN=your_token \
  -v $(pwd)/data:/app/data \
  vc-notify-bot
```

## Phase 2 以降の拡張計画

- VC 退出通知
- メンション機能
- 通知テンプレートカスタマイズ
- 通知履歴機能
- PostgreSQL 移行（1,000 サーバー超過時）
- Redis キャッシュ導入

## 参考資料

- [仕様書](docs/SPECIFICATION.md) - 詳細な機能要件とアーキテクチャ設計
- [Discord.js Guide](https://discordjs.guide/)
- [Discord.js Documentation](https://discord.js.org/)
- [Bun Documentation](https://bun.sh/docs)
- [Coolify Documentation](https://coolify.io/docs)

## 注意事項

### Bot 権限

Bot には以下の Discord 権限が必要:
- `VIEW_CHANNEL` - チャンネル閲覧
- `SEND_MESSAGES` - メッセージ送信
- `USE_SLASH_COMMANDS` - スラッシュコマンド使用

Intent:
- `Guilds`
- `GuildVoiceStates`

### エラーハンドリング

- 通知先チャンネル削除時: ルールを自動無効化
- Bot 権限不足時: エラーログ出力 + ユーザーに通知
- API 制限: Discord Rate Limit 遵守 + リトライ機構
- データベースエラー: トランザクションロールバック

## 開発フロー

1. Issue/タスクの確認
2. テストコード作成（TDD）
3. 実装
4. テスト実行
5. コミット
6. プッシュ（Coolify が自動デプロイ）

---

更新日: 2025-10-15
バージョン: 1.0.0
