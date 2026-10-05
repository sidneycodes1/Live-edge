export default function PositionRow({ pos, onClaim }) {
  const status = pos.market.status==='resolved' ? (pos.claimed?'Claimed': pos.claimable?'Claimable':'Closed') : pos.market.status==='open'?'Open':'Awaiting resolution';
  return (
    <div className="bg-surface border border-white/10 rounded-card p-4 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{pos.market.question}</p>
        <p className="text-xs text-white/50">YES {pos.yesShares} · NO {pos.noShares} · Value ~${pos.currentValue.toFixed(2)}</p>
        <p className="text-xs mt-1"><span className="px-2 py-0.5 bg-white/10 rounded-full text-[11px]">{status}</span></p>
      </div>
      {pos.claimable && <button onClick={()=>onClaim(pos)} className="shrink-0 bg-yes text-black font-bold px-4 py-2 rounded-full text-sm">Claim ${pos.claimAmount}</button>}
    </div>
  );
}
