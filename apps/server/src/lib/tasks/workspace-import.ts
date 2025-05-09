import {
  AccountStatus,
  DocumentContent,
  ExportDocumentUpdate,
  ExportNodeInteraction,
  ExportNodeReaction,
  ExportNodeUpdate,
  ExportUpload,
  ExportUser,
  extractNodeParentId,
  generateId,
  IdType,
  NodeAttributes,
  TaskStatus,
  UserStatus,
} from '@colanode/core';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { sql } from 'kysely';
import { decodeState, YDoc } from '@colanode/crdt';

import path from 'path';

import { fetchNodeTree } from '@/lib/nodes';
import { S3Unzip } from '@/lib/tasks/s3-unzip';
import { mapTaskOutput } from '@/lib/tasks/mappers';
import { eventBus } from '@/lib/event-bus';
import { database } from '@/data/database';
import {
  CreateNodeInteraction,
  CreateNodeReaction,
  CreateUpload,
  SelectDocumentUpdate,
  SelectNodeUpdate,
  SelectTask,
  SelectTaskArtifact,
  SelectWorkspace,
} from '@/data/schema';
import { fileS3 } from '@/data/storage';
import { config } from '@/lib/config';

const WRITE_BATCH_SIZE = 500;

export class WorkspaceImport {
  private readonly task: SelectTask;
  private readonly workspace: SelectWorkspace;

  private readonly taskDir: string;
  private readonly fileKeys: string[] = [];

  constructor(dbTask: SelectTask, dbWorkspace: SelectWorkspace) {
    this.task = dbTask;
    this.workspace = dbWorkspace;

    this.taskDir = `tasks/${this.task.id}`;
  }

  public async import() {
    try {
      await this.startTask();

      const artifact = await this.fetchArtifact();
      if (!artifact) {
        throw new Error('Artifact not found');
      }

      await this.unzipArtifact(artifact);
      await this.importUsers();
      await this.importNodeUpdates();
      await this.importNodeReactions();
      await this.importNodeInteractions();
      await this.importDocumentUpdates();
      await this.importUploads();

      await this.completeTask();
    } catch (error) {
      console.error(error);
    }
  }

  private async importUsers() {
    const userFile = this.fileKeys.find((file) => file.includes('users.json'));

    if (!userFile) {
      throw new Error('User file not found');
    }

    const exportUsers = await this.fetchJsonFile<ExportUser[]>(userFile);
    if (exportUsers.length === 0) {
      throw new Error('No users found');
    }

    const emails = exportUsers.map((user) => user.email);
    const accounts = await database
      .selectFrom('accounts')
      .selectAll()
      .where('email', 'in', emails)
      .execute();

    const defaultStatus =
      config.account.verificationType === 'automatic'
        ? AccountStatus.Active
        : AccountStatus.Pending;

    for (const exportUser of exportUsers) {
      let account = accounts.find((acc) => acc.email === exportUser.email);

      if (!account) {
        account = await database
          .insertInto('accounts')
          .returningAll()
          .values({
            id: generateId(IdType.Account),
            email: exportUser.email,
            name: exportUser.name,
            status: defaultStatus,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .executeTakeFirst();
      }

      if (!account) {
        throw new Error('Failed to create account');
      }

      const user = await database
        .insertInto('users')
        .returningAll()
        .values({
          id: exportUser.id,
          email: exportUser.email,
          name: exportUser.name,
          custom_name: exportUser.customName,
          workspace_id: this.workspace.id,
          role: exportUser.role,
          account_id: account.id,
          max_file_size: exportUser.maxFileSize,
          storage_limit: exportUser.storageLimit,
          status: UserStatus.Active,
          created_at: new Date(exportUser.createdAt),
          updated_at: exportUser.updatedAt
            ? new Date(exportUser.updatedAt)
            : null,
          created_by: this.workspace.created_by,
        })
        .executeTakeFirst();

      if (!user) {
        throw new Error('Failed to create user');
      }
    }
  }

  private async importNodeUpdates() {
    const nodeUpdateFiles = this.fileKeys
      .filter((file) => file.includes('node_updates'))
      .sort();

    if (nodeUpdateFiles.length === 0) {
      return;
    }

    for (const nodeUpdateFile of nodeUpdateFiles) {
      const allNodeUpdates =
        await this.fetchJsonFile<ExportNodeUpdate[]>(nodeUpdateFile);

      const nodeUpdatesMap = new Map<string, ExportNodeUpdate[]>();
      for (const nodeUpdate of allNodeUpdates) {
        if (!nodeUpdatesMap.has(nodeUpdate.nodeId)) {
          nodeUpdatesMap.set(nodeUpdate.nodeId, [nodeUpdate]);
        } else {
          nodeUpdatesMap.get(nodeUpdate.nodeId)?.push(nodeUpdate);
        }
      }

      for (const [nodeId, exportNodeUpdates] of nodeUpdatesMap.entries()) {
        const existingNode = await database
          .selectFrom('nodes')
          .selectAll()
          .where('id', '=', nodeId)
          .executeTakeFirst();

        const existingNodeUpdates: SelectNodeUpdate[] = [];

        if (existingNode) {
          const dbNodeUpdates = await database
            .selectFrom('node_updates')
            .selectAll()
            .where('node_id', '=', nodeId)
            .execute();

          for (const dbNodeUpdate of dbNodeUpdates) {
            existingNodeUpdates.push(dbNodeUpdate);
          }
        }

        const ydoc = new YDoc();
        let createdBy: string | null = null;
        let createdAt: Date | null = null;
        let updatedBy: string | null = null;
        let updatedAt: Date | null = null;

        for (const existingNodeUpdate of existingNodeUpdates) {
          ydoc.applyUpdate(existingNodeUpdate.data);

          if (createdBy === null) {
            createdBy = existingNodeUpdate.created_by;
          } else {
            updatedBy = existingNodeUpdate.created_by;
          }

          if (createdAt === null) {
            createdAt = new Date(existingNodeUpdate.created_at);
          } else {
            updatedAt = new Date(existingNodeUpdate.created_at);
          }
        }

        for (const exportNodeUpdate of exportNodeUpdates) {
          ydoc.applyUpdate(exportNodeUpdate.data);

          if (createdBy === null) {
            createdBy = exportNodeUpdate.createdBy;
          } else {
            updatedBy = exportNodeUpdate.createdBy;
          }

          if (createdAt === null) {
            createdAt = new Date(exportNodeUpdate.createdAt);
          } else {
            updatedAt = new Date(exportNodeUpdate.createdAt);
          }
        }

        if (!createdBy || !createdAt) {
          continue;
        }

        const attributes = ydoc.getObject<NodeAttributes>();
        const parentId = extractNodeParentId(attributes);
        const tree = parentId ? await fetchNodeTree(parentId) : [];
        const rootId = tree[0]?.id ?? nodeId;

        await database.transaction().execute(async (trx) => {
          const createdNodeUpdates = await trx
            .insertInto('node_updates')
            .returningAll()
            .values(
              exportNodeUpdates.map((update) => ({
                id: update.id,
                node_id: nodeId,
                data: decodeState(update.data),
                created_at: new Date(update.createdAt),
                created_by: createdBy,
                root_id: rootId,
                workspace_id: this.workspace.id,
              }))
            )
            .execute();

          if (!createdNodeUpdates) {
            throw new Error('Failed to create node updates');
          }

          const lastRevision =
            createdNodeUpdates[createdNodeUpdates.length - 1]?.revision;

          if (!lastRevision) {
            throw new Error('Failed to get last revision');
          }

          const node = await trx
            .insertInto('nodes')
            .returningAll()
            .values({
              id: nodeId,
              attributes: JSON.stringify(attributes),
              workspace_id: this.workspace.id,
              created_at: createdAt,
              created_by: createdBy,
              updated_at: updatedAt,
              updated_by: updatedBy,
              root_id: rootId,
              revision: lastRevision,
            })
            .onConflict((b) =>
              b.columns(['id']).doUpdateSet({
                attributes: JSON.stringify(attributes),
                revision: lastRevision,
                updated_at: updatedAt ?? createdAt,
                updated_by: updatedBy ?? createdBy,
              })
            )
            .executeTakeFirst();

          if (!node) {
            throw new Error('Failed to create node');
          }
        });
      }
    }
  }

  private async importNodeReactions() {
    const nodeReactionFileds = this.fileKeys
      .filter((file) => file.includes('node_reactions'))
      .sort();

    if (nodeReactionFileds.length === 0) {
      return;
    }

    for (const nodeReactionFile of nodeReactionFileds) {
      const nodeReactions =
        await this.fetchJsonFile<ExportNodeReaction[]>(nodeReactionFile);

      const nodeReactionsMap = new Map<string, ExportNodeReaction[]>();
      for (const nodeReaction of nodeReactions) {
        if (!nodeReactionsMap.has(nodeReaction.nodeId)) {
          nodeReactionsMap.set(nodeReaction.nodeId, [nodeReaction]);
        } else {
          nodeReactionsMap.get(nodeReaction.nodeId)?.push(nodeReaction);
        }
      }

      for (const [nodeId, nodeReactions] of nodeReactionsMap.entries()) {
        const node = await database
          .selectFrom('nodes')
          .selectAll()
          .where('id', '=', nodeId)
          .executeTakeFirst();

        if (!node) {
          continue;
        }

        const batch: CreateNodeReaction[] = [];
        for (const nodeReaction of nodeReactions) {
          batch.push({
            node_id: nodeId,
            collaborator_id: nodeReaction.collaboratorId,
            root_id: node.root_id,
            workspace_id: this.workspace.id,
            reaction: nodeReaction.reaction,
            created_at: new Date(nodeReaction.createdAt),
          });

          if (batch.length >= WRITE_BATCH_SIZE) {
            await database
              .insertInto('node_reactions')
              .values(batch)
              .onConflict((b) =>
                b
                  .columns(['node_id', 'collaborator_id', 'reaction'])
                  .doNothing()
              )
              .execute();
            batch.length = 0;
          }
        }

        if (batch.length > 0) {
          await database
            .insertInto('node_reactions')
            .values(batch)
            .onConflict((b) =>
              b.columns(['node_id', 'collaborator_id', 'reaction']).doNothing()
            )
            .execute();
        }
      }
    }
  }

  private async importNodeInteractions() {
    const nodeInteractionFileds = this.fileKeys
      .filter((file) => file.includes('node_interactions'))
      .sort();

    if (nodeInteractionFileds.length === 0) {
      return;
    }

    for (const nodeInteractionFile of nodeInteractionFileds) {
      const nodeInteractions =
        await this.fetchJsonFile<ExportNodeInteraction[]>(nodeInteractionFile);

      const nodeInteractionsMap = new Map<string, ExportNodeInteraction[]>();
      for (const nodeInteraction of nodeInteractions) {
        if (!nodeInteractionsMap.has(nodeInteraction.nodeId)) {
          nodeInteractionsMap.set(nodeInteraction.nodeId, [nodeInteraction]);
        } else {
          nodeInteractionsMap
            .get(nodeInteraction.nodeId)
            ?.push(nodeInteraction);
        }
      }

      for (const [nodeId, nodeInteractions] of nodeInteractionsMap.entries()) {
        const node = await database
          .selectFrom('nodes')
          .selectAll()
          .where('id', '=', nodeId)
          .executeTakeFirst();

        if (!node) {
          continue;
        }

        const batch: CreateNodeInteraction[] = [];
        for (const nodeInteraction of nodeInteractions) {
          batch.push({
            node_id: nodeId,
            collaborator_id: nodeInteraction.collaboratorId,
            root_id: node.root_id,
            workspace_id: this.workspace.id,
            first_opened_at: nodeInteraction.firstOpenedAt
              ? new Date(nodeInteraction.firstOpenedAt)
              : null,
            last_opened_at: nodeInteraction.lastOpenedAt
              ? new Date(nodeInteraction.lastOpenedAt)
              : null,
            first_seen_at: nodeInteraction.firstSeenAt
              ? new Date(nodeInteraction.firstSeenAt)
              : null,
            last_seen_at: nodeInteraction.lastSeenAt
              ? new Date(nodeInteraction.lastSeenAt)
              : null,
          });

          if (batch.length >= WRITE_BATCH_SIZE) {
            await database
              .insertInto('node_interactions')
              .values(batch)
              .onConflict((b) =>
                b.columns(['node_id', 'collaborator_id']).doUpdateSet({
                  first_opened_at: sql`coalesce(excluded.first_opened_at, node_interactions.first_opened_at)`,
                  last_opened_at: sql`coalesce(excluded.last_opened_at, node_interactions.last_opened_at)`,
                  first_seen_at: sql`coalesce(excluded.first_seen_at, node_interactions.first_seen_at)`,
                  last_seen_at: sql`coalesce(excluded.last_seen_at, node_interactions.last_seen_at)`,
                })
              )
              .execute();
            batch.length = 0;
          }
        }

        if (batch.length > 0) {
          await database
            .insertInto('node_interactions')
            .values(batch)
            .onConflict((b) =>
              b.columns(['node_id', 'collaborator_id']).doUpdateSet({
                first_opened_at: sql`coalesce(excluded.first_opened_at, node_interactions.first_opened_at)`,
                last_opened_at: sql`coalesce(excluded.last_opened_at, node_interactions.last_opened_at)`,
                first_seen_at: sql`coalesce(excluded.first_seen_at, node_interactions.first_seen_at)`,
                last_seen_at: sql`coalesce(excluded.last_seen_at, node_interactions.last_seen_at)`,
              })
            )
            .execute();
        }
      }
    }
  }

  private async importDocumentUpdates() {
    const documentUpdateFiles = this.fileKeys
      .filter((file) => file.includes('document_updates'))
      .sort();

    if (documentUpdateFiles.length === 0) {
      return;
    }

    for (const documentUpdateFile of documentUpdateFiles) {
      const allDocumentUpdates =
        await this.fetchJsonFile<ExportDocumentUpdate[]>(documentUpdateFile);

      const documentUpdatesMap = new Map<string, ExportDocumentUpdate[]>();
      for (const documentUpdate of allDocumentUpdates) {
        if (!documentUpdatesMap.has(documentUpdate.documentId)) {
          documentUpdatesMap.set(documentUpdate.documentId, [documentUpdate]);
        } else {
          documentUpdatesMap
            .get(documentUpdate.documentId)
            ?.push(documentUpdate);
        }
      }

      for (const [
        documentId,
        exportDocumentUpdates,
      ] of documentUpdatesMap.entries()) {
        const node = await database
          .selectFrom('nodes')
          .selectAll()
          .where('id', '=', documentId)
          .executeTakeFirst();

        if (!node) {
          continue;
        }

        const existingDocument = await database
          .selectFrom('documents')
          .selectAll()
          .where('id', '=', documentId)
          .executeTakeFirst();

        const existingDocumentUpdates: SelectDocumentUpdate[] = [];

        if (existingDocument) {
          const dbDocumentUpdates = await database
            .selectFrom('document_updates')
            .selectAll()
            .where('document_id', '=', documentId)
            .execute();

          for (const dbDocumentUpdate of dbDocumentUpdates) {
            existingDocumentUpdates.push(dbDocumentUpdate);
          }
        }

        const ydoc = new YDoc();
        const rootId = node.root_id;
        let createdBy: string | null = null;
        let createdAt: Date | null = null;
        let updatedBy: string | null = null;
        let updatedAt: Date | null = null;

        for (const existingDocumentUpdate of existingDocumentUpdates) {
          ydoc.applyUpdate(existingDocumentUpdate.data);

          if (createdBy === null) {
            createdBy = existingDocumentUpdate.created_by;
          } else {
            updatedBy = existingDocumentUpdate.created_by;
          }

          if (createdAt === null) {
            createdAt = new Date(existingDocumentUpdate.created_at);
          } else {
            updatedAt = new Date(existingDocumentUpdate.created_at);
          }
        }

        for (const exportDocumentUpdate of exportDocumentUpdates) {
          ydoc.applyUpdate(exportDocumentUpdate.data);

          if (createdBy === null) {
            createdBy = exportDocumentUpdate.createdBy;
          } else {
            updatedBy = exportDocumentUpdate.createdBy;
          }

          if (createdAt === null) {
            createdAt = new Date(exportDocumentUpdate.createdAt);
          } else {
            updatedAt = new Date(exportDocumentUpdate.createdAt);
          }
        }

        if (!createdBy || !createdAt) {
          continue;
        }

        const content = ydoc.getObject<DocumentContent>();
        await database.transaction().execute(async (trx) => {
          const createdDocumentUpdates = await trx
            .insertInto('document_updates')
            .returningAll()
            .values(
              exportDocumentUpdates.map((update) => ({
                id: update.id,
                document_id: documentId,
                root_id: rootId,
                data: decodeState(update.data),
                created_at: new Date(update.createdAt),
                created_by: createdBy,
                workspace_id: this.workspace.id,
              }))
            )
            .execute();

          if (!createdDocumentUpdates) {
            throw new Error('Failed to create document updates');
          }

          const lastRevision =
            createdDocumentUpdates[createdDocumentUpdates.length - 1]?.revision;

          if (!lastRevision) {
            throw new Error('Failed to get last revision');
          }

          const document = await trx
            .insertInto('documents')
            .returningAll()
            .values({
              id: documentId,
              content: JSON.stringify(content),
              workspace_id: this.workspace.id,
              created_at: createdAt,
              created_by: createdBy,
              updated_at: updatedAt,
              updated_by: updatedBy,
              revision: lastRevision,
            })
            .onConflict((b) =>
              b.columns(['id']).doUpdateSet({
                content: JSON.stringify(content),
                revision: lastRevision,
                updated_at: updatedAt ?? createdAt,
                updated_by: updatedBy ?? createdBy,
              })
            )
            .executeTakeFirst();

          if (!document) {
            throw new Error('Failed to create document');
          }
        });
      }
    }
  }

  private async importUploads() {
    const uploadFiles = this.fileKeys
      .filter((file) => file.includes('uploads'))
      .sort();

    if (uploadFiles.length === 0) {
      return;
    }

    for (const uploadFile of uploadFiles) {
      const uploads = await this.fetchJsonFile<ExportUpload[]>(uploadFile);
      const batch: CreateUpload[] = [];
      for (const upload of uploads) {
        const node = await database
          .selectFrom('nodes')
          .selectAll()
          .where('id', '=', upload.fileId)
          .executeTakeFirst();

        if (!node) {
          continue;
        }

        batch.push({
          file_id: upload.fileId,
          upload_id: upload.uploadId,
          root_id: node.root_id,
          workspace_id: this.workspace.id,
          created_at: new Date(upload.createdAt),
          created_by: this.workspace.created_by,
          path: upload.path,
          mime_type: upload.mimeType,
          size: upload.size,
          version_id: upload.versionId,
          uploaded_at: upload.uploadedAt ? new Date(upload.uploadedAt) : null,
        });

        if (batch.length >= WRITE_BATCH_SIZE) {
          await database
            .insertInto('uploads')
            .values(batch)
            .onConflict((b) =>
              b.columns(['file_id']).doUpdateSet({
                path: sql`coalesce(excluded.path, uploads.path)`,
                mime_type: sql`coalesce(excluded.mime_type, uploads.mime_type)`,
                size: sql`coalesce(excluded.size, uploads.size)`,
                version_id: sql`coalesce(excluded.version_id, uploads.version_id)`,
                upload_id: sql`coalesce(excluded.upload_id, uploads.upload_id)`,
                created_at: sql`coalesce(excluded.created_at, uploads.created_at)`,
                uploaded_at: sql`coalesce(excluded.uploaded_at, uploads.uploaded_at)`,
                created_by: sql`coalesce(excluded.created_by, uploads.created_by)`,
              })
            )
            .execute();
          batch.length = 0;
        }

        if (batch.length > 0) {
          await database
            .insertInto('uploads')
            .values(batch)
            .onConflict((b) =>
              b.columns(['file_id']).doUpdateSet({
                path: sql`coalesce(excluded.path, uploads.path)`,
                mime_type: sql`coalesce(excluded.mime_type, uploads.mime_type)`,
                size: sql`coalesce(excluded.size, uploads.size)`,
                version_id: sql`coalesce(excluded.version_id, uploads.version_id)`,
                upload_id: sql`coalesce(excluded.upload_id, uploads.upload_id)`,
                created_at: sql`coalesce(excluded.created_at, uploads.created_at)`,
                uploaded_at: sql`coalesce(excluded.uploaded_at, uploads.uploaded_at)`,
                created_by: sql`coalesce(excluded.created_by, uploads.created_by)`,
              })
            )
            .execute();
        }
      }
    }
  }

  private async fetchArtifact(): Promise<SelectTaskArtifact | undefined> {
    const artifact = await database
      .selectFrom('task_artifacts')
      .selectAll()
      .where('task_id', '=', this.task.id)
      .limit(1)
      .executeTakeFirst();

    return artifact;
  }

  private async fetchJsonFile<T>(path: string): Promise<T> {
    const command = new GetObjectCommand({
      Bucket: config.fileS3.bucketName,
      Key: path,
    });

    const response = await fileS3.send(command);

    if (!response.Body) {
      throw new Error('Data file body not found');
    }

    const json = await response.Body.transformToString();
    const data = JSON.parse(json) as T;

    return data;
  }

  private async unzipArtifact(artifact: SelectTaskArtifact) {
    const extension = path.extname(artifact.path);
    const outputPrefix = artifact.path.replace(extension, '');

    const s3Unzip = new S3Unzip({
      s3: fileS3,
      bucket: config.fileS3.bucketName,
      inputKey: artifact.path,
      outputPrefix,
    });

    const { outputKeys } = await s3Unzip.unzip();
    for (const outputKey of outputKeys) {
      this.fileKeys.push(outputKey);
    }
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
