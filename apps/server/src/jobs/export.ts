import { createDebugger, ExportStatus } from '@colanode/core';

import { JobHandler } from '@/types/jobs';
import { database } from '@/data/database';
import { WorkspaceExporter } from '@/lib/exports/workspace-exporter';

const debug = createDebugger('server:job:generate-export');

export type ExportInput = {
  type: 'export';
  id: string;
};

declare module '@/types/jobs' {
  interface JobMap {
    export: {
      input: ExportInput;
    };
  }
}

const MAX_UPDATE_INTERVAL = 1000 * 60 * 10; //10 minutes

export const exportHandler: JobHandler<ExportInput> = async (input) => {
  debug(`Generating export ${input.id}`);

  const dbExport = await database
    .selectFrom('exports')
    .selectAll()
    .where('id', '=', input.id)
    .executeTakeFirst();

  if (!dbExport) {
    debug(`Export ${input.id} not found`);
    return;
  }

  if (dbExport.type !== 'workspace') {
    debug(`Export type ${dbExport.type} is not supported.`);
    return;
  }

  if (dbExport.status === ExportStatus.Completed) {
    debug(`Export ${input.id} is already completed`);
    return;
  }

  if (dbExport.status === ExportStatus.Failed) {
    debug(`Export ${input.id} is marked as failed`);
    return;
  }

  if (
    dbExport.status === ExportStatus.Generating ||
    (dbExport.updated_at &&
      dbExport.updated_at > new Date(Date.now() - MAX_UPDATE_INTERVAL))
  ) {
    debug(`Export ${input.id} is still generating`);
    return;
  }

  const dbWorkspace = await database
    .selectFrom('workspaces')
    .where('id', '=', dbExport.workspace_id)
    .selectAll()
    .executeTakeFirst();

  if (!dbWorkspace) {
    debug(`Workspace ${dbExport.workspace_id} not found`);
    return;
  }

  const exporter = new WorkspaceExporter(dbExport, dbWorkspace);
  await exporter.export();
};
