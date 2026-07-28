import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

// Shared renderer for both the read view and the editor's live preview —
// sanitizing is non-negotiable here since page content is user-authored
// markdown rendered as HTML (stored-XSS otherwise).
export function WikiMarkdown({ content }: { content: string }) {
  if (!content.trim()) {
    return <p style={{ color: 'var(--text-dim)', fontSize: 13, fontStyle: 'italic' }}>Nothing here yet.</p>;
  }
  return (
    <div className="wiki-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
