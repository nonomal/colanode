import { Request, Response } from 'express';
import { createNode } from '@/lib/nodes';
import {
  generateId,
  IdType,
  ApiErrorCode,
  UserStatus,
  generateNodeIndex,
} from '@colanode/core';
import { ResponseBuilder } from '@/lib/response-builder';
import { database } from '@/data/database';

export const debugTriggerAssistantHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { rootId, nodeId, content, selectedContextNodeIds, mode } = req.body;

  if (!rootId || !nodeId || !content) {
    return ResponseBuilder.badRequest(res, {
      code: ApiErrorCode.BadRequest,
      message: 'rootId, nodeId and content are required',
    });
  }

  // Get a real user from the database
  const user = await database
    .selectFrom('users')
    .selectAll()
    .where('status', '=', UserStatus.Active)
    .where('email', '=', 'ylberg37@gmail.com')
    .executeTakeFirst();

  if (!user) {
    return ResponseBuilder.internalError(res, {
      code: ApiErrorCode.Unknown,
      message: 'No active user found in the database',
    });
  }

  const messageId = generateId(IdType.Message);
  const blockId = generateId(IdType.Block);

  const success = await createNode({
    nodeId: messageId,
    rootId,
    workspaceId: '01jq03y6jjc8rccwq7jwx2andnwc',
    userId: '01jq03y6jjc8rccwq7jwx2andpus',
    attributes: {
      type: 'message',
      subtype: 'question',
      parentId: nodeId,
      referenceId: null,
      selectedContextNodeIds: selectedContextNodeIds || [],
      mode: mode || 'default',
      content: {
        [blockId]: {
          id: blockId,
          type: 'paragraph',
          parentId: messageId,
          index: generateNodeIndex(),
          content: [
            {
              type: 'text',
              text: content,
              marks: [],
            },
          ],
        },
      },
    },
  });

  if (!success) {
    return ResponseBuilder.internalError(res, {
      code: ApiErrorCode.Unknown,
      message: 'Failed to create message',
    });
  }

  return ResponseBuilder.success(res, { messageId });
};

export default {
  debugTriggerAssistantHandler,
};
