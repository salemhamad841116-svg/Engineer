import React, { useState, useMemo } from 'react';
import { Copy, Check, FileCode, ExternalLink, Info, AlertTriangle, Lightbulb } from 'lucide-react';

interface SmartResponseRendererProps {
  content: string;
  isStreaming?: boolean;
  isAr?: boolean;
  onNotify?: (type: 'success' | 'error' | 'info', message: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isArabicText(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function sanitizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^(?:https?:\/\/|\/|#)/i.test(trimmed)) {
    return trimmed;
  }
  return '#';
}

// ---------------------------------------------------------------------------
// Code Block with Dedicated Copy Button
// ---------------------------------------------------------------------------

interface CodeBlockProps {
  language: string;
  code: string;
  isAr?: boolean;
  onNotify?: (type: 'success' | 'error' | 'info', message: string) => void;
}

function CodeBlock({ language, code, isAr, onNotify }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      if (onNotify) {
        onNotify('success', isAr ? 'تم نسخ الكود البرمجي' : 'Code copied to clipboard');
      }
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const displayLang = (language || 'code').toUpperCase();

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/15 bg-slate-950/90 shadow-lg text-slate-100 font-mono text-xs" dir="ltr">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-white/10 select-none">
        <div className="flex items-center gap-2 text-slate-400 text-[11px] font-semibold tracking-wide">
          <FileCode className="w-3.5 h-3.5 text-blue-400" />
          <span>{displayLang}</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
            copied
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10'
          }`}
          title={isAr ? 'نسخ الكود' : 'Copy code'}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400 stroke-[2.5]" />
              <span>{isAr ? 'تم النسخ' : 'Copied!'}</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 stroke-[2]" />
              <span>{isAr ? 'نسخ الكود' : 'Copy'}</span>
            </>
          )}
        </button>
      </div>

      {/* Code Body */}
      <pre className="p-3.5 overflow-x-auto text-[11.5px] leading-relaxed text-slate-200 selection:bg-blue-600/40">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Formatter: parses **bold**, *italic*, `code`, and [links](url)
// ---------------------------------------------------------------------------

function renderInline(text: string, keyPrefix = ''): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Tokenize regex matches: inline code `...`, bold **...**, italic *...*, link [...](...)
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const rawMatch = match[0];
    const matchIndex = match.index;

    // Plain text before token
    if (matchIndex > lastIndex) {
      nodes.push(text.slice(lastIndex, matchIndex));
    }

    const key = `${keyPrefix}-${matchIndex}`;

    if (rawMatch.startsWith('`') && rawMatch.endsWith('`')) {
      const codeSnippet = rawMatch.slice(1, -1);
      nodes.push(
        <code
          key={key}
          dir="ltr"
          className="px-1.5 py-0.5 mx-0.5 rounded-md bg-slate-800/90 text-blue-300 font-mono text-[11px] border border-white/10 font-semibold inline-block align-baseline"
        >
          {codeSnippet}
        </code>
      );
    } else if (rawMatch.startsWith('**') && rawMatch.endsWith('**')) {
      const boldText = rawMatch.slice(2, -2);
      nodes.push(
        <strong key={key} className="font-bold text-white tracking-tight">
          {renderInline(boldText, `${key}-b`)}
        </strong>
      );
    } else if (rawMatch.startsWith('*') && rawMatch.endsWith('*')) {
      const italicText = rawMatch.slice(1, -1);
      nodes.push(
        <em key={key} className="italic text-slate-300">
          {renderInline(italicText, `${key}-i`)}
        </em>
      );
    } else if (rawMatch.startsWith('[') && rawMatch.includes('](') && rawMatch.endsWith(')')) {
      const splitIdx = rawMatch.indexOf('](');
      const label = rawMatch.slice(1, splitIdx);
      const url = rawMatch.slice(splitIdx + 2, -1);
      nodes.push(
        <a
          key={key}
          href={sanitizeUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline font-medium inline-flex items-center gap-0.5"
        >
          <span>{label}</span>
          <ExternalLink className="w-2.5 h-2.5 inline-block opacity-75" />
        </a>
      );
    } else {
      nodes.push(rawMatch);
    }

    lastIndex = matchIndex + rawMatch.length;
  }

  // Trailing plain text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Block Parser & Structured Types
// ---------------------------------------------------------------------------

type BlockItem =
  | { type: 'code'; language: string; content: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'ordered-item'; number: string; title: string; children: string[] }
  | { type: 'bullet-list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'callout'; kind: 'note' | 'tip' | 'warning'; text: string }
  | { type: 'paragraph'; text: string };

function parseMarkdownBlocks(rawText: string, isStreaming = false): BlockItem[] {
  if (!rawText) return [];

  let text = rawText;
  // If streaming and there is an unclosed code block, auto-close it
  if (isStreaming) {
    const codeBlockCount = (text.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      text += '\n```';
    }
  }

  const lines = text.split('\n');
  const blocks: BlockItem[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Fenced Code Block
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'code',
        language,
        content: codeLines.join('\n'),
      });
      continue;
    }

    // 2. Empty line
    if (!trimmed) {
      i++;
      continue;
    }

    // 3. Headings (#, ##, ###, ####)
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // 4. Callout / Alert Blockquote (> [!NOTE], > [!TIP], > [!WARNING], > ...)
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      let kind: 'note' | 'tip' | 'warning' = 'note';

      while (i < lines.length && lines[i].trim().startsWith('>')) {
        let contentLine = lines[i].trim().slice(1).trim();
        if (contentLine.startsWith('[!NOTE]')) {
          kind = 'note';
          contentLine = contentLine.slice(7).trim();
        } else if (contentLine.startsWith('[!TIP]')) {
          kind = 'tip';
          contentLine = contentLine.slice(6).trim();
        } else if (contentLine.startsWith('[!WARNING]') || contentLine.startsWith('[!IMPORTANT]') || contentLine.startsWith('[!CAUTION]')) {
          kind = 'warning';
          contentLine = contentLine.replace(/^\[!(?:WARNING|IMPORTANT|CAUTION)\]/, '').trim();
        }
        if (contentLine) quoteLines.push(contentLine);
        i++;
      }

      blocks.push({
        type: 'callout',
        kind,
        text: quoteLines.join(' '),
      });
      continue;
    }

    // 5. GFM Table (| Col 1 | Col 2 |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length && lines[i + 1].includes('---')) {
      const parseRow = (r: string) =>
        r
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());

      const headers = parseRow(trimmed);
      i += 2; // skip header and delimiter line
      const rows: string[][] = [];

      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        rows.push(parseRow(lines[i].trim()));
        i++;
      }

      blocks.push({
        type: 'table',
        headers,
        rows,
      });
      continue;
    }

    // 6. Ordered Item (1. , 2. , 3. ) with possible sub-bullets
    const orderedMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (orderedMatch) {
      const num = orderedMatch[1];
      const title = orderedMatch[2].trim();
      const children: string[] = [];
      i++;

      // Collect nested bullet points or continuation lines under this numbered step
      while (i < lines.length) {
        const nextLine = lines[i];
        const nextTrimmed = nextLine.trim();

        // If next is a new numbered step, break
        if (/^\d+[.)]\s+/.test(nextTrimmed)) break;
        // If next is a heading or code block, break
        if (nextTrimmed.startsWith('#') || nextTrimmed.startsWith('```')) break;
        // If next is empty line followed by non-bullet, break
        if (!nextTrimmed) {
          if (i + 1 < lines.length && /^\d+[.)]\s+/.test(lines[i + 1].trim())) {
            i++;
            break;
          }
          i++;
          continue;
        }

        // Sub-bullets (•, -, *, +)
        const subBulletMatch = nextLine.match(/^\s*(?:[-*+•]|\d+\.\d+)\s+(.+)$/);
        if (subBulletMatch) {
          children.push(subBulletMatch[1].trim());
          i++;
        } else if (nextLine.startsWith('   ') || nextLine.startsWith('\t')) {
          // Indented continuation
          children.push(nextTrimmed);
          i++;
        } else {
          break;
        }
      }

      blocks.push({
        type: 'ordered-item',
        number: num,
        title,
        children,
      });
      continue;
    }

    // 7. Unordered / Bullet List (- , * , + , • )
    const bulletMatch = line.match(/^\s*[-*+•]\s+(.+)$/);
    if (bulletMatch) {
      const items: string[] = [bulletMatch[1].trim()];
      i++;

      while (i < lines.length) {
        const nextTrimmed = lines[i].trim();
        if (!nextTrimmed) {
          i++;
          continue;
        }
        const nextBullet = lines[i].match(/^\s*[-*+•]\s+(.+)$/);
        if (nextBullet) {
          items.push(nextBullet[1].trim());
          i++;
        } else {
          break;
        }
      }

      blocks.push({
        type: 'bullet-list',
        items,
      });
      continue;
    }

    // 8. Regular Paragraph
    const paraLines: string[] = [trimmed];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i];
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed) break;
      if (
        nextTrimmed.startsWith('```') ||
        nextTrimmed.startsWith('#') ||
        nextTrimmed.startsWith('>') ||
        /^\d+[.)]\s+/.test(nextTrimmed) ||
        /^[-*+•]\s+/.test(nextTrimmed) ||
        (nextTrimmed.startsWith('|') && nextTrimmed.endsWith('|'))
      ) {
        break;
      }
      paraLines.push(nextTrimmed);
      i++;
    }

    blocks.push({
      type: 'paragraph',
      text: paraLines.join(' '),
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Main Component: SmartResponseRenderer
// ---------------------------------------------------------------------------

export function SmartResponseRenderer({
  content,
  isStreaming = false,
  isAr,
  onNotify,
}: SmartResponseRendererProps) {
  const blocks = useMemo(() => parseMarkdownBlocks(content, isStreaming), [content, isStreaming]);

  if (!content) return null;

  return (
    <div className="space-y-3 leading-relaxed text-slate-200 select-text">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'code':
            return (
              <CodeBlock
                key={`block-${idx}`}
                language={block.language}
                code={block.content}
                isAr={isAr}
                onNotify={onNotify}
              />
            );

          case 'heading': {
            const hasArabic = isArabicText(block.text);
            if (block.level === 1) {
              return (
                <h1
                  key={`block-${idx}`}
                  dir={hasArabic ? 'rtl' : 'ltr'}
                  className="text-base md:text-lg font-extrabold text-white tracking-tight mt-4 mb-2 pb-1 border-b border-white/10"
                >
                  {renderInline(block.text, `h1-${idx}`)}
                </h1>
              );
            }
            if (block.level === 2) {
              return (
                <h2
                  key={`block-${idx}`}
                  dir={hasArabic ? 'rtl' : 'ltr'}
                  className="text-sm md:text-base font-bold text-slate-100 tracking-tight mt-3 mb-1.5"
                >
                  {renderInline(block.text, `h2-${idx}`)}
                </h2>
              );
            }
            return (
              <h3
                key={`block-${idx}`}
                dir={hasArabic ? 'rtl' : 'ltr'}
                className="text-xs md:text-sm font-semibold text-blue-300 mt-2 mb-1"
              >
                {renderInline(block.text, `h3-${idx}`)}
              </h3>
            );
          }

          case 'ordered-item': {
            const hasArabic = isArabicText(block.title);
            return (
              <div
                key={`block-${idx}`}
                dir={hasArabic ? 'rtl' : 'ltr'}
                className="my-2.5 space-y-1.5"
              >
                {/* Step Headline with glowing number badge */}
                <div className="flex items-start gap-2.5">
                  <span className="shrink-0 w-5 h-5 rounded-md bg-blue-600/25 border border-blue-500/40 text-blue-300 text-xs font-bold font-mono flex items-center justify-center mt-0.5 shadow-[0_0_8px_rgba(59,130,246,0.4)] select-none">
                    {block.number}
                  </span>
                  <div className="flex-1 text-xs md:text-sm font-bold text-white pt-0.5">
                    {renderInline(block.title, `ord-title-${idx}`)}
                  </div>
                </div>

                {/* Sub-bullets under this ordered step */}
                {block.children.length > 0 && (
                  <ul className="ms-7 space-y-1.5 pt-0.5 border-s border-blue-500/20 ps-3">
                    {block.children.map((child, cIdx) => (
                      <li key={`ord-child-${idx}-${cIdx}`} className="flex items-start gap-2 text-xs text-slate-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0 inline-block shadow-[0_0_6px_rgba(59,130,246,0.6)]" />
                        <span className="flex-1 leading-relaxed">
                          {renderInline(child, `ord-child-in-${idx}-${cIdx}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          }

          case 'bullet-list': {
            return (
              <ul key={`block-${idx}`} className="space-y-1.5 my-2">
                {block.items.map((item, bIdx) => {
                  const hasArabic = isArabicText(item);
                  return (
                    <li
                      key={`bullet-${idx}-${bIdx}`}
                      dir={hasArabic ? 'rtl' : 'ltr'}
                      className="flex items-start gap-2.5 text-xs text-slate-300"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0 inline-block shadow-[0_0_6px_rgba(59,130,246,0.6)]" />
                      <span className="flex-1 leading-relaxed">
                        {renderInline(item, `b-item-${idx}-${bIdx}`)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            );
          }

          case 'table': {
            return (
              <div key={`block-${idx}`} className="my-3 rounded-xl border border-white/10 overflow-hidden bg-slate-950/80 shadow-md">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-start border-collapse">
                    <thead>
                      <tr className="bg-white/[0.05] border-b border-white/10 text-white font-semibold">
                        {block.headers.map((h, hIdx) => (
                          <th key={`th-${idx}-${hIdx}`} className="p-2.5 text-start font-bold">
                            {renderInline(h, `th-in-${idx}-${hIdx}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {block.rows.map((row, rIdx) => (
                        <tr key={`tr-${idx}-${rIdx}`} className="hover:bg-white/[0.02] transition-colors">
                          {row.map((cell, cIdx) => (
                            <td key={`td-${idx}-${rIdx}-${cIdx}`} className="p-2.5 text-slate-300 text-start align-top">
                              {renderInline(cell, `td-in-${idx}-${rIdx}-${cIdx}`)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }

          case 'callout': {
            const isTip = block.kind === 'tip';
            const isWarn = block.kind === 'warning';
            const Icon = isTip ? Lightbulb : isWarn ? AlertTriangle : Info;

            return (
              <div
                key={`block-${idx}`}
                className={`my-3 p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                  isTip
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                    : isWarn
                    ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                    : 'bg-blue-950/20 border-blue-500/30 text-blue-200'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">
                  {renderInline(block.text, `callout-${idx}`)}
                </div>
              </div>
            );
          }

          case 'paragraph':
          default: {
            const hasArabic = isArabicText(block.text);
            return (
              <p
                key={`block-${idx}`}
                dir={hasArabic ? 'rtl' : 'ltr'}
                className="text-xs leading-relaxed text-slate-200"
              >
                {renderInline(block.text, `p-${idx}`)}
              </p>
            );
          }
        }
      })}
    </div>
  );
}
