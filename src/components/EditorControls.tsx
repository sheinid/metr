import { useEffect, useState } from 'react';
import { Button, Label, NumberField, Tooltip } from '@heroui/react';
import type { ButtonProps } from '@heroui/react';
import { clamp, round } from '../geometry';

export function IconButton({ label, ...props }: ButtonProps & { label: string }) {
  return (
    <Tooltip delay={500}>
      <Button variant="ghost" size="sm" isIconOnly aria-label={label} {...props} />
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

export function DimensionField({ label, value, onChange, min = 0, max = 10000, suffix = 'см', step = .1 }: {
  label: string; value: number; onChange: (value: number) => void;
  min?: number; max?: number; suffix?: string; step?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(round(value, .1)); }, [value, editing]);
  const commit = () => {
    if (Number.isFinite(draft)) onChange(clamp(draft, min, max));
    setEditing(false);
  };
  return (
    <NumberField variant="secondary" className="dimension-field" value={draft} onChange={setDraft} minValue={min} maxValue={max}
      step={step} formatOptions={{ useGrouping: false, maximumFractionDigits: 1 }}
      onFocus={() => setEditing(true)} onBlur={commit}>
      <Label>{label}</Label>
      <NumberField.Group>
        <NumberField.Input aria-label={label} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <span className="field-unit" aria-hidden="true">{suffix}</span>
      </NumberField.Group>
    </NumberField>
  );
}
