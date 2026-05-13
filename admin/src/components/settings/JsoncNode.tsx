import type { JSONPath, Node } from 'jsonc-parser';
import { getNodePath } from 'jsonc-parser';
import { extractAdjacentComments } from './comments';
import { matchEnvPlaceholder } from './envPill';
import { lookupTemplateComment } from './templateComments';
import { labelAndHelp } from './labels';
import { StringInput } from './widgets/StringInput';
import { NumberInput } from './widgets/NumberInput';
import { BooleanToggle } from './widgets/BooleanToggle';
import { NullChip } from './widgets/NullChip';
import { EnvPill } from './widgets/EnvPill';

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

  const anchor = property ?? node;
  const fileComments = extractAdjacentComments(text, anchor.offset, node.offset, node.length);
  const comment = fileComments.leading || (property ? lookupTemplateComment(path) : null) || '';
  const { label, help } = labelAndHelp(comment, key);

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
        // Use the property key string as stable key; fall back to byte offset.
        const propKey =
          child.children?.[0]?.type === 'string'
            ? String(child.children[0].value)
            : String(child.offset);
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
      // Array element: use unique byte offset as stable key.
      return <JsoncNode key={child.offset} node={child} text={text} onEdit={onEdit} />;
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
        {renderLeaf(node, path, text, onEdit)}
      </div>
      {help && (
        <p className="settings-row-help" id={helpId}>{help}</p>
      )}
    </div>
  );
};
