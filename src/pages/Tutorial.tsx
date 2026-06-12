import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  GraduationCap, Search, ArrowLeft, ArrowRight, ChevronRight, BookOpen,
} from 'lucide-react'
import { TUTORIAL_CHAPTERS, getTutorialChapter } from '../onboarding/tutorial'
import { renderMarkdown } from '../onboarding/help/markdown'

function ChapterNav({ activeId }: { activeId?: string }) {
  return (
    <nav aria-label="Tutorial chapters" className="space-y-0.5">
      {TUTORIAL_CHAPTERS.map(c => (
        <Link
          key={c.id}
          to={`/tutorial/${c.id}`}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
            c.id === activeId
              ? 'bg-primary/10 text-primary font-semibold'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          <span
            className={`shrink-0 w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center ${
              c.id === activeId
                ? 'bg-primary text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
            }`}
          >
            {c.number}
          </span>
          <span className="truncate">{c.title}</span>
        </Link>
      ))}
    </nav>
  )
}

function ChapterListView() {
  const [query, setQuery] = useState('')
  const q = query.toLowerCase().trim()

  const filtered = TUTORIAL_CHAPTERS.filter(c =>
    !q ||
    c.title.toLowerCase().includes(q) ||
    c.summary.toLowerCase().includes(q) ||
    c.content.toLowerCase().includes(q),
  )

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <GraduationCap className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50">App Tutorial</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Every page explained in simple steps — start at Chapter 1 or jump to any topic.
          </p>
        </div>
      </div>

      <div className="relative mt-4 mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search the tutorial…"
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            No chapters match <span className="font-semibold">"{query}"</span>
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Try different keywords</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <Link
              key={c.id}
              to={`/tutorial/${c.id}`}
              className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary/40 hover:shadow-sm transition-all group"
            >
              <span className="shrink-0 w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {c.number}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 group-hover:text-primary transition-colors">
                    {c.title}
                  </p>
                  <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{c.summary}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function ChapterView({ chapterId }: { chapterId: string }) {
  const chapter = getTutorialChapter(chapterId)

  if (!chapter) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <BookOpen className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Chapter not found</p>
        <Link to="/tutorial" className="mt-2 text-sm text-primary font-medium hover:underline">
          Back to all chapters
        </Link>
      </div>
    )
  }

  const idx  = TUTORIAL_CHAPTERS.findIndex(c => c.id === chapter.id)
  const prev = idx > 0 ? TUTORIAL_CHAPTERS[idx - 1] : null
  const next = idx < TUTORIAL_CHAPTERS.length - 1 ? TUTORIAL_CHAPTERS[idx + 1] : null

  return (
    <div className="flex gap-6 max-w-5xl mx-auto">
      {/* Chapter nav — desktop only */}
      <aside className="hidden lg:block w-64 shrink-0">
        <div className="sticky top-0 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">
          <Link
            to="/tutorial"
            className="flex items-center gap-2 px-3 py-2 mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:text-primary transition-colors"
          >
            <GraduationCap className="w-4 h-4 text-primary" />
            App Tutorial
          </Link>
          <ChapterNav activeId={chapter.id} />
        </div>
      </aside>

      {/* Chapter content */}
      <article className="flex-1 min-w-0">
        <Link
          to="/tutorial"
          className="lg:hidden flex items-center gap-1 text-xs text-primary font-medium mb-3 hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All Chapters
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 lg:p-8">
          <p className="text-xs font-bold text-primary uppercase tracking-widest mb-1">
            Chapter {chapter.number} of {TUTORIAL_CHAPTERS.length}
          </p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-1">{chapter.title}</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">Updated {chapter.updatedAt}</p>
          {renderMarkdown(chapter.content)}
        </div>

        {/* Prev / Next */}
        <div className="flex items-stretch justify-between gap-3 mt-4">
          {prev ? (
            <Link
              to={`/tutorial/${prev.id}`}
              className="flex-1 flex items-center gap-2 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary/40 transition-colors group"
            >
              <ArrowLeft className="w-4 h-4 text-gray-400 group-hover:text-primary shrink-0" />
              <div className="min-w-0 text-left">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Previous</p>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 group-hover:text-primary truncate">
                  {prev.title}
                </p>
              </div>
            </Link>
          ) : <span className="flex-1" />}
          {next ? (
            <Link
              to={`/tutorial/${next.id}`}
              className="flex-1 flex items-center justify-end gap-2 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary/40 transition-colors group"
            >
              <div className="min-w-0 text-right">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Next</p>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 group-hover:text-primary truncate">
                  {next.title}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-primary shrink-0" />
            </Link>
          ) : <span className="flex-1" />}
        </div>
      </article>
    </div>
  )
}

export default function Tutorial() {
  const { chapterId } = useParams<{ chapterId: string }>()
  return chapterId ? <ChapterView chapterId={chapterId} /> : <ChapterListView />
}
