import { Link, useLocation } from 'react-router-dom';
export default function BottomTabs() {
  const loc = useLocation();
  const is = (p)=> loc.pathname===p || loc.pathname.startsWith(p);
  const tabs = [{to:'/', label:'Live'}, {to:'/portfolio', label:'Portfolio'}, {to:'/about', label:'About'}];
  return (
    <div className="fixed bottom-0 inset-x-0 bg-surface border-t border-white/10 flex md:hidden">
      {tabs.map(t=> <Link key={t.to} to={t.to} className={`flex-1 text-center py-3 text-sm ${is(t.to)?'text-white font-bold':'text-white/60'}`}>{t.label}</Link>)}
    </div>
  );
}
