import {
  createDebugger,
  ExportDocumentUpdate,
  ExportManifest,
  ExportNodeInteraction,
  ExportNodeReaction,
  ExportNodeUpdate,
  ExportUpload,
  ExportUser,
  formatBytes,
  formatTaskLogLevel,
  generateId,
  IdType,
  TaskArtifactType,
  TaskLogLevel,
  TaskStatus,
} from '@colanode/core';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { encodeState } from '@colanode/crdt';

import {
  mapTaskOutput,
  mapTaskLogOutput,
  mapTaskArtifactOutput,
} from '@/lib/tasks/mappers';
import { SelectTask, SelectWorkspace } from '@/data/schema';
import { config } from '@/lib/config';
import { database } from '@/data/database';
import { fileS3 } from '@/data/storage';
import { S3Zip } from '@/lib/tasks/s3-zip';
import { eventBus } from '@/lib/event-bus';

const READ_BATCH_SIZE = 500;
const FILE_BATCH_SIZE = 10000;
const FILE_BATCH_SIZE_LIMIT = 1024 * 1024 * 500; // 500MB
const debug = createDebugger('workspace-exporter');

export class WorkspaceExport {
  private readonly task: SelectTask;
  private readonly workspace: SelectWorkspace;

  private readonly taskDir: string;
  private readonly exportDataZipKey: string;
  private readonly exportFilesZipPrefix: string;
  private readonly exportTempDirectory: string;

  private readonly dataFileKeys: string[] = [];
  private readonly uploadFileKeys: string[][] = [];

  public readonly manifest: ExportManifest;

  constructor(dbTask: SelectTask, dbWorkspace: SelectWorkspace) {
    this.task = dbTask;
    this.workspace = dbWorkspace;

    this.manifest = {
      id: this.task.id,
      server: {
        version: config.server.version,
        sha: config.server.sha,
      },
      workspace: {
        id: this.workspace.id,
        name: this.workspace.name,
        createdAt: this.workspace.created_at.toISOString(),
        description: this.workspace.description ?? undefined,
      },
      counts: {
        users: 0,
        nodeUpdates: 0,
        nodeReactions: 0,
        nodeInteractions: 0,
        documentUpdates: 0,
        uploads: 0,
      },
      files: [],
      createdAt: new Date().toISOString(),
    };

    this.taskDir = `tasks/${this.task.id}`;
    this.exportDataZipKey = `${this.taskDir}/data.zip`;
    this.exportFilesZipPrefix = `${this.taskDir}/files`;
    this.exportTempDirectory = `${this.taskDir}/temp`;
  }

  public async export() {
    await this.startTask();

    await this.exportUsers();
    await this.exportNodeUpdates();
    await this.exportNodeReactions();
    await this.exportNodeInteractions();
    await this.exportDocumentUpdates();
    await this.exportUploads();

    debug(
      `Saving manifest for workspace ${this.workspace.id} and task ${this.task.id}`
    );

    await this.saveDataFile('manifest.json', this.manifest);

    await this.zipDataFiles();
    await this.zipUploadFiles();
    await this.saveManifest();

    await this.deleteTempFiles();
    await this.completeTask();
  }

  private async exportUsers() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting users');

    let lastUserId: string | null = null;
    let hasMore = true;
    const exportUsers: ExportUser[] = [];

    while (hasMore) {
      const users = await database
        .selectFrom('users')
        .selectAll()
        .$if(lastUserId !== null, (qb) => qb.where('id', '>', lastUserId))
        .where('workspace_id', '=', this.workspace.id)
        .orderBy('id', 'asc')
        .limit(READ_BATCH_SIZE)
        .execute();

      if (users.length === 0) {
        hasMore = false;
        break;
      }

      for (const user of users) {
        exportUsers.push({
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar ?? undefined,
          customName: user.custom_name ?? undefined,
          customAvatar: user.custom_avatar ?? undefined,
          storageLimit: user.storage_limit,
          maxFileSize: user.max_file_size,
          role: user.role,
          createdAt: user.created_at.toISOString(),
          updatedAt: user.updated_at?.toISOString() ?? undefined,
          status: user.status,
        });

        lastUserId = user.id;
        this.manifest.counts.users++;
      }
    }

    if (exportUsers.length > 0) {
      await this.saveDataFile(`users.json`, exportUsers);
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Finished exporting users. Total users: ${this.manifest.counts.users.toLocaleString()}`
    );
  }

  private async exportNodeUpdates() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting node updates');

    let lastUpdateId: string | null = null;
    let hasMore = true;
    let part = 0;

    const exportNodeUpdates: ExportNodeUpdate[] = [];

    while (hasMore) {
      const updates = await database
        .selectFrom('node_updates')
        .selectAll()
        .$if(lastUpdateId !== null, (qb) => qb.where('id', '>', lastUpdateId))
        .where('workspace_id', '=', this.workspace.id)
        .orderBy('id', 'asc')
        .limit(READ_BATCH_SIZE)
        .execute();

      if (updates.length === 0) {
        hasMore = false;
        break;
      }

      for (const update of updates) {
        exportNodeUpdates.push({
          id: update.id,
          nodeId: update.node_id,
          data: encodeState(update.data),
          createdAt: update.created_at.toISOString(),
          createdBy: update.created_by,
        });

        lastUpdateId = update.id;
        this.manifest.counts.nodeUpdates++;

        if (exportNodeUpdates.length >= FILE_BATCH_SIZE) {
          await this.saveDataFile(
            `node_updates_${part}.json`,
            exportNodeUpdates
          );
          await this.saveLog(
            TaskLogLevel.Info,
            `Exported part ${part} of node updates. Total node updates: ${this.manifest.counts.nodeUpdates.toLocaleString()}`
          );

          exportNodeUpdates.splice(0, exportNodeUpdates.length);
          part++;
        }
      }
    }

    if (exportNodeUpdates.length > 0) {
      await this.saveDataFile(`node_updates_${part}.json`, exportNodeUpdates);
      await this.saveLog(
        TaskLogLevel.Info,
        `Exported part ${part} of node updates. Total node updates: ${this.manifest.counts.nodeUpdates.toLocaleString()}`
      );
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Finished exporting node updates. Total node updates: ${this.manifest.counts.nodeUpdates.toLocaleString()}`
    );
  }

  private async exportNodeReactions() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting node reactions');

    let lastRevision: string | null = null;
    let hasMore = true;
    let part = 0;

    const exportNodeReactions: ExportNodeReaction[] = [];

    while (hasMore) {
      const reactions = await database
        .selectFrom('node_reactions')
        .selectAll()
        .$if(lastRevision !== null, (qb) =>
          qb.where('revision', '>', lastRevision)
        )
        .where('workspace_id', '=', this.workspace.id)
        .orderBy('revision', 'asc')
        .limit(READ_BATCH_SIZE)
        .execute();

      if (reactions.length === 0) {
        hasMore = false;
        break;
      }

      for (const reaction of reactions) {
        if (reaction.deleted_at) {
          continue;
        }

        exportNodeReactions.push({
          nodeId: reaction.node_id,
          collaboratorId: reaction.collaborator_id,
          reaction: reaction.reaction,
          createdAt: reaction.created_at.toISOString(),
        });

        lastRevision = reaction.revision;
        this.manifest.counts.nodeReactions++;

        if (exportNodeReactions.length >= FILE_BATCH_SIZE) {
          await this.saveDataFile(
            `node_reactions_${part}.json`,
            exportNodeReactions
          );

          await this.saveLog(
            TaskLogLevel.Info,
            `Exported part ${part} of node reactions. Total node reactions: ${this.manifest.counts.nodeReactions.toLocaleString()}`
          );

          exportNodeReactions.splice(0, exportNodeReactions.length);
          part++;
        }
      }
    }

    if (exportNodeReactions.length > 0) {
      await this.saveDataFile(
        `node_reactions_${part}.json`,
        exportNodeReactions
      );
      await this.saveLog(
        TaskLogLevel.Info,
        `Exported part ${part} of node reactions. Total node reactions: ${this.manifest.counts.nodeReactions.toLocaleString()}`
      );
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Finished exporting node reactions. Total node reactions: ${this.manifest.counts.nodeReactions.toLocaleString()}`
    );
  }

  private async exportNodeInteractions() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting node interactions');

    let lastRevision: string | null = null;
    let hasMore = true;
    let part = 0;

    const exportNodeInteractions: ExportNodeInteraction[] = [];

    while (hasMore) {
      const interactions = await database
        .selectFrom('node_interactions')
        .selectAll()
        .$if(lastRevision !== null, (qb) =>
          qb.where('revision', '>', lastRevision)
        )
        .where('workspace_id', '=', this.workspace.id)
        .orderBy('revision', 'asc')
        .limit(READ_BATCH_SIZE)
        .execute();

      if (interactions.length === 0) {
        hasMore = false;
        break;
      }

      for (const interaction of interactions) {
        exportNodeInteractions.push({
          nodeId: interaction.node_id,
          collaboratorId: interaction.collaborator_id,
          firstSeenAt: interaction.first_seen_at?.toISOString(),
          lastSeenAt: interaction.last_seen_at?.toISOString(),
          firstOpenedAt: interaction.first_opened_at?.toISOString(),
          lastOpenedAt: interaction.last_opened_at?.toISOString(),
        });

        lastRevision = interaction.revision;
        this.manifest.counts.nodeInteractions++;

        if (exportNodeInteractions.length >= FILE_BATCH_SIZE) {
          await this.saveDataFile(
            `node_interactions_${part}.json`,
            exportNodeInteractions
          );

          await this.saveLog(
            TaskLogLevel.Info,
            `Exported part ${part} of node interactions. Total node interactions: ${this.manifest.counts.nodeInteractions.toLocaleString()}`
          );

          exportNodeInteractions.splice(0, exportNodeInteractions.length);
          part++;
        }
      }
    }

    if (exportNodeInteractions.length > 0) {
      await this.saveDataFile(
        `node_interactions_${part}.json`,
        exportNodeInteractions
      );

      await this.saveLog(
        TaskLogLevel.Info,
        `Exported part ${part} of node interactions. Total node interactions: ${this.manifest.counts.nodeInteractions.toLocaleString()}`
      );
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Finished exporting node interactions. Total node interactions: ${this.manifest.counts.nodeInteractions.toLocaleString()}`
    );
  }

  private async exportDocumentUpdates() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting document updates');

    let lastUpdateId: string | null = null;
    let hasMore = true;
    let part = 0;

    const exportDocumentUpdates: ExportDocumentUpdate[] = [];

    while (hasMore) {
      const updates = await database
        .selectFrom('document_updates')
        .selectAll()
        .$if(lastUpdateId !== null, (qb) => qb.where('id', '>', lastUpdateId))
        .where('workspace_id', '=', this.workspace.id)
        .orderBy('id', 'asc')
        .limit(READ_BATCH_SIZE)
        .execute();

      if (updates.length === 0) {
        hasMore = false;
        break;
      }

      for (const update of updates) {
        exportDocumentUpdates.push({
          id: update.id,
          documentId: update.document_id,
          data: encodeState(update.data),
          createdAt: update.created_at.toISOString(),
          createdBy: update.created_by,
        });

        lastUpdateId = update.id;
        this.manifest.counts.documentUpdates++;

        if (exportDocumentUpdates.length >= FILE_BATCH_SIZE) {
          await this.saveDataFile(
            `document_updates_${part}.json`,
            exportDocumentUpdates
          );

          await this.saveLog(
            TaskLogLevel.Info,
            `Exported part ${part} of document updates. Total document updates: ${this.manifest.counts.documentUpdates.toLocaleString()}`
          );

          exportDocumentUpdates.splice(0, exportDocumentUpdates.length);
          part++;
        }
      }
    }

    if (exportDocumentUpdates.length > 0) {
      await this.saveDataFile(
        `document_updates_${part}.json`,
        exportDocumentUpdates
      );

      await this.saveLog(
        TaskLogLevel.Info,
        `Exported part ${part} of document updates. Total document updates: ${this.manifest.counts.documentUpdates.toLocaleString()}`
      );
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Finished exporting document updates. Total document updates: ${this.manifest.counts.documentUpdates.toLocaleString()}`
    );
  }

  private async exportUploads() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting uploads');

    let lastFileId: string | null = null;
    let hasMore = true;
    let part = 0;

    const exportUploads: ExportUpload[] = [];
    const fileKeys: string[] = [];
    let filesSize = 0;

    while (hasMore) {
      const uploads = await database
        .selectFrom('uploads')
        .selectAll()
        .$if(lastFileId !== null, (qb) => qb.where('file_id', '>', lastFileId))
        .where('workspace_id', '=', this.workspace.id)
        .orderBy('file_id', 'asc')
        .limit(READ_BATCH_SIZE)
        .execute();

      if (uploads.length === 0) {
        hasMore = false;
        break;
      }

      for (const upload of uploads) {
        exportUploads.push({
          fileId: upload.file_id,
          uploadId: upload.upload_id,
          mimeType: upload.mime_type,
          size: upload.size,
          path: upload.path,
          versionId: upload.version_id,
          createdAt: upload.created_at.toISOString(),
          createdBy: upload.created_by,
          uploadedAt: upload.uploaded_at?.toISOString(),
        });

        lastFileId = upload.file_id;
        this.manifest.counts.uploads++;

        if (exportUploads.length >= FILE_BATCH_SIZE) {
          await this.saveDataFile(`uploads_${part}.json`, exportUploads);
          await this.saveLog(
            TaskLogLevel.Info,
            `Exported part ${part} of uploads. Total uploads: ${this.manifest.counts.uploads.toLocaleString()}`
          );

          exportUploads.splice(0, exportUploads.length);
          part++;
        }

        if (upload.uploaded_at) {
          fileKeys.push(upload.path);
          filesSize += upload.size;

          if (filesSize >= FILE_BATCH_SIZE_LIMIT) {
            this.uploadFileKeys.push(fileKeys);
            fileKeys.splice(0, fileKeys.length);
            filesSize = 0;
          }
        }
      }
    }

    if (exportUploads.length > 0) {
      await this.saveDataFile(`uploads_${part}.json`, exportUploads);
      await this.saveLog(
        TaskLogLevel.Info,
        `Exported part ${part} of uploads. Total uploads: ${this.manifest.counts.uploads.toLocaleString()}`
      );
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Finished exporting uploads. Total uploads: ${this.manifest.counts.uploads.toLocaleString()}`
    );
  }

  private async zipDataFiles() {
    this.saveLog(TaskLogLevel.Info, 'Zipping data file');

    const s3Zip = new S3Zip({
      s3: fileS3,
      bucket: config.fileS3.bucketName,
      inputKeys: this.dataFileKeys,
      outputKey: this.exportDataZipKey,
    });

    const { zipFileSize, zipFileName } = await s3Zip.zip();

    this.manifest.files.push({
      type: 'data',
      name: zipFileName,
      createdAt: new Date().toISOString(),
      size: zipFileSize,
    });

    await this.saveArtifact(
      'data',
      this.exportDataZipKey,
      zipFileName,
      'application/zip',
      zipFileSize
    );

    await this.saveLog(
      TaskLogLevel.Info,
      `Finished zipping data file at '${zipFileName}'. Size: ${formatBytes(zipFileSize)}`
    );
  }

  private async zipUploadFiles() {
    await this.saveLog(TaskLogLevel.Info, 'Zipping uploaded files');

    for (let i = 0; i < this.uploadFileKeys.length; i++) {
      const inputKeys = this.uploadFileKeys[i];
      if (!inputKeys) {
        continue;
      }

      const outputKey = `${this.exportFilesZipPrefix}_${i}.zip`;

      const s3Zip = new S3Zip({
        s3: fileS3,
        bucket: config.fileS3.bucketName,
        inputKeys,
        outputKey,
      });

      const { zipFileSize, zipFileName } = await s3Zip.zip();

      this.manifest.files.push({
        type: 'file',
        name: zipFileName,
        createdAt: new Date().toISOString(),
        size: zipFileSize,
      });

      await this.saveArtifact(
        'file',
        outputKey,
        zipFileName,
        'application/zip',
        zipFileSize
      );

      await this.saveLog(
        TaskLogLevel.Info,
        `Finished zipping part ${i + 1} of uploaded files at '${zipFileName}'. Size: ${formatBytes(zipFileSize)}`
      );
    }
  }

  private async saveManifest() {
    const filePath = `${this.taskDir}/manifest.json`;
    const json = JSON.stringify(this.manifest);
    const size = Buffer.byteLength(json, 'utf-8');

    this.manifest.files.push({
      type: 'manifest',
      name: 'manifest.json',
      createdAt: new Date().toISOString(),
      size,
    });

    const putCommand = new PutObjectCommand({
      Bucket: config.fileS3.bucketName,
      Key: filePath,
      Body: json,
      ContentType: 'application/json',
    });

    await fileS3.send(putCommand);

    await this.saveArtifact(
      'manifest',
      filePath,
      'manifest.json',
      'application/json',
      size
    );
  }

  private async saveDataFile(name: string, content: unknown) {
    const filePath = `${this.exportTempDirectory}/${name}`;
    const json = JSON.stringify(content);

    const putCommand = new PutObjectCommand({
      Bucket: config.fileS3.bucketName,
      Key: filePath,
      Body: json,
      ContentType: 'application/json',
    });

    await fileS3.send(putCommand);
    this.dataFileKeys.push(filePath);
  }

  private async deleteTempFiles() {
    this.saveLog(TaskLogLevel.Info, 'Deleting temp files');

    for (const key of this.dataFileKeys) {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: config.fileS3.bucketName,
        Key: key,
      });

      await fileS3.send(deleteCommand);
    }
  }

  private async saveLog(level: TaskLogLevel, message: string) {
    debug(
      `Writing log for task ${this.task.id} with level ${formatTaskLogLevel(level)}: ${message}`
    );

    const { taskLog, task } = await database
      .transaction()
      .execute(async (tx) => {
        const taskLog = await tx
          .insertInto('task_logs')
          .returningAll()
          .values({
            id: generateId(IdType.TaskLog),
            task_id: this.task.id,
            level,
            message,
            created_at: new Date(),
          })
          .executeTakeFirst();

        if (!taskLog) {
          throw new Error('Failed to write task log');
        }

        const task = await tx
          .updateTable('tasks')
          .returningAll()
          .set({
            active_at: new Date(),
          })
          .where('id', '=', this.task.id)
          .executeTakeFirst();

        if (!task) {
          throw new Error('Failed to update task');
        }

        return { taskLog, task };
      });

    eventBus.publish({
      type: 'task_log_created',
      task: mapTaskOutput(task),
      log: mapTaskLogOutput(taskLog),
    });
  }

  private async saveArtifact(
    type: TaskArtifactType,
    path: string,
    name: string,
    mimeType: string,
    size: number
  ) {
    debug(
      `Saving artifact for task ${this.task.id} with type ${type}: ${name}`
    );

    const { taskArtifact, task } = await database
      .transaction()
      .execute(async (tx) => {
        const taskArtifact = await tx
          .insertInto('task_artifacts')
          .returningAll()
          .values({
            id: generateId(IdType.TaskArtifact),
            task_id: this.task.id,
            type,
            name,
            mime_type: mimeType,
            size,
            path,
            created_at: new Date(),
          })
          .executeTakeFirst();

        if (!taskArtifact) {
          throw new Error('Failed to write task artifact');
        }

        const task = await tx
          .updateTable('tasks')
          .returningAll()
          .set({
            active_at: new Date(),
          })
          .where('id', '=', this.task.id)
          .executeTakeFirst();

        if (!task) {
          throw new Error('Failed to update task');
        }

        return { taskArtifact, task };
      });

    eventBus.publish({
      type: 'task_artifact_created',
      task: mapTaskOutput(task),
      artifact: mapTaskArtifactOutput(taskArtifact),
    });
  }

  private async startTask() {
    const task = await database
      .updateTable('tasks')
      .returningAll()
      .set({
        status: TaskStatus.Running,
        started_at: new Date(),
      })
      .where('id', '=', this.task.id)
      .executeTakeFirst();

    if (!task) {
      throw new Error('Failed to update task');
    }

    eventBus.publish({
      type: 'task_updated',
      task: mapTaskOutput(task),
    });
  }

  private async completeTask() {
    const task = await database
      .updateTable('tasks')
      .returningAll()
      .set({
        status: TaskStatus.Completed,
        completed_at: new Date(),
      })
      .where('id', '=', this.task.id)
      .executeTakeFirst();

    if (!task) {
      throw new Error('Failed to update task');
    }

    eventBus.publish({ type: 'task_updated', task: mapTaskOutput(task) });
  }
}
