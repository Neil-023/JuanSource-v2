// App.jsx
import React, { useEffect, useRef, useState } from 'react'
import image from './assets/picture.png'
import verifiedIcon from './assets/verified.png'
import fakeIcon from './assets/fake.png'
import fakeIconLight from './assets/fake-light.svg'
import fakeIconDark from './assets/fake-dark.svg'
import verifiedIconLight from './assets/verified-light.svg'
import verifiedIconDark from './assets/verified-dark.svg'
import Logo from './assets/logo.png'



import './index.css'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8001'
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''
const getProgressSteps = (engine) => [
  'Sending claim to fact-checker…',
  'Collecting live evidence 🔎',
  // engine === 'ollama' ? 'Analyzing claim with Ollama 🧠' : 'Analyzing claim with Gemini ✨',
  'Analyzing claim with Gemini ✨',
  'Summarizing verdict 📝',
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normaliseVerdict = (value) => {
  const lowered = (value || '').toLowerCase()
  if (lowered.includes('real') || lowered.includes('true') || lowered.includes('verified')) return 'verified'
  if (lowered.includes('fake') || lowered.includes('false')) return 'fake'
  return 'unknown'
}

const describeBackendError = (raw) => {
  if (!raw) return 'The fact-checker is unavailable right now. Please try again shortly.'
  const lowered = raw.toLowerCase()
  if (lowered.includes('failed to fetch') || lowered.includes('networkerror')) {
     return `Unable to reach the fact-checker at ${API_BASE}. Make sure the FastAPI server is running (uvicorn backend.app.main:app --reload), that it is listening on port 8001, and that no firewall/CORS rules block the request.`
  }
  if (lowered.includes('tavily_api_key') || lowered.includes('tavily')) {
    return 'Backend is missing Tavily credentials (set TAVILY_API_KEY).'
  }
  if (lowered.includes('gemini')) {
    return 'Gemini API credentials are missing or invalid on the backend (check GEMINI_API_KEY).'
  }
  if (lowered.includes('turnstile_secret_key is not configured')) {
    return 'Backend Turnstile secret is missing. Set TURNSTILE_SECRET_KEY in backend/.env and restart backend.'
  }
  if (lowered.includes('invalid-input-secret')) {
    return 'Turnstile secret key is invalid or mismatched with your site key. Use keys from the same Turnstile widget.'
  }
  if (lowered.includes('hostname-mismatch')) {
    return 'Turnstile hostname mismatch. Add localhost (and 127.0.0.1 if needed) to allowed hostnames in Cloudflare Turnstile settings.'
  }
  if (lowered.includes('timeout-or-duplicate') || lowered.includes('invalid-input-response')) {
    return 'Turnstile token expired or was already used. Please complete the challenge again and submit immediately.'
  }
  if (lowered.includes('generative language api') || lowered.includes('service_disabled')) {
    return 'Gemini is configured but disabled in Google Cloud. Enable Generative Language API for the project tied to GOOGLE_API_KEY, then retry.'
  }
  if (lowered.includes('turnstile') || lowered.includes('human verification')) {
    return 'Human verification failed. Please complete the Turnstile challenge and try again.'
  }
  if (lowered.includes('daily prompt limit reached') || lowered.includes('429')) {
    return 'You have reached today\'s prompt limit. Please try again after midnight (Asia/Manila).'
  }
  // if (lowered.includes('ollama') || lowered.includes('11434')) {
  //   return 'Ollama backend is offline. Launch it locally with `ollama serve` (and ensure the requested model is pulled) so the Ollama Version can respond.'
  // }
  return raw
}

function FinalResultCard({ headline, reasoning, verdict, evidence }) {
  const isVerified = verdict === 'verified'
  const isFake = verdict === 'fake'
  const badgeClass = isVerified
    ? 'bg-emerald-100 text-emerald-800'
    : isFake
      ? 'bg-rose-100 text-rose-800'
      : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'

  return (
    <div className="w-full flex flex-col items-center">
    
      {/* Media card */}
        
          {/* Decorative inner card with subtle right-bottom drop shadow */}
          <div className="w-full max-w-md bg-white dark:bg-[#101012] rounded-md flex flex-col items-center justify-center relative p-8"
               style={{ boxShadow: '8px 8px 0 rgba(0,0,0,0.08)' }}
          >
              {/* Badge */}
          <div className="flex justify-center mb-4">
            <div
              className={`inline-block px-4 py-1 rounded-md text-sm font-semibold ${
                isVerified ? 'bg-[#DEFFC4] text-[#5CC10E] dark:bg-[#17270A] text-[#5CC10E]' : 'bg-[#FFC4C4] text-[#FF3737] dark:bg-[#270A0A] text-[#270A0A]'
              }`}
            >
              {isVerified ? 'Real Claim' : 'Fake Claim'}
            </div>
          </div>

            {/* centered icon (verified vs fake) */}
           {/* Light mode image */}
              <img
                src={isVerified ? verifiedIconLight : fakeIconLight}
                alt={isVerified ? 'Verified' : 'Fake'}
                className="w-auto max-h-48 object-contain mb-4 dark:hidden"
              />

              {/* Dark mode image */}
              <img
                src={isVerified ? verifiedIconDark : fakeIconDark}
                alt={isVerified ? 'Verified' : 'Fake'}
                className="w-auto max-h-48 object-contain mb-4 hidden dark:block"
              />

          </div>
       

        {/* Summary row (with small toggle / dot under image, optional) */}
        {/* <div className="flex items-center justify-center mt-4">
          <div className="h-2 w-8 rounded-full"></div>
          <div
            className={`h-2 w-4 rounded-full ${isVerified ? 'bg-emerald-500' : 'bg-rose-500'}`}
          />
        </div> */}

        {/* Text */}
        <div className="mt-6 flex items-center gap-1">
          {/* check & cross icon */}
          <div className="mt-1  hidden md:block">
            {isVerified ? (
              <svg className="h-6 w-6 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-6 w-6 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <div>
            {headline && <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">{headline}</div>}
            <div className="text-sm text-gray-700 dark:text-slate-200">{reasoning}</div>
          </div>
        </div>
        {evidence?.length > 0 && (
          <div className="mt-5">
            <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-slate-400">Sources</p>
            <ul className="mt-2 space-y-1 text-sm">
              {evidence.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple-500 dark:text-purple-300 hover:underline break-all"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    
  )
}

const ENGINE_OPTIONS = [
  { value: 'google', label: 'Google Version', endpoint: '/fact-check' },
  // { value: 'ollama', label: 'Ollama Version', endpoint: '/fact-check-ollama' },
]

export default function App() {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState([])
  const [isDark, setIsDark] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [aboutTab, setAboutTab] = useState('about')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [engine, setEngine] = useState('google')
  const [engineMenuOpen, setEngineMenuOpen] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [submitError, setSubmitError] = useState('')
  const idRef = useRef(1)
  const scrollRef = useRef(null)
  const turnstileContainerRef = useRef(null)
  const turnstileWidgetIdRef = useRef(null)
  const hasDraft = query.trim().length > 0

  const credibleSources = [
    { name: 'ABS-CBN News', tagline: 'Trusted nationwide coverage of Philippine events.' },
    { name: 'GMA News', tagline: 'Independent reporting from GMA Network journalists.' },
    { name: 'Rappler', tagline: 'Investigative stories and fact-checking initiatives.' },
    { name: 'Philippine Daily Inquirer', tagline: 'In-depth national and regional reporting.' },
    { name: 'Philstar', tagline: 'Daily news and analysis from The Philippine Star.' },
  ]

  // initialize theme from storage or system preference
  useEffect(() => {
    const stored = localStorage.getItem('theme')
    const initial = stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    setIsDark(initial === 'dark')
    document.documentElement.classList.toggle('dark', initial === 'dark')
  }, [])

  // apply theme on change
  useEffect(() => {
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // ensure scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, hasDraft])

  useEffect(() => {
    fetch(`${API_BASE}/session/bootstrap`, {
      method: 'GET',
      credentials: 'include',
    }).catch(() => {
      // No-op: prompt endpoint will still return a clear error if backend is unavailable.
    })
  }, [])

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileContainerRef.current) return

    const renderWidget = () => {
      if (!window.turnstile || !turnstileContainerRef.current) return

      if (turnstileWidgetIdRef.current !== null) {
        window.turnstile.remove(turnstileWidgetIdRef.current)
        turnstileWidgetIdRef.current = null
      }

      turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: isDark ? 'dark' : 'light',
        callback: (token) => {
          setTurnstileToken(token)
          setSubmitError('')
        },
        'expired-callback': () => {
          setTurnstileToken('')
        },
        'error-callback': () => {
          setTurnstileToken('')
          setSubmitError('Human verification failed. Please retry the challenge.')
        },
      })
    }

    if (window.turnstile) {
      renderWidget()
      return
    }

    const existingScript = document.querySelector('script[data-turnstile-script="true"]')
    if (existingScript) {
      existingScript.addEventListener('load', renderWidget, { once: true })
      return () => existingScript.removeEventListener('load', renderWidget)
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstileScript = 'true'
    script.addEventListener('load', renderWidget, { once: true })
    document.head.appendChild(script)

    return () => {
      script.removeEventListener('load', renderWidget)
    }
  }, [isDark])

  const resetTurnstile = () => {
    if (window.turnstile && turnstileWidgetIdRef.current !== null) {
      window.turnstile.reset(turnstileWidgetIdRef.current)
    }
    setTurnstileToken('')
  }

  const selectedEngine = ENGINE_OPTIONS.find((opt) => opt.value === engine) ?? ENGINE_OPTIONS[0]

  const send = async (e) => {
    if (e) e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return

    if (!TURNSTILE_SITE_KEY) {
      setSubmitError('Turnstile is not configured. Set VITE_TURNSTILE_SITE_KEY to enable prompting.')
      return
    }

    if (!turnstileToken) {
      setSubmitError('Please complete human verification before sending a prompt.')
      return
    }

    setSubmitError('')

    const userId = idRef.current++
    setMessages((m) => [
      ...m,
      { id: userId, role: 'user', text: trimmed, time: Date.now() },
    ])
    setQuery('')

    const stepId = idRef.current++
    setMessages((m) => [
      ...m,
      { id: stepId, role: 'assistant', text: '', loading: true },
    ])

    try {
      const steps = getProgressSteps(selectedEngine.value)
      for (let i = 0; i < steps.length; i++) {
        await sleep(600 + Math.random() * 600)
        const currentStep = steps[i]
        setMessages((m) =>
          m.map((msg) =>
            msg.id === stepId
              ? { ...msg, text: currentStep, loading: i !== steps.length - 1 }
              : msg
          )
        )
      }

      const endpoint = selectedEngine.endpoint
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          claim: trimmed,
          turnstile_token: turnstileToken,
        }),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        const detail = payload?.detail ?? payload?.error ?? 'Fact-check request failed.'
        throw new Error(detail)
      }
      const data = payload ?? {}
      const finalId = idRef.current++
      setMessages((m) => [
        ...m.filter((msg) => msg.id !== stepId),
        {
          id: finalId,
          role: 'assistant',
          text: data.reasoning ?? data.raw ?? 'No reasoning available.',
          loading: false,
          final: true,
          verdict: normaliseVerdict(data.classification),
          headline: `Claim: "${trimmed}"`,
          evidence: data.evidence ?? [],
        },
      ])
    } catch (error) {
      const friendly = describeBackendError(error instanceof Error ? error.message : String(error))
      setMessages((m) =>
        m.map((msg) =>
          msg.id === stepId
            ? { ...msg, text: friendly, loading: false, error: true }
            : msg
        )
      )
    } finally {
      resetTurnstile()
    }
  }

  return (
    <div className="min-h-screen bg-[#f9f9f9] text-gray-800 dark:bg-[#101012] dark:text-white transition-colors duration-300">
      <div
        className={`max-w-screen-4xl mx-auto relative px-0 sm:px-0 lg:px-8 py-12 ${
          sidebarOpen ? 'lg:pr-[500px] xl:pr-[520px]' : 'lg:pr-12'
        }`}
      >
        {/* Main Screen */}
        <main className="w-full flex flex-col min-h-[70vh]">
          <div className="flex justify-end mb-4 lg:hidden">
            <button
              onClick={() => setShowInfo(true)}
              className="p-2 rounded-full bg-white dark:bg-slate-800 shadow hover:bg-gray-100 dark:hover:bg-slate-700"
              aria-label="Open information modal"
              title="About"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 dark:text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12A9 9 0 113 12a9 9 0 0118 0z"/>
              </svg>
            </button>
          </div>
          <div className="hidden lg:flex justify-end mb-4">
            <button
              onClick={() => setSidebarOpen((open) => !open)}
              className="p-2 rounded-full bg-white dark:bg-[#1B1C22] shadow hover:bg-gray-100 dark:hover:bg-[#17171C]"
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-gray-500 dark:text-slate-300"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                {sidebarOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 18l-6-6 6-6" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 18l6-6-6-6" />
                )}
              </svg>
            </button>
          </div>
          <div className="flex-1">
            {messages.length === 0 ? (
              // Hero view when no chat yet
              <div className="flex flex-col items-center text-center gap-8 py-16 sm:py-20">
                <div className="w-full max-w-2xl lg:max-w-4xl mx-auto">
                  <div className="mx-auto rounded-2xl p-10 flex items-center justify-center bg-white/0">
                    <div className="w-full h-64 flex items-center justify-center">
                      <img src={image} alt="Image" className="w-full h-full max-h-64 object-contain" />
                    </div>
                  </div>
                </div>

                <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold text-gray-900 dark:text-white max-w-3xl tracking-tight">
                  Your go-to tool for verifying facts and exposing fake news.
                </h1>

                <div className="w-full max-w-3xl">
                  <p className="mt-4 text-sm text-gray-500 sm:text-base">This tool uses Generative AI and real-time web search (Tavily) for factual verification. Always verify critical information independently. Stay vigilant, stay informed. </p>

                </div>
              </div>
            ) : (
              <div
                ref={scrollRef}
                className="space-y-6 max-h-[80vh] overflow-y-auto pr-4 mx-auto w-[90%] md:w-[80%] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"> 
          
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex items-end gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {/* assistant avatar */}
                    {m.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-white dark:bg-slate-800 shadow flex items-center justify-center">
                        <img src={Logo} alt="JuanSource logo" className="w-5 h-5 object-contain" />
                      </div>
                    )}

                    <div className={`rounded-2xl p-4 shadow-md max-w-[70%]  ${
                      m.role === 'user'
                        ? 'bg-[#6C63FF] text-white rounded-br-none'
                        : 'bg-white text-gray-700 dark:bg-[#1B1C22] dark:text-slate-100 rounded-bl-none'
                    }`}>
                      {/* if final result -> show the result card */}
                      {m.final ? (
                        <FinalResultCard headline={m.headline} reasoning={m.text} verdict={m.verdict} evidence={m.evidence} />
                      ) :  (
                        <div className="flex items-center gap-2">
                          <div>{m.text}</div>
                          {m.loading && (
                            <div className="w-5 h-5 border-2 border-[#6C63FF] rounded-full animate-spin border-t-transparent" />
                          )}
                        </div>
                      )}
                    </div>

                    {/* user avatar */}
                    {m.role === 'user' && (
                      <div className="w-8 h-8 rounded-full bg-[#6C63FF] text-white flex items-center justify-center text-sm font-medium">
                        U
                      </div>
                    )}
                  </div>
                ))}

                {/* draft preview while typing */}
                {hasDraft && (
                  <div key="draft" className="flex items-start gap-4 justify-end">
                    <div className="rounded-2xl  p-4 shadow-md max-w-[70%] bg-purple-500/80 text-white rounded-br-none">
                      {query}
                    </div>
                    <div className="w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-medium">
                      U
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-8">
            <form onSubmit={send} className="max-w-3xl lg:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setEngineMenuOpen((open) => !open)}
                    className="min-w-[150px] px-4 py-3 rounded-xl bg-white dark:bg-[#1B1C22] shadow text-sm text-left border border-transparent dark:border-[#26262F] flex items-center justify-between gap-3"
                  >
                    <span>{selectedEngine.label}</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`h-4 w-4 transition-transform ${engineMenuOpen ? 'rotate-180' : ''}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {engineMenuOpen && (
                    <div className="absolute z-10 mt-2 w-48 rounded-xl bg-white dark:bg-[#1B1C22] shadow-lg border border-gray-100 dark:border-[#26262F]">
                      {ENGINE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setEngine(option.value)
                            setEngineMenuOpen(false)
                          }}
                          className={`w-full text-left px-4 py-2 text-sm ${
                            engine === option.value
                              ? 'bg-gray-50 dark:bg-[#23242C] text-[#6C63FF]'
                              : 'text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-[#23242C]'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex-1 relative">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Not sure if it's true? Type it here..."
                    className="w-full pl-5 pr-12 py-4 rounded-xl bg-white dark:bg-[#1B1C22] shadow-lg placeholder-gray-400 dark:placeholder-[#505050] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600/60 border border-transparent"
                  />
                  <button
                    type="submit"
                    disabled={!turnstileToken}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#6C63FF] p-2.5 sm:p-3 rounded-lg shadow-md transition-transform duration-150 hover:scale-105 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                    aria-label="submit-search"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-col items-end gap-2">
                <div ref={turnstileContainerRef} className="min-h-[65px]" />
                {submitError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">{submitError}</p>
                )}
              </div>
            </form>
          </div>
        </main>

        {/* Right sidebar (fixed) */}
        <aside
          className={`hidden lg:flex flex-col fixed top-0 right-0 h-screen w-[500px] border-l border-gray-200 dark:border-none bg-white dark:bg-[#1A1A1F] p-6 overflow-y-auto transition-transform duration-300 ${
            sidebarOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
          }`}
        >
          <div className="flex items-center justify-between mb-4">
           <div className="flex items-center gap-2">
              <img
                src={Logo}
                alt="JuanSource logo"
                className="w-6 h-6 object-contain"
              />
              <span className="text-lg font-semibold text-gray-800 dark:text-white tracking-tighter">
                juansource.
              </span>
            </div>

            {/* replaced "see all" with info icon */}
            <button
              onClick={() => setShowInfo(true)}
              className="p-2 rounded-full bg-[#F9F9F9] dark:bg-[#101012]"
              aria-label="Open information modal"
              title="About"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 dark:text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12A9 9 0 113 12a9 9 0 0118 0z"/>
              </svg>
            </button>
          </div>

         <div className="mt-2 px-2 py-4 border-b border-gray-200 dark:border-[#2B2C2C] flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-300">
              Our top 5 news sources
            </h3>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-[#6C63FF]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 17l6-6 4 4 8-8" />
                  <circle cx="3" cy="17" r="1" fill="currentColor" />
                  <circle cx="9" cy="11" r="1" fill="currentColor" />
                  <circle cx="13" cy="15" r="1" fill="currentColor" />
                  <circle cx="21" cy="7" r="1" fill="currentColor" />
                </svg>

          </div>


          <div className="space-y-4">
            {credibleSources.map((source) => (
              <div key={source.name} className="px-2 py-4 rounded-lg hover:bg-gray-50 dark:hover:bg-[#17171C] transition-colors">
                <h4 className="text-md font-medium">{source.name}</h4>
                <p className="mt-2 text-sm text-gray-500 dark:text-slate-300">{source.tagline}</p>
              </div>
            ))}
          </div>
        </aside>

        {/* Floating theme toggle (bottom-right) */}
        <div className="fixed right-4 bottom-4 sm:right-6 sm:bottom-6">
          <button
            onClick={() => setIsDark((v) => !v)}
            className="p-3 sm:p-4 rounded-full bg-white  dark:bg-[#101012] shadow-lg flex items-center justify-center"
            aria-pressed={isDark}
            aria-label="Toggle dark mode"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? (
              // Sun icon (light theme target)
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v2m0 12v2m8-8h2M2 12H4m13.657-6.343l1.414 1.414M4.929 19.071l1.414-1.414m0-10.314L4.93 5.657M19.071 19.07l-1.414-1.414" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
            ) : (
              // Moon icon (dark theme target)
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>
        </div>

        {/* Info Modal */}
        {showInfo && (
          <div className="fixed inset-0 z-50">
            {/* backdrop */}
            <div
                  className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"

              onClick={() => setShowInfo(false)}
            />
            {/* dialog */}
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div
                role="dialog"
                aria-modal="true"
                className="w-full max-w-2xl rounded-2xl bg-white dark:bg-[#101012] border border-gray-200 dark:border-none shadow-2xl"
              >
                {/* header */}
               <div className="flex items-center justify-center relative px-6 py-4 border-b border-gray-100 dark:border-[#2B2C2C]">
                  <h2 className="text-md font-semibold text-gray-700 dark:text-slate-100 text-center">
                    About JuanSource
                  </h2>
                  <button
                    onClick={() => setShowInfo(false)}
                    className="absolute right-6 p-2 rounded-full bg-[#F9F9F9] dark:bg-[#101012]"
                    aria-label="Close modal"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 text-gray-500 dark:text-slate-300"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>


                {/* tabs */}
                <div className="px-6 pt-4">
                  <div className="flex items-center justify-center">
                    <div className="inline-flex p-1 rounded-xl bg-gray-100 dark:bg-[#1B1C22] gap-1">
                      <button
                        onClick={() => setAboutTab('about')}
                        className={`px-4 py-1.5 text-sm rounded-xl transition ${
                          aboutTab === 'about'
                            ? 'bg-white dark:bg-[#101012] text-gray-900 dark:text-slate-100 shadow'
                            : 'bg-transparent text-gray-600 dark:text-slate-300 hover:text-gray-800 dark:hover:text-slate-100'
                        }`}
                      >
                        About
                      </button>
                      <button
                        onClick={() => setAboutTab('how')}
                        className={`px-4 py-1.5 text-sm rounded-xl transition ${
                          aboutTab === 'how'
                            ? 'bg-white dark:bg-[#101012] text-gray-900 dark:text-slate-100 shadow'
                            : 'bg-transparent text-gray-600 dark:text-slate-300 hover:text-gray-800 dark:hover:text-slate-100'
                        }`}
                      >
                        How to Use
                      </button>
                    </div>
                  </div>

                  {/* body */}
                  <div className="px-2 sm:px-6 pb-6 text-sm text-gray-700 dark:text-slate-200">
                    {/* logo row */}
                    <div className="flex items-center justify-center gap-2 my-8 ">
                      <img
                        src={Logo}
                        alt="JuanSource logo"
                        className="w-8 h-8 object-contain"
                      />
                      <span className="text-2xl font-semibold text-gray-800 dark:text-white tracking-tighter">
                        juansource.
                      </span>
                    </div>

                    {aboutTab === 'about' ? (
                      <div className="space-y-3">
                        <p className='text-justify'>
                          <strong>JuanSource</strong> is a fact-checking tool that combines Generative AI with real-time web search (Tavily) to verify information and detect misleading claims. Designed to combat the spread of fake news and disinformation in the Philippines, especially during elections and major public issues. JuanSource empowers users to stay informed and think critically.
                        </p>
         
                      </div>
                    ) : (
                     <div className="space-y-3">
                        <p>
                          JuanSource helps you quickly verify if a statement is true or misleading by checking reliable online sources.
                          Just follow these easy steps:
                        </p>

                        <ol className="list-decimal pl-5 space-y-2">
                          <li>
                            <strong>Enter a claim</strong> – Type or paste the statement you want to fact-check.
                          </li>
                          <li>
                            <strong>Run the check</strong> – JuanSource will search reliable sources and gather evidence.
                          </li>
                          <li>
                            <strong>View the result</strong> – See if the claim is true or false, along with key references.
                          </li>
                        </ol>

                        <p>And there you go! You’ve just verified a claim with JuanSource ✨</p>
                      </div>

                    )}
                  </div>

                    <div className="flex items-center justify-center my-6 text-xs text-[#A4A4A4] dark:text-[#505050]">
                      © 2025 JuanSource. All rights reserved.
                    </div>

                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
