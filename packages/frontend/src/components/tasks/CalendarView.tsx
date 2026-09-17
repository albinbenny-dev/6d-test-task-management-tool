import { useMemo, useRef, useState } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isToday, format, addMonths, subMonths,
} from 'date-fns';
import { taskDotColor } from '../../lib/taskMeta';
import { PriorityBadge } from './PriorityBadge';
import { FloatingPortal } from '../ui/FloatingPortal';
import { useClickOutside } from '../../hooks/useClickOutside';
import type { Task } from '../../types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS_PER_DAY = 3;

function dayKey(dateStr: string): string {
  return format(new Date(dateStr), 'yyyy-MM-dd');
}

// A task chip — same small color-dot + truncated-title language used for
// tags/labels elsewhere in Task Management, just scoped to a day cell. The
// tooltip includes the source list name — a no-op on the per-list page
// (every task shares the same list there) but the only way to tell tasks
// apart by list when this view is fed a whole project's tasks combined.
function TaskChip({ task, onOpenTask }: { task: Task; onOpenTask: (task: Task) => void }) {
  const title = task.taskList ? `${task.title} — ${task.taskList.name}` : task.title;
  return (
    <div className="tm-cal-chip" title={title} onClick={() => onOpenTask(task)}>
      <span className="tm-cal-chip-dot" style={{ background: taskDotColor(task) }} />
      <span className="tm-cal-chip-title">{task.title}</span>
    </div>
  );
}

// ── One calendar day cell — its own popover state, since only its own
// "+N more" trigger and popover care about it (same self-contained pattern
// as TaskListsSidebar's per-row kebab menu). ────────────────────────────────
function DayCell({ date, inMonth, tasks, onOpenTask }: {
  date: Date;
  inMonth: boolean;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}) {
  const [open, setOpen] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside([cellRef, menuRef], () => setOpen(false), open);

  const shown = tasks.slice(0, MAX_CHIPS_PER_DAY);
  const extra = tasks.length - shown.length;

  return (
    <div ref={cellRef} className={`tm-cal-day${inMonth ? '' : ' outside-month'}${isToday(date) ? ' today' : ''}`}>
      <span className="tm-cal-day-num">{format(date, 'd')}</span>
      <div className="tm-cal-day-chips">
        {shown.map((task) => <TaskChip key={task.id} task={task} onOpenTask={onOpenTask} />)}
        {extra > 0 && (
          <div className="tm-cal-more" onClick={() => setOpen(true)}>+{extra} more</div>
        )}
      </div>

      <FloatingPortal anchorRef={cellRef} open={open} portalRef={menuRef} width={230}>
        <div className="tm-cal-popover">
          <div className="tm-cal-popover-header">{format(date, 'EEEE, MMM d')}</div>
          {tasks.map((task) => (
            <div
              key={task.id}
              className="tm-cal-popover-row"
              onClick={() => { setOpen(false); onOpenTask(task); }}
            >
              <span className="tm-cal-chip-dot" style={{ background: taskDotColor(task) }} />
              <span className="tm-cal-popover-title" title={task.title}>{task.title}</span>
              {task.taskList && <span className="tag">{task.taskList.name}</span>}
              <PriorityBadge priority={task.priority} />
            </div>
          ))}
        </div>
      </FloatingPortal>
    </div>
  );
}

// ── Month-grid calendar — a third way to view a task list's tasks, laid
// out by due date instead of status/rank. Purely a client-side rendering of
// whatever `tasks` List/Board already receive (same filters apply here too)
// — no separate fetch, no backend changes. Subtasks are included as their
// own chips on their own due dates (unlike Board/List, which fold them
// under their parent) since the point of this view is "what's due when",
// and a subtask's own deadline matters even when its parent's differs. ─────
export function CalendarView({ tasks, onOpenTask }: {
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));

  const days = useMemo(() => {
    const gridStart = startOfWeek(currentMonth);
    const gridEnd = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const key = dayKey(task.dueDate);
      const bucket = map.get(key);
      if (bucket) bucket.push(task); else map.set(key, [task]);
    }
    return map;
  }, [tasks]);

  const unscheduled = useMemo(() => tasks.filter((t) => !t.dueDate), [tasks]);

  return (
    <div className="card tm-cal" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="tm-cal-header">
        <div className="tm-cal-nav">
          <button className="tm-cal-nav-btn" onClick={() => setCurrentMonth((m) => subMonths(m, 1))} title="Previous month">‹</button>
          <span className="tm-cal-month-label">{format(currentMonth, 'MMMM yyyy')}</span>
          <button className="tm-cal-nav-btn" onClick={() => setCurrentMonth((m) => addMonths(m, 1))} title="Next month">›</button>
        </div>
        <button className="tm-cal-today-btn" onClick={() => setCurrentMonth(startOfMonth(new Date()))}>Today</button>
      </div>

      {unscheduled.length > 0 && (
        <div className="tm-cal-unscheduled">
          <span className="tm-cal-unscheduled-label">Unscheduled ({unscheduled.length})</span>
          <div className="tm-cal-unscheduled-list">
            {unscheduled.map((task) => <TaskChip key={task.id} task={task} onOpenTask={onOpenTask} />)}
          </div>
        </div>
      )}

      <div className="tm-cal-weekdays">
        {WEEKDAY_LABELS.map((label) => <div key={label} className="tm-cal-weekday">{label}</div>)}
      </div>

      <div className="tm-cal-grid">
        {days.map((date) => (
          <DayCell
            key={date.toISOString()}
            date={date}
            inMonth={isSameMonth(date, currentMonth)}
            tasks={tasksByDay.get(format(date, 'yyyy-MM-dd')) ?? []}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
    </div>
  );
}
