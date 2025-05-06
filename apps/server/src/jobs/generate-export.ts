import { createDebugger, ExportStatus } from '@colanode/core';

import { JobHandler } from '@/types/jobs';
import { database } from '@/data/database';
import { WorkspaceExporter } from '@/lib/exports/workspace-exporter';

const debug = createDebugger('server:job:generate-export');

export type GenerateExportInput = {
  type: 'generate_export';
  id: string;
};

declare module '@/types/jobs' {
  interface JobMap {
    generate_export: {
      input: GenerateExportInput;
    };
  }
}

export const generateExportHandler: JobHandler<GenerateExportInput> = async (
  input
) => {
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

  if (dbExport.status !== ExportStatus.Pending) {
    debug(`Export ${input.id} is not pending`);
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

  await database
    .updateTable('exports')
    .set({
      status: ExportStatus.Generating,
      started_at: new Date(),
    })
    .where('id', '=', dbExport.id)
    .execute();

  const exporter = new WorkspaceExporter(dbExport, dbWorkspace);
  await exporter.export();

  await database
    .updateTable('exports')
    .set({
      status: ExportStatus.Completed,
      completed_at: new Date(),
      counts: JSON.stringify(exporter.manifest.counts),
    })
    .where('id', '=', dbExport.id)
    .execute();
};
