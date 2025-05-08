import { Layout } from '@/renderer/components/layouts/layout';
import { useAccount } from '@/renderer/contexts/account';
import { WorkspaceContext } from '@/renderer/contexts/workspace';
import { useQuery } from '@/renderer/hooks/use-query';
import {
  WorkspaceMetadataKey,
  WorkspaceMetadataMap,
  Workspace as WorkspaceType,
} from '@/shared/types/workspaces';

interface WorkspaceProps {
  workspace: WorkspaceType;
}

export const Workspace = ({ workspace }: WorkspaceProps) => {
  const account = useAccount();

  const { data: metadata, isPending: isPendingMetadata } = useQuery({
    type: 'workspace_metadata_list',
    accountId: account.id,
    workspaceId: workspace.id,
  });

  if (isPendingMetadata) {
    return null;
  }

  return (
    <WorkspaceContext.Provider
      value={{
        ...workspace,
        getMetadata<K extends WorkspaceMetadataKey>(key: K) {
          const value = metadata?.find((m) => m.key === key);
          if (!value) {
            return undefined;
          }

          if (value.key !== key) {
            return undefined;
          }

          return value as WorkspaceMetadataMap[K];
        },
        setMetadata<K extends WorkspaceMetadataKey>(
          key: K,
          value: WorkspaceMetadataMap[K]['value']
        ) {
          window.colanode.executeMutation({
            type: 'workspace_metadata_save',
            accountId: account.id,
            workspaceId: workspace.id,
            key,
            value,
          });
        },
        deleteMetadata(key: string) {
          window.colanode.executeMutation({
            type: 'workspace_metadata_delete',
            accountId: account.id,
            workspaceId: workspace.id,
            key,
          });
        },
      }}
    >
      <Layout key={workspace.id} />
    </WorkspaceContext.Provider>
  );
};
