import { Migration } from 'kysely';

export const createTaskArtifactsTable: Migration = {
  up: async (db) => {
    await db.schema
      .createTable('task_artifacts')
      .addColumn('id', 'varchar(30)', (col) => col.notNull().primaryKey())
      .addColumn('task_id', 'varchar(30)', (col) => col.notNull())
      .addColumn('type', 'varchar(255)', (col) => col.notNull())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('mime_type', 'varchar(255)', (col) => col.notNull())
      .addColumn('size', 'integer', (col) => col.notNull())
      .addColumn('path', 'text', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull())
      .addColumn('expires_at', 'timestamptz')
      .addColumn('status', 'integer', (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex('task_artifacts_task_id_idx')
      .on('task_artifacts')
      .column('task_id')
      .execute();
  },
  down: async (db) => {
    await db.schema.dropTable('task_artifacts').execute();
  },
};
