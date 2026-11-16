export async function loadCherUrl(): Promise<string | null> {
  try {
    const response = await fetch('/api/navigation');
    if (!response.ok) return null;
    const { cherUrl } = await response.json();
    if (typeof cherUrl !== 'string') return null;
    const url = new URL(cherUrl);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function returnToCher(url: string | null): boolean {
  if (!url) return false;
  window.location.assign(url);
  return true;
}
