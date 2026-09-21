export default function About() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20 prose prose-invert">
      <h1 className="font-heading font-bold text-2xl">How Panta is used</h1>
      <table className="w-full text-sm mt-4 border-collapse">
        <thead><tr className="border-b border-white/10"><th className="text-left py-2">Capability</th><th className="text-left">Route</th><th>Mode</th></tr></thead>
        <tbody className="text-xs">
          <tr className="border-b border-white/5"><td>List markets, get market</td><td>/api/markets/catalog</td><td>Live (hybrid) / Sim</td></tr>
          <tr className="border-b border-white/5"><td>Quote create market</td><td>/api/markets/quote</td><td>Live quote, sim fallback</td></tr>
          <tr className="border-b border-white/5"><td>Build create tx</td><td>/api/markets/build</td><td>Live unsigned + sim</td></tr>
          <tr className="border-b border-white/5"><td>Register market</td><td>/api/markets/register</td><td>Sim</td></tr>
          <tr className="border-b border-white/5"><td>Quote / build buy</td><td>/api/orders/*</td><td>Live preview / sim settle</td></tr>
          <tr className="border-b border-white/5"><td>Positions</td><td>/api/portfolio</td><td>Live for real wallet, sim otherwise</td></tr>
          <tr className="border-b border-white/5"><td>Claims</td><td>/api/claims/*</td><td>Sim</td></tr>
          <tr><td>Metrics</td><td>/api/streamer/metrics</td><td>Own DB (+ live when avail.)</td></tr>
        </tbody>
      </table>
      <h2 className="font-heading font-bold mt-6">Assumptions (simulator)</h2>
      <ul className="text-sm text-white/70 list-disc ml-4">
        <li>Graduation at ≥100 volume, creator share 25% of fees — placeholder, not Panta's real rule</li>
        <li>LMSR pricing b=50 is an approximation, not Panta's curve</li>
        <li>Sim resolver stands in for Panta's oracle; no AI agent claimed</li>
        <li>Winning share = 1 sim USDC</li>
      </ul>
      <p className="text-xs text-white/40 mt-4">Mode badge visible on every page. Never present play-money as real.</p>
    </div>
  );
}
