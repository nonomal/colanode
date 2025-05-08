import { TaskArtifactOutput, TaskLogOutput, TaskOutput } from '@colanode/core';

import { SelectTask, SelectTaskArtifact, SelectTaskLog } from '@/data/schema';

export const mapTaskOutput = (task: SelectTask): TaskOutput => {
  return {
    id: task.id,
    name: task.name,
    description: task.description ?? undefined,
    status: task.status,
    workspaceId: task.workspace_id,
    createdAt: task.created_at.toISOString(),
    createdBy: task.created_by,
    completedAt: task.completed_at?.toISOString(),
    attributes: task.attributes,
  };
};

export const mapTaskLogOutput = (log: SelectTaskLog): TaskLogOutput => {
  return {
    id: log.id,
    level: log.level,
    message: log.message,
    createdAt: log.created_at.toISOString(),
  };
};

export const mapTaskArtifactOutput = (
  artifact: SelectTaskArtifact
): TaskArtifactOutput => {
  return {
    id: artifact.id,
    type: artifact.type,
    name: artifact.name,
    size: artifact.size,
    mimeType: artifact.mime_type,
    createdAt: artifact.created_at.toISOString(),
  };
};
