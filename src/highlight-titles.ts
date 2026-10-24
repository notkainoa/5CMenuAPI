// A deterministic display title for an existing source row. This does not
// classify that row as a food or establish any dietary guarantee.
export function sourceHighlightTitle(name: string): string {
  const plain = name.replace(/<[^>]*>/g, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/giu, ' ')
    .replace(/\b[\p{L}\p{N}-]+\.[a-z]{2,}(?:\/\S*)?/giu, ' ')
    .replace(/[<>\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!plain) throw new Error('Empty source title');
  const chars = [...plain];
  if (chars.length <= 64) return plain;
  const cleanEnd = (text: string): string => {
    let previous = '';
    while (previous !== text) {
      previous = text;
      text = text.replace(/[\s,:/\-–—]+$/u, '').replace(/\s+(?:or|and|with|on|of|for|in|to)$/iu, '').trimEnd();
    }
    return text;
  };
  // Verbose program names often append choices after a short complete title.
  // Prefer that existing prefix rather than cut its choices halfway through.
  const phraseBoundary = plain.search(/ - | with /iu);
  if (phraseBoundary > 0) {
    const phrase = cleanEnd(plain.slice(0, phraseBoundary));
    if ([...phrase].length >= 10 && [...phrase].length <= 64) return phrase;
  }
  const prefix = chars.slice(0, 64).join('');
  if (/\s/u.test(chars[64])) return cleanEnd(prefix);
  const boundary = prefix.search(/\s+\S*$/u);
  // A single overlong source word has no boundary, so preserve its bounded
  // prefix rather than create replacement food words.
  return cleanEnd(boundary > 0 ? prefix.slice(0, boundary) : prefix);
}
