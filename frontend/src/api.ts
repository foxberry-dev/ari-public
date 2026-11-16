export async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(value.error || `Request failed (${response.status})`);
  }
  return response.json();
}
