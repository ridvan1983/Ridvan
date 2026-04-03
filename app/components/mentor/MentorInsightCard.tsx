import type { MentorInsightKind } from '~/lib/mentor/proactive-message';

const accent: Record<MentorInsightKind, string> = {
  warning: 'border-amber-200 bg-amber-50/90 text-amber-950',
  opportunity: 'border-emerald-200 bg-emerald-50/90 text-emerald-950',
  milestone: 'border-violet-200 bg-violet-50/90 text-violet-950',
  tip: 'border-sky-200 bg-sky-50/90 text-sky-950',
};

const label: Record<MentorInsightKind, string> = {
  warning: 'Varning',
  opportunity: 'Möjlighet',
  milestone: 'Milstolpe',
  tip: 'Tips',
};

export function MentorInsightCard(props: {
  type: MentorInsightKind;
  title: string;
  description: string;
  action: string;
  className?: string;
}) {
  const surface = accent[props.type] ?? accent.tip;
  const kindLabel = label[props.type] ?? 'Insikt';

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 text-sm shadow-sm ${surface} ${props.className ?? ''}`}
      role="region"
      aria-label={`Mentor-insikt: ${kindLabel}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{kindLabel}</div>
      <div className="mt-1 font-semibold leading-snug">{props.title}</div>
      <p className="mt-1 text-[13px] leading-relaxed opacity-95">{props.description}</p>
      <div className="mt-2 border-t border-black/10 pt-2 text-[12px] font-medium leading-snug">
        Nästa steg: {props.action}
      </div>
    </div>
  );
}
