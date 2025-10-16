export interface MigrationRunner {
  runMigrations: () => Promise<void>;
}

export function createMigrationRunner(): MigrationRunner {
  return {
    async runMigrations() {
      // TODO(#5): schema.sql を適用してテーブルを作成
    },
  };
}
