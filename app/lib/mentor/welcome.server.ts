import type { ExpertVerticalKey } from '~/lib/vertical/expert.server';
import { getVerticalExpertContext, getVerticalExpertSummaryLine } from '~/lib/vertical/expert.server';

export type MentorWelcomeProject = {
  title: string | null;
};

export type MentorWelcomeVertical = {
  /** e.g. hair_salon, restaurant */
  normalizedIndustry?: string | null;
  expectedBusinessModel?: string | null;
  geoNotes?: string | null;
} | null;

/**
 * Deterministic first-open welcome (no LLM). Tone: experienced co-founder.
 */
export function generateWelcomeMessage(project: MentorWelcomeProject, vertical: MentorWelcomeVertical, expertKey: ExpertVerticalKey): string {
  const name = project.title?.trim() || 'ert projekt';
  const expertLine = getVerticalExpertSummaryLine(expertKey);
  const modelHint = vertical?.expectedBusinessModel?.trim();
  const geoHint = vertical?.geoNotes?.trim();

  const insight = [
    `Jag har gått igenom vad ni bygger — **${name}**.`,
    `${expertLine}`,
    modelHint ? `För den här typen av bolag brukar **${modelHint.slice(0, 220)}${modelHint.length > 220 ? '…' : ''}** vara centralt — vi kalibrerar det mot er verklighet.` : null,
    geoHint ? `Marknadsnotering: ${geoHint.slice(0, 180)}${geoHint.length > 180 ? '…' : ''}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const question =
    'Innan vi dyker in: **vem är er primära kund första 90 dagarna** — och vilket *ett* mål (t.ex. bokningar/vecka eller betalande kunder) ska vi optimera mot?';

  return [insight, '', question].join('\n\n');
}

/** Long-form expert block for welcome API / debugging (optional). */
export function getWelcomeExpertAppendix(expertKey: ExpertVerticalKey): string {
  return getVerticalExpertContext(expertKey);
}
