"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a memo's Markdown. Raw HTML in the text is never rendered (memo
 * content can carry client-supplied wording), so it is safe to show.
 */
export function MemoMarkdown({ text }: { text: string }) {
  return (
    <div className="memo">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
