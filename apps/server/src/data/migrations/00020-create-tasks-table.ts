import { Migration, sql } from 'kysely';

export const createTasksTable: Migration = {
  up: async (db) => {
    await db.schema
      .createTable('tasks')
      .addColumn('id', 'varchar(30)', (col) => col.notNull().primaryKey())
      .addColumn('workspace_id', 'varchar(30)', (col) => col.notNull())
      .addColumn('type', 'varchar(30)', (col) =>
        col.generatedAlwaysAs(sql`(attributes->>'type')::VARCHAR(30)`).stored()
      )
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('attributes', 'jsonb', (col) => col.notNull())
      .addColumn('status', 'integer', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull())
      .addColumn('created_by', 'varchar(30)', (col) => col.notNull())
      .addColumn('started_at', 'timestamptz')
      .addColumn('active_at', 'timestamptz')
      .addColumn('completed_at', 'timestamptz')
      .execute();

    await db.schema
      .createIndex('tasks_workspace_id_idx')
      .on('tasks')
      .column('workspace_id')
      .execute();
  },
  down: async (db) => {
    await db.schema.dropTable('tasks').execute();
  },
};
