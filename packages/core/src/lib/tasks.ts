import { TaskLogLevel, TaskStatus, TaskType } from '../types/tasks';

export const formatTaskLogLevel = (level: TaskLogLevel) => {
  switch (level) {
    case TaskLogLevel.Info:
      return 'INFO';
    case TaskLogLevel.Warning:
      return 'WARNING';
    case TaskLogLevel.Error:
      return 'ERROR';
  }
};

export const formatTaskStatus = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.Pending:
      return 'Pending';
    case TaskStatus.Running:
      return 'Running';
    case TaskStatus.Completed:
      return 'Completed';
    case TaskStatus.Failed:
      return 'Failed';
  }
};

export const formatTaskType = (type: TaskType) => {
  switch (type) {
    case 'export_workspace':
      return 'Export Workspace';
    default:
      return type;
  }
};
