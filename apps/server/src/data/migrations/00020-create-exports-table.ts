import { Migration } from 'kysely';

export const createExportsTable: Migration = {
  up: async (db) => {
    await db.schema
      .createTable('exports')
      .addColumn('id', 'varchar(30)', (col) => col.notNull().primaryKey())
      .addColumn('workspace_id', 'varchar(30)', (col) => col.notNull())
      .addColumn('type', 'varchar(255)', (col) => col.notNull())
      .addColumn('counts', 'jsonb')
      .addColumn('files', 'jsonb')
      .addColumn('status', 'integer', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull())
      .addColumn('created_by', 'varchar(30)', (col) => col.notNull())
      .addColumn('started_at', 'timestamptz')
      .addColumn('updated_at', 'timestamptz')
      .addColumn('completed_at', 'timestamptz')
      .execute();
  },
  down: async (db) => {
    await db.schema.dropTable('exports').execute();
  },
};
