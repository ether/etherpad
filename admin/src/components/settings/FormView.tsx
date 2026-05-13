import { parseTree, type JSONPath, type Node, type ParseError } from 'jsonc-parser';
import { useStore } from '../../store/store';
import { useTranslation } from 'react-i18next';
import { editJsonc } from './jsoncEdit';
import { JsoncNode } from './JsoncNode';
import { ParseErrorBanner } from './ParseErrorBanner';
import { extractAdjacentComments } from './comments';
import { lookupTemplateComment } from './templateComments';
import { labelAndHelp } from './labels';

type Props = {
  onSwitchToRaw: () => void;
};

// Parser-error token labels are kept in English — they are technical tokens
// matching the jsonc-parser error enum, not user-facing prose.
const ParseErrorMessage: Record<number, string> = {
  1: 'Invalid symbol',
  2: 'Invalid number format',
  3: 'Property name expected',
  4: 'Value expected',
  5: 'Colon expected',
  6: 'Comma expected',
  7: 'Closing brace expected',
  8: 'Closing bracket expected',
  9: 'End of file expected',
  16: 'Unexpected end of comment',
  17: 'Unexpected end of string',
  18: 'Unexpected end of number',
  19: 'Invalid unicode',
  20: 'Invalid escape character',
  21: 'Invalid character',
};

const formatErrors = (errors: ParseError[]): string =>
  errors.length === 0
    ? ''
    : errors.map(e => `offset ${e.offset}: ${ParseErrorMessage[e.error] ?? 'parse error'}`).join('\n');

const Section = ({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <section className="settings-section">
    <header className="settings-section-header">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </header>
    <div className="settings-section-body">{children}</div>
  </section>
);

const propertyKey = (prop: Node): string =>
  prop.type === 'property' && prop.children?.[0]?.type === 'string'
    ? String(prop.children[0].value)
    : '';

const propertyComment = (prop: Node, text: string, key: string): string | null => {
  const valueNode = prop.children?.[1];
  if (!valueNode) return null;
  const live = extractAdjacentComments(text, prop.offset, valueNode.offset, valueNode.length);
  return live.leading || lookupTemplateComment([key]);
};

export const FormView = ({ onSwitchToRaw }: Props) => {
  const { t } = useTranslation();
  const rawText = useStore(s => s.settings);

  // While settings haven't loaded yet, show an empty busy placeholder so we
  // don't flash a parse-error banner for the undefined→'' empty-string case.
  if (rawText === undefined) {
    return <div className="settings-form" data-testid="settings-form-view" aria-busy="true" />;
  }

  const text = rawText;

  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });

  // Always read the latest text from the store instead of closing over the
  // render-time snapshot, so rapid sequential edits don't clobber each other.
  const onEdit = (path: JSONPath, value: unknown) => {
    const current = useStore.getState().settings ?? '';
    useStore.getState().setSettings(editJsonc(current, path, value));
  };

  if (!tree || errors.length > 0 || tree.type !== 'object') {
    return <ParseErrorBanner message={formatErrors(errors)} onSwitchToRaw={onSwitchToRaw} />;
  }

  const generalProps: Node[] = [];
  const sectionProps: Node[] = [];
  for (const prop of tree.children ?? []) {
    if (prop.type !== 'property' || !prop.children?.[1]) continue;
    const valueType = prop.children[1].type;
    if (valueType === 'object' || valueType === 'array') sectionProps.push(prop);
    else generalProps.push(prop);
  }

  return (
    <div className="settings-form" data-testid="settings-form-view">
      {generalProps.length > 0 && (
        <Section title={t('admin_settings.section.general')}>
          {generalProps.map((prop) => {
            const propKey =
              prop.children?.[0]?.type === 'string'
                ? String(prop.children[0].value)
                : String(prop.offset);
            return (
              <JsoncNode
                key={propKey}
                node={prop.children![1]}
                property={prop}
                text={text}
                onEdit={onEdit}
              />
            );
          })}
        </Section>
      )}
      {sectionProps.map((prop) => {
        const key = propertyKey(prop);
        const { label, help } = labelAndHelp(propertyComment(prop, text, key), key);
        const sectionKey =
          prop.children?.[0]?.type === 'string'
            ? String(prop.children[0].value)
            : String(prop.offset);
        return (
          <Section key={sectionKey} title={label} description={help}>
            <JsoncNode
              node={prop.children![1]}
              property={prop}
              text={text}
              onEdit={onEdit}
              suppressOwnHeader
            />
          </Section>
        );
      })}
    </div>
  );
};
