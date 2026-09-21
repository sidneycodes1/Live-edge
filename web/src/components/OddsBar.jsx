import { motion } from 'framer-motion';

export default function OddsBar({ yesPrice, noPrice, animateKey }) {
  const yesPct = Math.round(yesPrice*100);
  const noPct = 100 - yesPct;
  return (
    <div className="w-full">
      <div className="flex h-3 rounded-full overflow-hidden bg-white/10">
        <motion.div layout className="bg-yes" style={{width:`${yesPct}%`}} transition={{duration:0.6, ease:'easeOut'}} />
        <motion.div layout className="bg-no" style={{width:`${noPct}%`}} transition={{duration:0.6, ease:'easeOut'}} />
      </div>
      <div className="flex justify-between text-xs mt-1 num">
        <span className="text-yes">YES {yesPct}%</span>
        <span className="text-no">NO {noPct}%</span>
      </div>
    </div>
  );
}
