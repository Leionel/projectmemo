import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownRenderer({ content, className = "" }: { content: string; className?: string }) {
  return <article aria-label="Markdown 渲染预览" className={`prose-output min-w-0 ${className}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </article>;
}
