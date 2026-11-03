/**
 * Chat-Filter (Basis): normalisieren, Kontaktdaten/Links entfernen, Schimpfwörter maskieren.
 * Der „Sichere Chat" mit Satzbausteinen für Kinder kommt mit den Konten (Phase 5).
 */
const BLOCKLIST = [
  'arschloch',
  'hurensohn',
  'fotze',
  'wichser',
  'missgeburt',
  'nazi',
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'faggot',
  'retard',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '');
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|de|net|org|io|gg|tv|me|ru|xyz)\b\S*/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const PHONE_RE = /(?:\+?\d[\s/-]?){7,}/g;

export interface ChatFilterResult {
  text: string;
  /** Wurde etwas verändert? */
  filtered: boolean;
}

export function filterChat(input: string): ChatFilterResult {
  // Steuerzeichen (0–31, 127) durch Leerzeichen ersetzen.
  let text = Array.from(input, (ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return c < 32 || c === 127 ? ' ' : ch;
  })
    .join('')
    .trim()
    .slice(0, 200);
  const before = text;
  text = text.replace(EMAIL_RE, '***').replace(URL_RE, '***').replace(PHONE_RE, '***');
  text = text
    .split(/(\s+)/)
    .map((word) => {
      const n = normalize(word);
      return n && BLOCKLIST.some((b) => n.includes(b))
        ? '*'.repeat(Math.min(8, word.length))
        : word;
    })
    .join('');
  return { text, filtered: text !== before };
}

/** Bereinigt einen Anzeigenamen; leer/ungültig → Gastname. */
export function sanitizeName(input: string, fallbackId: number): string {
  const cleaned = input.replace(/[^A-Za-z0-9ÄÖÜäöüß_-]/g, '').slice(0, 16);
  const n = normalize(cleaned);
  if (cleaned.length < 3 || BLOCKLIST.some((b) => n.includes(b)))
    return `Wanderer${1000 + (fallbackId % 9000)}`;
  return cleaned;
}
