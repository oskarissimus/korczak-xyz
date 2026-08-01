// Hand the browser a file. Shared by the manual log export and by the conflict dialog, which
// saves the branch the user is about to discard before it discards it.
export function downloadJSON(filename: string, json: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
