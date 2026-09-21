export const fmtPrice = (p) => (p*100).toFixed(1)+'%';
export const fmtUSD = (n) => `$${Number(n).toFixed(2)}`;
export const fmtTimeLeft = (end) => {
  const diff = new Date(end) - new Date();
  if (diff <= 0) return 'closed';
  const m = Math.floor(diff/60000);
  const s = Math.floor((diff%60000)/1000);
  return `${m}m ${s}s`;
};
