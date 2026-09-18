import { useEffect, useState } from "react";

type HealthStatus = { status: string; db: string } | null;

export default function App() {
  const [health, setHealth] = useState<HealthStatus>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
      <h1 className="text-3xl font-semibold text-gray-900">Kenza</h1>
      <p className="mt-2 text-gray-500 text-center max-w-md">
        Agent commercial autonome — socle en cours de construction (Phase 3 :
        Docker, PostgreSQL, seeder). Le simulateur de chat et le tableau de
        bord arrivent en Phase 10.
      </p>
      <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
        API :{" "}
        {health ? (
          <span className="text-accent font-medium">
            {health.status} (db: {health.db})
          </span>
        ) : (
          <span className="text-gray-400">en attente...</span>
        )}
      </div>
    </div>
  );
}
