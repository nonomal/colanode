import { Migration, sql } from 'kysely';

export const createTasksTable: Migration = {
  up: async (db) => {
    await db.schema
      .createTable('tasks')
      .addColumn('id', 'varchar(30)', (col) => col.notNull().primaryKey())
      .addColumn('type', 'varchar(30)', (col) =>
        col.generatedAlwaysAs(sql`(attributes->>'type')::VARCHAR(30)`).stored()
      )
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('attributes', 'jsonb', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull())
      .addColumn('created_by', 'varchar(30)', (col) => col.notNull())
      .addColumn('started_at', 'timestamptz')
      .addColumn('active_at', 'timestamptz')
      .addColumn('completed_at', 'timestamptz')
      .addColumn('status', 'integer', (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex('tasks_created_by_idx')
      .on('tasks')
      .column('created_by')
      .execute();
  },
  down: async (db) => {
    await db.schema.dropTable('tasks').execute();
  },
};
