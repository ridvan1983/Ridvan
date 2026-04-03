import ReactMarkdown from 'react-markdown';

export function MentorRichText(props: { content: string; className?: string }) {
  return (
    <div className={props.className}>
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-[#0A0A0A]">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-4 border-violet-200 pl-3 text-[#374151]">{children}</blockquote>
          ),
        }}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  );
}
