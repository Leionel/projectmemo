import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownRenderer({ content, className = "", projectId }: { content: string; className?: string; projectId?: string }) {
  return <article aria-label="Markdown 渲染预览" className={`prose-output min-w-0 ${className}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      img: ({ src, alt }) => {
        // 只自动读取原鉴权附件接口；模型文字中的远程图片不得绕过联网许可。
        const local = typeof src === "string" ? /^\/api\/projects\/([^/?#]+)\/attachments\/[^/?#]+\/file$/.exec(src) : null;
        if (projectId && local && local[1] === encodeURIComponent(projectId)) {
          // eslint-disable-next-line @next/next/no-img-element -- 原鉴权附件路由，不经图片优化代理。
          return <img src={src} alt={alt ?? "附件图片"} loading="lazy" referrerPolicy="no-referrer" />;
        }
        return <span className="text-[var(--ink-soft)]">[图片{alt ? `：${alt}` : ""}，未自动加载]</span>;
      },
      a: ({ href, children }) => <a href={href} rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>,
    }}>{content}</ReactMarkdown>
  </article>;
}
