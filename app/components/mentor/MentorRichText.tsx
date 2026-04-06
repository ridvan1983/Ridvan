import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { stripMentorStructuredTailForUi } from '~/lib/mentor/strip-structured-tail';

function normalizeMentorMarkdownSource(raw: string) {
  let t = stripMentorStructuredTailForUi(raw);
  t = t.replace(/\r\n/g, '\n');
  t = t.replace(/\\n/g, '\n');
  return t;
}

export function MentorRichText(props: { content: string; className?: string }) {
  const source = normalizeMentorMarkdownSource(props.content);

  return (
    <div className={props.className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-3 text-xl font-bold text-[#0A0A0A] first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-3 text-lg font-semibold text-[#0A0A0A] first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-2 text-base font-semibold text-[#0A0A0A] first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-[#0A0A0A]">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-4 border-violet-200 pl-3 text-[#374151]">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 max-w-full overflow-x-auto rounded-lg border border-bolt-elements-borderColor">
              <table className="w-full min-w-[16rem] border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-bolt-elements-background-depth-1">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-bolt-elements-borderColor last:border-0">{children}</tr>,
          th: ({ children }) => (
            <th className="border border-bolt-elements-borderColor px-2 py-1.5 text-left font-semibold text-[#0A0A0A]">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-bolt-elements-borderColor px-2 py-1.5 align-top">{children}</td>,
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg bg-[#1e1e1e] p-3 font-mono text-sm text-gray-100">{children}</pre>
          ),
          code: ({ className, children }) =>
            className ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded bg-violet-100/80 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
            ),
          a: ({ href, children }) => (
            <a className="font-medium text-violet-700 underline underline-offset-2 hover:text-violet-900" href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
