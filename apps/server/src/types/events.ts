import { TaskArtifactOutput, TaskLogOutput, TaskOutput } from '@colanode/core';

export type NodeCreatedEvent = {
  type: 'node_created';
  nodeId: string;
  rootId: string;
  workspaceId: string;
};

export type NodeUpdatedEvent = {
  type: 'node_updated';
  nodeId: string;
  rootId: string;
  workspaceId: string;
};

export type NodeDeletedEvent = {
  type: 'node_deleted';
  nodeId: string;
  rootId: string;
  workspaceId: string;
};

export type NodeInteractionUpdatedEvent = {
  type: 'node_interaction_updated';
  nodeId: string;
  collaboratorId: string;
  rootId: string;
  workspaceId: string;
};

export type NodeReactionCreatedEvent = {
  type: 'node_reaction_created';
  nodeId: string;
  collaboratorId: string;
  rootId: string;
  workspaceId: string;
};

export type NodeReactionDeletedEvent = {
  type: 'node_reaction_deleted';
  nodeId: string;
  collaboratorId: string;
  rootId: string;
  workspaceId: string;
};

export type CollaborationCreatedEvent = {
  type: 'collaboration_created';
  collaboratorId: string;
  nodeId: string;
  workspaceId: string;
};

export type CollaborationUpdatedEvent = {
  type: 'collaboration_updated';
  collaboratorId: string;
  nodeId: string;
  workspaceId: string;
};

export type FileCreatedEvent = {
  type: 'file_created';
  fileId: string;
  rootId: string;
  workspaceId: string;
};

export type FileUpdatedEvent = {
  type: 'file_updated';
  fileId: string;
  rootId: string;
  workspaceId: string;
};

export type FileDeletedEvent = {
  type: 'file_deleted';
  fileId: string;
  rootId: string;
  workspaceId: string;
};

export type FileInteractionUpdatedEvent = {
  type: 'file_interaction_updated';
  fileId: string;
  collaboratorId: string;
  rootId: string;
  workspaceId: string;
};

export type UserCreatedEvent = {
  type: 'user_created';
  userId: string;
  workspaceId: string;
  accountId: string;
};

export type UserUpdatedEvent = {
  type: 'user_updated';
  userId: string;
  workspaceId: string;
  accountId: string;
};

export type AccountUpdatedEvent = {
  type: 'account_updated';
  accountId: string;
};

export type WorkspaceCreatedEvent = {
  type: 'workspace_created';
  workspaceId: string;
};

export type WorkspaceUpdatedEvent = {
  type: 'workspace_updated';
  workspaceId: string;
};

export type WorkspaceDeletedEvent = {
  type: 'workspace_deleted';
  workspaceId: string;
};

export type DeviceDeletedEvent = {
  type: 'device_deleted';
  accountId: string;
  deviceId: string;
};

export type DocumentUpdatedEvent = {
  type: 'document_updated';
  documentId: string;
  workspaceId: string;
};

export type DocumentUpdateCreatedEvent = {
  type: 'document_update_created';
  documentId: string;
  rootId: string;
  workspaceId: string;
};

export type TaskCreatedEvent = {
  type: 'task_created';
  task: TaskOutput;
};

export type TaskUpdatedEvent = {
  type: 'task_updated';
  task: TaskOutput;
};

export type TaskLogCreatedEvent = {
  type: 'task_log_created';
  task: TaskOutput;
  log: TaskLogOutput;
};

export type TaskArtifactCreatedEvent = {
  type: 'task_artifact_created';
  task: TaskOutput;
  artifact: TaskArtifactOutput;
};

export type Event =
  | NodeCreatedEvent
  | NodeUpdatedEvent
  | NodeDeletedEvent
  | CollaborationCreatedEvent
  | CollaborationUpdatedEvent
  | NodeInteractionUpdatedEvent
  | NodeReactionCreatedEvent
  | NodeReactionDeletedEvent
  | UserCreatedEvent
  | UserUpdatedEvent
  | AccountUpdatedEvent
  | WorkspaceCreatedEvent
  | WorkspaceUpdatedEvent
  | WorkspaceDeletedEvent
  | DeviceDeletedEvent
  | FileCreatedEvent
  | FileUpdatedEvent
  | FileDeletedEvent
  | FileInteractionUpdatedEvent
  | DocumentUpdatedEvent
  | DocumentUpdateCreatedEvent
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskLogCreatedEvent
  | TaskArtifactCreatedEvent;
