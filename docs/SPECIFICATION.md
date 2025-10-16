# Discord VC ボイス参加通知 Bot 仕様書 v1.0

## 1. プロジェクト概要

### 1.1 目的

Discord サーバーにおいて、特定のボイスチャンネル（VC）にユーザーが参加した際、指定されたテキストチャンネルに自動で通知を行う Bot。

### 1.2 背景

- チーム作業や配信において、VC への参加をリアルタイムで把握したい
- 複数の VC チャンネルと通知先を柔軟に管理したい
- サーバーごとに異なる通知設定を可能にする

### 1.3 スコープ

**対象**

- Discord Bot 開発（discord.js v14）
- Bun 1.3 ランタイム使用
- SQLite データベース
- Coolify Self-hosted デプロイ
- TDD 開発手法

**対象外**

- VC 退出通知（Phase 2 で検討）
- 音声処理機能
- Web 管理画面
- 他プラットフォーム連携

---

## 2. 機能要件

### 2.1 コア機能

#### F-001: VC 参加検知

**概要**: ユーザーの VC 参加をリアルタイムで検知

**詳細**

- Discord Gateway Events (`VoiceStateUpdate`)を監視
- 参加判定: `oldState.channel === null && newState.channel !== null`
- 移動は検知対象外: `oldState.channel && newState.channel`

**前提条件**

- Bot 権限: `VIEW_CHANNEL`, `SEND_MESSAGES`
- Intent: `GuildVoiceStates`

#### F-002: ルールベース通知システム

**概要**: 柔軟な通知ルール管理

**ルール構造**

```typescript
interface NotificationRule {
  id: string; // UUID
  guildId: string; // サーバーID
  name: string; // ルール名（ユーザー管理用）
  watchedVoiceChannelIds: string[]; // 監視対象VCチャンネルID配列
  targetUserIds: string[]; // 対象ユーザーID配列（空=全員）
  notificationChannelId: string; // 通知先チャンネルID（1つ）
  enabled: boolean; // 有効/無効
  createdAt: Date;
  updatedAt: Date;
}
```

**ルール評価ロジック**

1. 参加した VC チャンネルが watchedVoiceChannelIds に含まれるか
2. targetUserIds が空配列の場合は全ユーザー対象
3. targetUserIds に値がある場合は該当ユーザーのみ対象
4. enabled が true の場合のみ実行

**複数ルール対応**

- 1 サーバーあたり最大 50 ルール
- 1 回の参加で複数ルール適用可能
- 同じ通知先への重複送信は抑制

#### F-003: Slash Command インターフェース

**概要**: Discord Slash Commands による管理 UI

**コマンド一覧**

##### `/vc-notify setup`

初回セットアップウィザード

**実行条件**

- 実行者: `MANAGE_GUILD`権限
- Bot 権限確認

**処理フロー**

1. 現在の権限状態を表示
2. 不足権限がある場合は警告
3. サンプルルール作成の提案

**応答例**

```
✅ セットアップ完了
現在のBot権限: VIEW_CHANNEL, SEND_MESSAGES, USE_SLASH_COMMANDS
データベース: 初期化済み

次のステップ:
/vc-notify rule add でルールを作成してください
```

##### `/vc-notify rule add`

新規ルール作成

**パラメータ**

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| name | String | ✓ | ルール名（例: "開発チーム通知"） |

**インタラクションフロー**

1. コマンド実行
2. Modal 表示: ルール名入力
3. Select Menu: 監視 VC チャンネル選択（複数可）
4. Select Menu: 対象ユーザー選択（オプション、複数可）
5. Select Menu: 通知先チャンネル選択（1 つ）
6. 確認 Embed 表示
7. ボタン: [作成] [キャンセル]

**バリデーション**

- name: 1-50 文字、重複許可
- watchedVoiceChannelIds: 1-10 チャンネル
- targetUserIds: 0-50 ユーザー
- notificationChannelId: テキストチャンネルのみ

**応答例**

```
✅ ルール「開発チーム通知」を作成しました

監視対象VC: #開発用VC, #作業用VC
対象ユーザー: 全員
通知先: #general
状態: 有効

ルールID: rule_abc123
```

##### `/vc-notify rule list`

ルール一覧表示

**パラメータ**

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| show_disabled | Boolean | - | 無効なルールも表示 |

**応答形式**

- Embed 形式
- ページネーション（10 件/ページ）
- ボタン: [前へ] [次へ] [詳細表示]

**応答例**

```
📋 通知ルール一覧 (3件)

1️⃣ 開発チーム通知 ✅
   監視: #開発用VC, #作業用VC
   対象: 全員
   通知先: #general
   ID: rule_abc123

2️⃣ VIP専用通知 ✅
   監視: #VIP-VC
   対象: @Admin, @Moderator
   通知先: #vip-log
   ID: rule_def456

3️⃣ イベント通知 ❌ (無効)
   監視: #イベント会場
   対象: 全員
   通知先: #event-log
   ID: rule_ghi789
```

##### `/vc-notify rule edit`

ルール編集

**パラメータ**

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| rule_id | String | ✓ | ルール ID（Autocomplete） |

**Autocomplete**

- ユーザーが入力中にルール名+ID を検索表示
- サーバー内のルールのみ表示

**編集フロー**

1. 現在の設定を表示
2. Select Menu: 編集項目選択
   - ルール名
   - 監視 VC チャンネル
   - 対象ユーザー
   - 通知先チャンネル
3. 選択項目に応じた編集 UI 表示
4. 確認後保存

##### `/vc-notify rule toggle`

ルール有効/無効切り替え

**パラメータ**

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| rule_id | String | ✓ | ルール ID（Autocomplete） |

**応答例**

```
✅ ルール「開発チーム通知」を無効にしました
```

##### `/vc-notify rule delete`

ルール削除

**パラメータ**

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| rule_id | String | ✓ | ルール ID（Autocomplete） |

**削除フロー**

1. ルール詳細表示
2. 確認ボタン: [削除する] [キャンセル]
3. 削除実行（論理削除ではなく物理削除）

**応答例**

```
🗑️ ルール「開発チーム通知」を削除しました
```

#### F-004: 通知メッセージ

**概要**: VC チャンネル参加時の通知メッセージ

**メッセージ形式**

```
🔔 [ルール名]
👤 @username がボイスチャンネルに参加しました
🎤 #ボイスチャンネル名
⏰ 2025-10-15 14:30:45 JST

───────────────
ルールID: rule_abc123
```

**Embed 仕様**

```typescript
{
  color: 0x5865F2, // Discord Blurple
  author: {
    name: user.tag,
    iconURL: user.displayAvatarURL()
  },
  title: `🔔 ${rule.name}`,
  fields: [
    { name: "参加VC", value: channel.name, inline: true },
    { name: "時刻", value: timestamp, inline: true }
  ],
  footer: {
    text: `Rule ID: ${rule.id}`
  },
  timestamp: new Date()
}
```

**メンション**

- デフォルト: メンションなし
- オプション（Phase 2）: @ユーザーメンション

### 2.2 データ管理

#### F-005: データ永続化

**ストレージ**: SQLite 3

**スキーマ**

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

**マイグレーション**

- 起動時自動実行
- バージョン管理: `schema_version`テーブル

#### F-006: データバックアップ

**概要**: SQLite ファイルの定期バックアップ

**要件**

- 手動バックアップコマンド（Phase 2）
- 自動バックアップ（Coolify Volume 経由）

### 2.3 エラーハンドリング

#### F-007: エラー対応

**通知先チャンネル削除時**

- Audit log出力
- ルールを自動無効化

**Bot 権限不足時**

- エラーログ出力
- コマンド実行者にエラー返信
- 必要な権限を明示

**API 制限**

- Discord Rate Limit 遵守
- リトライ機構（指数バックオフ）

**データベースエラー**

- トランザクションロールバック
- エラーログ出力
- ユーザーにエラー通知

---

## 3. 非機能要件

### 3.1 セキュリティ

#### S-001: 認証・認可

**Bot 認証**

- Discord Bot Token（環境変数管理）
- Token 漏洩時の対策: 即座に再発行

**コマンド権限**

| コマンド | 必要権限 |
|---------|---------|
| setup | MANAGE_GUILD |
| rule add/edit/delete | MANAGE_GUILD |
| rule list | - |
| rule toggle | MANAGE_GUILD |

#### S-002: データ保護

**機密情報**

- Bot Token: 環境変数のみ
- DB 暗号化: 不要

**個人情報**

- ユーザー ID: Discord 規約に準拠
- データ削除: サーバーから Bot 削除時

#### S-003: インジェクション対策

- SQL: Prepared Statements 使用
- コマンド入力: バリデーション必須

### 3.5 保守性

**ログ**

- レベル: ERROR, WARN, INFO, DEBUG
- 出力先: stdout（Coolify 収集）
- フォーマット: JSON

**モニタリング**

- メトリクス: Bot ステータス、エラー率
- アラート: エラー率 > 5%

### 3.6 互換性

**Discord API**

- API Version: v10
- Gateway: v10

**Bun Runtime**

- Version: 1.3.x

**discord.js**

- Version: 14.x

---

## 4. アーキテクチャ設計

### 4.1 全体構成

```text
┌─────────────────────────────────────────┐
│           Discord Gateway               │
│     (VoiceStateUpdate Events)           │
└─────────────┬───────────────────────────┘
              │
              │ WebSocket
              │
┌─────────────▼───────────────────────────┐
│         Discord.js Client               │
│  ┌─────────────────────────────────┐    │
│  │   Event Handler                 │    │
│  │   - VoiceStateUpdate            │    │
│  │   - InteractionCreate           │    │
│  │   - Ready                       │    │
│  └──────────┬──────────────────────┘    │
└─────────────┼───────────────────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
┌───▼─────────┐  ┌──────▼────────┐
│  Handlers   │  │   Commands    │
│  Layer      │  │   Layer       │
└───┬─────────┘  └──────┬────────┘
    │                   │
    └─────────┬─────────┘
              │
     ┌────────▼─────────┐
     │   Service Layer  │
     │  - RuleService   │
     │  - NotifyService │
     └────────┬─────────┘
              │
     ┌────────▼─────────┐
     │ Repository Layer │
     │  - RuleRepo      │
     └────────┬─────────┘
              │
     ┌────────▼─────────────┐
     │  SQLite (bun:sqlite) │
     │   /app/data/bot.db   │
     └──────────────────────┘
```

### 4.2 レイヤー設計

#### Handler Layer

**責務**: Discord イベント処理

```typescript
// src/handlers/voiceState.ts
export class VoiceStateHandler {
  constructor(
    private ruleService: RuleService,
    private notifyService: NotifyService
  ) {}

  async handle(
    oldState: VoiceState,
    newState: VoiceState
  ): Promise<void> {
    // 参加判定
    if (!this.isJoinEvent(oldState, newState)) return;

    // ルール取得
    const rules = await this.ruleService.getApplicableRules(
      newState.guild.id,
      newState.channel!.id,
      newState.member!.user.id
    );

    // 通知実行
    await Promise.all(
      rules.map(rule =>
        this.notifyService.sendNotification(rule, newState)
      )
    );
  }

  private isJoinEvent(old: VoiceState, new: VoiceState): boolean {
    return !old.channel && !!new.channel;
  }
}
```

#### Command Layer

**責務**: Slash Command 処理

```typescript
// src/commands/rule.ts
export class RuleCommand {
  constructor(private ruleService: RuleService) {}

  async handleAdd(interaction: CommandInteraction): Promise<void> {
    // Modal表示
    // Select Menu処理
    // ルール作成
    // 応答
  }

  async handleList(interaction: CommandInteraction): Promise<void> {
    // ルール取得
    // Embed生成
    // ページネーション
  }

  // その他のコマンドハンドラー
}
```

#### Service Layer

**責務**: ビジネスロジック

```typescript
// src/services/ruleService.ts
export class RuleService {
  constructor(private repo: RuleRepository) {}

  async getApplicableRules(
    guildId: string,
    channelId: string,
    userId: string
  ): Promise<NotificationRule[]> {
    const rules = await this.repo.findEnabledByGuild(guildId);

    return rules.filter((rule) => {
      // VCチャンネルチェック
      if (!rule.watchedVoiceChannelIds.includes(channelId)) {
        return false;
      }

      // ユーザーチェック
      if (
        rule.targetUserIds.length > 0 &&
        !rule.targetUserIds.includes(userId)
      ) {
        return false;
      }

      return true;
    });
  }
}
```

#### Repository Layer

**責務**: データアクセス

```typescript
// src/database/repository.ts
export class RuleRepository {
  constructor(private db: Database) {}

  createRule(data: CreateRuleDTO): NotificationRule {
    const stmt = this.db.query(`
      INSERT INTO notification_rules
      (id, guild_id, name, watched_voice_channel_ids,
       target_user_ids, notification_channel_id,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);

    const rule = stmt.get(
      uuidv4(),
      data.guildId,
      data.name,
      JSON.stringify(data.watchedVoiceChannelIds),
      JSON.stringify(data.targetUserIds),
      data.notificationChannelId,
      new Date().toISOString(),
      new Date().toISOString()
    ) as any;

    return this.deserializeRule(rule);
  }

  findByGuild(guildId: string): NotificationRule[] {
    const stmt = this.db.query(`
      SELECT * FROM notification_rules
      WHERE guild_id = ?
      ORDER BY created_at DESC
    `);

    return stmt.all(guildId).map(this.deserializeRule);
  }

  private deserializeRule(row: any): NotificationRule {
    return {
      ...row,
      watchedVoiceChannelIds: JSON.parse(row.watched_voice_channel_ids),
      targetUserIds: JSON.parse(row.target_user_ids),
      enabled: !!row.enabled,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
```

### 4.3 依存性注入

```typescript
// src/index.ts
import { Client, GatewayIntentBits } from 'discord.js';
import { Database } from 'bun:sqlite';

// DB初期化
const db = new Database('./data/bot.db');

// Repository
const ruleRepo = new RuleRepository(db);

// Services
const ruleService = new RuleService(ruleRepo);
const notifyService = new NotifyService();

// Handlers
const voiceStateHandler = new VoiceStateHandler(
  ruleService,
  notifyService
);

// Commands
const ruleCommand = new RuleCommand(ruleService);

// Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Event Registration
client.on('voiceStateUpdate', (old, new) =>
  voiceStateHandler.handle(old, new)
);

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'vc-notify') {
    await ruleCommand.handleInteraction(interaction);
  }
});

client.login(process.env.DISCORD_TOKEN);
```

---

## 5. データモデル

### 5.1 エンティティ定義

#### NotificationRule

```typescript
interface NotificationRule {
  id: string; // UUID v4
  guildId: string; // Discord Snowflake
  name: string; // 1-50文字
  watchedVoiceChannelIds: string[]; // 1-10要素
  targetUserIds: string[]; // 0-50要素
  notificationChannelId: string; // Discord Snowflake
  enabled: boolean; // デフォルト: true
  createdAt: Date;
  updatedAt: Date;
}
```

#### DTO（Data Transfer Object）

```typescript
// ルール作成
interface CreateRuleDTO {
  guildId: string;
  name: string;
  watchedVoiceChannelIds: string[];
  targetUserIds: string[];
  notificationChannelId: string;
}

// ルール更新
interface UpdateRuleDTO {
  name?: string;
  watchedVoiceChannelIds?: string[];
  targetUserIds?: string[];
  notificationChannelId?: string;
}

// 通知データ
interface NotificationData {
  rule: NotificationRule;
  user: {
    id: string;
    tag: string;
    avatarURL: string;
  };
  voiceChannel: {
    id: string;
    name: string;
  };
  timestamp: Date;
}
```

### 5.2 バリデーションルール

```typescript
const RuleValidation = {
  name: {
    minLength: 1,
    maxLength: 50,
    pattern: /^[\w\s\-_]+$/,
  },
  watchedVoiceChannelIds: {
    minItems: 1,
    maxItems: 10,
    itemPattern: /^\d{17,19}$/, // Discord Snowflake
  },
  targetUserIds: {
    minItems: 0,
    maxItems: 50,
    itemPattern: /^\d{17,19}$/,
  },
};
```

---

## 6. インターフェース設計

### 6.1 Slash Commands 定義

```typescript
// src/commands/definitions.ts
export const commands = [
  {
    name: "vc-notify",
    description: "VC参加通知Bot管理",
    options: [
      {
        name: "setup",
        description: "初期セットアップ",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "rule",
        description: "ルール管理",
        type: ApplicationCommandOptionType.SubcommandGroup,
        options: [
          {
            name: "add",
            description: "ルール追加",
            type: ApplicationCommandOptionType.Subcommand,
          },
          {
            name: "list",
            description: "ルール一覧",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "show_disabled",
                description: "無効なルールも表示",
                type: ApplicationCommandOptionType.Boolean,
                required: false,
              },
            ],
          },
          {
            name: "edit",
            description: "ルール編集",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "rule_id",
                description: "ルールID",
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true,
              },
            ],
          },
          {
            name: "toggle",
            description: "ルール有効/無効切り替え",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "rule_id",
                description: "ルールID",
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true,
              },
            ],
          },
          {
            name: "delete",
            description: "ルール削除",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "rule_id",
                description: "ルールID",
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true,
              },
            ],
          },
        ],
      },
    ],
  },
];
```

### 6.2 UI コンポーネント

#### Modal（ルール名入力）

```typescript
const modal = new ModalBuilder()
  .setCustomId("rule_name_modal")
  .setTitle("ルール名入力")
  .addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("rule_name")
        .setLabel("ルール名")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("例: 開発チーム通知")
        .setRequired(true)
        .setMaxLength(50)
    )
  );
```

#### Select Menu（VC チャンネル選択）

```typescript
const selectMenu = new ChannelSelectMenuBuilder()
  .setCustomId("select_voice_channels")
  .setPlaceholder("監視するVCチャンネルを選択")
  .setChannelTypes(ChannelType.GuildVoice)
  .setMinValues(1)
  .setMaxValues(10);
```

#### Button（確認・キャンセル）

```typescript
const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId("confirm_create")
    .setLabel("作成")
    .setStyle(ButtonStyle.Success),
  new ButtonBuilder()
    .setCustomId("cancel_create")
    .setLabel("キャンセル")
    .setStyle(ButtonStyle.Secondary)
);
```

---

## 7. テスト要件

### 7.1 テスト戦略

#### テストピラミッド

```
        /\
       /  \     E2E Tests (5%)
      /____\    - Botの統合動作確認
     /      \
    /        \  Integration Tests (15%)
   /__________\ - DB + Service層
  /            \
 /              \ Unit Tests (80%)
/________________\ - 各関数・メソッド単体
```

### 7.2 Unit Tests

**カバレッジ目標**: 80%以上

**対象**

```typescript
// Repository Layer
describe("RuleRepository", () => {
  test("createRule: 正常系");
  test("createRule: バリデーションエラー");
  test("findByGuild: 0件");
  test("findByGuild: 複数件");
  test("updateRule: 正常系");
  test("deleteRule: 正常系");
  test("deserializeRule: JSON配列パース");
});

// Service Layer
describe("RuleService", () => {
  test("getApplicableRules: 全員対象");
  test("getApplicableRules: 特定ユーザー対象");
  test("getApplicableRules: マッチなし");
  test("getApplicableRules: 複数ルールマッチ");
  test("getApplicableRules: 無効ルール除外");
});

// Handler Layer
describe("VoiceStateHandler", () => {
  test("handle: 参加イベント検知");
  test("handle: 移動イベント無視");
  test("handle: 退出イベント無視");
  test("handle: 通知送信成功");
  test("handle: 通知送信失敗時エラーハンドリング");
});
```

### 7.3 Integration Tests

**対象**: DB + Service 層の統合

```typescript
describe("RuleService Integration", () => {
  let db: Database;
  let repo: RuleRepository;
  let service: RuleService;

  beforeEach(() => {
    db = new Database(":memory:");
    // マイグレーション実行
    repo = new RuleRepository(db);
    service = new RuleService(repo);
  });

  afterEach(() => db.close());

  test("ルール作成から取得まで", async () => {
    // ルール作成
    const created = await service.createRule({
      guildId: "123",
      name: "Test",
      watchedVoiceChannelIds: ["456"],
      targetUserIds: [],
      notificationChannelId: "789",
    });

    // 取得
    const rules = await service.getApplicableRules("123", "456", "user1");

    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(created.id);
  });
});
```

### 7.4 E2E Tests（Phase 2）

**対象**: Bot 全体の動作

```typescript
describe("E2E: VC Join Notification", () => {
  test("ユーザーがVCに参加すると通知が送信される", async () => {
    // 1. ルール作成
    // 2. モックユーザーがVC参加をシミュレート
    // 3. 通知チャンネルにメッセージが送信されたか確認
  });
});
```

### 7.5 テスト実行

プロジェクトの公式テスト手順は mise タスク経由で統一する。

```bash
# 全テスト実行
mise run test

# Watch mode
mise run test:watch

# カバレッジ
mise run test:coverage

# 特定ファイル（ローカル確認用の直接実行例）
bun test tests/database/repository.test.ts

# タイムアウト指定（必要に応じて直接実行）
bun test --timeout 10000
```

---

## 8. デプロイメント要件

### 8.1 環境構成

#### 環境変数

```bash
# 必須
DISCORD_TOKEN=your_bot_token_here

# オプション
LOG_LEVEL=info              # debug, info, warn, error
DB_PATH=/app/data/bot.db   # SQLiteファイルパス
NODE_ENV=production        # development, production
```

### 8.2 Dockerfile

```dockerfile
FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# 依存関係インストール
FROM base AS deps
COPY package.json bun.lockb ./
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

# ヘルスチェック（オプション）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun run healthcheck.ts || exit 1

# Volume
VOLUME ["/app/data"]

# 起動
CMD ["bun", "run", "src/index.ts"]
```

### 8.3 Coolify 設定

**デプロイタイプ**: Dockerfile

**Volume 設定**

```yaml
volumes:
  - /app/data:/persistent-data/bot-data
```

**環境変数**

- Coolify UI から`DISCORD_TOKEN`設定
- その他の環境変数も必要に応じて設定

**リソース制限**

- Memory: 256MB-512MB
- CPU: 0.5-1 core

**再起動ポリシー**

```yaml
restart: unless-stopped
```

### 8.4 CI/CD（GitHub Actions）

```yaml
name: CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.0

      - name: Install dependencies
        run: bun install

      - name: Run tests
        run: bun test --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Coolify Deploy
        run: |
          curl -X POST ${{ secrets.COOLIFY_WEBHOOK_URL }}
```

---

## 9. 運用・監視

### 9.1 ログ設計

**ログレベル**

```typescript
enum LogLevel {
  DEBUG = "debug", // 開発時のみ
  INFO = "info", // 通常動作
  WARN = "warn", // 警告
  ERROR = "error", // エラー
}
```

**ログフォーマット（JSON）**

```json
{
  "timestamp": "2025-10-15T14:30:45.123Z",
  "level": "info",
  "message": "User joined voice channel",
  "context": {
    "guildId": "123456789",
    "userId": "987654321",
    "channelId": "456789123",
    "ruleId": "rule_abc123"
  }
}
```

**重要ログイベント**

- Bot 起動/停止
- VC 参加検知
- 通知送信（成功/失敗）
- コマンド実行
- エラー発生
- Rate Limit 到達

### 9.2 メトリクス

**収集項目**

- 処理中のイベント数
- 通知送信成功率
- 通知送信レイテンシ
- エラー発生率
- アクティブサーバー数
- アクティブルール数

**ツール**（Phase 2）

- Prometheus
- Grafana

### 9.3 アラート

**アラート条件**

- エラー率 > 5%（5 分間）
- 通知送信失敗率 > 10%（5 分間）
- Bot 接続切断
- DB 接続エラー

**通知先**

- Discord Webhook
- Email

### 9.4 バックアップ

**SQLite バックアップ**

```bash
# Coolify Volume経由で定期バックアップ
# または手動コマンド（Phase 2）
/vc-notify admin backup
```

**復元手順**

1. Coolify Volume 確認
2. SQLite ファイルコピー
3. Bot 再起動

---

## 10. Phase 2 以降の拡張計画

### 10.1 機能拡張

**Phase 2**

- VC 退出通知
- メンション機能
- 通知テンプレートカスタマイズ
- 管理 Web ダッシュボード
- 通知履歴機能

**Phase 3**

- 統計・分析機能
- 複数 Bot 言語対応
- カスタム通知音
- スケジュール通知（定期メンテナンス等）

### 10.2 技術的拡張

**データベース**

- PostgreSQL 移行（1,000 サーバー超過時）
- Redis キャッシュ導入

**インフラ**

- 水平スケーリング
- Discord Bot Sharding

**モニタリング**

- Prometheus/Grafana
- Sentry（エラートラッキング）

---

## 11. 付録

### 11.1 用語集

| 用語          | 説明                                        |
| ------------- | ------------------------------------------- |
| VC            | Voice Channel（ボイスチャンネル）           |
| Rule          | 通知ルール                                  |
| Guild         | Discord サーバー                            |
| Snowflake     | Discord ID 形式（64bit 整数）               |
| Intent        | Discord Gateway 接続時の権限指定            |
| Slash Command | Discord のスラッシュコマンド（/から始まる） |

### 11.2 参考リンク

**Discord**

- [Discord Developer Portal](https://discord.com/developers/docs)
- [discord.js Guide](https://discordjs.guide/)
- [discord.js Documentation](https://discord.js.org/)

**Bun**

- [Bun Documentation](https://bun.sh/docs)
- [bun:sqlite](https://bun.sh/docs/api/sqlite)
- [bun:test](https://bun.sh/docs/cli/test)

**Coolify**

- [Coolify Documentation](https://coolify.io/docs)

### 11.3 変更履歴

| バージョン | 日付       | 変更内容 | 作成者 |
| ---------- | ---------- | -------- | ------ |
| 1.0        | 2025-10-15 | 初版作成 | -      |

---
