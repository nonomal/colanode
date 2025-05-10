import {
  ExportDocumentUpdate,
  ExportManifest,
  ExportNodeInteraction,
  ExportNodeReaction,
  ExportNodeUpdate,
  ExportUpload,
  ExportUser,
  ExportWorkspaceTaskAttributes,
  formatBytes,
  TaskLogLevel,
} from '@colanode/core';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { encodeState } from '@colanode/crdt';

import { SelectTask } from '@/data/schema';
import { config } from '@/lib/config';
import { database } from '@/data/database';
import { fileS3 } from '@/data/storage';
import { S3Zip } from '@/lib/tasks/s3-zip';
import { buildDownloadUrl } from '@/lib/files';
import { TaskBase } from '@/lib/tasks/task-base';

const READ_BATCH_SIZE = 500;
const FILE_BATCH_SIZE = 10000;

export class WorkspaceExport extends TaskBase {
  private readonly attributes: ExportWorkspaceTaskAttributes;

  private readonly exportZipKey: string;
  private readonly exportTempDirectory: string;
  private readonly artifactExpireDate: Date;
  private readonly fileKeys: string[] = [];

  private usersCount = 0;
  private nodeUpdatesCount = 0;
  private nodeReactionsCount = 0;
  private nodeInteractionsCount = 0;
  private documentUpdatesCount = 0;
  private uploadsCount = 0;

  constructor(dbTask: SelectTask) {
    super(dbTask);

    if (dbTask.attributes.type !== 'export_workspace') {
      throw new Error('Task is not a workspace export');
    }

    this.attributes = dbTask.attributes;

    this.exportZipKey = `${this.taskDir}/data.zip`;
    this.exportTempDirectory = `${this.taskDir}/temp`;
    this.artifactExpireDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  }

  public async export() {
    await this.markTaskAsRunning();

    await this.exportUsers();
    await this.exportNodeUpdates();
    await this.exportNodeReactions();
    await this.exportNodeInteractions();
    await this.exportDocumentUpdates();
    await this.exportUploads();
    await this.saveManifest();

    await this.zipFiles();
    await this.deleteTempFiles();

    await this.markTaskAsCompleted();
  }

  private async exportUsers() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting users.');

    let lastUserId: string | null = null;
    let hasMore = true;
    const exportUsers: ExportUser[] = [];

    while (hasMore) {
      const users = await database
        .selectFrom('users')
        .selectAll()
        .$if(lastUserId !== null, (qb) => qb.where('id', '>', lastUserId))
        .where('workspace_id', '=', this.attributes.workspaceId)
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
        this.usersCount++;
      }
    }

    if (exportUsers.length > 0) {
      await this.saveJsonFile(`users.json`, exportUsers);
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Exported ${this.usersCount.toLocaleString()} users.`
    );
  }

  private async exportNodeUpdates() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting node updates.');

    let lastUpdateId: string | null = null;
    let hasMore = true;
    let part = 1;

    const exportNodeUpdates: ExportNodeUpdate[] = [];

    while (hasMore) {
      const updates = await database
        .selectFrom('node_updates')
        .selectAll()
        .$if(lastUpdateId !== null, (qb) => qb.where('id', '>', lastUpdateId))
        .where('workspace_id', '=', this.attributes.workspaceId)
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
        this.nodeUpdatesCount++;

        if (exportNodeUpdates.length >= FILE_BATCH_SIZE) {
          await this.saveJsonFile(
            `node_updates_${part}.json`,
            exportNodeUpdates
          );
          await this.saveLog(
            TaskLogLevel.Info,
            `Exported part ${part} of node updates.`
          );

          exportNodeUpdates.splice(0, exportNodeUpdates.length);
          part++;
        }
      }
    }

    if (exportNodeUpdates.length > 0) {
      await this.saveJsonFile(`node_updates_${part}.json`, exportNodeUpdates);
      await this.saveLog(
        TaskLogLevel.Info,
        `Exported part ${part} of node updates.`
      );
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Exported ${this.nodeUpdatesCount.toLocaleString()} node updates.`
    );
  }

  private async exportNodeReactions() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting node reactions.');

    let lastRevision: string | null = null;
    let hasMore = true;
    let part = 1;

    const exportNodeReactions: ExportNodeReaction[] = [];

    while (hasMore) {
      const reactions = await database
        .selectFrom('node_reactions')
        .selectAll()
        .$if(lastRevision !== null, (qb) =>
          qb.where('revision', '>', lastRevision)
        )
        .where('workspace_id', '=', this.attributes.workspaceId)
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
        this.nodeReactionsCount++;

        if (exportNodeReactions.length >= FILE_BATCH_SIZE) {
          await this.saveJsonFile(
            `node_reactions_${part}.json`,
            exportNodeReactions
          );

          await this.saveLog(
            TaskLogLevel.Info,
            `Exported part ${part} of node reactions.`
          );

          exportNodeReactions.splice(0, exportNodeReactions.length);
          part++;
        }
      }
    }

    if (exportNodeReactions.length > 0) {
      await this.saveJsonFile(
        `node_reactions_${part}.json`,
        exportNodeReactions
      );
      await this.saveLog(
        TaskLogLevel.Info,
        `Exported part ${part} of node reactions.`
      );
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Exported ${this.nodeReactionsCount.toLocaleString()} node reactions.`
    );
  }

  private async exportNodeInteractions() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting node interactions.');

    let lastRevision: string | null = null;
    let hasMore = true;
    let part = 1;

    const exportNodeInteractions: ExportNodeInteraction[] = [];

    while (hasMore) {
      const interactions = await database
        .selectFrom('node_interactions')
        .selectAll()
        .$if(lastRevision !== null, (qb) =>
          qb.where('revision', '>', lastRevision)
        )
        .where('workspace_id', '=', this.attributes.workspaceId)
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
        this.nodeInteractionsCount++;

        if (exportNodeInteractions.length >= FILE_BATCH_SIZE) {
          await this.saveJsonFile(
            `node_interactions_${part}.json`,
            exportNodeInteractions
          );

          await this.saveLog(
            TaskLogLevel.Info,
            `Exported part ${part} of node interactions.`
          );

          exportNodeInteractions.splice(0, exportNodeInteractions.length);
          part++;
        }
      }
    }

    if (exportNodeInteractions.length > 0) {
      await this.saveJsonFile(
        `node_interactions_${part}.json`,
        exportNodeInteractions
      );

      await this.saveLog(
        TaskLogLevel.Info,
        `Exported part ${part} of node interactions.`
      );
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Exported ${this.nodeInteractionsCount.toLocaleString()} node interactions.`
    );
  }

  private async exportDocumentUpdates() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting document updates.');

    let lastUpdateId: string | null = null;
    let hasMore = true;
    let part = 1;

    const exportDocumentUpdates: ExportDocumentUpdate[] = [];

    while (hasMore) {
      const updates = await database
        .selectFrom('document_updates')
        .selectAll()
        .$if(lastUpdateId !== null, (qb) => qb.where('id', '>', lastUpdateId))
        .where('workspace_id', '=', this.attributes.workspaceId)
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
        this.documentUpdatesCount++;

        if (exportDocumentUpdates.length >= FILE_BATCH_SIZE) {
          await this.saveJsonFile(
            `document_updates_${part}.json`,
            exportDocumentUpdates
          );

          await this.saveLog(
            TaskLogLevel.Info,
            `Exported part ${part} of document updates.`
          );

          exportDocumentUpdates.splice(0, exportDocumentUpdates.length);
          part++;
        }
      }
    }

    if (exportDocumentUpdates.length > 0) {
      await this.saveJsonFile(
        `document_updates_${part}.json`,
        exportDocumentUpdates
      );

      await this.saveLog(
        TaskLogLevel.Info,
        `Exported part ${part} of document updates.`
      );
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Exported ${this.documentUpdatesCount.toLocaleString()} document updates.`
    );
  }

  private async exportUploads() {
    await this.saveLog(TaskLogLevel.Info, 'Exporting uploads.');

    let lastFileId: string | null = null;
    let hasMore = true;
    let part = 1;

    const exportUploads: ExportUpload[] = [];

    while (hasMore) {
      const uploads = await database
        .selectFrom('uploads')
        .selectAll()
        .$if(lastFileId !== null, (qb) => qb.where('file_id', '>', lastFileId))
        .where('workspace_id', '=', this.attributes.workspaceId)
        .orderBy('file_id', 'asc')
        .limit(READ_BATCH_SIZE)
        .execute();

      if (uploads.length === 0) {
        hasMore = false;
        break;
      }

      for (const upload of uploads) {
        let url: string | undefined;

        if (upload.uploaded_at) {
          url = await buildDownloadUrl(upload.path);
        }

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
          url,
        });

        lastFileId = upload.file_id;
        this.uploadsCount++;

        if (exportUploads.length >= FILE_BATCH_SIZE) {
          await this.saveJsonFile(`uploads_${part}.json`, exportUploads);
          await this.saveLog(
            TaskLogLevel.Info,
            `Exported part ${part} of uploads.`
          );

          exportUploads.splice(0, exportUploads.length);
          part++;
        }
      }
    }

    if (exportUploads.length > 0) {
      await this.saveJsonFile(`uploads_${part}.json`, exportUploads);
      await this.saveLog(
        TaskLogLevel.Info,
        `Exported part ${part} of uploads.`
      );
    }

    await this.saveLog(
      TaskLogLevel.Info,
      `Exported ${this.uploadsCount.toLocaleString()} uploads.`
    );
  }

  private async zipFiles() {
    this.saveLog(TaskLogLevel.Info, 'Zipping data file.');

    const s3Zip = new S3Zip({
      s3: fileS3,
      bucket: config.fileS3.bucketName,
      inputKeys: this.fileKeys,
      outputKey: this.exportZipKey,
    });

    const { zipFileSize, zipFileName } = await s3Zip.zip();

    await this.saveArtifact(
      'data',
      this.exportZipKey,
      zipFileName,
      'application/zip',
      zipFileSize,
      this.artifactExpireDate
    );

    await this.saveLog(
      TaskLogLevel.Info,
      `Zipped data file at '${zipFileName}'. Size: ${formatBytes(zipFileSize)}`
    );
  }

  private async saveManifest() {
    const manifest: ExportManifest = {
      id: this.task.id,
      server: {
        version: config.server.version,
        sha: config.server.sha,
      },
      workspace: {
        id: this.attributes.workspaceId,
        name: '',
        createdAt: new Date().toISOString(),
        description: '',
      },
      counts: {
        users: this.usersCount,
        nodeUpdates: this.nodeUpdatesCount,
        nodeReactions: this.nodeReactionsCount,
        nodeInteractions: this.nodeInteractionsCount,
        documentUpdates: this.documentUpdatesCount,
        uploads: this.uploadsCount,
      },
      createdAt: new Date().toISOString(),
    };

    const json = JSON.stringify(manifest);
    await this.saveJsonFile('manifest.json', json);
  }

  private async saveJsonFile(name: string, content: unknown) {
    const filePath = `${this.exportTempDirectory}/${name}`;
    const json = JSON.stringify(content);

    const putCommand = new PutObjectCommand({
      Bucket: config.fileS3.bucketName,
      Key: filePath,
      Body: json,
      ContentType: 'application/json',
    });

    await fileS3.send(putCommand);
    this.fileKeys.push(filePath);
  }

  private async deleteTempFiles() {
    this.saveLog(TaskLogLevel.Info, 'Cleaning up temp files.');

    for (const key of this.fileKeys) {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: config.fileS3.bucketName,
        Key: key,
      });

      await fileS3.send(deleteCommand);
    }

    const manifestKey = `${this.exportTempDirectory}/manifest.json`;
    const deleteCommand = new DeleteObjectCommand({
      Bucket: config.fileS3.bucketName,
      Key: manifestKey,
    });

    await fileS3.send(deleteCommand);
  }
}
