import { WikiMarkdown } from './WikiMarkdown';
import type { WikiPage } from '../../types';

function parseTags(tags: string): string[] {
  try { return JSON.parse(tags) as string[]; } catch { return []; }
}

export function WikiPageView({ page }: { page: WikiPage }) {
  const tags = parseTags(page.tags);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 className="page-title" style={{ fontSize: 20 }}>{page.title}</h1>
        <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          {page.updatedBy ? `Last edited by ${page.updatedBy.user.name}` : page.createdBy ? `Created by ${page.createdBy.user.name}` : 'No author on record'}
          {' · '}
          {new Date(page.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
            {tags.map((t) => <span key={t} className="tag">{t}</span>)}
          </div>
        )}
      </div>

      <WikiMarkdown content={page.content} />
    </div>
  );
}
