import type { ReactNode } from 'react';

function inlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{inlineMarkdown(token.slice(2, -2), `${key}-strong`)}</strong>);
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (link) nodes.push(<a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
    } else {
      nodes.push(<em key={key}>{inlineMarkdown(token.slice(1, -1), `${key}-em`)}</em>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function withLineBreaks(value: string, keyPrefix: string) {
  return value.split('\n').flatMap((line, index, lines) => [
    ...inlineMarkdown(line, `${keyPrefix}-${index}`),
    ...(index < lines.length - 1 ? [<br key={`${keyPrefix}-br-${index}`} />] : []),
  ]);
}

function isBlockStart(line: string) {
  return /^\s*```/.test(line)
    || /^#{1,6}\s+/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line);
}

export function MarkdownOutput({ children }: { children: string }) {
  const lines = children.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```([^\s`]*)\s*$/);
    if (fence) {
      const start = index;
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${start}`} data-language={fence[1] || undefined}><code>{code.join('\n')}</code></pre>);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push(<h3 key={`heading-${index}`} data-level={heading[1].length}>{inlineMarkdown(heading[2], `heading-${index}`)}</h3>);
      index += 1;
      continue;
    }

    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const start = index;
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*[-*+]\s+(.+)$/);
        if (!item) break;
        items.push(<li key={`ul-${index}`}>{inlineMarkdown(item[1], `ul-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-list-${start}`}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const start = index;
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!item) break;
        items.push(<li key={`ol-${index}`}>{inlineMarkdown(item[1], `ol-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-list-${start}`}>{items}</ol>);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const start = index;
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${start}`}>{withLineBreaks(quote.join('\n'), `quote-${start}`)}</blockquote>);
      continue;
    }

    const start = index;
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && (index === start || !isBlockStart(lines[index]))) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${start}`}>{withLineBreaks(paragraph.join('\n'), `paragraph-${start}`)}</p>);
  }

  return <div className="markdown-content">{blocks}</div>;
}
