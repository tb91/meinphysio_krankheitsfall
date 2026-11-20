import { useQuery } from '@tanstack/react-query';

// Gerüst: zeigt nur, ob die API erreichbar ist. Die Arbeitsliste für den Empfang folgt.
export function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`API ${res.status}`);
      return (await res.json()) as { ok: boolean; now: string };
    },
  });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Ausfall-Assistent</h1>
      <p>
        API:{' '}
        {health.isLoading ? 'prüfe…' : health.isError ? 'nicht erreichbar' : `ok (jetzt = ${health.data?.now})`}
      </p>
    </main>
  );
}
