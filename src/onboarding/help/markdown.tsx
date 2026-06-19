// ── Simple Markdown renderer ──────────────────────────────────────────────────
// Shared by HelpCenter (modal) and the full-page Tutorial.
// Handles: ## / ### headings, **bold**, `code`, bullet lists (- ),
// numbered lists (1. ), tables (| ), horizontal rules (---), images (![]), blank lines.

export interface MarkdownRenderOptions {
  /** Called when a tutorial screenshot image is clicked — enables lightbox. */
  onImageClick?: (src: string, alt: string) => void
}

// Resolve tutorial screenshot relative paths to public static paths
function resolveImgSrc(src: string): string {
  if (src.startsWith('./screenshots/')) {
    return `/tutorial/screenshots/${src.slice('./screenshots/'.length)}`
  }
  return src
}

export function renderMarkdown(raw: string, options?: MarkdownRenderOptions): JSX.Element {
  const lines = raw.split('\n')
  const elements: JSX.Element[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-base font-semibold text-gray-800 dark:text-gray-100 mt-5 mb-2 first:mt-0">
          {line.slice(3)}
        </h2>,
      )
      i++
      continue
    }

    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-sm font-semibold text-gray-700 dark:text-gray-200 mt-4 mb-1">
          {line.slice(4)}
        </h3>,
      )
      i++
      continue
    }

    // Horizontal rule
    if (line.trim() === '---') {
      elements.push(
        <hr key={i} className="border-t border-gray-200 dark:border-white/[0.07] my-4" />,
      )
      i++
      continue
    }

    // Image: ![alt](src)
    const imgMatch = line.match(/^!\[(.+?)\]\((.+?)\)$/)
    if (imgMatch) {
      const alt = imgMatch[1]
      const src = resolveImgSrc(imgMatch[2])
      if (options?.onImageClick) {
        elements.push(
          <button
            key={i}
            type="button"
            onClick={() => options.onImageClick!(src, alt)}
            className="block cursor-zoom-in w-full text-left"
            aria-label={`Enlarge: ${alt}`}
          >
            <img
              src={src}
              alt={alt}
              className="max-w-full h-auto rounded-lg border border-gray-200 dark:border-white/[0.07] shadow-sm my-4"
            />
          </button>,
        )
      } else {
        elements.push(
          <img
            key={i}
            src={src}
            alt={alt}
            className="max-w-full h-auto rounded-lg border border-gray-200 dark:border-white/[0.07] shadow-sm my-4"
          />,
        )
      }
      i++
      continue
    }

    // Table block
    if (line.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!lines[i].match(/^\|[-| ]+\|$/)) tableLines.push(lines[i])
        i++
      }
      if (tableLines.length > 0) {
        const [headerLine, ...bodyLines] = tableLines
        const headers = headerLine.split('|').filter(Boolean).map(c => c.trim())
        elements.push(
          <div key={`tbl-${i}`} className="overflow-x-auto my-3">
            <table className="min-w-full text-xs border border-gray-200 dark:border-white/[0.07] rounded-lg overflow-hidden">
              <thead className="bg-gray-100 dark:bg-[#141416]">
                <tr>
                  {headers.map((h, hi) => (
                    <th key={hi} className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyLines.map((row, ri) => {
                  const cells = row.split('|').filter(Boolean).map(c => c.trim())
                  return (
                    <tr key={ri} className={ri % 2 === 0 ? 'bg-white dark:bg-[#0c0c0e]' : 'bg-gray-50 dark:bg-white/[0.03]'}>
                      {cells.map((cell, ci) => (
                        <td key={ci} className="px-3 py-1.5 text-gray-700 dark:text-gray-300">
                          <InlineMarkdown text={cell} />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>,
        )
      }
      continue
    }

    // Bullet list block
    if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(lines[i].slice(2))
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} className="list-none space-y-1 my-2 pl-1">
          {items.map((item, ii) => (
            <li key={ii} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
              <span><InlineMarkdown text={item} /></span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    // Numbered list block
    if (/^\d+\. /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ''))
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="space-y-1 my-2 pl-1">
          {items.map((item, ii) => (
            <li key={ii} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {ii + 1}
              </span>
              <span><InlineMarkdown text={item} /></span>
            </li>
          ))}
        </ol>,
      )
      continue
    }

    // Empty line
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph
    elements.push(
      <p key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-2">
        <InlineMarkdown text={line} />
      </p>,
    )
    i++
  }

  return <div>{elements}</div>
}

export function InlineMarkdown({ text }: { text: string }) {
  const parts: JSX.Element[] = []
  const re = /\*\*(.+?)\*\*|`(.+?)`/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={last}>{text.slice(last, m.index)}</span>)
    if (m[1] !== undefined) {
      parts.push(<strong key={m.index} className="font-semibold text-gray-900 dark:text-gray-100">{m[1]}</strong>)
    } else {
      parts.push(<code key={m.index} className="font-mono text-xs bg-gray-100 dark:bg-[#141416] px-1 py-0.5 rounded">{m[2]}</code>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>)
  return <>{parts}</>
}
