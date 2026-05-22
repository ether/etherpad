import type { JSONPath, Node } from 'jsonc-parser';
import { getNodePath } from 'jsonc-parser';
import { extractAdjacentComments } from './comments';
import { matchEnvPlaceholder } from './envPill';
import { lookupTemplateComment } from './templateComments';
import { humanize, labelAndHelp } from './labels';
import { StringInput } from './widgets/StringInput';
import { NumberInput } from './widgets/NumberInput';
import { BooleanToggle } from './widgets/BooleanToggle';
import { NullChip } from './widgets/NullChip';
import { EnvPill } from './widgets/EnvPill';
import { useResolvedAt } from '../../store/store';

type Props = {
  /** The value node (not the property node). */
  node: Node;
  /** The property node, when this value is the value-side of `"key": value`. */
  property?: Node;
  text: string;
  onEdit: (path: JSONPath, value: unknown) => void;
  /**
   * When true, this group's own label/header is suppressed because a
   * containing Section already rendered it. The group's children still
   * render. Used for top-level object/array sections in FormView.
   */
  suppressOwnHeader?: boolean;
};

const propertyKey = (property: Node | undefined): string => {
  if (!property || property.type !== 'property') return '';
  const k = property.children?.[0];
  return k?.type === 'string' ? String(k.value) : '';
};

const renderLeaf = (
  node: Node,
  path: JSONPath,
  text: string,
  onEdit: (path: JSONPath, value: unknown) => void,
  resolvedValue: unknown,
) => {
  if (node.type === 'string') {
    const raw = text.slice(node.offset, node.offset + node.length);
    const env = matchEnvPlaceholder(raw);
    if (env) {
      return (
        <EnvPill
          placeholder={env}
          path={path}
          onChange={(d) => onEdit(path, `\${${env.variable}:${d}}`)}
          resolvedValue={resolvedValue}
        />
      );
    }
    return (
      <StringInput
        value={String(node.value)}
        path={path}
        onChange={v => onEdit(path, v)}
      />
    );
  }
  if (node.type === 'number') {
    return (
      <NumberInput
        value={Number(node.value)}
        path={path}
        onChange={v => onEdit(path, v)}
      />
    );
  }
  if (node.type === 'boolean') {
    return (
      <BooleanToggle
        value={Boolean(node.value)}
        path={path}
        onChange={v => onEdit(path, v)}
      />
    );
  }
  if (node.type === 'null') {
    return <NullChip path={path} />;
  }
  return null;
};

export const JsoncNode = ({ node, property, text, onEdit, suppressOwnHeader }: Props) => {
  const path = getNodePath(node);
  const key = propertyKey(property);
  // useResolvedAt must be called unconditionally for every JsoncNode
  // render (React hook rules). It's cheap: a shallow zustand selector +
  // an object-walk that returns undefined when the resolved payload is
  // absent (old server) — in which case EnvPill simply omits the chip.
  const resolvedValue = useResolvedAt(path);

  const anchor = property ?? node;
  const fileComments = extractAdjacentComments(text, anchor.offset, node.offset, node.length);
  const tmpl = property ? lookupTemplateComment(path) : null;
  const leading = fileComments.leading || tmpl?.leading || '';
  const trailing = fileComments.trailing || tmpl?.trailing || '';

  // Leading block comments (e.g. /* Description … */ above a key) carry the
  // descriptive label — use labelAndHelp's first-sentence split.
  // Trailing same-line comments (e.g. "altF9": true, /* focus on … */) are
  // brief per-key annotations: the key itself reads as the label, the comment
  // belongs in the help slot below the control.  See #7740.
  let label: string;
  let help: string;
  if (leading) {
    const r = labelAndHelp(leading, key);
    label = r.label;
    help = [r.help, trailing].filter(Boolean).join(' ');
  } else if (trailing) {
    label = humanize(key);
    help = trailing;
  } else {
    label = humanize(key);
    help = '';
  }

  const rowId = `settings-row-${path.join('.') || 'root'}`;
  const helpId = help ? `${rowId}-help` : undefined;

  // ---- Object / array groups ----
  if (node.type === 'object' || node.type === 'array') {
    const children = (node.children ?? []).map((child) => {
      // For object: child is a property node, drill into its value node.
      // For array: child is a value node directly.
      if (node.type === 'object') {
        const valueNode = child.children?.[1];
        if (!valueNode) return null;
        const propPath = getNodePath(child);
        const propKey = propPath.join('.');
        return (
          <JsoncNode
            key={propKey}
            node={valueNode}
            property={child}
            text={text}
            onEdit={onEdit}
          />
        );
      }
      // Array element: use stable JSON path as key.
      const childPath = getNodePath(child);
      return <JsoncNode key={childPath.join('.')} node={child} text={text} onEdit={onEdit} />;
    });

    if (suppressOwnHeader || !property) {
      // Render children flat — the containing Section provides the label.
      return <>{children}</>;
    }

    // Nested group within a section: render as a sub-section with its own
    // heading, indented under its parent.
    return (
      <div className="settings-subsection" data-testid={`group-${path.join('.')}`}>
        <div className="settings-subsection-header">
          <span className="settings-subsection-title">{label}</span>
          {help && <span className="settings-subsection-help">{help}</span>}
        </div>
        <div className="settings-subsection-body">{children}</div>
      </div>
    );
  }

  // ---- Leaf row ----
  return (
    <div className="settings-row" id={rowId}>
      <label className="settings-row-label" htmlFor={`field-${path.join('.')}`}>
        {label}
      </label>
      <div className="settings-row-control">
        {renderLeaf(node, path, text, onEdit, resolvedValue)}
      </div>
      {help && (
        <p className="settings-row-help" id={helpId}>{help}</p>
      )}
    </div>
  );
};
