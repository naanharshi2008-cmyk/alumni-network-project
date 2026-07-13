export default function DebugEnv() {
  return (
    <div style={{ padding: '40px', fontFamily: 'monospace', fontSize: '16px' }}>
      <h2>Environment Variable Check</h2>
      <p><strong>URL:</strong> {process.env.NEXT_PUBLIC_SUPABASE_URL || '(not set)'}</p>
      <p><strong>Key starts with:</strong> {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.slice(0, 15) + '...' : '(not set)'}</p>
    </div>
  );
}