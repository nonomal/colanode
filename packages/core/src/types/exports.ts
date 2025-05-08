import { z } from 'zod';

import { UserStatus, workspaceRoleSchema } from './workspaces';

export const exportCountsSchema = z.object({
  users: z.number(),
  nodeUpdates: z.number(),
  nodeReactions: z.number(),
  nodeInteractions: z.number(),
  documentUpdates: z.number(),
  uploads: z.number(),
});

export type ExportCounts = z.infer<typeof exportCountsSchema>;

export const exportFileSchema = z.object({
  type: z.enum(['data', 'file', 'manifest']),
  name: z.string(),
  size: z.number(),
  createdAt: z.string(),
});

export type ExportFile = z.infer<typeof exportFileSchema>;

export const exportManifestSchema = z.object({
  id: z.string(),
  server: z.object({
    version: z.string(),
    sha: z.string(),
  }),
  workspace: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    createdAt: z.string(),
  }),
  counts: exportCountsSchema,
  files: z.array(exportFileSchema),
  createdAt: z.string(),
});

export type ExportManifest = z.infer<typeof exportManifestSchema>;

export const exportNodeUpdateSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  data: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
});

export type ExportNodeUpdate = z.infer<typeof exportNodeUpdateSchema>;

export const exportNodeReactionSchema = z.object({
  nodeId: z.string(),
  collaboratorId: z.string(),
  reaction: z.string(),
  createdAt: z.string(),
});

export type ExportNodeReaction = z.infer<typeof exportNodeReactionSchema>;

export const exportNodeInteractionSchema = z.object({
  nodeId: z.string(),
  collaboratorId: z.string(),
  firstSeenAt: z.string().optional(),
  lastSeenAt: z.string().optional(),
  firstOpenedAt: z.string().optional(),
  lastOpenedAt: z.string().optional(),
});

export type ExportNodeInteraction = z.infer<typeof exportNodeInteractionSchema>;

export const exportDocumentUpdateSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  data: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
});

export type ExportDocumentUpdate = z.infer<typeof exportDocumentUpdateSchema>;

export const exportUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatar: z.string().optional(),
  customName: z.string().optional(),
  customAvatar: z.string().optional(),
  storageLimit: z.string(),
  maxFileSize: z.string(),
  role: workspaceRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  status: z.nativeEnum(UserStatus),
});

export type ExportUser = z.infer<typeof exportUserSchema>;

export const exportUploadSchema = z.object({
  fileId: z.string(),
  uploadId: z.string(),
  mimeType: z.string(),
  size: z.number(),
  path: z.string(),
  versionId: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  uploadedAt: z.string().optional(),
});

export type ExportUpload = z.infer<typeof exportUploadSchema>;
