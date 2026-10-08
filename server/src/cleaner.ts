// Removes signatures, quoted replies and disclaimers from an email body.

// Lines that start "the junk part": cut from the first match onward
const CUT_MARKERS: RegExp[] = [
  /^\s*on .{5,120} wrote:\s*$/i,
  /^\s*-{2,}\s*original message\s*-{2,}\s*$/i,
  /^\s*_{5,}\s*$/,
  /^\s*from:\s.+/i,
  /^\s*sent from my (iphone|ipad|android|galaxy|mobile|phone)/i,
  /^\s*get outlook for (ios|android)/i,
  /^\s*--\s*$/,
  /^\s*(best regards|kind regards|warm regards|regards|thanks and regards|thank you|thanks|sincerely|salam|terima kasih)\s*[,.!]?\s*$/i,
  /^\s*(this (e-?mail|message) (and any attachments )?(is|are|may be) (confidential|intended)|disclaimer|confidentiality notice)/i,
];

// Lines that only appear inside signature blocks
const SIGNATURE_HINTS: RegExp[] = [
  /<mailto:[^>]*>/i,
  /^\s*[MTEFOW]\.\s+\S/,
  /^\s*(mobile|mob|tel|phone|hp|ext|fax)\s*[:.]/i,
  /^\s*\+?\d[\d\s()-]{7,}\s*$/,
];

// For flattened emails with no line breaks
const FLAT_CUTS: RegExp[] = [
  /\s(E|M|T|Tel|Mobile)\.\s+\S+@\S+/,
  /\sM\.\s+[\d(+]/,
  /\s"?This (e-?mail|message) may be confidential/i,
  /\s"?This (e-?mail|message) (and any attachments )?(is|are) (confidential|intended)/i,
];

export function cleanEmailBody(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let kept: string[] = [];

  // Pass 1: cut at quoted text and marker lines
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (
      kept.join("").trim().length > 0 &&
      CUT_MARKERS.some((re) => re.test(line))
    )
      break;
    kept.push(line);
  }

  // Pass 2: cut at the first signature-looking line, back to the blank line before it
  const j = kept.findIndex(
    (line, i) =>
      SIGNATURE_HINTS.some((re) => re.test(line)) &&
      kept.slice(0, i).join("").trim().length > 0,
  );
  if (j > 0) {
    let b = j;
    while (b > 0 && kept[b - 1].trim() !== "") b--;
    const cutAt = kept.slice(0, b).join("").trim().length > 0 ? b : j;
    kept = kept.slice(0, cutAt);
  }

  // Pass 3: flattened emails (almost no line breaks)
  let flat = kept.join("\n");
  if (flat.split("\n").length < 3) {
    let cut = flat.length;
    for (const re of FLAT_CUTS) {
      const m = re.exec(flat);
      if (m && m.index > 10 && m.index < cut) cut = m.index;
    }
    flat = flat.slice(0, cut);
  }

  const cleaned = flat
    .replace(/<mailto:[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Fail safe: never return an empty problem statement
  return cleaned.length > 0 ? cleaned : raw.trim();
}
