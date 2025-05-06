import {
  createDebugger,
  ExportDocumentUpdate,
  ExportFiles,
  ExportManifest,
  ExportNodeInteraction,
  ExportNodeReaction,
  ExportNodeUpdate,
  ExportStatus,
  ExportUpload,
  ExportUser,
} from '@colanode/core';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { encodeState } from '@colanode/crdt';

import { SelectExport, SelectWorkspace } from '@/data/schema';
import { config } from '@/lib/config';
import { database } from '@/data/database';
import { fileS3 } from '@/data/storage';
import { S3Zipper } from '@/lib/s3/s3-zipper';

const READ_BATCH_SIZE = 500;
const FILE_BATCH_SIZE = 10000;
const FILE_BATCH_SIZE_LIMIT = 1024 * 1024 * 500; // 500MB
const debug = createDebugger('workspace-exporter');

export class WorkspaceExporter {
  private readonly dbExport: SelectExport;
  private readonly dbWorkspace: SelectWorkspace;

  private readonly exportDir: string;
  private readonly exportDataZipKey: string;
  private readonly exportFilesZipPrefix: string;
  private readonly exportTempDirectory: string;

  private readonly dataFileKeys: string[] = [];
  private readonly uploadFileKeys: string[][] = [];

  public readonly manifest: ExportManifest;

  constructor(dbExport: SelectExport, dbWorkspace: SelectWorkspace) {
    this.dbExport = dbExport;
    this.dbWorkspace = dbWorkspace;

    this.manifest = {
      id: this.dbExport.id,
      server: {
        version: config.server.version,
        sha: config.server.sha,
      },
      workspace: {
        id: this.dbWorkspace.id,
        name: this.dbWorkspace.name,
        createdAt: this.dbWorkspace.created_at.toISOString(),
        description: this.dbWorkspace.description ?? undefined,
      },
      counts: {
        users: 0,
        nodeUpdates: 0,
        nodeReactions: 0,
        nodeInteractions: 0,
        documentUpdates: 0,
        uploads: 0,
      },
      createdAt: new Date().toISOString(),
    };

    this.exportDir = `exports/${this.dbExport.id}`;
    this.exportDataZipKey = `${this.exportDir}/data.zip`;
    this.exportFilesZipPrefix = `${this.exportDir}/files`;
    this.exportTempDirectory = `${this.exportDir}/temp`;
  }

  public async export() {
    await this.exportUsers();
    await this.exportNodeUpdates();
    await this.exportNodeReactions();
    await this.exportNodeInteractions();
    await this.exportDocumentUpdates();
    await this.exportUploads();

    debug(
      `Saving manifest for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

    await this.saveFile('manifest.json', this.manifest);

    await this.zipDataFiles();
    await this.zipUploadFiles();

    await this.deleteTempFiles();
    await this.completeExport();
  }

  private async exportUsers() {
    debug(
      `Exporting users for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

    let lastUserId: string | null = null;
    let hasMore = true;
    const exportUsers: ExportUser[] = [];

    while (hasMore) {
      const users = await database
        .selectFrom('users')
        .selectAll()
        .$if(lastUserId !== null, (qb) => qb.where('id', '>', lastUserId))
        .where('workspace_id', '=', this.dbWorkspace.id)
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
      await this.saveFile(`users.json`, exportUsers);
    }

    await this.updateProgress();

    debug(
      `Exported ${this.manifest.counts.users} users for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );
  }

  private async exportNodeUpdates() {
    debug(
      `Exporting node updates for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

    let lastUpdateId: string | null = null;
    let hasMore = true;
    let part = 0;

    const exportNodeUpdates: ExportNodeUpdate[] = [];

    while (hasMore) {
      const updates = await database
        .selectFrom('node_updates')
        .selectAll()
        .$if(lastUpdateId !== null, (qb) => qb.where('id', '>', lastUpdateId))
        .where('workspace_id', '=', this.dbWorkspace.id)
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
          await this.saveFile(`node_updates_${part}.json`, exportNodeUpdates);
          await this.updateProgress();

          exportNodeUpdates.splice(0, exportNodeUpdates.length);
          part++;
        }
      }
    }

    if (exportNodeUpdates.length > 0) {
      await this.saveFile(`node_updates_${part}.json`, exportNodeUpdates);
      await this.updateProgress();
    }

    debug(
      `Exported ${this.manifest.counts.nodeUpdates} node updates in ${part} files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );
  }

  private async exportNodeReactions() {
    debug(
      `Exporting node reactions for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

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
        .where('workspace_id', '=', this.dbWorkspace.id)
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
          await this.saveFile(
            `node_reactions_${part}.json`,
            exportNodeReactions
          );

          await this.updateProgress();

          exportNodeReactions.splice(0, exportNodeReactions.length);
          part++;
        }
      }
    }

    if (exportNodeReactions.length > 0) {
      await this.saveFile(`node_reactions_${part}.json`, exportNodeReactions);
      await this.updateProgress();
    }

    debug(
      `Exported ${this.manifest.counts.nodeReactions} node reactions in ${part} files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );
  }

  private async exportNodeInteractions() {
    debug(
      `Exporting node interactions for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

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
        .where('workspace_id', '=', this.dbWorkspace.id)
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
          await this.saveFile(
            `node_interactions_${part}.json`,
            exportNodeInteractions
          );

          await this.updateProgress();

          exportNodeInteractions.splice(0, exportNodeInteractions.length);
          part++;
        }
      }
    }

    if (exportNodeInteractions.length > 0) {
      await this.saveFile(
        `node_interactions_${part}.json`,
        exportNodeInteractions
      );

      await this.updateProgress();
    }

    debug(
      `Exported ${this.manifest.counts.nodeInteractions} node interactions in ${part} files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );
  }

  private async exportDocumentUpdates() {
    debug(
      `Exporting document updates for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

    let lastUpdateId: string | null = null;
    let hasMore = true;
    let part = 0;

    const exportDocumentUpdates: ExportDocumentUpdate[] = [];

    while (hasMore) {
      const updates = await database
        .selectFrom('document_updates')
        .selectAll()
        .$if(lastUpdateId !== null, (qb) => qb.where('id', '>', lastUpdateId))
        .where('workspace_id', '=', this.dbWorkspace.id)
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
          await this.saveFile(
            `document_updates_${part}.json`,
            exportDocumentUpdates
          );

          await this.updateProgress();

          exportDocumentUpdates.splice(0, exportDocumentUpdates.length);
          part++;
        }
      }
    }

    if (exportDocumentUpdates.length > 0) {
      await this.saveFile(
        `document_updates_${part}.json`,
        exportDocumentUpdates
      );

      await this.updateProgress();
    }

    debug(
      `Exported ${this.manifest.counts.documentUpdates} document updates in ${part} files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );
  }

  private async exportUploads() {
    debug(
      `Exporting uploads for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

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
        .where('workspace_id', '=', this.dbWorkspace.id)
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
          await this.saveFile(`uploads_${part}.json`, exportUploads);
          await this.updateProgress();

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
      await this.saveFile(`uploads_${part}.json`, exportUploads);
      await this.updateProgress();
    }

    debug(
      `Exported ${this.manifest.counts.uploads} uploads in ${part} files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );
  }

  private async zipDataFiles() {
    debug(
      `Zipping data files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

    await this.updateProgress();

    const s3Zipper = new S3Zipper({
      s3: fileS3,
      bucket: config.fileS3.bucketName,
      inputKeys: this.dataFileKeys,
      outputKey: this.exportDataZipKey,
    });

    await s3Zipper.zip();

    await this.updateProgress();
  }

  private async zipUploadFiles() {
    debug(
      `Zipping upload files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

    for (let i = 0; i < this.uploadFileKeys.length; i++) {
      const inputKeys = this.uploadFileKeys[i];
      if (!inputKeys) {
        continue;
      }

      const outputKey = `${this.exportFilesZipPrefix}_${i}.zip`;

      const s3Zipper = new S3Zipper({
        s3: fileS3,
        bucket: config.fileS3.bucketName,
        inputKeys,
        outputKey,
      });

      await s3Zipper.zip();

      await this.updateProgress();
    }
  }

  private async saveFile(path: string, content: unknown) {
    const filePath = `${this.exportTempDirectory}/${path}`;
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
    debug(
      `Deleting files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

    for (const key of this.dataFileKeys) {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: config.fileS3.bucketName,
        Key: key,
      });

      await fileS3.send(deleteCommand);
    }
  }

  private async updateProgress() {
    await database
      .updateTable('exports')
      .set({
        status: ExportStatus.Generating,
        updated_at: new Date(),
        counts: JSON.stringify(this.manifest.counts),
      })
      .where('id', '=', this.dbExport.id)
      .execute();
  }

  private async completeExport() {
    const exportFiles: ExportFiles = {
      data: this.exportDataZipKey,
      files: this.uploadFileKeys.map(
        (_, i) => `${this.exportFilesZipPrefix}_${i}.zip`
      ),
    };

    await database
      .updateTable('exports')
      .set({
        status: ExportStatus.Completed,
        files: JSON.stringify(exportFiles),
        counts: JSON.stringify(this.manifest.counts),
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', this.dbExport.id)
      .execute();
  }
}
