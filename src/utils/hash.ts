// Stable short id derived from a file's *content* (not its name), so the same
// source PDF always yields the same id even if the OS renamed the download to
// "... (1).pdf" or the user grabbed it in a different session. Used to name the
// downloaded parts uniquely (`<id>-parte-N-de-Z.pdf`) and to cross-check that a
// pasted answer belongs to the current part.
//
// SHA-256 is used instead of MD5 because it is built into the browser
// (crypto.subtle.digest) with no dependency and is plenty fast. 12 hex chars =
// 48 bits, so collisions are negligible for this single-user, per-file use.
export const computeFileId = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
};
