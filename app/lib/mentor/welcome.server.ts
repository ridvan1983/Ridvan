import type { ExpertVerticalKey } from '~/lib/vertical/expert.server';
import { getVerticalExpertContext } from '~/lib/vertical/expert.server';

/** Long-form expert block for debugging / optional APIs (ingen chat-välkomst här). */
export function getWelcomeExpertAppendix(expertKey: ExpertVerticalKey): string {
  return getVerticalExpertContext(expertKey);
}
