import type { Project } from '~/lib/projects/types';

export function MentorTopBar(props: {
  projects: Project[];
  selectedProjectId: string;
  onSelectProjectId: (id: string) => void;
  canRunVertical: boolean;
  canRunIngest: boolean;
  isVerticalRunning: boolean;
  isIngesting: boolean;
  onRunVertical: () => void;
  onRunIngestion: () => void;
  onOpenHealth: () => void;
  dailyPriority: null | { id: string; priority_text: string; date: string; completed: boolean };
  isDailyPriorityLoading: boolean;
  onGenerateDailyPriority: () => void;
  onToggleDailyPriority: (completed: boolean) => void;
}) {
  return (
    <div className="border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-4 py-3">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold">Mentor</div>
          <select
            className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary"
            value={props.selectedProjectId}
            onChange={(e) => props.onSelectProjectId(e.target.value)}
          >
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title ?? 'Untitled project'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={props.onOpenHealth}
              disabled={!props.selectedProjectId}
              className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm font-semibold text-bolt-elements-textPrimary disabled:opacity-60"
            >
              Hälsokoll
            </button>

            <button
              type="button"
              onClick={props.onGenerateDailyPriority}
              disabled={props.isDailyPriorityLoading || !props.selectedProjectId}
              className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm font-semibold text-bolt-elements-textPrimary disabled:opacity-60"
            >
              {props.isDailyPriorityLoading ? 'Laddar…' : 'Dagens prioritet'}
            </button>
          </div>

          {props.dailyPriority ? (
            <label className="flex items-start gap-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary">
              <input
                type="checkbox"
                className="mt-1"
                checked={props.dailyPriority.completed}
                onChange={(e) => props.onToggleDailyPriority(e.target.checked)}
              />
              <span className={props.dailyPriority.completed ? 'line-through opacity-70' : ''}>{props.dailyPriority.priority_text}</span>
            </label>
          ) : null}

          <div className="flex items-center gap-2">
          <button
            onClick={props.onRunVertical}
            disabled={!props.canRunVertical || props.isVerticalRunning}
            className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm font-semibold text-bolt-elements-textPrimary disabled:opacity-60"
          >
            {props.isVerticalRunning ? 'Running…' : 'Run Vertical'}
          </button>
          <button
            onClick={props.onRunIngestion}
            disabled={!props.canRunIngest || props.isIngesting}
            className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm font-semibold text-bolt-elements-textPrimary disabled:opacity-60"
          >
            {props.isIngesting ? 'Running…' : 'Run ingestion'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
