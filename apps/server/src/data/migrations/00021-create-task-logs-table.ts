import { Migration } from 'kysely';

export const createTaskLogsTable: Migration = {
  up: async (db) => {
    await db.schema
      .createTable('task_logs')
      .addColumn('id', 'varchar(30)', (col) => col.notNull().primaryKey())
      .addColumn('task_id', 'varchar(30)', (col) => col.notNull())
      .addColumn('level', 'integer', (col) => col.notNull())
      .addColumn('message', 'text', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull())
      .execute();

    await db.schema
      .createIndex('task_logs_task_id_idx')
      .on('task_logs')
      .column('task_id')
      .execute();
  },
  down: async (db) => {
    await db.schema.dropTable('task_logs').execute();
  },
};
