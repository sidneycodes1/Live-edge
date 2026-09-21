import { useEffect, useState } from 'react';
export default function Toast({ message, onDone }) {
  useEffect(()=>{ if(message){ const t=setTimeout(onDone, 3000); return ()=>clearTimeout(t);} }, [message, onDone]);
  if (!message) return null;
  return <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 bg-surface border border-white/20 px-4 py-2 rounded-full text-sm z-50">{message}</div>;
}
