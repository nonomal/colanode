import {
  createDebugger,
  ExportDocumentUpdate,
  ExportManifest,
  ExportNodeInteraction,
  ExportNodeReaction,
  ExportNodeUpdate,
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
const debug = createDebugger('workspace-exporter');

export class WorkspaceExporter {
  private readonly dbExport: SelectExport;
  private readonly dbWorkspace: SelectWorkspace;

  private readonly exportDirectory: string;
  private readonly exportZipPath: string;
  private readonly exportTempDirectory: string;
  private readonly uploadedFileKeys: string[] = [];

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
      },
      createdAt: new Date().toISOString(),
    };

    this.exportDirectory = `exports/${this.dbExport.id}`;
    this.exportZipPath = `${this.exportDirectory}/data.zip`;
    this.exportTempDirectory = `${this.exportDirectory}/temp`;
  }

  public async export() {
    await this.exportUsers();
    await this.exportNodeUpdates();
    await this.exportNodeReactions();
    await this.exportNodeInteractions();
    await this.exportDocumentUpdates();

    debug(
      `Saving manifest for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

    await this.saveFile('manifest.json', this.manifest);

    debug(
      `Zipping files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

    const s3Zipper = new S3Zipper({
      s3: fileS3,
      bucket: config.fileS3.bucketName,
      inputKeys: this.uploadedFileKeys,
      outputKey: this.exportZipPath,
    });

    await s3Zipper.zip();
    await this.deleteFiles();
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

          exportNodeUpdates.splice(0, exportNodeUpdates.length);
          part++;
        }
      }
    }

    if (exportNodeUpdates.length > 0) {
      await this.saveFile(`node_updates_${part}.json`, exportNodeUpdates);
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

          exportNodeReactions.splice(0, exportNodeReactions.length);
          part++;
        }
      }
    }

    if (exportNodeReactions.length > 0) {
      await this.saveFile(`node_reactions_${part}.json`, exportNodeReactions);
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
    }

    debug(
      `Exported ${this.manifest.counts.documentUpdates} document updates in ${part} files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );
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
    this.uploadedFileKeys.push(filePath);
  }

  private async deleteFiles() {
    debug(
      `Deleting files for workspace ${this.dbWorkspace.id} and export ${this.dbExport.id}`
    );

    for (const key of this.uploadedFileKeys) {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: config.fileS3.bucketName,
        Key: key,
      });

      await fileS3.send(deleteCommand);
    }
  }
}
