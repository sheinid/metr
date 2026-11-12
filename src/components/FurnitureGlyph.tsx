import type { Furniture } from '../model';
export function FurnitureGlyph({ item, ghost = false }: { item: Furniture; ghost?: boolean }) {
  const w = item.width, h = item.depth, x = -w / 2, y = -h / 2;
  const stroke = '#665f53', fill = item.color;
  const common = { stroke, strokeWidth: 1.5, fill, strokeLinejoin: 'round' as const };
  let shape;
  switch (item.kind) {
    case 'sofa': case 'chair': {
      const arm = Math.min(18, w * .14), back = Math.min(20, h * .22);
      shape = <><rect x={x} y={y} width={w} height={h} rx={10} {...common}/><rect x={x + arm} y={y + back} width={w - arm * 2} height={h - back - 6} rx={5} fill={fill} stroke={stroke} strokeWidth={1}/><path d={`M${x + arm} ${y + back}V${y + h - 5}M${-x - arm} ${y + back}V${y + h - 5}`} stroke={stroke} fill="none"/>{item.kind === 'sofa' && <path d={`M0 ${y + back}V${y + h - 8}`} stroke={stroke} strokeWidth={.8}/>}</>; break;
    }
    case 'bed': shape = <><rect x={x - 2} y={y - 3} width={w + 4} height={h + 6} rx={5} {...common}/><rect x={x + 5} y={y + 7} width={w - 10} height={h - 14} rx={5} fill="#f8f6ee" stroke={stroke} strokeWidth={1}/><rect x={x + 5} y={y + h * .28} width={w - 10} height={h * .65} rx={4} fill={fill} stroke={stroke} strokeWidth={.8}/><path d={`M${x + 8} ${y + h * .37}H${-x - 8}`} fill="none" stroke={stroke} opacity={.4}/>{[.25,.75].map(n => <rect key={n} x={x + w * n - w * .19} y={y + 12} width={w * .38} height={h * .17} rx={6} fill="#fffdf7" stroke={stroke} strokeWidth={.8}/>)}</>; break;
    case 'dining': shape = <>{[-1,1].flatMap(side => [-.25,.25].map(pos => <rect key={`${side}-${pos}`} x={w * pos - 18} y={side === -1 ? y - 15 : -y - 10} width={36} height={25} rx={7} fill="#d8cfc0" stroke={stroke} strokeWidth={1}/>))}<rect x={x} y={y} width={w} height={h} rx={Math.min(18, h / 4)} {...common}/><rect x={x + 8} y={y + 8} width={w - 16} height={h - 16} rx={12} fill="none" stroke={stroke} opacity={.18}/></>; break;
    case 'table': shape = <><rect x={x} y={y} width={w} height={h} rx={Math.min(18, h / 3)} {...common}/><rect x={x + 5} y={y + 5} width={Math.max(1,w - 10)} height={Math.max(1,h - 10)} rx={10} fill="none" stroke={stroke} opacity={.2}/></>; break;
    case 'wardrobe': shape = <><rect x={x} y={y} width={w} height={h} rx={2} {...common}/>{Array.from({ length: Math.max(1, Math.floor(w / 60)) - 1 }, (_, i) => <path key={i} d={`M${x + (i + 1) * w / Math.max(1, Math.floor(w / 60))} ${y}V${-y}`} stroke={stroke} opacity={.4}/>)}<path d={`M${x + 8} ${-y - 6}H${-x - 8}`} stroke={stroke} strokeWidth={2} opacity={.5}/></>; break;
    case 'kitchen': shape = <><rect x={x} y={y} width={w} height={h} rx={3} {...common}/><rect x={x + w * .12} y={y + 8} width={Math.min(45,w * .25)} height={Math.max(8,h - 16)} rx={7} fill="#edf0ec" stroke={stroke}/><circle cx={x + w * .12 + 22} cy={y + h / 2} r={3} fill={stroke}/>{w > 100 && <><rect x={x + w * .64} y={y + 7} width={Math.min(48, w * .28)} height={h - 14} rx={3} fill="#797b73"/>{[0,1].flatMap(i => [0,1].map(j => <circle key={`${i}-${j}`} cx={x + w * .64 + 13 + i * 22} cy={y + 19 + j * Math.max(10,h - 38)} r={6} stroke="#d9dcd3" fill="none"/>))}</>}</>; break;
    case 'fridge': shape = <><rect x={x} y={y} width={w} height={h} rx={4} {...common}/><path d={`M${x + 5} ${y + h * .3}H${-x - 5}M${-x - 8} ${y + 6}v${h * .17}M${-x - 8} ${y + h * .4}v${h * .4}`} stroke={stroke} opacity={.6}/></>; break;
    case 'bath': shape = <><rect x={x} y={y} width={w} height={h} rx={8} {...common}/><rect x={x + 8} y={y + 10} width={Math.max(1,w - 16)} height={Math.max(1,h - 20)} rx={Math.min(28,w / 3)} fill="#f8fbf9" stroke={stroke} strokeWidth={1}/><circle cx={0} cy={y + 25} r={3} fill={stroke}/></>; break;
    case 'sink': shape = <><rect x={x} y={y} width={w} height={h} rx={5} {...common}/><ellipse cx={0} cy={3} rx={w * .34} ry={h * .29} fill="#f8fbf9" stroke={stroke}/><path d={`M0 ${y + 4}v${h * .24}`} stroke={stroke} strokeWidth={3} strokeLinecap="round"/></>; break;
    case 'toilet': shape = <><rect x={x} y={y} width={w} height={h * .3} rx={4} {...common}/><ellipse cx={0} cy={h * .12} rx={w * .43} ry={h * .37} fill="#fafcf9" stroke={stroke} strokeWidth={1.5}/><ellipse cx={0} cy={h * .13} rx={w * .27} ry={h * .24} fill="#dde8e5" stroke={stroke} strokeWidth={.7}/></>; break;
    case 'plant': shape = <><circle r={w * .28} {...common}/>{[0,1,2,3,4,5].map(i => <ellipse key={i} cx={0} cy={-h * .23} rx={w * .16} ry={h * .28} transform={`rotate(${i * 60})`} fill={i % 2 ? '#a2b798' : '#b9c9ae'} stroke="#6e8969" strokeWidth={1}/>)}</>; break;
  }
  return <g opacity={ghost ? .28 : 1}>{shape}</g>;
}
