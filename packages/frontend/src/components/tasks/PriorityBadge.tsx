import { PRIORITY_LABEL } from '../../lib/taskMeta';
import type { TaskPriority } from '../../types';

const FLAG: Record<TaskPriority, string> = {
  LOW: '⚑',
  NORMAL: '⚑',
  HIGH: '⚑',
  URGENT: '⚑',
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className={`tm-priority tm-priority-${priority}`}>
      <span aria-hidden>{FLAG[priority]}</span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
