import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMe, useSettings } from "../hooks";
import { naira } from "../lib/api";
import { CommunityMock, MentorshipMock } from "../components/LandingMocks";

/** Wraps children in a fade-up reveal the first time they scroll into view. */
function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -60px 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${shown ? "animate-fade-up" : "opacity-0"} ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#a78bfa]">
      {children}
    </p>
  );
}

const paths = [
  {
    icon: "M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25",
    title: "New to KDP? Start Here.",
    body: "You don’t need previous publishing experience. Learn the fundamentals, understand the business, and develop the knowledge to approach your first publishing projects with confidence.",
  },
  {
    icon: "M2.25 18 9 11.25l4.306 4.307a11.95 11.95 0 0 1 5.814-5.519l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941",
    title: "Already Publishing? Go Further.",
    body: "Refine your strategies, explore better opportunities, strengthen your organic ranking and sales, and learn how to grow your catalogue and royalties.",
  },
];

const benefits = [
  {
    title: "Mentorship That Moves You Forward",
    body: "Bring questions, publishing ideas, and challenges into mentorship rooms where you can seek constructive feedback.",
    mock: <MentorshipMock />,
  },
  {
    title: "A Community Built Around Growth",
    body: "Connect with fellow publishers, participate in discussions, follow important announcements, and build accountability into your journey.",
    mock: <CommunityMock />,
  },
];

const steps = [
  {
    n: "01",
    t: "Create your account",
    b: "Register and verify your email.",
  },
  {
    n: "02",
    t: "Activate your membership",
    b: "Review the terms and pay securely through Paystack.",
  },
  {
    n: "03",
    t: "Enter the academy",
    b: "Access the available learning resources, mentorship rooms, and community features.",
  },
];

const included = [
  "Hands-on KDP guidance — keywords, covers, ranking, launches, royalties",
  "Live mentorship rooms with feedback from mentors",
  "Private messages with voice notes, images, and video",
  "Official announcements with instant notifications",
  "A community of publishers building in public, together",
  "One payment, ongoing access — no tiers, no upsells",
];

export default function Landing() {
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const user = me?.user;

  const isMember =
    !!user && (user.membershipStatus === "active" || user.isAdmin);

  const cta =
    user && user.emailVerified
      ? isMember
        ? { to: "/app/groups", label: "Open the academy" }
        : { to: "/paywall", label: "Activate membership" }
      : { to: "/auth", label: "Join Omnivex Academy" };

  const signInTo =
    user && user.emailVerified ? (isMember ? "/app/groups" : "/paywall") : "/auth?mode=signin";

  return (
    <div className="min-h-screen bg-ink">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-line/50 bg-ink/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link to="/" className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt=""
              className="h-9 w-9 rounded-xl ring-1 ring-white/10"
            />
            <span className="text-[15px] font-semibold tracking-tight">
              Omnivex Academy
            </span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm md:flex">
            <a href="#gain" className="text-mist transition hover:text-white">
              Inside the academy
            </a>
            <a href="#how" className="text-mist transition hover:text-white">
              How it works
            </a>
            <a href="#pricing" className="text-mist transition hover:text-white">
              Membership
            </a>
          </nav>
          <div className="flex items-center gap-3">
            {!user && (
              <Link
                to="/auth?mode=signin"
                className="hidden text-sm text-mist transition hover:text-white sm:block"
              >
                Sign in
              </Link>
            )}
            <Link
              to={cta.to}
              className="btn-primary focus-ring rounded-xl px-4 py-2 text-sm font-medium"
            >
              {user ? "Open app" : "Join"}
            </Link>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------- 1. Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(900px 420px at 50% -120px, rgba(139,92,246,0.22), transparent 65%), radial-gradient(700px 380px at 85% 10%, rgba(40,13,255,0.16), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-14 text-center sm:pt-20">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#8b5cf6]/40 bg-[#8b5cf6]/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#c4b5fd]">
              The Amazon KDP Mentorship Community
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mx-auto mt-7 max-w-3xl text-[2.5rem] font-bold leading-[1.04] tracking-tight sm:text-6xl">
              Start Your KDP Journey.
              <br />
              <span className="bg-gradient-to-r from-[#8b5cf6] via-[#a78bfa] to-[#c4b5fd] bg-clip-text text-transparent">
                Build Beyond Your Limits.
              </span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mx-auto mt-6 max-w-2xl text-[15px] leading-relaxed text-mist sm:text-base">
              Whether you’re publishing your first book or looking to take your
              existing catalogue to the next level, Omnivex gives you the
              knowledge, mentorship, and community to grow with purpose.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={cta.to}
                className="btn-primary focus-ring w-full rounded-xl px-8 py-3.5 text-sm font-semibold sm:w-auto"
              >
                {cta.label}
              </Link>
              <Link
                to={signInTo}
                className="btn-ghost focus-ring w-full rounded-xl px-8 py-3.5 text-sm font-semibold sm:w-auto"
              >
                Already a Member? Sign In
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* -------------------------------------------------- 2. Two paths */}
      <section id="paths" className="relative">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <Reveal className="text-center">
            <Eyebrow>For every stage</Eyebrow>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              Two paths. One academy.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-mist">
              You don’t need experience to begin — and you don’t need to be a
              beginner to belong.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {paths.map((p, i) => (
              <Reveal key={p.title} delay={i * 100}>
                <div className="card group h-full rounded-2xl p-7 transition duration-300 hover:border-[#8b5cf6]/60 sm:p-8">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#8b5cf6]/12 text-[#a78bfa] ring-1 ring-[#8b5cf6]/30 transition group-hover:bg-[#8b5cf6]/20">
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.7}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d={p.icon}
                      />
                    </svg>
                  </span>
                  <h3 className="mt-5 text-xl font-bold tracking-tight">
                    {p.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-mist sm:text-[15px]">
                    {p.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------- 3. What you'll gain */}
      <section id="gain" className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(800px 400px at 0% 30%, rgba(139,92,246,0.10), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <Reveal className="text-center">
            <Eyebrow>Inside the academy</Eyebrow>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              What you’ll gain inside Omnivex
            </h2>
          </Reveal>

          <div className="mt-12 space-y-16 sm:mt-16 sm:space-y-24">
            {benefits.map((b, i) => (
              <Reveal key={b.title}>
                <div className="grid items-center gap-8 lg:gap-14 lg:grid-cols-2">
                  <div className={i % 2 === 1 ? "lg:order-2" : ""}>
                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[#a78bfa]">
                      0{i + 1}
                    </span>
                    <h3 className="mt-3 text-2xl font-bold tracking-tight sm:text-[1.75rem]">
                      {b.title}
                    </h3>
                    <p className="mt-4 max-w-md text-[15px] leading-relaxed text-mist">
                      {b.body}
                    </p>
                  </div>
                  <div className={i % 2 === 1 ? "lg:order-1" : ""}>
                    {b.mock}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------- 4. Getting started */}
      <section id="how" className="relative">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <Reveal className="text-center">
            <Eyebrow>Getting started</Eyebrow>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              Your Next Chapter Starts in Three Steps.
            </h2>
          </Reveal>
          <div className="relative mt-10 grid gap-4 md:grid-cols-3 md:gap-5">
            {/* connective line between the step numerals (desktop) */}
            <div
              className="pointer-events-none absolute left-[16.5%] right-[16.5%] top-7 hidden h-px md:block"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(139,92,246,0.55), rgba(139,92,246,0.55), transparent)",
              }}
            />
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 90}>
                <div className="card h-full rounded-2xl p-6 text-center transition duration-300 hover:border-[#8b5cf6]/50">
                  <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-b from-[#8b5cf6]/25 to-[#8b5cf6]/5 text-xl font-black text-[#c4b5fd] ring-1 ring-[#8b5cf6]/40">
                    {s.n}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-mist">{s.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------- 5. Membership */}
      <section id="pricing" className="relative">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <Reveal className="text-center">
            <Eyebrow>Membership</Eyebrow>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              One Membership. A World of Publishing Knowledge.
            </h2>
          </Reveal>
          <Reveal delay={100} className="mt-10">
            <div className="card relative mx-auto max-w-2xl overflow-hidden rounded-3xl">
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-40"
                style={{
                  background:
                    "radial-gradient(500px 160px at 50% 0%, rgba(139,92,246,0.20), transparent 70%)",
                }}
              />
              <div className="relative p-7 text-center sm:p-10">
                {settings?.priceKobo ? (
                  <>
                    <p className="text-sm font-medium text-mist">
                      Full academy membership
                    </p>
                    <p className="mt-3 text-5xl font-black tracking-tight text-white">
                      {naira(settings.priceKobo)}
                    </p>
                    <p className="mt-2 text-sm text-mist">
                      One-time payment · ongoing access · paid in naira
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-mist">
                      Full academy membership
                    </p>
                    <p className="mt-3 text-2xl font-black tracking-tight text-white">
                      One membership, full access
                    </p>
                    <p className="mt-2 text-sm text-mist">
                      The current price is shown before you pay — no hidden
                      fees.
                    </p>
                  </>
                )}

                <ul className="mx-auto mt-8 max-w-md space-y-3 text-left">
                  {included.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm">
                      <svg
                        className="mt-0.5 h-4 w-4 shrink-0 text-[#a78bfa]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m20 6-11 11-5-5" />
                      </svg>
                      <span className="leading-relaxed text-white/90">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  to={cta.to}
                  className="btn-primary focus-ring mt-9 inline-block w-full rounded-xl px-8 py-3.5 text-sm font-semibold sm:w-auto"
                >
                  {isMember ? "Open the academy" : "Join Omnivex Academy"}
                </Link>

                <p className="mx-auto mt-5 max-w-md text-xs leading-relaxed text-mist/80">
                  Payment is processed securely by Paystack. You’ll review and
                  accept the academy’s current terms
                  {settings?.termsVersion ? ` (v${settings.termsVersion})` : ""} before paying.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------- 6. Final CTA + footer */}
      <section className="relative overflow-hidden border-t border-line/40">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(700px 320px at 50% 115%, rgba(139,92,246,0.30), transparent 65%), radial-gradient(500px 220px at 50% 130%, rgba(40,13,255,0.22), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-5 py-20 text-center sm:py-28">
          <Reveal>
            <h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-[2.75rem]">
              Your KDP Journey Can Start Here.
              <br />
              <span className="bg-gradient-to-r from-[#8b5cf6] via-[#a78bfa] to-[#c4b5fd] bg-clip-text text-transparent">
                Your Growth Doesn’t Have to Stop There.
              </span>
            </h2>
          </Reveal>
          <Reveal delay={100}>
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-mist">
              Whether you’re taking your first step or building on years of
              experience, Omnivex is here to help you learn, improve, and move
              forward.
            </p>
          </Reveal>
          <Reveal delay={180}>
            <Link
              to={cta.to}
              className="btn-primary focus-ring mt-9 inline-block rounded-xl px-9 py-4 text-sm font-semibold"
            >
              {isMember ? "Open the academy" : "Enter Omnivex Academy"} →
            </Link>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-line/50 bg-ink">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-10 text-sm sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt=""
              className="h-8 w-8 rounded-lg ring-1 ring-white/10"
            />
            <div className="text-left">
              <p className="text-sm font-semibold">Omnivex Academy</p>
              <p className="text-xs text-mist">
                The Amazon KDP mentorship community.
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-mist">
            <a href="#gain" className="transition hover:text-white">
              Inside the academy
            </a>
            <a href="#how" className="transition hover:text-white">
              How it works
            </a>
            <a href="#pricing" className="transition hover:text-white">
              Membership
            </a>
            <Link to="/auth?mode=signin" className="transition hover:text-white">
              Sign in
            </Link>
            <a
              href="mailto:hello@omnivex-academy.xyz"
              className="transition hover:text-white"
            >
              Support
            </a>
          </nav>
          <p className="text-xs text-mist/70">
            © {new Date().getFullYear()} Omnivex Academy. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
