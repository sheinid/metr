import { useMemo, useState } from 'react';
import { Slider } from '@heroui/react';
import { ChevronsLeftRight } from 'lucide-react';
import type { Plan } from '../model';
import { getPreviewFrame, PlanPreview } from './PlanPreview';

export function PlanComparison({ plan, source }: { plan: Plan; source: Plan }) {
  const [position, setPosition] = useState(50);
  const frame = useMemo(() => getPreviewFrame([source, plan]), [source, plan]);

  return (
    <div className="plan-comparison">
      <div className="comparison-layer">
        <PlanPreview plan={source} frame={frame} />
        <span className="comparison-label comparison-label--before">Было</span>
      </div>
      <div className="comparison-layer" style={{ clipPath: `inset(0 0 0 ${position}%)` }}>
        <PlanPreview plan={plan} source={source} frame={frame} />
        <span className="comparison-label comparison-label--after">Стало</span>
      </div>
      <Slider className="comparison-slider" aria-label={`Сравнение планировок: ${plan.name}`}
        minValue={0} maxValue={100} step={1} value={position} onChange={value => setPosition(Number(value))}>
        <Slider.Track>
          <Slider.Thumb aria-label="Граница сравнения" aria-valuetext={`${position}% исходной планировки`}>
            <span className="comparison-grip" aria-hidden="true"><ChevronsLeftRight size={20} /></span>
          </Slider.Thumb>
        </Slider.Track>
      </Slider>
    </div>
  );
}
