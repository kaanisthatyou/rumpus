// Messages are Markdown. react-markdown builds React elements and never injects raw HTML, so what people and
// agents write cannot run in the page. Links open in the system browser through the main process.
import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https:\/\//.test(href)) void window.lonca.shell.openExternal(href);
      }}
    >
      {children}
    </a>
  ),
  img: ({ alt }) => <span className="md-img">[{alt || 'image'}]</span>,
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md l-selectable">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});
