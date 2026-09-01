# Discord VC notification bot

DiscordのVC参加を検知し、設定されたテキストチャンネルへ通知するBun製Botである。
利用者向けのセットアップとコマンドは`README.md`、機能要件と設計は`docs/SPECIFICATION.md`をSoTとする。
仕様値、データモデル、権限一覧、将来計画をこのファイルへ複製しない。

## Commands

miseタスクを標準の入口として使う。

```bash
mise run test
mise run test:watch
mise run test:coverage
mise run typecheck
```

package scriptを直接使う必要がある場合は`package.json`で現在の定義を確認する。
変更後は少なくとも`mise run test`を実行し、対象に応じてcoverageも確認する。

## Architecture

依存関係はhandler、command、service、repository、SQLiteの順に分離する。
Discord APIやデータベースを扱うコードからビジネスロジックをserviceへ分離し、依存性注入を保つ。
データアクセスはrepository経由とし、serviceやhandlerからSQLiteを直接操作しない。
TypeScript strict modeとES modulesを維持し、型安全性を下げる回避策を追加しない。

## Change synchronization

- Slash commandの名前、引数、権限、応答を変えたら、command定義、handler、テスト、`README.md`、`docs/SPECIFICATION.md`の対応箇所を同時に更新する。
- 通知ルールや永続化形式を変えたら、schema、migration、型、repository、service、テストを一つの変更として扱う。
- 環境変数を変えたら、起動時検証、`.env.example`、`README.md`、デプロイ文書を同期する。
- Discord intentまたはBot権限を変えたら、実装だけでなくDeveloper Portal側で必要な設定を文書化する。
- Coolifyで使うSQLiteの永続化先を変える場合は、既存データの移行とrollback方法を先に定める。

## Safety and Git

`DISCORD_TOKEN`や実サーバーの識別子をログ、fixture、コミットへ含めない。
実Discordサーバーへのコマンド登録、通知送信、デプロイは外部状態を変更するため、ユーザーが明示的に依頼した場合だけ行う。
コミット、push、PR作成もユーザーが明示的に依頼した場合だけ行う。
