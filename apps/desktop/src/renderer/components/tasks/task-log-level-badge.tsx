import { TaskLogLevel, formatTaskLogLevel } from '@colanode/core';

interface TaskLogLevelProps {
  level: TaskLogLevel;
}

export const TaskLogLevelBadge = ({ level }: TaskLogLevelProps) => {
  const getLevelStyles = () => {
    switch (level) {
      case TaskLogLevel.Info:
        return 'text-blue-700';
      case TaskLogLevel.Warning:
        return 'text-yellow-700';
      case TaskLogLevel.Error:
        return 'text-red-700';
      default:
        return 'text-gray-700';
    }
  };

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${getLevelStyles()}`}
    >
      {formatTaskLogLevel(level)}
    </span>
  );
};
