import { cn } from '@/shared/lib/utils';

interface SidebarMenuIconProps {
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  isActive?: boolean;
  className?: string;
}

export const SidebarMenuIcon = ({
  icon: Icon,
  onClick,
  isActive = false,
  className,
}: SidebarMenuIconProps) => {
  return (
    <div
      className={cn(
        'w-10 h-10 flex items-center justify-center hover:cursor-pointer hover:bg-gray-200 rounded-md',
        className,
        isActive ? 'bg-gray-200' : ''
      )}
      onClick={onClick}
    >
      <Icon
        className={cn(
          'size-5',
          isActive ? 'text-primary' : 'text-muted-foreground'
        )}
      />
    </div>
  );
};
