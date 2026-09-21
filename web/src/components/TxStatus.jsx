export default function TxStatus({ status }) {
  const map = { idle:null, quoting:'Quoting...', building:'Building...', submitting:'Submitting...', success:'✓ Success', error:'Error' };
  if (!map[status]) return null;
  return <div className="flex items-center gap-2 mt-3 text-xs"><span className={`w-2 h-2 rounded-full ${status==='success'?'bg-yes':'bg-live animate-pulse'}`} />{map[status]}</div>;
}
