import { AppMetadataListQueryHandler } from '@/main/queries/apps/app-metadata-list';
import { AccountGetQueryHandler } from '@/main/queries/accounts/account-get';
import { AccountListQueryHandler } from '@/main/queries/accounts/accounts-list';
import { EmojiGetQueryHandler } from '@/main/queries/emojis/emoji-get';
import { EmojiListQueryHandler } from '@/main/queries/emojis/emoji-list';
import { EmojiCategoryListQueryHandler } from '@/main/queries/emojis/emoji-category-list';
import { EmojiSearchQueryHandler } from '@/main/queries/emojis/emoji-search';
import { EmojiGetBySkinIdQueryHandler } from '@/main/queries/emojis/emoji-get-by-skin-id';
import { FileListQueryHandler } from '@/main/queries/files/file-list';
import { FileStateGetQueryHandler } from '@/main/queries/files/file-state-get';
import { FileMetadataGetQueryHandler } from '@/main/queries/files/file-metadata-get';
import { IconListQueryHandler } from '@/main/queries/icons/icon-list';
import { IconSearchQueryHandler } from '@/main/queries/icons/icon-search';
import { IconCategoryListQueryHandler } from '@/main/queries/icons/icon-category-list';
import { MessageListQueryHandler } from '@/main/queries/messages/message-list';
import { NodeReactionsListQueryHandler } from '@/main/queries/nodes/node-reaction-list';
import { NodeReactionsAggregateQueryHandler } from '@/main/queries/nodes/node-reactions-aggregate';
import { NodeChildrenGetQueryHandler } from '@/main/queries/nodes/node-children-get';
import { NodeGetQueryHandler } from '@/main/queries/nodes/node-get';
import { NodeTreeGetQueryHandler } from '@/main/queries/nodes/node-tree-get';
import { RadarDataGetQueryHandler } from '@/main/queries/interactions/radar-data-get';
import { RecordListQueryHandler } from '@/main/queries/records/record-list';
import { ServerListQueryHandler } from '@/main/queries/servers/server-list';
import { UserSearchQueryHandler } from '@/main/queries/users/user-search';
import { WorkspaceGetQueryHandler } from '@/main/queries/workspaces/workspace-get';
import { WorkspaceListQueryHandler } from '@/main/queries/workspaces/workspace-list';
import { UserListQueryHandler } from '@/main/queries/users/user-list';
import { DatabaseListQueryHandler } from '@/main/queries/databases/database-list';
import { DatabaseViewListQueryHandler } from '@/main/queries/databases/database-view-list';
import { RecordSearchQueryHandler } from '@/main/queries/records/record-search';
import { UserGetQueryHandler } from '@/main/queries/users/user-get';
import { SpaceListQueryHandler } from '@/main/queries/spaces/space-list';
import { ChatListQueryHandler } from '@/main/queries/chats/chat-list';
import { DocumentGetQueryHandler } from '@/main/queries/documents/document-get';
import { DocumentStateGetQueryHandler } from '@/main/queries/documents/document-state-get';
import { DocumentUpdatesListQueryHandler } from '@/main/queries/documents/document-update-list';
import { AccountMetadataListQueryHandler } from '@/main/queries/accounts/account-metadata-list';
import { WorkspaceMetadataListQueryHandler } from '@/main/queries/workspaces/workspace-metadata-list';
import { TaskListQueryHandler } from '@/main/queries/tasks/task-list';
import { TaskGetQueryHandler } from '@/main/queries/tasks/task-get';
import { QueryHandler } from '@/main/lib/types';
import { QueryMap } from '@/shared/queries';

type QueryHandlerMap = {
  [K in keyof QueryMap]: QueryHandler<QueryMap[K]['input']>;
};

export const queryHandlerMap: QueryHandlerMap = {
  app_metadata_list: new AppMetadataListQueryHandler(),
  account_list: new AccountListQueryHandler(),
  message_list: new MessageListQueryHandler(),
  node_reaction_list: new NodeReactionsListQueryHandler(),
  node_reactions_aggregate: new NodeReactionsAggregateQueryHandler(),
  node_get: new NodeGetQueryHandler(),
  node_tree_get: new NodeTreeGetQueryHandler(),
  record_list: new RecordListQueryHandler(),
  server_list: new ServerListQueryHandler(),
  user_search: new UserSearchQueryHandler(),
  workspace_list: new WorkspaceListQueryHandler(),
  user_list: new UserListQueryHandler(),
  file_list: new FileListQueryHandler(),
  emoji_list: new EmojiListQueryHandler(),
  emoji_get: new EmojiGetQueryHandler(),
  emoji_get_by_skin_id: new EmojiGetBySkinIdQueryHandler(),
  emoji_category_list: new EmojiCategoryListQueryHandler(),
  emoji_search: new EmojiSearchQueryHandler(),
  icon_list: new IconListQueryHandler(),
  icon_search: new IconSearchQueryHandler(),
  icon_category_list: new IconCategoryListQueryHandler(),
  node_children_get: new NodeChildrenGetQueryHandler(),
  radar_data_get: new RadarDataGetQueryHandler(),
  file_metadata_get: new FileMetadataGetQueryHandler(),
  account_get: new AccountGetQueryHandler(),
  workspace_get: new WorkspaceGetQueryHandler(),
  database_list: new DatabaseListQueryHandler(),
  database_view_list: new DatabaseViewListQueryHandler(),
  record_search: new RecordSearchQueryHandler(),
  user_get: new UserGetQueryHandler(),
  file_state_get: new FileStateGetQueryHandler(),
  chat_list: new ChatListQueryHandler(),
  space_list: new SpaceListQueryHandler(),
  workspace_metadata_list: new WorkspaceMetadataListQueryHandler(),
  document_get: new DocumentGetQueryHandler(),
  document_state_get: new DocumentStateGetQueryHandler(),
  document_updates_list: new DocumentUpdatesListQueryHandler(),
  account_metadata_list: new AccountMetadataListQueryHandler(),
  task_list: new TaskListQueryHandler(),
  task_get: new TaskGetQueryHandler(),
};
