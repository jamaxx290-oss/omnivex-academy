import { Link } from "react-router-dom";
import { useMe, useSettings } from "../hooks";
import { naira } from "../lib/api";

const features = [
  {
    icon: "M17 20h5v-2a4 4 0 0 0-3-3.87M9 20H4v-2a4 4 0 0 1 3-3.87m6-3.13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z",
    title: "Live mentorship groups",
    body: "Structured rooms where mentors and peers review covers, blurbs, and launch plans in real time.",
  },
  {
    icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z",
    title: "Direct messages",
    body: "Private one-to-one chats with accountability partners — voice notes, images, and video included.",
  },
  {
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016Z",
    title: "KDP-focused curriculum",
    body: "Keyword research, AMS ads, series strategy, and royalty math taught by authors who ship.",
  },
  {
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 9v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    title: "One transparent price",
    body: "Pay once in naira through Paystack and get full access. No upsells, no surprise tiers.",
  },
];

const steps = [
  { n: "01", t: "Create your account", b: "Sign up with your email and verify the 6-digit code we send you." },
  { n: "02", t: "Activate membership", b: "Review the academy terms and check out securely in naira with Paystack." },
  { n: "03", t: "Join the rooms", b: "Hop into mentorship groups, follow announcements, and start shipping books." },
];

export default function Landing() {
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const user = me?.user;

  const cta =
    user && user.emailVerified
      ? user.membershipStatus === "active" || user.isAdmin
        ? { to: "/app/groups", label: "Open the academy" }
        : { to: "/paywall", label: "Activate membership" }
      : { to: "/auth", label: "Create your account" };

  return (
    <div className="app-bg min-h-screen">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-sm font-bold">
            O
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            Omnivex Academy
          </span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <a href="#how" className="hidden text-mist transition hover:text-white sm:block">
            How it works
          </a>
          <a href="#features" className="hidden text-mist transition hover:text-white sm:block">
            Features
          </a>
          <Link
            to={user ? cta.to : "/auth"}
            className="btn-primary focus-ring rounded-xl px-4 py-2 font-medium"
          >
            {user ? "Open app" : "Sign in"}
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 text-center sm:pt-16">
        <span className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs text-mist">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          The KDP mentorship community
        </span>
        <h1 className="animate-fade-up mx-auto mt-5 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Publish smarter.
          <br />
          <span className="bg-gradient-to-r from-white via-white to-accent bg-clip-text text-transparent">
            Grow royalties together.
          </span>
        </h1>
        <p className="animate-fade-up mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-mist sm:text-base">
          Omnivex Academy is a private community for Amazon KDP authors —
          live mentorship rooms, direct mentor access, and a proven playbook
          for covers, keywords, ads, and launches.
        </p>
        <div className="animate-fade-up mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to={cta.to}
            className="btn-primary focus-ring w-full rounded-xl px-7 py-3.5 text-sm font-semibold sm:w-auto"
          >
            {cta.label}
          </Link>
          <Link
            to="/auth"
            className="btn-ghost focus-ring w-full rounded-xl px-7 py-3.5 text-sm font-semibold sm:w-auto"
          >
            I already have an account
          </Link>
        </div>

        {settings?.priceKobo ? (
          <p className="mt-4 text-xs text-mist">
            Full membership ·{" "}
            <span className="font-semibold text-white">
              {naira(settings.priceKobo)}
            </span>{" "}
            one-time · paid in naira
          </p>
        ) : null}

        {/* Hero mock */}
        <div className="relative mx-auto mt-12 max-w-4xl">
          <div className="card overflow-hidden rounded-2xl p-3 text-left sm:p-4">
            <div className="flex items-center gap-1.5 border-b border-line px-2 pb-3">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
              <span className="ml-3 truncate text-[11px] text-mist">
                omnivex.academy / launch-lab
              </span>
            </div>
            <div className="space-y-2 p-2">
              <div className="rounded-xl bg-surface/80 p-3">
                <p className="text-xs font-semibold text-white">Live mentorship rooms</p>
                <p className="mt-0.5 truncate text-xs text-mist">
                  Post a cover, blurb, or launch plan and get structured feedback from mentors and peers.
                </p>
              </div>
              <div className="rounded-xl bg-surface/80 p-3">
                <p className="text-xs font-semibold text-white">Voice notes, images &amp; video</p>
                <p className="mt-0.5 truncate text-xs text-mist">
                  Share a voice-note walkthrough or a screenshot — every format works in every chat.
                </p>
              </div>
              <div className="rounded-xl bg-surface/80 p-3">
                <p className="text-xs font-semibold text-white">Announcements &amp; DMs</p>
                <p className="mt-0.5 truncate text-xs text-mist">
                  Follow official updates and message accountability partners one-to-one.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Everything a KDP author needs, in one calm place
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <div
              key={f.title}
              className="card group rounded-2xl p-6 transition hover:border-accent"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-white transition group-hover:bg-accent">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                </svg>
              </span>
              <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
          From signup to your first live room in minutes
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="card relative rounded-2xl p-6">
              <span className="text-3xl font-black text-accent/60">{s.n}</span>
              <h3 className="mt-3 text-base font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist">{s.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonial */}
      <section className="mx-auto max-w-3xl px-5 py-14 text-center">
        <blockquote className="text-lg leading-relaxed text-white/90 sm:text-xl">
          Built for authors who want an accountable team — structured rooms,
          direct mentor access, and a proven playbook for covers, keywords,
          ads, and launches.
        </blockquote>
        <p className="mt-4 text-sm text-mist">
          Everything you need to publish smarter, in one calm place.
        </p>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-6">
        <div className="card relative overflow-hidden rounded-3xl p-8 text-center sm:p-12">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(500px 200px at 50% 0%, rgba(40,13,255,0.35), transparent 70%)",
            }}
          />
          <h2 className="relative text-2xl font-bold tracking-tight sm:text-3xl">
            Ready to publish with a team behind you?
          </h2>
          <p className="relative mx-auto mt-3 max-w-md text-sm text-mist">
            Create your account, verify your email, and activate membership —
            it takes under five minutes.
          </p>
          <Link
            to={cta.to}
            className="btn-primary focus-ring relative mt-7 inline-block rounded-xl px-8 py-3.5 text-sm font-semibold"
          >
            {cta.label}
          </Link>
        </div>
      </section>

      <footer className="border-t border-line px-5 py-8 text-center text-xs text-mist">
        © {new Date().getFullYear()} Omnivex Academy · Built for authors who ship.
      </footer>
    </div>
  );
}
