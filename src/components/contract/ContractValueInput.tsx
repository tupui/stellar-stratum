import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { ParamShape } from '@/lib/contract/form-values';

interface ContractValueInputProps {
  shape: ParamShape;
  value: unknown;
  onChange: (value: unknown) => void;
}

/**
 * Renders one input matching the shape's `kind`. Complex / user-defined types
 * fall back to a JSON textarea — `spec.funcArgsToScVals` accepts native JS,
 * so JSON is the least surprising escape hatch for structs, tuples, vecs, maps.
 */
export const ContractValueInput = ({ shape, value, onChange }: ContractValueInputProps) => {
  switch (shape.kind) {
    case 'bool':
      return (
        <div className="flex items-center gap-2 h-10">
          <Switch checked={Boolean(value)} onCheckedChange={onChange} />
          <span className="text-sm text-muted-foreground">{value ? 'true' : 'false'}</span>
        </div>
      );

    case 'address':
      return (
        <Input
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder="G… or C…"
          className="font-mono text-xs"
        />
      );

    case 'string':
    case 'symbol':
      return (
        <Input
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={shape.kind === 'symbol' ? 'symbol' : 'string'}
        />
      );

    case 'u32':
    case 'i32':
      return (
        <Input
          type="number"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={shape.typeLabel}
        />
      );

    case 'u64':
    case 'i64':
    case 'u128':
    case 'i128':
    case 'u256':
    case 'i256':
      return (
        <Input
          inputMode="numeric"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${shape.typeLabel} (integer)`}
          className="font-mono"
        />
      );

    case 'bytes':
    case 'bytesN':
      return (
        <Input
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={shape.kind === 'bytesN' ? `hex, ${shape.bytesLen} bytes` : 'hex bytes (e.g. deadbeef)'}
          className="font-mono text-xs"
        />
      );

    case 'void':
      return <div className="text-sm text-muted-foreground italic h-10 flex items-center">void — no value</div>;

    case 'option': {
      const wrapper = (value ?? {}) as { provided?: boolean; value?: unknown };
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={Boolean(wrapper.provided)}
              onCheckedChange={(provided) => onChange({ ...wrapper, provided })}
            />
            <Label className="text-xs text-muted-foreground">
              {wrapper.provided ? 'Some' : 'None'}
            </Label>
          </div>
          {wrapper.provided && shape.inner && (
            <ContractValueInput
              shape={shape.inner}
              value={wrapper.value}
              onChange={(v) => onChange({ provided: true, value: v })}
            />
          )}
        </div>
      );
    }

    case 'json':
    default:
      return (
        <Textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${shape.typeLabel} — JSON`}
          className="font-mono text-xs min-h-[80px]"
        />
      );
  }
};
