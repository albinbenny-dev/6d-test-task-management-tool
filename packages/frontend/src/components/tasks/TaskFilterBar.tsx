import { TbBtn } from '../layout/Topbar';
import { MultiSelectFilter } from '../testCycles/FilterBar';
import { ALL_TASK_STATUSES, STATUS_LABEL, ALL_PRIORITIES, PRIORITY_LABEL, TASK_DUE_BUCKETS } from '../../lib/taskMeta';

// Search + every filter dimension for a task list, rendered ONCE by
// TaskListDetail above the Board/List toggle — owning this state at the
// page level (rather than inside TaskListView, which used to own it
// locally) is what keeps filters intact when switching views: List and
// Board used to be two separate mounted trees, so toggling between them
// unmounted whichever one held the filter state and threw it away.
export interface TaskFilterState {
  search: string;
  statusFilters: string[];
  priorityFilters: string[];
  assigneeFilters: string[];
  dueFilters: string[];
  tagFilters: string[];
}

export function emptyTaskFilters(): TaskFilterState {
  return { search: '', statusFilters: [], priorityFilters: [], assigneeFilters: [], dueFilters: [], tagFilters: [] };
}

export function countActiveTaskFilters(f: TaskFilterState): number {
  return f.statusFilters.length + f.priorityFilters.length + f.assigneeFilters.length + f.dueFilters.length + f.tagFilters.length + (f.search.trim() ? 1 : 0);
}

export function TaskFilterBar({
  filters, onChange, assigneeOptions, tagOptions,
  groupByStatus, onGroupByStatusChange, showGroupToggle,
  filteredCount, totalCount,
}: {
  filters: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  assigneeOptions: string[];
  tagOptions: string[];
  groupByStatus: boolean;
  onGroupByStatusChange: (v: boolean) => void;
  showGroupToggle: boolean;
  filteredCount: number;
  totalCount: number;
}) {
  const activeFilterCount = countActiveTaskFilters(filters);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
        background: 'var(--surface2)', flexShrink: 0, marginBottom: 12,
      }}
    >
      <div style={{ position: 'relative', flex: '0 1 220px', minWidth: 140 }}>
        <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 11, opacity: 0.5 }}>🔍</span>
        <input
          className="input-field"
          placeholder="Search tasks…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          style={{ fontSize: 12, padding: '6px 9px 6px 28px', width: '100%' }}
        />
      </div>
      <MultiSelectFilter label="Status" values={filters.statusFilters} onChange={(v) => onChange({ ...filters, statusFilters: v })} options={ALL_TASK_STATUSES.map((s) => STATUS_LABEL[s])} />
      <MultiSelectFilter label="Priority" values={filters.priorityFilters} onChange={(v) => onChange({ ...filters, priorityFilters: v })} options={ALL_PRIORITIES.map((p) => PRIORITY_LABEL[p])} />
      <MultiSelectFilter label="Assignee" values={filters.assigneeFilters} onChange={(v) => onChange({ ...filters, assigneeFilters: v })} options={assigneeOptions} />
      <MultiSelectFilter label="Due date" values={filters.dueFilters} onChange={(v) => onChange({ ...filters, dueFilters: v })} options={[...TASK_DUE_BUCKETS]} />
      <MultiSelectFilter label="Tags" values={filters.tagFilters} onChange={(v) => onChange({ ...filters, tagFilters: v })} options={tagOptions} />
      {activeFilterCount > 0 && (
        <TbBtn variant="ghost" onClick={() => onChange(emptyTaskFilters())}>✕ Clear ({activeFilterCount})</TbBtn>
      )}
      {showGroupToggle && (
        <div className="tm-view-tabs" style={{ marginLeft: 'auto' }}>
          <button className={`tm-view-tab${!groupByStatus ? ' active' : ''}`} onClick={() => onGroupByStatusChange(false)}>☰ Flat</button>
          <button className={`tm-view-tab${groupByStatus ? ' active' : ''}`} onClick={() => onGroupByStatusChange(true)}>▤ By status</button>
        </div>
      )}
      <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', marginLeft: showGroupToggle ? 0 : 'auto' }}>
        {filteredCount} of {totalCount} task{totalCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}
