import { MonitorStop, Server, Settings, Trash, Users } from 'lucide-react';

import { SidebarHeader } from '@/renderer/components/layouts/sidebars/sidebar-header';
import { SidebarSettingsItem } from '@/renderer/components/layouts/sidebars/sidebar-settings-item';
import { SpecialContainerTabPath } from '@/shared/types/workspaces';

export const SettingsSidebar = () => {
  return (
    <div className="flex flex-col gap-4 h-full px-2">
      <div className="flex w-full min-w-0 flex-col gap-1">
        <SidebarHeader title="Workspace settings" />
        <SidebarSettingsItem
          title="General"
          icon={Settings}
          path={SpecialContainerTabPath.WorkspaceGeneralSettings}
        />
        <SidebarSettingsItem
          title="Users"
          icon={Users}
          path={SpecialContainerTabPath.WorkspaceUsersSettings}
        />
        <SidebarSettingsItem
          title="Delete"
          icon={Trash}
          path={SpecialContainerTabPath.WorkspaceDeleteSettings}
        />
      </div>
      <div className="flex w-full min-w-0 flex-col gap-1">
        <SidebarHeader title="Account settings" />
        <SidebarSettingsItem
          title="General"
          icon={Settings}
          path={SpecialContainerTabPath.AccountGeneralSettings}
        />
      </div>
      <div className="flex w-full min-w-0 flex-col gap-1">
        <SidebarHeader title="Application" />
        <SidebarSettingsItem
          title="Desktop"
          icon={MonitorStop}
          path={SpecialContainerTabPath.ApplicationDesktopSettings}
        />
        <SidebarSettingsItem
          title="Server"
          icon={Server}
          path={SpecialContainerTabPath.ApplicationServerSettings}
        />
      </div>
    </div>
  );
};
