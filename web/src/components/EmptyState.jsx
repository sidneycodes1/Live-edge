export default function EmptyState({ title, body }) {
  return <div className="text-center py-12 border border-dashed border-white/10 rounded-card"><h3 className="font-heading font-bold">{title}</h3><p className="text-sm text-white/50 mt-1">{body}</p></div>;
}
