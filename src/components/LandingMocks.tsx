/**
 * Landing-page previews of the real academy interface.
 *
 * Static, marketing-safe mockups built from the same design tokens as the
 * product (`.card`, accent, line, mist) so the landing page shows what the
 * academy actually looks like instead of generic art. The Academy is a
 * mentorship — these previews show mentorship feedback and community life,
 * never course/lesson structures.
 */

function Avatar({
  initials,
  className = "",
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${className}`}
    >
      {initials}
    </span>
  );
}

const MENTOR_TAG = (
  <span className="rounded-md border border-[#8b5cf6]/50 bg-[#8b5cf6]/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.14em] text-[#c4b5fd]">
    Mentor
  </span>
);

const TONES = {
  violet: "bg-[#2a1b5e] text-[#c4b5fd]",
  indigo: "bg-[#1c2a66] text-[#a5b4fc]",
  rose: "bg-[#4c1d3d] text-[#f9a8d4]",
  teal: "bg-[#103c40] text-[#7dd3c8]",
} as const;

/* ------------------------------------------------------------------ */
/* Mentorship thread                                                    */
/* ------------------------------------------------------------------ */

export function MentorshipMock() {
  return (
    <div className="card rounded-2xl p-5 text-left">
      <div className="flex items-start gap-2.5">
        <Avatar initials="JO" className={TONES.indigo} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold">
            James O. <span className="font-normal text-mist/50">Yesterday</span>
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/90">
            Book two slipped off page one — what do I change first?
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2.5">
        <Avatar initials="CN" className={TONES.violet} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold">
            Chidinma O. {MENTOR_TAG}
          </p>
          <div className="mb-1.5 rounded-md border-l-2 border-[#8b5cf6]/70 bg-black/40 px-2.5 py-1 text-[11px] text-mist">
            James O.: Book two slipped off page one — what do I change…
          </div>
          <p className="text-[12.5px] leading-relaxed text-white/90">
            Change nothing yet — ranking needs a week of steady sales to
            settle. Check your categories and also-buyes first, and let the
            organic climb show us what to fix next.
          </p>

          {/* Voice note */}
          <div className="mt-2.5 flex max-w-[230px] items-center gap-2.5 rounded-xl border border-line bg-black/40 p-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#8b5cf6] text-white">
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span className="flex h-6 flex-1 items-center gap-[3px]">
              {[8, 14, 10, 18, 22, 12, 16, 9, 20, 13, 7, 15, 11, 17, 8].map(
                (h, i) => (
                  <span
                    key={i}
                    className="w-[3px] rounded-full bg-[#a78bfa]/70"
                    style={{ height: `${h}px` }}
                  />
                ),
              )}
            </span>
            <span className="shrink-0 text-[10px] text-mist/60">0:38</span>
          </div>
        </div>
      </div>

      <p className="mt-4 border-t border-line/60 pt-3 text-[11px] text-mist/70">
        3 publishers replied ·{" "}
        <span className="font-semibold text-[#c4b5fd]">Open mentorship room</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Community + announcements                                            */
/* ------------------------------------------------------------------ */

export function CommunityMock() {
  return (
    <div className="card rounded-2xl p-5 text-left">
      <div className="rounded-xl border border-line bg-black/40 p-4">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#c4b5fd]">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 11 18-5v12L3 14v-3z" />
            <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
          </svg>
          Announcement · The Academy
          <svg viewBox="0 0 24 24" className="ml-auto h-3 w-3 text-mist/50" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
        </div>
        <p className="mt-2 text-[13px] font-bold">
          Launch Week Teardown — Saturday, 7:00pm WAT
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-mist">
          Bring your numbers. We&apos;ll review positioning, covers and ranking
          together, live in the mentorship room.
        </p>
        <p className="mt-2.5 text-[10.5px] text-mist/60">Read by 128 members</p>
      </div>

      <div className="mt-4 flex items-start gap-2.5">
        <Avatar initials="EO" className={TONES.rose} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold">
            Emeka O.{" "}
            <span className="ml-1 rounded-full bg-success/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-success">
              Win
            </span>
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/90">
            Page one for my main keyword today. The category change from last
            week&apos;s session did it.
          </p>
          <p className="mt-1.5 text-[10.5px] text-mist/60">12 replies</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-line/60 pt-3.5">
        <span className="flex -space-x-2">
          <Avatar initials="AN" className={`${TONES.violet} ring-2 ring-black`} />
          <Avatar initials="TA" className={`${TONES.indigo} ring-2 ring-black`} />
          <Avatar initials="FB" className={`${TONES.teal} ring-2 ring-black`} />
          <Avatar initials="+9" className={`${TONES.rose} ring-2 ring-black`} />
        </span>
        <span className="text-[11px] text-mist/80">38 publishers active today</span>
      </div>
    </div>
  );
}
