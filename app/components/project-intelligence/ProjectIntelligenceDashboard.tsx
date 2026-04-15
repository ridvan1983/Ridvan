import { Link } from '@remix-run/react';
import { brand } from '~/config/brand';
import type { ProjectIntelligenceDashboardPayload } from '~/lib/project-intelligence/dashboard-types';

function healthColor(score: number) {
  if (score >= 80) {
    return 'text-emerald-400';
  }
  if (score >= 50) {
    return 'text-amber-400';
  }
  return 'text-red-400';
}

function healthBg(score: number) {
  if (score >= 80) {
    return 'bg-emerald-500/20';
  }
  if (score >= 50) {
    return 'bg-amber-500/20';
  }
  return 'bg-red-500/20';
}

function TrendIcon({ trend }: { trend: ProjectIntelligenceDashboardPayload['healthTrend'] }) {
  if (trend === 'up') {
    return <span className="text-emerald-400 i-ph:trend-up text-lg" title="Uppåt" />;
  }
  if (trend === 'down') {
    return <span className="text-red-400 i-ph:trend-down text-lg" title="Nedåt" />;
  }
  return <span className="text-bolt-elements-textSecondary i-ph:minus text-lg" title="Oförändrat" />;
}

function severityLabel(s: string) {
  if (s === 'high') {
    return 'Hög';
  }
  if (s === 'low') {
    return 'Låg';
  }
  return 'Medium';
}

function severityClass(s: string) {
  if (s === 'high') {
    return 'bg-red-500/20 text-red-300';
  }
  if (s === 'low') {
    return 'bg-slate-500/20 text-slate-300';
  }
  return 'bg-amber-500/20 text-amber-200';
}

function marketLabel(ind: ProjectIntelligenceDashboardPayload['marketPosition']['indicator']) {
  if (ind === 'strong') {
    return 'Stark';
  }
  if (ind === 'weak') {
    return 'Utvecklingsbar';
  }
  return 'Balanserad';
}

function mentorHref(projectId: string, mentorPrompt: string) {
  const q = new URLSearchParams();
  q.set('projectId', projectId);
  q.set('mentorDraft', mentorPrompt);
  return `/mentor?${q.toString()}`;
}

type Props = {
  projectId: string;
  dashboard: ProjectIntelligenceDashboardPayload | null;
  loading?: boolean;
  error?: string | null;
  brainMissing?: boolean;
  onRefresh?: () => void;
};

export function ProjectIntelligenceDashboard({ projectId, dashboard, loading, error, brainMissing, onRefresh }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 text-sm text-bolt-elements-textSecondary">
        Beräknar affärshälsa…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
        {error}
        {onRefresh ? (
          <button type="button" onClick={onRefresh} className="mt-2 block text-xs font-medium text-rose-100 underline">
            Försök igen
          </button>
        ) : null}
      </div>
    );
  }

  if (!dashboard) {
    return null;
  }

  return (
    <div className="space-y-4">
      {brainMissing ? (
        <p className="text-xs text-bolt-elements-textSecondary">
          Ingen Brain-data ännu — poängen är preliminär. Bygg och spara så uppdateras analysen.
        </p>
      ) : null}

      <section className={`rounded-2xl border border-bolt-elements-borderColor p-4 ${healthBg(dashboard.healthScore)}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-bolt-elements-textSecondary">Affärshälsa</div>
            <div className={`mt-1 text-4xl font-bold tabular-nums ${healthColor(dashboard.healthScore)}`}>
              {dashboard.healthScore}
            </div>
            <div className="text-xs text-bolt-elements-textSecondary">av 100</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-bolt-elements-textSecondary">Trend</span>
            <TrendIcon trend={dashboard.healthTrend} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
        <div className="text-sm font-semibold text-bolt-elements-textPrimary">Intäktsdrivare</div>
        <ul className="mt-3 space-y-3">
          {dashboard.revenueDrivers.map((d, i) => (
            <li key={`${d.title}-${i}`}>
              <Link
                to={mentorHref(projectId, d.mentorPrompt)}
                className="block rounded-xl bg-bolt-elements-background-depth-1 p-3 transition-theme hover:border-bolt-elements-item-contentAccent/30 hover:bg-bolt-elements-background-depth-3 border border-transparent"
              >
                <div className="text-sm font-medium text-bolt-elements-textPrimary">{d.title}</div>
                <div className="mt-1 text-xs text-bolt-elements-textSecondary leading-relaxed">{d.detail}</div>
                <div className="mt-2 text-[11px] font-medium text-violet-400">Öppna i Mentor →</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
        <div className="text-sm font-semibold text-bolt-elements-textPrimary">Risker</div>
        <ul className="mt-3 space-y-3">
          {dashboard.risks.map((r, i) => (
            <li key={`${r.title}-${i}`} className="rounded-xl bg-bolt-elements-background-depth-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-bolt-elements-textPrimary">{r.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${severityClass(r.severity)}`}>
                  {severityLabel(r.severity)}
                </span>
              </div>
              <div className="mt-2 text-xs text-bolt-elements-textSecondary leading-relaxed">
                <span className="font-medium text-bolt-elements-textPrimary/90">Åtgärd: </span>
                {r.action}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="rounded-2xl border-2 p-4"
        style={{ borderColor: `${brand.gradient.from}66` }}
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-bolt-elements-textSecondary">Nästa bästa åtgärd</div>
        <div className="mt-2 text-lg font-bold text-bolt-elements-textPrimary leading-snug">{dashboard.nextBestAction.title}</div>
        <p className="mt-2 text-sm text-bolt-elements-textSecondary leading-relaxed">{dashboard.nextBestAction.detail}</p>
        <Link
          to={mentorHref(projectId, dashboard.nextBestAction.mentorPrompt)}
          className="mt-4 inline-flex w-full items-center justify-center rounded-xl py-3 text-sm font-semibold text-white shadow-md"
          style={{
            backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})`,
          }}
        >
          Diskutera med Mentor
        </Link>
      </section>

      <section className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
        <div className="text-sm font-semibold text-bolt-elements-textPrimary">Marknadsposition</div>
        <p className="mt-2 text-sm text-bolt-elements-textSecondary leading-relaxed">{dashboard.marketPosition.summary}</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-bolt-elements-background-depth-3">
            <div
              className={`h-full rounded-full transition-all ${
                dashboard.marketPosition.indicator === 'strong'
                  ? 'bg-emerald-500'
                  : dashboard.marketPosition.indicator === 'weak'
                    ? 'bg-red-400'
                    : 'bg-amber-400'
              }`}
              style={{
                width:
                  dashboard.marketPosition.indicator === 'strong'
                    ? '85%'
                    : dashboard.marketPosition.indicator === 'weak'
                      ? '35%'
                      : '60%',
              }}
            />
          </div>
          <span className="text-xs font-medium text-bolt-elements-textPrimary whitespace-nowrap">
            {marketLabel(dashboard.marketPosition.indicator)}
          </span>
        </div>
      </section>

      <section className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
        <div className="text-sm font-semibold text-bolt-elements-textPrimary">Milstolpar</div>
        <div className="mt-3 space-y-2 text-sm">
          <div>
            <span className="text-xs uppercase tracking-wide text-bolt-elements-textSecondary">Uppnått</span>
            <div className="text-bolt-elements-textPrimary">{dashboard.milestones.achievedLabel}</div>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-bolt-elements-textSecondary">Nästa</span>
            <div className="text-bolt-elements-textPrimary">{dashboard.milestones.nextLabel}</div>
          </div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-bolt-elements-background-depth-3">
          <div
            className="h-full rounded-full bg-violet-500 transition-all"
            style={{ width: `${dashboard.milestones.progressPct}%` }}
          />
        </div>
        <div className="mt-1 text-right text-[10px] text-bolt-elements-textSecondary tabular-nums">
          {dashboard.milestones.progressPct}%
        </div>
      </section>

      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          className="w-full rounded-lg border border-bolt-elements-borderColor py-2 text-xs text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-3"
        >
          Uppdatera analys (kan ta några sekunder)
        </button>
      ) : null}
    </div>
  );
}

/** Liten cirkel för projektlistor */
export function ProjectHealthDot({ score }: { score: number | null | undefined }) {
  if (score == null || Number.isNaN(score)) {
    return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-bolt-elements-borderColor" title="Ingen data" />;
  }
  const c = score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-400' : 'bg-red-500';
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${c}`} title={`Hälsa: ${score}`} />;
}
