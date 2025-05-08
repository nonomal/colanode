import { Avatar } from '@/renderer/components/avatars/avatar';
import { useWorkspace } from '@/renderer/contexts/workspace';

export const WorkspaceSettingsContainerTab = () => {
  const workspace = useWorkspace();

  return (
    <div className="flex items-center space-x-2">
      <Avatar
        size="small"
        id={workspace.id}
        name={workspace.name}
        avatar={workspace.avatar}
      />
      <span>Workspace Settings</span>
    </div>
  );
};
