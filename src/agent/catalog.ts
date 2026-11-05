// Op catalogue generated from the op schema, so the agent docs never drift from the code.
import { OP_DESCS, type ParamDesc } from '../core/opSchema';

function paramLine(p: ParamDesc): string {
  const range = p.kind === 'number' ? ` [${p.min}..${p.max}, default ${p.default}]` : p.options ? ` (${p.options.join(' | ')}, default ${p.default})` : '';
  return `${p.key}${p.optional ? '?' : ''}: ${p.kind}${range}${p.help ? ` — ${p.help}` : ''}`;
}

export function opCatalog(): string {
  return OP_DESCS.filter((d) => d.type !== 'stroke')
    .map((d) => `- ${d.type}: ${d.summary}\n    ${d.params.map(paramLine).join('\n    ')}`)
    .join('\n');
}
