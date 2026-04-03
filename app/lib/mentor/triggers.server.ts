import {
  buildProactiveMentorStorage,
  type MentorInsightPayload,
} from '~/lib/mentor/proactive-message';

export type MentorBuilderTriggerType =
  | 'DEPLOY_TRIGGERED'
  | 'AUTH_ADDED'
  | 'PAYMENT_ADDED'
  | 'DATABASE_ADDED'
  | 'FIRST_PREVIEW'
  | 'MAJOR_REFACTOR';

export const MENTOR_TRIGGER_PRIORITY: MentorBuilderTriggerType[] = [
  'DEPLOY_TRIGGERED',
  'PAYMENT_ADDED',
  'AUTH_ADDED',
  'DATABASE_ADDED',
  'MAJOR_REFACTOR',
  'FIRST_PREVIEW',
];

function insightFor(type: MentorBuilderTriggerType): MentorInsightPayload {
  switch (type) {
    case 'DEPLOY_TRIGGERED':
      return {
        type: 'milestone',
        title: 'Live i produktion',
        description: 'Nu gäller det att omvandla trafik till betalande kunder — inte bara att sajten finns.',
        action: 'Skriv ner ett mål för vecka 1: antal besök, leads och betalningar du ska ha.',
      };
    case 'AUTH_ADDED':
      return {
        type: 'warning',
        title: 'Inloggning = persondata',
        description: 'Så fort användare kan logga in behöver du koll på GDPR, roller och vem som får se vad.',
        action: 'Lista vilka användarroller som ska finnas och vilken data varje roll får läsa.',
      };
    case 'PAYMENT_ADDED':
      return {
        type: 'opportunity',
        title: 'Intäktsmotor på plats',
        description: 'Rätt prismodell för din bransch påverkar både conversion och churn mer än features.',
        action: 'Jämför prenumeration vs engångsköp vs usage-baserat för din målgrupp — välj en huvudmodell.',
      };
    case 'DATABASE_ADDED':
      return {
        type: 'tip',
        title: 'Datamodell = affärslogik',
        description: 'Tabeller och fält du bygger nu låser hur du kan mäta intäkter och följa kunder över tid.',
        action: 'Para ihop varje central entitet med ett affärsmål (t.ex. bokning → intäkt).',
      };
    case 'FIRST_PREVIEW':
      return {
        type: 'tip',
        title: 'Första intrycket',
        description: 'Det kunder ser först avgör om de stannar — inte hur elegant koden är under huven.',
        action: 'Öppna preview som en ny besökare: vad förstår du på 5 sekunder, och vad ska du klicka härnäst?',
      };
    case 'MAJOR_REFACTOR':
      return {
        type: 'warning',
        title: 'Stort kodomtag',
        description: 'Många filer på en gång kan vara pivot, teknisk skuld eller något mittemellan — strategiskt val.',
        action: 'Förklara i en mening varför omfattningen behövs nu och vad som inte får gå sönder.',
      };
    default:
      return {
        type: 'tip',
        title: 'Mentor',
        description: '',
        action: '',
      };
  }
}

function bodyMarkdownFor(type: MentorBuilderTriggerType): string {
  switch (type) {
    case 'DEPLOY_TRIGGERED':
      return [
        'Du har publicerat — starkt steg.',
        '',
        'Innan du firar: tänk launch som ett experiment. Vem är första kunden du vill betala, hur når du den personen i veckan, och vad mäter du dag ett (t.ex. besök → signup → betalning)?',
        '',
        'Vill du att vi sätter ett konkret veckomål och en enkel funnel-mätning som matchar just din bransch?',
      ].join('\n');
    case 'AUTH_ADDED':
      return [
        'Du har lagt till inloggning.',
        '',
        'Då behöver vi vara tydliga med GDPR och åtkomst: vilka personuppgifter samlar du in, var lagras de, och vilka användarroller ska kunna se känslig data?',
        '',
        'Har du redan bestämt vilka typer av konton som ska finnas (admin, kund, personal …) eller vill du att vi spikar en enkel rollmatris?',
      ].join('\n');
    case 'PAYMENT_ADDED':
      return [
        'Betalning är på plats.',
        '',
        'Nästa fråga är affärsmodell: vad är standard i din bransch — abonnemang, engångsavgift, provision eller hybrid — och vad gör att kunder *förstår* priset utan att tveka?',
        '',
        'Vilken modell känns mest naturlig för din målgrupp just nu, och vad är din plan B om conversion är låg första månaden?',
      ].join('\n');
    case 'DATABASE_ADDED':
      return [
        'Du har kopplat in en databas.',
        '',
        'Då vill jag säkerställa att datamodellen stödjer det du faktiskt ska tjäna pengar på — inte bara det som var enkelt att bygga först. Samtidigt: persondata = GDPR.',
        '',
        'Vilken entitet i databasen är “källan till sanning” för intäkter, och vilka personfält är du inte säker på att du får lagra?',
      ].join('\n');
    case 'FIRST_PREVIEW':
      return [
        'Preview visas första gången.',
        '',
        'Ur kundens perspektiv: förstår man direkt vad produkten gör, vem den är för, och vad nästa steg är? Om något känns otydligt är det ofta värt att fixa före fler features.',
        '',
        'Vad tror du en kall besökare skulle tycka är mest förvirrande på första skärmen?',
      ].join('\n');
    case 'MAJOR_REFACTOR':
      return [
        'Många filer ändras samtidigt.',
        '',
        'Är det här en pivot, en nödvändig teknisk omstrukturering, eller något annat? Jag vill förstå *varför* omfattningen är rätt just nu så vi inte bygger bort oss från kunderna.',
        '',
        'Berätta kort: vad ändrar du i användarens upplevelse eller affären när dammet har lagt sig?',
      ].join('\n');
    default:
      return 'Jag såg en förändring i bygget som kan påverka affären — vill du kort säga vad målet är med steget?';
  }
}

export function buildMentorTriggerMessage(type: MentorBuilderTriggerType): string {
  const insight = insightFor(type);
  return buildProactiveMentorStorage({
    triggerType: type,
    insight,
    bodyMarkdown: bodyMarkdownFor(type),
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
}

function pathSignalsAuth(path: string): boolean {
  const p = path.toLowerCase();
  return (
    /(^|\/)auth(\/|$)/.test(p) ||
    /login|sign-?in|sign-?up|session|next-auth|clerk|lucia|better-auth/.test(p) ||
    /supabase\/.*auth|middleware\.(ts|js)/.test(p)
  );
}

function pathSignalsPayment(path: string): boolean {
  const p = path.toLowerCase();
  return /stripe|paddle|checkout|billing|payment|invoice|subscription|lemon|razorpay/.test(p);
}

function pathSignalsDatabase(path: string): boolean {
  const p = path.toLowerCase();
  return (
    /prisma|drizzle|schema\.prisma|supabase\/migrations|\.sql$|mongodb|postgres|mysql|sqlite|firebase|firestore/.test(p) ||
    /(db|database)\.(ts|js)$/.test(p)
  );
}

export function inferTriggersFromFilePaths(paths: string[]): MentorBuilderTriggerType[] {
  const out = new Set<MentorBuilderTriggerType>();
  for (const path of paths) {
    if (pathSignalsAuth(path)) {
      out.add('AUTH_ADDED');
    }
    if (pathSignalsPayment(path)) {
      out.add('PAYMENT_ADDED');
    }
    if (pathSignalsDatabase(path)) {
      out.add('DATABASE_ADDED');
    }
  }
  return [...out];
}

export function inferTriggersFromBrainEvent(
  eventType: string,
  payload: Record<string, unknown>,
): MentorBuilderTriggerType[] {
  const hot = new Set<MentorBuilderTriggerType>();
  const paths = asStringArray(payload.file_paths);

  if (eventType === 'project.published') {
    hot.add('DEPLOY_TRIGGERED');
  }
  if (eventType === 'project.built') {
    hot.add('FIRST_PREVIEW');
  }

  for (const t of inferTriggersFromFilePaths(paths)) {
    hot.add(t);
  }

  return [...hot];
}

export function inferTriggersFromBuilderSeedContext(args: {
  initialPrompt: string;
  filePaths: string[];
}): MentorBuilderTriggerType[] {
  const hot = new Set<MentorBuilderTriggerType>();

  for (const t of inferTriggersFromFilePaths(args.filePaths)) {
    hot.add(t);
  }

  if (/\b(auth|login|sign in|sign-in|clerk|next-auth|supabase auth)\b/i.test(args.initialPrompt)) {
    hot.add('AUTH_ADDED');
  }
  if (/\b(stripe|payment|checkout|billing|subscription|paddle)\b/i.test(args.initialPrompt)) {
    hot.add('PAYMENT_ADDED');
  }
  if (/\b(database|prisma|drizzle|supabase|postgres|mongodb|sql)\b/i.test(args.initialPrompt)) {
    hot.add('DATABASE_ADDED');
  }

  const uniquePaths = new Set(args.filePaths.filter(Boolean));
  if (uniquePaths.size >= 12) {
    hot.add('MAJOR_REFACTOR');
  }

  return [...hot];
}

export function pickHighestPriorityTrigger(candidates: MentorBuilderTriggerType[]): MentorBuilderTriggerType | null {
  if (candidates.length === 0) {
    return null;
  }
  const set = new Set(candidates);
  for (const t of MENTOR_TRIGGER_PRIORITY) {
    if (set.has(t)) {
      return t;
    }
  }
  return candidates[0] ?? null;
}

export type MentorRefactorBurstState = {
  windowStartMs: number;
  eventCount: number;
};

export const MENTOR_REFACTOR_BURST_MS = 120_000;
export const MENTOR_REFACTOR_BURST_MIN_EVENTS = 18;

/** Rolling counter for many small file-change events → MAJOR_REFACTOR. */
export function nextRefactorBurstState(
  prev: MentorRefactorBurstState | null,
  nowMs: number,
): { next: MentorRefactorBurstState; shouldFireRefactor: boolean } {
  const empty = { windowStartMs: nowMs, eventCount: 0 };
  if (!prev || nowMs - prev.windowStartMs > MENTOR_REFACTOR_BURST_MS) {
    return {
      next: { windowStartMs: nowMs, eventCount: 1 },
      shouldFireRefactor: false,
    };
  }

  const eventCount = prev.eventCount + 1;
  return {
    next: { windowStartMs: prev.windowStartMs, eventCount },
    shouldFireRefactor: eventCount >= MENTOR_REFACTOR_BURST_MIN_EVENTS,
  };
}
