import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Search, BookOpen, HelpCircle, Compass, Megaphone,
  ChevronDown, ChevronRight, Play, ArrowLeft, Tag,
  Sparkles,
} from 'lucide-react'
import { useOnboardingStore } from '../../store/onboardingStore'
import { HELP_ARTICLES } from '../../onboarding/help/articles'
import { FAQS } from '../../onboarding/help/faqs'
import { RELEASE_NOTES } from '../../onboarding/help/releaseNotes'
import { ALL_TOURS } from '../../onboarding/tours'
import type { HelpArticle, FAQEntry } from '../../types/onboarding'

// ── Simple Markdown renderer ──────────────────────────────────────────────────
// Handles: ## headings, **bold**, bullet lists (- ), tables (| ), blank lines

function renderMarkdown(raw: string): JSX.Element {
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
          <div key={`tbl-${i}`} className="overflow-x-auto scroll-x-fade my-3">
            <table className="min-w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <thead className="bg-gray-100 dark:bg-gray-800">
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
                    <tr key={ri} className={ri % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-850'}>
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
              <InlineMarkdown text={item} />
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
              <InlineMarkdown text={item} />
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

function InlineMarkdown({ text }: { text: string }) {
  const parts: JSX.Element[] = []
  const re = /\*\*(.+?)\*\*|`(.+?)`/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={last}>{text.slice(last, m.index)}</span>)
    if (m[1] !== undefined) {
      parts.push(<strong key={m.index} className="font-semibold text-gray-900 dark:text-gray-100">{m[1]}</strong>)
    } else {
      parts.push(<code key={m.index} className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">{m[2]}</code>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>)
  return <>{parts}</>
}

// ── Tab type ──────────────────────────────────────────────────────────────────

type TabId = 'articles' | 'faqs' | 'tours' | 'whats-new'

const TABS: { id: TabId; label: string; Icon: React.ElementType }[] = [
  { id: 'articles',  label: 'Articles',   Icon: BookOpen  },
  { id: 'faqs',      label: 'FAQs',       Icon: HelpCircle },
  { id: 'tours',     label: 'Tours',      Icon: Compass   },
  { id: 'whats-new', label: "What's New", Icon: Megaphone },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function ArticleCard({ article, onClick }: { article: HelpArticle; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary/40 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 group-hover:text-primary transition-colors">
          {article.title}
        </p>
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{article.summary}</p>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {article.tags.slice(0, 3).map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] text-gray-500 dark:text-gray-400">
            <Tag className="w-2.5 h-2.5" />
            {tag}
          </span>
        ))}
      </div>
    </button>
  )
}

function ArticleDetail({ article, onBack }: { article: HelpArticle; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-primary font-medium mb-4 hover:underline"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Articles
      </button>
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">{article.title}</h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Updated {article.updatedAt}</p>
      <div className="overflow-y-auto flex-1 pr-1">
        {renderMarkdown(article.content)}
      </div>
    </div>
  )
}

function FAQItem({ faq, isOpen, onToggle }: { faq: FAQEntry; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors text-left"
        aria-expanded={isOpen}
      >
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{faq.question}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-1 bg-gray-50 dark:bg-gray-800/60 border-t border-gray-100 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          <InlineMarkdown text={faq.answer} />
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function HelpCenter() {
  const isOpen           = useOnboardingStore(s => s.isHelpCenterOpen)
  const closeCenter      = useOnboardingStore(s => s.closeHelpCenter)
  const startTour        = useOnboardingStore(s => s.startTour)
  const initialTab       = useOnboardingStore(s => s.helpCenterInitialTab)

  const [tab, setTab]         = useState<TabId>('articles')
  const [query, setQuery]     = useState('')
  const [openFAQ, setOpenFAQ] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Reset state on open, respecting initialTab
  useEffect(() => {
    if (isOpen) {
      setTab((initialTab as TabId | null) ?? 'articles')
      setQuery('')
      setSelectedArticle(null)
      setOpenFAQ(null)
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCenter() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, closeCenter])

  const q = query.toLowerCase().trim()

  const filteredArticles = HELP_ARTICLES.filter(a =>
    !q ||
    a.title.toLowerCase().includes(q) ||
    a.summary.toLowerCase().includes(q) ||
    a.tags.some(t => t.includes(q)),
  )

  const filteredFAQs = FAQS.filter(f =>
    !q ||
    f.question.toLowerCase().includes(q) ||
    f.answer.toLowerCase().includes(q) ||
    f.tags.some(t => t.includes(q)),
  )

  const filteredTours = ALL_TOURS.filter(t =>
    !q ||
    t.title.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q),
  )

  const handleStartTour = useCallback((tourId: Parameters<typeof startTour>[0]) => {
    closeCenter()
    setTimeout(() => startTour(tourId), 150)
  }, [closeCenter, startTour])

  if (!isOpen) return null

  // Portal into #layout-safe-zone so the modal is structurally bounded by the
  // safe area (viewport minus tab bar). absolute inset-0 covers that area exactly
  // with no viewport arithmetic — the container's own height enforces the boundary.
  const container = document.getElementById('layout-safe-zone')
  if (!container) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Help Center"
      className="absolute inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) closeCenter() }}
    >
      <div className="w-full max-w-2xl max-h-full lg:max-h-[85vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <HelpCircle className="w-4 h-4 text-primary" />
            </div>
            <h1 className="text-base font-bold text-gray-900 dark:text-gray-50">Help Center</h1>
          </div>
          <button
            type="button"
            onClick={closeCenter}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={e => { setQuery(e.target.value); setSelectedArticle(null) }}
              placeholder="Search articles, FAQs, and tours…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 shrink-0 px-5">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setTab(id); setSelectedArticle(null) }}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {id === 'articles' && q && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                  {filteredArticles.length}
                </span>
              )}
              {id === 'faqs' && q && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                  {filteredFAQs.length}
                </span>
              )}
              {id === 'tours' && q && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                  {filteredTours.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ── Articles ── */}
          {tab === 'articles' && !selectedArticle && (
            <div className="space-y-2">
              {filteredArticles.length === 0 ? (
                <EmptySearch query={query} />
              ) : (
                filteredArticles.map(a => (
                  <ArticleCard key={a.id} article={a} onClick={() => setSelectedArticle(a)} />
                ))
              )}
            </div>
          )}

          {tab === 'articles' && selectedArticle && (
            <ArticleDetail article={selectedArticle} onBack={() => setSelectedArticle(null)} />
          )}

          {/* ── FAQs ── */}
          {tab === 'faqs' && (
            <div className="space-y-2">
              {filteredFAQs.length === 0 ? (
                <EmptySearch query={query} />
              ) : (
                filteredFAQs.map(f => (
                  <FAQItem
                    key={f.id}
                    faq={f}
                    isOpen={openFAQ === f.id}
                    onToggle={() => setOpenFAQ(prev => prev === f.id ? null : f.id)}
                  />
                ))
              )}
            </div>
          )}

          {/* ── Tours ── */}
          {tab === 'tours' && (
            <div className="space-y-2">
              {filteredTours.length === 0 ? (
                <EmptySearch query={query} />
              ) : (
                filteredTours.map(t => (
                  <div
                    key={t.id}
                    className="flex items-start justify-between gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Compass className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t.title}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.description}</p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                          {t.steps.length} step{t.steps.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleStartTour(t.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0"
                    >
                      <Play className="w-3 h-3" />
                      Start
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── What's New ── */}
          {tab === 'whats-new' && (
            <div className="space-y-4">
              {RELEASE_NOTES.map(note => (
                <div key={note.version} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-primary/5 to-transparent border-b border-gray-100 dark:border-gray-700">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-50">
                        v{note.version} — {note.title}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{note.date}</p>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <ul className="space-y-1.5">
                      {note.highlights.map((h, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
                          {h}
                        </li>
                      ))}
                    </ul>
                    {note.details && (
                      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                        {renderMarkdown(note.details)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    container,
  )
}

function EmptySearch({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Search className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-3" />
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
        No results for <span className="font-semibold">"{query}"</span>
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Try different keywords</p>
    </div>
  )
}
