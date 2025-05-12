import { SidebarMenu } from '@/renderer/components/layouts/sidebars/sidebar-menu';
import { SidebarChats } from '@/renderer/components/layouts/sidebars/sidebar-chats';
import { SidebarSpaces } from '@/renderer/components/layouts/sidebars/sidebar-spaces';
import { SettingsSidebar } from '@/renderer/components/layouts/sidebars/sidebar-settings';
import { SidebarMenuType } from '@/shared/types/workspaces';

interface SidebarProps {
  menu: SidebarMenuType;
  onMenuChange: (menu: SidebarMenuType) => void;
}

export const Sidebar = ({ menu, onMenuChange }: SidebarProps) => {
  return (
    <div className="flex h-screen min-h-screen max-h-screen w-full min-w-full flex-row bg-slate-50">
      <SidebarMenu value={menu} onChange={onMenuChange} />
      <div className="min-h-0 flex-grow overflow-auto">
        {menu === 'spaces' && <SidebarSpaces />}
        {menu === 'chats' && <SidebarChats />}
        {menu === 'settings' && <SettingsSidebar />}
      </div>
    </div>
  );
};
