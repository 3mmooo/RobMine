/**
 * Sicherer Chat (Kinder unter 13 und Gäste): nur diese Satzbausteine lassen sich senden
 * und empfangen. Der Server prüft auf exakte Übereinstimmung.
 */
export const SAFE_PHRASES: readonly string[] = [
  'Hallo! 👋',
  'Tschüss!',
  'Danke!',
  'Gern geschehen!',
  'Ja',
  'Nein',
  'Komm mit!',
  'Warte auf mich!',
  'Folge mir!',
  'Wo bist du?',
  'Ich bin hier!',
  'Lass uns zusammen bauen!',
  'Schau mal!',
  'Cool! 😎',
  'Super gemacht!',
  'Hilfe!',
  'Ich gehe ins Portal.',
  'Gute Nacht 🌙',
  'Das ist schön ✨',
  'Willst du mein Freund sein?',
  'Ich muss gleich los.',
  'Haha 😄',
];

const SET = new Set(SAFE_PHRASES);
export function isSafePhrase(text: string): boolean {
  return SET.has(text);
}
