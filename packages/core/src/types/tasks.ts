import { z } from 'zod';

import { apiListBaseOutputSchema } from './api';

export enum TaskStatus {
  Pending = 0,
  Running = 1,
  Completed = 2,
  Failed = 3,
}

export enum TaskLogLevel {
  Info = 0,
  Warning = 1,
  Error = 2,
}

export const taskArtifactTypeSchema = z.enum(['data', 'file', 'manifest']);
export type TaskArtifactType = z.infer<typeof taskArtifactTypeSchema>;

export const exportWorkspaceTaskAttributesSchema = z.object({
  type: z.literal('export_workspace'),
});

export type ExportWorkspaceTaskAttributes = z.infer<
  typeof exportWorkspaceTaskAttributesSchema
>;

export const taskAttributesSchema = z.discriminatedUnion('type', [
  exportWorkspaceTaskAttributesSchema,
]);

export type TaskAttributes = z.infer<typeof taskAttributesSchema>;
export type TaskType = TaskAttributes['type'];

export const taskOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  attributes: taskAttributesSchema,
  status: z.nativeEnum(TaskStatus),
  workspaceId: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  startedAt: z.string().optional(),
  activeAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type TaskOutput = z.infer<typeof taskOutputSchema>;

export const taskListOutputSchema = apiListBaseOutputSchema.extend({
  data: z.array(taskOutputSchema),
});

export type TaskListOutput = z.infer<typeof taskListOutputSchema>;

export const taskLogOutputSchema = z.object({
  id: z.string(),
  level: z.nativeEnum(TaskLogLevel),
  message: z.string(),
  createdAt: z.string(),
});

export type TaskLogOutput = z.infer<typeof taskLogOutputSchema>;

export const taskArtifactOutputSchema = z.object({
  id: z.string(),
  type: taskArtifactTypeSchema,
  name: z.string(),
  size: z.number(),
  mimeType: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
});

export type TaskArtifactOutput = z.infer<typeof taskArtifactOutputSchema>;

export const taskGetOutputSchema = z.object({
  task: taskOutputSchema,
  logs: z.array(taskLogOutputSchema),
  artifacts: z.array(taskArtifactOutputSchema),
});

export type TaskGetOutput = z.infer<typeof taskGetOutputSchema>;

export const taskCreateInputSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  attributes: taskAttributesSchema,
});

export type TaskCreateInput = z.infer<typeof taskCreateInputSchema>;

export const taskCreateOutputSchema = z.object({
  task: taskOutputSchema,
});

export type TaskCreateOutput = z.infer<typeof taskCreateOutputSchema>;
