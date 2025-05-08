import { DatabaseBackup, Info, Trash2, Users } from 'lucide-react';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/renderer/components/ui/tabs';
import { WorkspaceUpdate } from '@/renderer/components/workspaces/workspace-update';
import { WorkspaceUsers } from '@/renderer/components/workspaces/workspace-users';
import { WorkspaceDelete } from '@/renderer/components/workspaces/workspace-delete';
import { Tasks } from '@/renderer/components/tasks/tasks';
import { useWorkspace } from '@/renderer/contexts/workspace';

const tabTriggerClasses =
  'border-l-2 border-transparent justify-start rounded-none data-[state=active]:shadow-none data-[state=active]:border-primary data-[state=active]:bg-primary/5 py-1.5';
const tabTriggerIconClasses = 'h-5 w-5 me-2';

export const WorkspaceSettingsContainer = () => {
  const workspace = useWorkspace();
  const canDelete = workspace.role === 'owner';

  return (
    <Tabs
      orientation="vertical"
      defaultValue={'info'}
      className="min-w-full w-full flex flex-row gap-4 p-4"
    >
      <TabsList className="shrink-0 grid grid-cols-1 min-w-48 gap-1 p-0 bg-background">
        <TabsTrigger value={'info'} className={tabTriggerClasses}>
          <Info className={tabTriggerIconClasses} /> Info
        </TabsTrigger>
        <TabsTrigger value={'users'} className={tabTriggerClasses}>
          <Users className={tabTriggerIconClasses} /> Users
        </TabsTrigger>
        <TabsTrigger value={'tasks'} className={tabTriggerClasses}>
          <DatabaseBackup className={tabTriggerIconClasses} /> Tasks
        </TabsTrigger>
        <TabsTrigger
          value={'delete'}
          className={tabTriggerClasses}
          disabled={!canDelete}
        >
          <Trash2 className={tabTriggerIconClasses} /> Delete
        </TabsTrigger>
      </TabsList>
      <div className="w-full max-w-4xl">
        <TabsContent value={'info'}>
          <WorkspaceUpdate />
        </TabsContent>
        <TabsContent value={'users'}>
          <WorkspaceUsers />
        </TabsContent>
        <TabsContent value={'tasks'}>
          <Tasks />
        </TabsContent>
        <TabsContent value={'delete'}>
          <WorkspaceDelete />
        </TabsContent>
      </div>
    </Tabs>
  );
};
